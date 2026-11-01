// S08, degrau 1: o vídeo do apresentador decodificado no NVDEC (cuvid), direto para a memória da placa. Nenhum quadro
// decodificado passa pela CPU: o ffmpeg só separa os pacotes do contêiner (`-c copy`, Annex B), o analisador do cuvid
// lê os cabeçalhos e o NVDEC decodifica. Cada quadro exibido é copiado (placa → placa) para um buffer NV12 nosso, de
// passo = largura, porque as superfícies do decodificador voltam a ser usadas.
//
// Quadro i = o i-ésimo na ordem de exibição, a mesma ordem dos pts ordenados da sonda (midia-linha.ts, indiceNoVideo).
// Para a frente, sem reabrir; pedir um quadro já descartado reabre do começo (como o LeitorDeVideo do ffmpeg).
use cudarc::driver::sys::*;
use nvidia_video_codec_sdk::sys::cuviddec::*;
use nvidia_video_codec_sdk::sys::nvcuvid::*;
use std::collections::VecDeque;
use std::ffi::c_void;
use std::io::Read;
use std::process::{Child, ChildStdout, Command, Stdio};

/// Pedaço do fluxo Annex B dado ao analisador por vez: poucos quadros de cada vez, para a fila de exibidos ficar curta.
const PEDACO: usize = 64 * 1024;
/// Exibidos guardados a partir do pedido (um pedaço com muitos quadros pequenos, num vídeo quase parado). Os que passam
/// disso não são copiados; se um deles for pedido depois, o vídeo é reaberto (como pedir para trás).
const FILA_MAXIMA: usize = 64;

/// Lê do ffmpeg repetindo a leitura interrompida por um sinal (EINTR, `os error 4`): o `read` da std devolve o erro em
/// vez de repetir quando o tratador do sinal não tem SA_RESTART (no Node ou no host do CEF, com os filhos do ffmpeg e do
/// navegador saindo). Nada foi lido numa leitura interrompida; repetir é seguro.
fn ler_repetindo(fonte: &mut impl Read, pedaco: &mut [u8]) -> std::io::Result<usize> {
    loop {
        match fonte.read(pedaco) {
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            r => return r,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CodecVideo {
    H264,
    Hevc,
}

impl CodecVideo {
    pub fn de(nome: &str) -> Result<Self, String> {
        match nome {
            "h264" => Ok(Self::H264),
            "hevc" => Ok(Self::Hevc),
            outro => Err(format!(
                "codec de vídeo «{outro}»: o NVDEC do motor lê h264 e hevc"
            )),
        }
    }
    fn cuvid(self) -> cudaVideoCodec {
        match self {
            Self::H264 => cudaVideoCodec::cudaVideoCodec_H264,
            Self::Hevc => cudaVideoCodec::cudaVideoCodec_HEVC,
        }
    }
    fn ffmpeg(self) -> (&'static str, &'static str) {
        match self {
            Self::H264 => ("h264_mp4toannexb", "h264"),
            Self::Hevc => ("hevc_mp4toannexb", "hevc"),
        }
    }
}

fn cu(r: CUresult, contexto: &str) -> Result<(), String> {
    if r == CUresult::CUDA_SUCCESS {
        Ok(())
    } else {
        Err(format!("{contexto}: {r:?}"))
    }
}

/// Um quadro NV12 na placa: Y (largura × altura) seguido do UV intercalado (largura × altura / 2), passo = largura.
pub struct QuadroNv12 {
    pub ptr: CUdeviceptr,
}

/// Estado que as funções de retorno do analisador mexem (pUserData). Fica numa caixa: o endereço não muda.
struct Estado {
    codec: CodecVideo,
    largura: u32,
    altura: u32,
    trava: CUvideoctxlock,
    decodificador: CUvideodecoder,
    /// Altura da superfície de saída (a do alvo): o UV começa em passo × essa altura.
    altura_superficie: u32,
    /// Quadros exibidos ainda guardados: (índice na ordem de exibição, buffer).
    exibidos: VecDeque<(u32, CUdeviceptr)>,
    livres: Vec<CUdeviceptr>,
    contados: u32,
    /// Exibidos desde a abertura, somando as reaberturas.
    total: u32,
    erro: Option<String>,
    /// O quadro pedido agora: os exibidos antes dele não são copiados.
    alvo: u32,
    /// O primeiro exibido que não coube na fila (não copiado), se houve.
    lacuna: Option<u32>,
}

impl Estado {
    fn tamanho(&self) -> usize {
        self.largura as usize * self.altura as usize * 3 / 2
    }

    fn buffer(&mut self) -> Result<CUdeviceptr, String> {
        if let Some(b) = self.livres.pop() {
            return Ok(b);
        }
        let mut p: CUdeviceptr = 0;
        cu(unsafe { cuMemAlloc_v2(&mut p, self.tamanho()) }, "cuMemAlloc")?;
        Ok(p)
    }

    fn sequencia(&mut self, formato: &CUVIDEOFORMAT) -> Result<i32, String> {
        let superficies = i32::from(formato.min_num_decode_surfaces).max(1) + 4;
        if formato.chroma_format != cudaVideoChromaFormat::cudaVideoChromaFormat_420
            || formato.bit_depth_luma_minus8 != 0
            || formato.bit_depth_chroma_minus8 != 0
        {
            return Err(format!(
                "vídeo {:?} de {} bits: o motor lê 4:2:0 de 8 bits",
                formato.chroma_format,
                formato.bit_depth_luma_minus8 + 8
            ));
        }
        let area = formato.display_area;
        let (l, a) = ((area.right - area.left) as u32, (area.bottom - area.top) as u32);
        if (l, a) != (self.largura, self.altura) {
            return Err(format!(
                "o NVDEC vê {l}x{a}, a sonda disse {}x{}",
                self.largura, self.altura
            ));
        }
        if !self.decodificador.is_null() {
            // Mesmo tamanho: o decodificador serve (cabeçalho repetido em cada IDR).
            return Ok(superficies);
        }
        let mut info: CUVIDDECODECREATEINFO = unsafe { std::mem::zeroed() };
        info.ulWidth = formato.coded_width.into();
        info.ulHeight = formato.coded_height.into();
        info.ulMaxWidth = formato.coded_width.into();
        info.ulMaxHeight = formato.coded_height.into();
        info.ulNumDecodeSurfaces = superficies as _;
        info.CodecType = self.codec.cuvid();
        info.ChromaFormat = cudaVideoChromaFormat::cudaVideoChromaFormat_420;
        info.ulCreationFlags = cudaVideoCreateFlags::cudaVideoCreate_PreferCUVID as _;
        info.display_area.left = area.left as i16;
        info.display_area.top = area.top as i16;
        info.display_area.right = area.right as i16;
        info.display_area.bottom = area.bottom as i16;
        info.OutputFormat = cudaVideoSurfaceFormat::cudaVideoSurfaceFormat_NV12;
        info.DeinterlaceMode = cudaVideoDeinterlaceMode::cudaVideoDeinterlaceMode_Weave;
        info.ulTargetWidth = l.into();
        info.ulTargetHeight = a.into();
        info.ulNumOutputSurfaces = 2;
        info.vidLock = self.trava;
        cu(
            unsafe { cuvidCreateDecoder(&mut self.decodificador, &mut info) },
            "cuvidCreateDecoder",
        )?;
        self.altura_superficie = a;
        Ok(superficies)
    }

    fn exibir(&mut self, info: &CUVIDPARSERDISPINFO) -> Result<(), String> {
        let indice = self.contados;
        self.contados += 1;
        self.total += 1;
        if indice < self.alvo {
            return Ok(()); // antes do pedido: decodificado (é referência), sem cópia
        }
        if self.exibidos.len() >= FILA_MAXIMA {
            self.lacuna.get_or_insert(indice);
            return Ok(());
        }
        let mut proc: CUVIDPROCPARAMS = unsafe { std::mem::zeroed() };
        proc.progressive_frame = info.progressive_frame;
        proc.top_field_first = info.top_field_first;
        let (mut ptr, mut passo) = (0u64, 0u32);
        cu(
            unsafe {
                cuvidMapVideoFrame64(
                    self.decodificador,
                    info.picture_index,
                    &mut ptr,
                    &mut passo,
                    &mut proc,
                )
            },
            "cuvidMapVideoFrame",
        )?;
        let destino = self.buffer();
        let r = destino.and_then(|destino| {
            let (l, a) = (self.largura as usize, self.altura as usize);
            // Y e UV, cada um num cuMemcpy2D (placa → placa).
            for (origem, destino, linhas) in [
                (ptr, destino, a),
                (
                    ptr + u64::from(passo) * u64::from(self.altura_superficie),
                    destino + (l * a) as u64,
                    a / 2,
                ),
            ] {
                let copia = CUDA_MEMCPY2D {
                    srcXInBytes: 0,
                    srcY: 0,
                    srcMemoryType: CUmemorytype::CU_MEMORYTYPE_DEVICE,
                    srcHost: std::ptr::null(),
                    srcDevice: origem,
                    srcArray: std::ptr::null_mut(),
                    srcPitch: passo as usize,
                    dstXInBytes: 0,
                    dstY: 0,
                    dstMemoryType: CUmemorytype::CU_MEMORYTYPE_DEVICE,
                    dstHost: std::ptr::null_mut(),
                    dstDevice: destino,
                    dstArray: std::ptr::null_mut(),
                    dstPitch: l,
                    WidthInBytes: l,
                    Height: linhas,
                };
                cu(unsafe { cuMemcpy2D_v2(&copia) }, "cuMemcpy2D do quadro")?;
            }
            // A cópia de placa para placa pode voltar antes de acabar: a superfície só é desmapeada (e reaproveitada pelo
            // decodificador) depois dela.
            cu(unsafe { cuCtxSynchronize() }, "esperar a cópia do quadro")?;
            Ok(destino)
        });
        let desmapear = cu(
            unsafe { cuvidUnmapVideoFrame64(self.decodificador, ptr) },
            "cuvidUnmapVideoFrame",
        );
        let destino = r?;
        desmapear?;
        self.exibidos.push_back((indice, destino));
        Ok(())
    }
}

unsafe extern "C" fn ao_sequenciar(dados: *mut c_void, formato: *mut CUVIDEOFORMAT) -> i32 {
    let e = unsafe { &mut *(dados as *mut Estado) };
    match e.sequencia(unsafe { &*formato }) {
        Ok(n) => n,
        Err(erro) => {
            e.erro.get_or_insert(erro);
            0
        }
    }
}

unsafe extern "C" fn ao_decodificar(dados: *mut c_void, imagem: *mut CUVIDPICPARAMS) -> i32 {
    let e = unsafe { &mut *(dados as *mut Estado) };
    if e.decodificador.is_null() {
        e.erro.get_or_insert("imagem antes do cabeçalho".into());
        return 0;
    }
    match cu(
        unsafe { cuvidDecodePicture(e.decodificador, imagem) },
        "cuvidDecodePicture",
    ) {
        Ok(()) => 1,
        Err(erro) => {
            e.erro.get_or_insert(erro);
            0
        }
    }
}

unsafe extern "C" fn ao_exibir(dados: *mut c_void, info: *mut CUVIDPARSERDISPINFO) -> i32 {
    let e = unsafe { &mut *(dados as *mut Estado) };
    if info.is_null() {
        return 1; // fim do fluxo
    }
    match e.exibir(unsafe { &*info }) {
        Ok(()) => 1,
        Err(erro) => {
            e.erro.get_or_insert(erro);
            0
        }
    }
}

/// Decodificador de um arquivo. A CUDA tem de estar corrente na thread que o usa (a do NVENC).
pub struct Decodificador {
    arquivo: String,
    ffmpeg: String,
    estado: Box<Estado>,
    analisador: CUvideoparser,
    filho: Option<Child>,
    saida: Option<ChildStdout>,
    acabou: bool,
    /// O último índice entregue (o buffer dele fica guardado até o próximo pedido).
    ultimo: Option<u32>,
    pub reaberturas: u32,
    /// Bytes do fluxo comprimido lidos do ffmpeg (a única coisa do vídeo que passa pela CPU).
    pub bytes: u64,
}

impl Decodificador {
    pub fn abrir(
        contexto: CUcontext,
        arquivo: &str,
        ffmpeg: &str,
        codec: CodecVideo,
        largura: u32,
        altura: u32,
    ) -> Result<Self, String> {
        if largura % 2 != 0 || altura % 2 != 0 || largura == 0 || altura == 0 {
            return Err(format!("tamanho {largura}x{altura}: o motor lê vídeo de tamanho par"));
        }
        let mut trava: CUvideoctxlock = std::ptr::null_mut();
        cu(unsafe { cuvidCtxLockCreate(&mut trava, contexto) }, "cuvidCtxLockCreate")?;
        let estado = Box::new(Estado {
            codec,
            largura,
            altura,
            trava,
            decodificador: std::ptr::null_mut(),
            altura_superficie: altura,
            exibidos: VecDeque::new(),
            livres: Vec::new(),
            contados: 0,
            total: 0,
            erro: None,
            alvo: 0,
            lacuna: None,
        });
        let mut d = Self {
            arquivo: arquivo.to_string(),
            ffmpeg: ffmpeg.to_string(),
            estado,
            analisador: std::ptr::null_mut(),
            filho: None,
            saida: None,
            acabou: false,
            ultimo: None,
            reaberturas: 0,
            bytes: 0,
        };
        d.reabrir()?;
        Ok(d)
    }

    /// Fecha o ffmpeg e o analisador (o decodificador e os buffers ficam) e começa do início do arquivo.
    fn reabrir(&mut self) -> Result<(), String> {
        self.fechar_fluxo();
        let e = &mut *self.estado;
        while let Some((_, b)) = e.exibidos.pop_front() {
            e.livres.push(b);
        }
        e.contados = 0;
        e.erro = None;
        e.lacuna = None;
        self.acabou = false;
        self.ultimo = None;
        let (bsf, formato) = e.codec.ffmpeg();
        let mut filho = Command::new(&self.ffmpeg)
            .args(["-hide_banner", "-v", "error", "-nostdin", "-i"])
            .arg(&self.arquivo)
            .args(["-map", "0:v:0", "-c:v", "copy", "-bsf:v", bsf, "-f", formato, "pipe:1"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|erro| format!("ffmpeg ({}): {erro}", self.ffmpeg))?;
        self.saida = filho.stdout.take();
        self.filho = Some(filho);
        let mut params: CUVIDPARSERPARAMS = unsafe { std::mem::zeroed() };
        params.CodecType = e.codec.cuvid();
        params.ulMaxNumDecodeSurfaces = 1;
        params.ulMaxDisplayDelay = 0;
        params.pUserData = e as *mut Estado as *mut c_void;
        params.pfnSequenceCallback = Some(ao_sequenciar);
        params.pfnDecodePicture = Some(ao_decodificar);
        params.pfnDisplayPicture = Some(ao_exibir);
        cu(
            unsafe { cuvidCreateVideoParser(&mut self.analisador, &mut params) },
            "cuvidCreateVideoParser",
        )
    }

    fn fechar_fluxo(&mut self) {
        if !self.analisador.is_null() {
            let _ = unsafe { cuvidDestroyVideoParser(self.analisador) };
            self.analisador = std::ptr::null_mut();
        }
        self.saida = None;
        if let Some(mut f) = self.filho.take() {
            let _ = f.kill();
            let _ = f.wait();
        }
    }

    /// Dá ao analisador o próximo pedaço do fluxo (ou o fim). Devolve false se o fluxo já tinha acabado.
    fn alimentar(&mut self) -> Result<bool, String> {
        if self.acabou {
            return Ok(false);
        }
        let mut pedaco = vec![0u8; PEDACO];
        let n = match self.saida.as_mut() {
            Some(s) => ler_repetindo(s, &mut pedaco).map_err(|e| format!("lendo o ffmpeg: {e}"))?,
            None => 0,
        };
        let mut pacote: CUVIDSOURCEDATAPACKET = unsafe { std::mem::zeroed() };
        if n == 0 {
            self.acabou = true;
            pacote.flags = CUvideopacketflags::CUVID_PKT_ENDOFSTREAM as _;
        } else {
            self.bytes += n as u64;
            pacote.payload_size = n as _;
            pacote.payload = pedaco.as_ptr();
        }
        let r = cu(
            unsafe { cuvidParseVideoData(self.analisador, &mut pacote) },
            "cuvidParseVideoData",
        );
        if let Some(e) = self.estado.erro.take() {
            return Err(e);
        }
        r?;
        Ok(true)
    }

    /// O quadro `i` (ordem de exibição) em NV12 na placa. Vale até o próximo pedido.
    pub fn quadro(&mut self, i: u32) -> Result<QuadroNv12, String> {
        if self.ultimo.is_some_and(|u| i < u)
            || self.estado.exibidos.front().is_some_and(|(k, _)| i < *k)
        {
            self.reaberturas += 1;
            self.reabrir()?;
        }
        self.estado.alvo = i;
        loop {
            let e = &mut *self.estado;
            while e.exibidos.front().is_some_and(|(k, _)| *k < i) {
                let (_, b) = e.exibidos.pop_front().unwrap();
                e.livres.push(b);
            }
            if let Some((k, b)) = e.exibidos.front()
                && *k == i
            {
                self.ultimo = Some(i);
                return Ok(QuadroNv12 { ptr: *b });
            }
            // Já exibido e não guardado (passou da fila): reabre e decodifica até ele de novo.
            if i < e.contados {
                self.reaberturas += 1;
                self.reabrir()?;
                self.estado.alvo = i;
                continue;
            }
            if !self.alimentar()? {
                return Err(format!(
                    "{}: o vídeo acabou no quadro {}, pedido o {i}",
                    self.arquivo,
                    self.estado.contados.saturating_sub(1)
                ));
            }
        }
    }

    pub fn largura(&self) -> u32 {
        self.estado.largura
    }
    pub fn altura(&self) -> u32 {
        self.estado.altura
    }
    /// Quadros exibidos pelo NVDEC desde a abertura (com as reaberturas).
    pub fn exibidos(&self) -> u32 {
        self.estado.total
    }
}

impl Drop for Decodificador {
    fn drop(&mut self) {
        self.fechar_fluxo();
        let e = &mut *self.estado;
        unsafe {
            if !e.decodificador.is_null() {
                let _ = cuvidDestroyDecoder(e.decodificador);
            }
            for (_, b) in e.exibidos.drain(..) {
                let _ = cuMemFree_v2(b);
            }
            for b in e.livres.drain(..) {
                let _ = cuMemFree_v2(b);
            }
            let _ = cuvidCtxLockDestroy(e.trava);
        }
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use cudarc::driver::CudaContext;
    use std::time::Instant;

    fn tem_placa() -> bool {
        std::path::Path::new("/dev/nvidiactl").exists()
    }

    // EINTR (`os error 4`): um sinal com tratador sem SA_RESTART chegando enquanto a leitura do ffmpeg espera. O `read`
    // da std devolve o erro em vez de repetir; `ler_repetindo` repete. Linux x86_64 (o `struct sigaction` da glibc).
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    #[repr(C)]
    struct AcaoDoSinal {
        tratador: usize,
        mascara: [u64; 16],
        bandeiras: i32,
        restaurador: usize,
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    unsafe extern "C" {
        fn sigaction(sinal: i32, acao: *const AcaoDoSinal, antiga: *mut AcaoDoSinal) -> i32;
        fn pthread_self() -> usize;
        fn pthread_kill(fio: usize, sinal: i32) -> i32;
    }
    const SIGUSR2: i32 = 12;
    extern "C" fn nada(_: i32) {}

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    /// O tratador do SIGUSR2 sem SA_RESTART e uma leitura do stdout de `sh -c <script>` numa thread, que recebe
    /// `sinais` SIGUSR2 enquanto espera. Devolve o resultado da leitura.
    fn ler_com_sinais(script: &str, sinais: u32, ler: fn(&mut ChildStdout, &mut [u8]) -> std::io::Result<usize>) -> std::io::Result<Vec<u8>> {
        let acao = AcaoDoSinal { tratador: nada as extern "C" fn(i32) as usize, mascara: [0; 16], bandeiras: 0, restaurador: 0 };
        let mut antiga = AcaoDoSinal { tratador: 0, mascara: [0; 16], bandeiras: 0, restaurador: 0 };
        assert_eq!(unsafe { sigaction(SIGUSR2, &acao, &mut antiga) }, 0);
        let mut filho = Command::new("sh").args(["-c", script]).stdout(Stdio::piped()).spawn().unwrap();
        let mut saida = filho.stdout.take().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let leitor = std::thread::spawn(move || {
            tx.send(unsafe { pthread_self() }).unwrap();
            let mut pedaco = vec![0u8; 64];
            ler(&mut saida, &mut pedaco).map(|n| pedaco[..n].to_vec())
        });
        let fio = rx.recv().unwrap();
        for _ in 0..sinais {
            std::thread::sleep(std::time::Duration::from_millis(100));
            assert_eq!(unsafe { pthread_kill(fio, SIGUSR2) }, 0);
        }
        let r = leitor.join().unwrap();
        let _ = filho.kill();
        let _ = filho.wait();
        // O tratador de antes volta (o processo de teste é de todos os testes).
        assert_eq!(unsafe { sigaction(SIGUSR2, &antiga, std::ptr::null_mut()) }, 0);
        r
    }

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    #[test]
    fn leitura_do_ffmpeg_sobrevive_ao_eintr() {
        // Reproduz: o `read` direto volta com Interrupted (o «lendo o ffmpeg: … (os error 4)» do bench). Se o sinal
        // chegar antes de a thread entrar no `read` (máquina carregada), a leitura só acaba no fim do `sleep`: de novo.
        let direto = (0..5).map(|_| ler_com_sinais("sleep 1", 1, |s, b| s.read(b))).find(|r| r.is_err());
        assert_eq!(direto.map(|r| r.map_err(|e| e.kind())), Some(Err(std::io::ErrorKind::Interrupted)));
        // Corrigido: três sinais durante a espera e a leitura ainda devolve o que o ffmpeg escreveu.
        let repetido = ler_com_sinais("sleep 0.6; printf abc", 3, |s, b| ler_repetindo(s, b));
        assert_eq!(repetido.unwrap(), b"abc");
    }

    /// Pasta própria de cada teste (`nome`): os testes rodam em paralelo e cada um apaga a sua no fim.
    fn pasta(nome: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("nvdec-teste-{}-{nome}", std::process::id()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// Vídeo sintético (R01): testsrc2 com ruído, para os quadros diferirem e o H.264 ter P e B.
    fn gerar(arquivo: &std::path::Path, codec: &str, quadros: u32, b: bool) {
        let mut args = vec![
            "-v".to_string(), "error".into(), "-y".into(), "-f".into(), "lavfi".into(), "-i".into(),
            format!("testsrc2=s=1920x1080:r=25:d={},noise=alls=20:allf=t+u,format=yuv420p", f64::from(quadros) / 25.0),
            "-c:v".into(),
        ];
        if codec == "hevc" {
            args.extend(["libx265".into(), "-x265-params".into(), "log-level=error".into()]);
        } else {
            args.push("libx264".into());
        }
        args.extend(["-g".into(), "12".into(), "-bf".into(), if b { "2" } else { "0" }.into()]);
        args.push(arquivo.to_str().unwrap().into());
        let s = Command::new("ffmpeg").args(&args).status().unwrap();
        assert!(s.success(), "ffmpeg não gerou o vídeo");
    }

    /// Os quadros decodificados pelo ffmpeg (software), em I420, um atrás do outro.
    fn referencia(arquivo: &std::path::Path) -> Vec<u8> {
        let s = Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(arquivo)
            .args(["-fps_mode", "passthrough", "-pix_fmt", "yuv420p", "-f", "rawvideo", "pipe:1"])
            .output()
            .unwrap();
        assert!(s.status.success());
        s.stdout
    }

    /// NV12 da placa → I420 na CPU (só no teste).
    fn ler_i420(q: &QuadroNv12, l: usize, a: usize) -> Vec<u8> {
        let mut nv12 = vec![0u8; l * a * 3 / 2];
        cu(
            unsafe { cuMemcpyDtoH_v2(nv12.as_mut_ptr() as *mut c_void, q.ptr, nv12.len()) },
            "DtoH",
        )
        .unwrap();
        let mut i420 = nv12[..l * a].to_vec();
        let uv = &nv12[l * a..];
        i420.extend(uv.iter().step_by(2));
        i420.extend(uv.iter().skip(1).step_by(2));
        i420
    }

    fn conferir(codec: &str, b: bool) {
        let p = pasta(&format!("{codec}-{b}"));
        let arquivo = p.join(format!("v-{codec}-{b}.mp4"));
        let n = 50;
        gerar(&arquivo, codec, n, b);
        let esperado = referencia(&arquivo);
        let (l, a) = (1920usize, 1080usize);
        let q = l * a * 3 / 2;
        assert_eq!(esperado.len(), q * n as usize);
        let cuda = CudaContext::new(0).unwrap();
        let mut d = Decodificador::abrir(
            cuda.cu_ctx(),
            arquivo.to_str().unwrap(),
            "ffmpeg",
            CodecVideo::de(codec).unwrap(),
            1920,
            1080,
        )
        .unwrap();
        // Para a frente, pulando e repetindo, como o render pede (o quadro do vídeo de cada N).
        let pedidos: Vec<u32> = vec![0, 0, 1, 2, 5, 5, 6, 13, 14, 30, 49];
        for &i in &pedidos {
            let lido = ler_i420(&d.quadro(i).unwrap(), l, a);
            let ref_i = &esperado[i as usize * q..(i as usize + 1) * q];
            assert!(lido == ref_i, "{codec} (B={b}): quadro {i} difere do ffmpeg");
        }
        assert_eq!(d.reaberturas, 0);
        // Para trás reabre e dá o mesmo.
        let lido = ler_i420(&d.quadro(3).unwrap(), l, a);
        assert!(lido == esperado[3 * q..4 * q], "quadro 3 depois de reabrir");
        assert_eq!(d.reaberturas, 1);
        // Fim do vídeo: erro com a mensagem.
        let erro = d.quadro(n).err().unwrap();
        assert!(erro.contains("acabou"), "{erro}");
        drop(d);
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn nvdec_igual_ao_ffmpeg_h264() {
        if !tem_placa() {
            eprintln!("pulado: sem placa");
            return;
        }
        conferir("h264", true);
        conferir("h264", false);
    }

    #[test]
    fn nvdec_igual_ao_ffmpeg_hevc() {
        if !tem_placa() {
            eprintln!("pulado: sem placa");
            return;
        }
        conferir("hevc", true);
    }

    /// Revisão do S08: vídeo quase parado (quadros de poucas centenas de bytes), em que um pedaço do fluxo traz mais
    /// quadros que a fila. Antes, o render caía com «mais de 64 quadros exibidos»; agora os que passam não são copiados
    /// e, pedidos depois, o vídeo reabre. Os quadros saem iguais ao ffmpeg.
    #[test]
    fn nvdec_video_quase_parado() {
        if !tem_placa() {
            eprintln!("pulado: sem placa");
            return;
        }
        let p = pasta("parado");
        let arquivo = p.join("parado.mp4");
        let fonte = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
        let s = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "lavfi", "-i"])
            .arg(format!("color=c=0x203040:s=1920x1080:r=25:d=12,drawtext=fontfile={fonte}:text='%{{n}}':fontsize=20:fontcolor=white:x=10:y=10,format=yuv420p"))
            .args(["-c:v", "libx264", "-g", "300", "-bf", "0"])
            .arg(&arquivo)
            .status()
            .unwrap();
        assert!(s.success());
        let esperado = referencia(&arquivo);
        let (l, a) = (1920usize, 1080usize);
        let q = l * a * 3 / 2;
        assert_eq!(esperado.len(), q * 300);
        let tamanho = std::fs::metadata(&arquivo).unwrap().len();
        assert!(tamanho < 300 * 1024, "o vídeo tem de ser pequeno: {tamanho} bytes");
        let cuda = CudaContext::new(0).unwrap();
        let mut d = Decodificador::abrir(cuda.cu_ctx(), arquivo.to_str().unwrap(), "ffmpeg", CodecVideo::H264, 1920, 1080)
            .unwrap();
        for i in [0u32, 1, 100, 101, 250, 299] {
            let lido = ler_i420(&d.quadro(i).unwrap(), l, a);
            assert!(lido == esperado[i as usize * q..(i as usize + 1) * q], "quadro {i} difere do ffmpeg");
        }
        eprintln!("vídeo quase parado: {tamanho} bytes, {} reaberturas", d.reaberturas);
        drop(d);
        let _ = std::fs::remove_dir_all(&p);
    }

    /// Degrau 1, medida: CPU (do processo) e parede para decodificar um vídeo inteiro no NVDEC, contra o ffmpeg em
    /// software (I420 para um pipe, o que o LeitorDeVideo do P10.5 faz). Só com MOTOR_MEDIR_NVDEC=<arquivo>.
    #[test]
    #[ignore]
    fn sonda_medir_nvdec() {
        let Ok(arquivo) = std::env::var("MOTOR_MEDIR_NVDEC") else {
            eprintln!("MOTOR_MEDIR_NVDEC=<vídeo 1080p> para medir");
            return;
        };
        let cpu = || {
            let mut u: libc_rusage = unsafe { std::mem::zeroed() };
            unsafe { getrusage(-1, &mut u) }; // filhos (o ffmpeg)
            let mut s: libc_rusage = unsafe { std::mem::zeroed() };
            unsafe { getrusage(0, &mut s) };
            let t = |r: &libc_rusage| {
                r.ru_utime[0] as f64 + r.ru_utime[1] as f64 / 1e6 + r.ru_stime[0] as f64 + r.ru_stime[1] as f64 / 1e6
            };
            (t(&s), t(&u))
        };
        let sonda = Command::new("ffprobe")
            .args(["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries",
                "stream=codec_name,width,height,nb_read_frames", "-of", "csv=p=0"])
            .arg(&arquivo)
            .output()
            .unwrap();
        let linha = String::from_utf8(sonda.stdout).unwrap();
        let campos: Vec<&str> = linha.trim().split(',').collect();
        let (codec, l, a, n): (&str, u32, u32, u32) =
            (campos[0], campos[1].parse().unwrap(), campos[2].parse().unwrap(), campos[3].parse().unwrap());
        let cuda = CudaContext::new(0).unwrap();
        let (c0, f0) = cpu();
        let t0 = Instant::now();
        let mut d = Decodificador::abrir(cuda.cu_ctx(), &arquivo, "ffmpeg", CodecVideo::de(codec).unwrap(), l, a)
            .unwrap();
        for i in 0..n {
            d.quadro(i).unwrap();
        }
        cuda.synchronize().unwrap();
        drop(d);
        let parede = t0.elapsed().as_secs_f64();
        let (c1, f1) = cpu();
        eprintln!(
            "NVDEC: {n} quadros {l}x{a} {codec}: parede {parede:.3} s, CPU do processo {:.3} s, do ffmpeg (separar) {:.3} s, {:.3} ms de CPU por quadro",
            c1 - c0, f1 - f0, (c1 - c0 + f1 - f0) * 1e3 / f64::from(n)
        );
        let t0 = Instant::now();
        let (_, f0) = cpu();
        let s = Command::new("ffmpeg")
            .args(["-v", "error", "-nostdin", "-i"])
            .arg(&arquivo)
            .args(["-map", "0:v:0", "-fps_mode", "passthrough", "-pix_fmt", "yuv420p", "-f", "rawvideo", "-y", "/dev/null"])
            .status()
            .unwrap();
        assert!(s.success());
        let (_, f1) = cpu();
        eprintln!(
            "ffmpeg (software, I420): parede {:.3} s, CPU {:.3} s, {:.3} ms de CPU por quadro",
            t0.elapsed().as_secs_f64(), f1 - f0, (f1 - f0) * 1e3 / f64::from(n)
        );
    }

    #[repr(C)]
    struct libc_rusage {
        ru_utime: [i64; 2],
        ru_stime: [i64; 2],
        resto: [i64; 14],
    }
    unsafe extern "C" {
        fn getrusage(quem: i32, uso: *mut libc_rusage) -> i32;
    }
}
