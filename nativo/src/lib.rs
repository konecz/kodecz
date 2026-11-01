// M02 (scope.md 4.2): quadro do Electron (dma-buf) → Vulkan → CUDA → NVENC, sem passar pela CPU.
// P10.2, captura em fila: duas threads. A do Vulkan copia o quadro do Chromium para um dos buffers exportáveis (anel de
// `fila + 1`) e responde ao JS assim que a cópia termina (a textura do Chromium só pode ser liberada depois dela); a do
// NVENC é dona da CUDA e da sessão (a sessão empresta o encoder, e os recursos emprestam a sessão) e codifica os
// buffers na ordem em que chegam, em paralelo com a página. O buffer volta ao anel quando o NVENC acaba de lê-lo; sem
// buffer livre, a cópia espera (contrapressão). O último codificado fica preso para o quadro repetido (P10.3).
mod brilho;
mod marca;
mod mistura;
mod nvdec;
mod pulado;
#[cfg(test)]
mod sonda_pulado;
mod vulkan;

use cudarc::driver::CudaContext;
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use nvidia_video_codec_sdk::sys::nvEncodeAPI::*;
use nvidia_video_codec_sdk::{CodecPictureParams, EncodePictureParams, Encoder, EncoderInitParams};
use std::fs::File;
use std::io::Write;
use std::os::fd::BorrowedFd;
use std::sync::{Arc, Mutex, mpsc};
use std::thread::JoinHandle;
use std::time::Instant;
use vulkan::{Quadro, Vulkan};

#[napi(object)]
pub struct Plano {
    pub fd: i32,
    pub stride: u32,
    pub offset: u32,
    /// `codedSize` do `textureInfo`: tem de ser o tamanho da sessão (DPR ≠ 1 ou outra janela dão outro).
    pub largura: u32,
    pub altura: u32,
}

#[napi(object)]
pub struct Opcoes {
    pub largura: u32,
    pub altura: u32,
    /// Fluxo cru (Annex B), H.264 ou HEVC conforme `codec`.
    pub saida: String,
    /// Camada de alfa do HEVC do NVENC (`enableAlphaLayerEncoding`). Só no HEVC.
    pub alfa: bool,
    /// P01: "h264" (perfil High) ou "hevc". Padrão "hevc", o dos experimentos e da camada do M05; o comando
    /// (cli/render.ts) pede "h264" por padrão, que toca em todo navegador.
    pub codec: Option<String>,
    /// Quadros por segundo da composição, gravados no VUI do fluxo (P10.5: sem isso, uma composição de 25 qps saía com
    /// 30 no cabeçalho). Padrão 30.
    pub qps: Option<u32>,
    /// Preset do NVENC, 1 a 7 (P1 a P7).
    pub preset: Option<u32>,
    /// Quadros entre IDRs (GOP e `idrPeriod`), padrão 30: a montagem busca o segmento pelo quadro-chave (M05).
    pub gop: Option<u32>,
    /// Qualidade constante, 1 a 51 (menor = melhor): VBR com `targetQuality` e `averageBitRate` 0. Padrão
    /// `QUALIDADE_PADRAO`; 0 deixa a taxa do preset.
    pub qualidade: Option<u32>,
    /// `alphaLayerBitrateRatio`: taxa da cor ÷ taxa do alfa (padrão do NVENC 15). Menor dá mais taxa ao alfa.
    /// Padrão `RAZAO_ALFA_PADRAO`; 0 deixa a do preset.
    pub razao_alfa: Option<u32>,
    /// M03: linhas da faixa da marca abaixo do quadro (a janela tem `altura + marca` linhas). Padrão 0.
    pub marca: Option<u32>,
    /// P10.2: quadros copiados que podem esperar o NVENC (de 1 a 16). Padrão `FILA_PADRAO`.
    pub fila: Option<u32>,
}

pub const GOP_PADRAO: u32 = 30;
pub const FILA_PADRAO: u32 = 3;
/// P10.3: tarefas que podem esperar o NVENC. O repetido não prende buffer (a cópia é contida pelo anel), então a fila
/// de tarefas é bem maior que a de buffers: uma sequência de quadros parados não segura a página.
pub const TAREFAS_NA_FILA: usize = 256;
// Escolhidos no M05 (decisão do responsável, 2026-10-29): arquivo menor que a taxa do preset e pior quadro com SSIM
// de 0,9924 para 0,9967 contra o caminho com PNG, no mesmo tempo de codificação.
pub const QUALIDADE_PADRAO: u32 = 23;
pub const RAZAO_ALFA_PADRAO: u32 = 4;
pub const QPS_PADRAO: u32 = 30;

/// P01: o codec do fluxo.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Codec {
    H264,
    Hevc,
}

impl Codec {
    /// Lê `opcoes.codec` e recusa o alfa fora do HEVC (o NVENC só tem a camada de alfa no HEVC).
    fn de(opcoes: &Opcoes) -> Result<Codec, String> {
        let codec = match opcoes.codec.as_deref() {
            None | Some("hevc") => Codec::Hevc,
            Some("h264") => Codec::H264,
            Some(outro) => return Err(format!("codec «{outro}»: use \"h264\" ou \"hevc\"")),
        };
        if opcoes.alfa && codec == Codec::H264 {
            return Err("a camada de alfa só existe no HEVC: use codec \"hevc\" com alfa".into());
        }
        Ok(codec)
    }

    fn guid(self) -> GUID {
        match self {
            Codec::H264 => NV_ENC_CODEC_H264_GUID,
            Codec::Hevc => NV_ENC_CODEC_HEVC_GUID,
        }
    }
}

/// O VUI BT.709 de faixa limitada. O NVENC converte o ARGB em YUV BT.709 de faixa limitada, mas não grava isso no
/// fluxo; sem o VUI, o decodificador supõe BT.601 e o vermelho 255 sai 232.
fn vui_bt709(vui: &mut NV_ENC_CONFIG_H264_VUI_PARAMETERS) {
    vui.videoSignalTypePresentFlag = 1;
    vui.videoFormat = NV_ENC_VUI_VIDEO_FORMAT::NV_ENC_VUI_VIDEO_FORMAT_UNSPECIFIED;
    vui.videoFullRangeFlag = 0;
    vui.colourDescriptionPresentFlag = 1;
    vui.colourPrimaries = NV_ENC_VUI_COLOR_PRIMARIES::NV_ENC_VUI_COLOR_PRIMARIES_BT709;
    vui.transferCharacteristics =
        NV_ENC_VUI_TRANSFER_CHARACTERISTIC::NV_ENC_VUI_TRANSFER_CHARACTERISTIC_BT709;
    vui.colourMatrix = NV_ENC_VUI_MATRIX_COEFFS::NV_ENC_VUI_MATRIX_COEFFS_BT709;
}

/// Ajustes da configuração do preset: sem quadros B nem lookahead, GOP com IDR, taxa e alfa, e o VUI BT.709. No H.264,
/// perfil High em 4:2:0 com CABAC (o que todo navegador decodifica).
fn configurar(config: &mut NV_ENC_CONFIG, opcoes: &Opcoes, codec: Codec) {
    // Sem quadros B nem lookahead: cada quadro enviado sai na hora, e o fluxo fica na ordem de envio.
    config.frameIntervalP = 1;
    config.rcParams.lookaheadDepth = 0;
    config.rcParams.set_enableLookahead(0);
    let gop = opcoes.gop.unwrap_or(GOP_PADRAO).max(1);
    config.gopLength = gop;
    let q = opcoes.qualidade.unwrap_or(QUALIDADE_PADRAO);
    if q > 0 {
        config.rcParams.rateControlMode = NV_ENC_PARAMS_RC_MODE::NV_ENC_PARAMS_RC_VBR;
        config.rcParams.averageBitRate = 0;
        config.rcParams.maxBitRate = 0;
        config.rcParams.targetQuality = q.clamp(1, 51) as u8;
        config.rcParams.targetQualityLSB = 0;
    }
    let r = opcoes.razao_alfa.unwrap_or(RAZAO_ALFA_PADRAO);
    if r > 0 {
        config.rcParams.alphaLayerBitrateRatio = r;
    }
    // (VPS/)SPS/PPS em todo IDR: cada trecho a partir de um quadro-chave se decodifica sozinho.
    match codec {
        Codec::Hevc => {
            let hevc = unsafe { &mut config.encodeCodecConfig.hevcConfig };
            hevc.idrPeriod = gop;
            hevc.set_repeatSPSPPS(1);
            if opcoes.alfa {
                hevc.set_enableAlphaLayerEncoding(1);
            }
            vui_bt709(&mut hevc.hevcVUIParameters);
        }
        Codec::H264 => {
            config.profileGUID = NV_ENC_H264_PROFILE_HIGH_GUID;
            let h264 = unsafe { &mut config.encodeCodecConfig.h264Config };
            h264.idrPeriod = gop;
            h264.set_repeatSPSPPS(1);
            h264.chromaFormatIDC = 1;
            h264.entropyCodingMode =
                NV_ENC_H264_ENTROPY_CODING_MODE::NV_ENC_H264_ENTROPY_CODING_MODE_CABAC;
            // C01: uma referência só. O quadro pulado entra como referência no lugar do último do NVENC (igual a
            // ele), e o NVENC, que só olha uma para trás, continua certo (pulado.rs). Não custou tamanho na cena.
            h264.maxNumRefFrames = 1;
            h264.numRefL0 = NV_ENC_NUM_REF_FRAMES::NV_ENC_NUM_REF_FRAMES_1;
            vui_bt709(&mut h264.h264VUIParameters);
        }
    }
}

/// M03: resultado de `quadroMarcado`.
#[napi(object)]
pub struct Marcado {
    /// O número lido na faixa, ou nada se ela não confere.
    pub marca: Option<u32>,
    /// Se o quadro foi para a fila do NVENC (só quando a marca é a esperada).
    pub codificado: bool,
    /// Pixels BGRA lidos da placa (só com `conferir` e quando codificado).
    pub pixels: Option<Buffer>,
}

#[napi(object)]
#[derive(Default)]
pub struct Resumo {
    /// Quadros no fluxo, contando os repetidos.
    pub quadros: u32,
    /// P10.3: quadros repetidos (o buffer do anterior reenviado ao NVENC, sem página, cópia nem textura).
    pub repetidos: u32,
    /// C01: repetidos escritos como P pulado (sem NVENC). O resto dos repetidos foi codificado pelo NVENC.
    pub pulados: u32,
    /// C01: por que o pulado parou de valer (recurso do fluxo que ele não escreve), se parou.
    pub pulado_desligado: Option<String>,
    pub importacoes: u32,
    /// Quadros que chegaram com a escrita do Chromium ainda pendente (a cópia esperou o sync_file).
    pub cercas_pendentes: u32,
    /// Quadros sem sync_file no dma-buf (nada a esperar).
    pub sem_sync_file: u32,
    pub bytes: f64,
    /// Cada cópia (inclusive a de marca errada), na thread do Vulkan.
    pub copia_us: Vec<f64>,
    /// Espera por um buffer livre antes da cópia (a fila cheia segurando a página).
    pub espera_us: Vec<f64>,
    /// Cada codificação de quadro copiado, na thread do NVENC.
    pub codificacao_us: Vec<f64>,
    /// Cada codificação de quadro repetido.
    pub repeticao_us: Vec<f64>,
    /// S08: cada montagem (quadro do vídeo no NVDEC e mistura), na thread do NVENC, antes da codificação.
    pub montagem_us: Vec<f64>,
    /// S08: quadros do vídeo exibidos pelo NVDEC, reaberturas (pedido para trás) e bytes comprimidos lidos.
    pub nvdec_quadros: u32,
    pub nvdec_reaberturas: u32,
    pub nvdec_bytes: f64,
    /// Brilho de cada quadro do fluxo (contando os repetidos), medido na placa antes do NVENC: a média do luma na
    /// escala do Y do MP4 (BT.709 de faixa limitada, 16 a 235; brilho.rs). Vazio com `MOTOR_BRILHO=0`.
    pub brilho: Vec<f64>,
    /// A média da diferença absoluta do luma para o quadro anterior do fluxo, na mesma escala (0 no primeiro e nos
    /// repetidos).
    pub mudanca: Vec<f64>,
    /// Cada medida do brilho (núcleo e leitura das duas somas), na thread do NVENC.
    pub brilho_us: Vec<f64>,
    /// Por que o brilho não foi medido (o núcleo não carregou ou uma medida falhou); o render segue sem a série.
    pub brilho_erro: Option<String>,
}

/// S08: um vídeo da composição decodificado pelo motor no NVDEC (`abrirVideo`).
#[napi(object)]
pub struct VideoNaPlaca {
    pub arquivo: String,
    /// "h264" ou "hevc" (o codec_name do ffprobe).
    pub codec: String,
    pub largura: u32,
    pub altura: u32,
    /// Matriz de cor no nome do WebCodecs (corDoVideo do midia-linha.ts), ou nada; e a faixa.
    pub matriz: Option<String>,
    pub cheia: bool,
    /// O ffmpeg que separa os pacotes do contêiner (padrão "ffmpeg").
    pub ffmpeg: Option<String>,
}

/// S08: onde o quadro `indice` (ordem de exibição) do vídeo `video` vai no quadro: origem do vídeo inteiro e o recorte
/// visível [x0, y0, x1, y1). Com `escala` ([sx, sy, tx, ty]: o texel u vai a `t + s·u`), o vídeo vai ampliado ou
/// reduzido, bilinear como o Chromium (`mistura::Escala`); a origem inteira (`x`, `y`) não vale.
#[napi(object)]
#[derive(Clone)]
pub struct VideoMontado {
    pub video: u32,
    pub indice: u32,
    pub x: i32,
    pub y: i32,
    pub recorte: Vec<i32>,
    pub escala: Option<Vec<f64>>,
    /// Recorte arredondado de um ancestral (`overflow` com `border-radius`): [x0, y0, x1, y1, raio] ou
    /// [x0, y0, x1, y1, raio, cantos por cima, cobertor], o retângulo no pixel, o raio dos quatro cantos, os bits dos
    /// cantos com algo da página por cima do vídeo e o fundo que os cobre (0xAARRGGBB pré-multiplicado;
    /// `mistura::Arredondado`).
    pub arredondado: Option<Vec<f64>>,
}

/// S08: o que vai por baixo da página no próximo quadro: o fundo da raiz (0xRRGGBB, tirado da página pelo motor) e o
/// vídeo. A página chega com o buraco transparente.
#[napi(object)]
#[derive(Clone)]
pub struct Montagem {
    pub fundo: Option<u32>,
    pub video: Option<VideoMontado>,
}

type Resposta<T> = mpsc::Sender<Result<T, String>>;

enum Pedido {
    Quadro(Quadro, bool, Resposta<Option<Vec<u8>>>),
    /// M03: quadro, marca esperada, conferir; S08: a montagem do quadro.
    Marcado(
        Quadro,
        u32,
        bool,
        Option<Montagem>,
        Resposta<(Option<u32>, bool, Option<Vec<u8>>)>,
    ),
    Fechar(mpsc::Sender<Result<Resumo, String>>),
}

/// S08: com conferência, os pixels lidos depois da mistura voltam por aqui.
type Conferida = Option<mpsc::Sender<Result<Vec<u8>, String>>>;

/// P10.2: o que a thread do NVENC recebe, na ordem dos quadros.
enum Tarefa {
    /// Codificar o buffer `i` do anel (a cópia já terminou); S08: antes, montar o vídeo por baixo.
    Codificar(usize, Option<Montagem>, Conferida),
    /// S08: abrir um vídeo no NVDEC; responde o número dele.
    AbrirVideo(VideoNaPlaca, Resposta<u32>),
    /// P10.3: codificar de novo o último buffer codificado.
    Repetir,
    /// Esvaziar a fila, encerrar o fluxo e soltar a CUDA antes de o Vulkan soltar a memória.
    Fechar(mpsc::Sender<Result<Resumo, String>>),
}

/// O primeiro erro do NVENC, guardado para voltar ao JS na próxima chamada (a codificação não responde ao quadro).
type Falha = Arc<Mutex<Option<String>>>;

fn falha_ou(falha: &Falha, padrao: &str) -> String {
    falha
        .lock()
        .ok()
        .and_then(|f| f.clone())
        .unwrap_or_else(|| padrao.to_string())
}

#[napi]
pub struct Motor {
    tamanho: (u32, u32),
    /// M03: linhas da faixa da marca abaixo do quadro.
    marca: u32,
    canal: Option<mpsc::Sender<Pedido>>,
    /// P10.3: o quadro repetido vai direto à fila do NVENC (depois do último `quadroMarcado`, que já a alimentou).
    tarefas: Option<mpsc::SyncSender<Tarefa>>,
    falha: Falha,
    fio: Option<JoinHandle<()>>,
    /// S08: a montagem dos próximos `quadroMarcado` (até o próximo `montar`).
    montagem: Mutex<Option<Montagem>>,
}

fn falha(e: impl std::fmt::Debug) -> String {
    format!("{e:?}")
}

fn preset(n: u32) -> GUID {
    match n {
        1 => NV_ENC_PRESET_P1_GUID,
        2 => NV_ENC_PRESET_P2_GUID,
        3 => NV_ENC_PRESET_P3_GUID,
        5 => NV_ENC_PRESET_P5_GUID,
        6 => NV_ENC_PRESET_P6_GUID,
        7 => NV_ENC_PRESET_P7_GUID,
        _ => NV_ENC_PRESET_P4_GUID,
    }
}

/// Thread do NVENC: abre a CUDA e a sessão, registra os buffers do anel e codifica as tarefas na ordem.
fn codificar_em_fila(
    opcoes: Opcoes,
    buffers: Vec<(File, u64)>,
    tarefas: mpsc::Receiver<Tarefa>,
    livres: mpsc::Sender<usize>,
    falha: Falha,
    pronto: mpsc::Sender<Result<(), String>>,
) {
    let pronto_erro = pronto.clone();
    // O Drop da sessão encerra o fluxo e entra em pânico se falhar: o pânico vira erro, não derruba o Node.
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        corpo_nvenc(opcoes, buffers, &tarefas, &livres, pronto)
    }))
    .unwrap_or_else(|_| {
        Err("a sessão do NVENC caiu (pânico ao codificar ou encerrar)".to_string())
    });
    if let Err(e) = r {
        if let Ok(mut f) = falha.lock() {
            f.get_or_insert(e.clone());
        }
        let _ = pronto_erro.send(Err(e));
    }
}

fn corpo_nvenc(
    opcoes: Opcoes,
    buffers: Vec<(File, u64)>,
    tarefas: &mpsc::Receiver<Tarefa>,
    livres: &mpsc::Sender<usize>,
    pronto: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    let (largura, altura) = (opcoes.largura, opcoes.altura);
    let cuda = CudaContext::new(0).map_err(falha)?;
    let encoder = Encoder::initialize_with_cuda(cuda.clone()).map_err(falha)?;

    let tipo = Codec::de(&opcoes)?;
    let codec = tipo.guid();
    let h264 = tipo == Codec::H264;
    let p = preset(opcoes.preset.unwrap_or(4));
    let afinacao = NV_ENC_TUNING_INFO::NV_ENC_TUNING_INFO_HIGH_QUALITY;
    let mut config = encoder
        .get_preset_config(codec, p, afinacao)
        .map_err(falha)?
        .presetCfg;
    configurar(&mut config, &opcoes, tipo);
    // C01: o quadro repetido é um P «pulado» escrito por nós (pulado.rs), sem NVENC. Para isso a sessão roda sem a
    // decisão de tipo (PTD): o IDR a cada `gop` quadros e o POC de cada quadro (quadros desde o IDR, contando os
    // pulados) vêm daqui. Com alfa (duas camadas) ou `MOTOR_PULADO=0`, fica o caminho do P10.3 (o NVENC codifica de
    // novo o último buffer, com PTD).
    let gop = opcoes.gop.unwrap_or(GOP_PADRAO).max(1);
    let proprio = !opcoes.alfa && std::env::var("MOTOR_PULADO").map_or(true, |v| v != "0");
    let mut inicio = EncoderInitParams::new(codec, largura, altura);
    inicio
        .preset_guid(p)
        .tuning_info(afinacao)
        .framerate(opcoes.qps.unwrap_or(QPS_PADRAO).max(1), 1)
        .encode_config(&mut config);
    if !proprio {
        inicio.enable_picture_type_decision();
    }
    // ARGB do NVENC = palavra de 32 bits com B no byte baixo, isto é, o BGRA do Chromium na memória.
    let sessao = encoder
        .start_session(NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_ARGB, inicio)
        .map_err(|e| format!("iniciar NVENC ({tipo:?}, alfa={}): {e:?}", opcoes.alfa))?;

    let mut entradas = Vec::with_capacity(buffers.len());
    // S08: o endereço de cada buffer na CUDA, para a mistura escrever nele antes do NVENC ler.
    let mut enderecos = Vec::with_capacity(buffers.len());
    let fluxo_cuda = cuda.default_stream();
    for (arquivo, tamanho) in buffers {
        let externa = unsafe { cuda.import_external_memory(arquivo, tamanho) }.map_err(falha)?;
        let mapeado = externa.map_all().map_err(falha)?;
        {
            use cudarc::driver::DevicePtr;
            enderecos.push(mapeado.device_ptr(&fluxo_cuda).0);
        }
        entradas.push(
            sessao
                .register_cuda_resource(largura * 4, mapeado)
                .map_err(falha)?,
        );
    }
    // Uma saída só: a codificação de cada quadro termina (lock do fluxo) antes da próxima.
    let mut fluxo = sessao.create_output_bitstream().map_err(falha)?;
    let mut saida = File::create(&opcoes.saida).map_err(falha)?;
    let _ = pronto.send(Ok(()));

    let mut resumo = Resumo::default();
    let mut ultimo: Option<usize> = None;
    // Acompanha o fluxo do NVENC (parâmetros, POC, referências; no H.264, reescreve o frame_num); `None` depois de algo
    // que o pulado não sabe tratar (antes do primeiro pulado: daí em diante, o NVENC codifica os repetidos).
    let mut pulado = proprio.then(|| {
        if h264 {
            pulado::Pulado::H264(Default::default())
        } else {
            pulado::Pulado::Hevc(Default::default())
        }
    });
    // Desliga o pulado com o motivo; se o fluxo já depende dele (H.264 com frame_num deslocado), é erro.
    let desligar = |pulado: &mut Option<pulado::Pulado>,
                    resumo: &mut Resumo,
                    e: String|
     -> Result<(), String> {
        if pulado.as_ref().is_some_and(pulado::Pulado::sem_volta) {
            return Err(format!("quadro pulado: {e}"));
        }
        resumo.pulado_desligado = Some(e);
        *pulado = None;
        Ok(())
    };
    let mut codificar = |i: usize,
                         resumo: &mut Resumo,
                         pulado: &mut Option<pulado::Pulado>,
                         saida: &mut File|
     -> Result<f64, String> {
        let t0 = Instant::now();
        let n = resumo.quadros;
        let poc = (n % gop) as i32;
        let mut params = EncodePictureParams {
            input_timestamp: u64::from(n),
            ..Default::default()
        };
        if proprio {
            params.picture_type = if poc == 0 {
                NV_ENC_PIC_TYPE::NV_ENC_PIC_TYPE_IDR
            } else {
                NV_ENC_PIC_TYPE::NV_ENC_PIC_TYPE_P
            };
            params.codec_params = Some(if h264 {
                CodecPictureParams::H264(NV_ENC_PIC_PARAMS_H264 {
                    displayPOCSyntax: 2 * poc as u32,
                    refPicFlag: 1,
                    ..Default::default()
                })
            } else {
                CodecPictureParams::Hevc(NV_ENC_PIC_PARAMS_HEVC {
                    displayPOCSyntax: poc as u32,
                    refPicFlag: 1,
                    ..Default::default()
                })
            });
        }
        sessao
            .encode_picture(&mut entradas[i], &mut fluxo, params)
            .map_err(falha)?;
        let trava = fluxo.lock().map_err(falha)?;
        let reescrito = match pulado.as_mut().map(|p| p.observar(trava.data(), poc)) {
            Some(Ok(r)) => r,
            Some(Err(e)) => {
                desligar(pulado, resumo, e)?;
                None
            }
            None => None,
        };
        let dados = reescrito.as_deref().unwrap_or(trava.data());
        saida.write_all(dados).map_err(falha)?;
        resumo.bytes += dados.len() as f64;
        drop(trava);
        resumo.quadros += 1;
        Ok(t0.elapsed().as_secs_f64() * 1e6)
    };
    // S08: os vídeos abertos no NVDEC (com os coeficientes de cor) e o núcleo da mistura, carregado no primeiro uso.
    let mut videos: Vec<(nvdec::Decodificador, mistura::Coeficientes)> = Vec::new();
    let mut misturador: Option<mistura::Misturador> = None;
    // O brilho de cada quadro (a piscada medida no render; brilho.rs). `MOTOR_BRILHO=0` desliga (para medir o custo).
    // É medida auxiliar: se o núcleo não carregar ou uma medida falhar, o render segue sem a série (`brilho_erro`).
    let mut medidor = None;
    if !std::env::var("MOTOR_BRILHO").is_ok_and(|v| v == "0") {
        match brilho::Medidor::novo() {
            Ok(m) => medidor = Some(m),
            Err(e) => resumo.brilho_erro = Some(e),
        }
    }
    let montar = |i: usize,
                      m: &Montagem,
                      videos: &mut Vec<(nvdec::Decodificador, mistura::Coeficientes)>,
                      misturador: &mut Option<mistura::Misturador>|
     -> Result<(), String> {
        if misturador.is_none() {
            *misturador = Some(mistura::Misturador::novo()?);
        }
        let quadro = match &m.video {
            Some(v) => {
                let (d, k) = videos
                    .get_mut(v.video as usize)
                    .ok_or_else(|| format!("vídeo {} não foi aberto", v.video))?;
                let r = &v.recorte;
                if r.len() != 4 {
                    return Err("recorte com 4 números: [x0, y0, x1, y1]".into());
                }
                // O recorte tem de caber no vídeo e no quadro: o núcleo lê o vídeo só dentro dele (com escala, os
                // texels ficam presos à borda do vídeo; o recorte só precisa caber no quadro).
                let (vl, va) = (d.largura() as i32, d.altura() as i32);
                let escala = match v.escala.as_deref() {
                    None => None,
                    Some(&[sx, sy, tx, ty]) => Some(mistura::Escala::de(sx, sy, tx, ty)?),
                    Some(_) => return Err("escala com 4 números: [sx, sy, tx, ty]".into()),
                };
                let arredondado = match v.arredondado.as_deref() {
                    None => None,
                    Some(&[x0, y0, x1, y1, raio]) => Some(mistura::Arredondado::de(x0, y0, x1, y1, raio)?),
                    Some(&[x0, y0, x1, y1, raio, por_cima, cobertor]) => {
                        Some(mistura::Arredondado::de(x0, y0, x1, y1, raio)?.com_por_cima(por_cima as u32, cobertor as u32))
                    }
                    Some(_) => return Err("arredondado com 5 ou 7 números: [x0, y0, x1, y1, raio, cantos por cima, cobertor]".into()),
                };
                let (ox, oy, fx, fy) = if escala.is_some() {
                    (0, 0, largura as i32, altura as i32)
                } else {
                    (v.x.max(0), v.y.max(0), (v.x + vl).min(largura as i32), (v.y + va).min(altura as i32))
                };
                if r[0] < ox || r[1] < oy || r[2] > fx || r[3] > fy {
                    return Err(format!(
                        "recorte {r:?} fora do vídeo {vl}x{va} em ({}, {}) ou do quadro",
                        v.x, v.y
                    ));
                }
                let q = d.quadro(v.indice)?;
                let pos = mistura::Posicao {
                    x: v.x,
                    y: v.y,
                    recorte: [r[0], r[1], r[2], r[3]],
                    escala,
                    arredondado,
                };
                Some((q.ptr, d.largura(), d.altura(), pos, *k))
            }
            None => None,
        };
        misturador.as_ref().unwrap().misturar(&mistura::Mistura {
            saida: enderecos[i],
            passo: largura * 4,
            largura,
            altura,
            video: quadro.as_ref().map(|(p, l, a, pos, k)| (*p, *l, *a, *pos, k)),
            fundo: m.fundo,
        })
    };
    let mut fechar = None;
    for tarefa in tarefas {
        match tarefa {
            Tarefa::AbrirVideo(v, resposta) => {
                let r = (|| {
                    let k = mistura::Coeficientes::de(v.matriz.as_deref(), v.cheia, v.altura)?;
                    let d = nvdec::Decodificador::abrir(
                        cuda.cu_ctx(),
                        &v.arquivo,
                        v.ffmpeg.as_deref().unwrap_or("ffmpeg"),
                        nvdec::CodecVideo::de(&v.codec)?,
                        v.largura,
                        v.altura,
                    )?;
                    videos.push((d, k));
                    Ok(videos.len() as u32 - 1)
                })();
                let _ = resposta.send(r);
            }
            Tarefa::Codificar(i, m, conferida) => {
                if let Some(m) = &m {
                    let t0 = Instant::now();
                    montar(i, m, &mut videos, &mut misturador)?;
                    resumo.montagem_us.push(t0.elapsed().as_secs_f64() * 1e6);
                }
                if let Some(m) = &medidor {
                    // O anterior do fluxo ainda está preso no anel (para o repetido): a diferença sai dele.
                    let t0 = Instant::now();
                    match m.medir(enderecos[i], ultimo.map(|u| enderecos[u]), largura * 4, largura, altura) {
                        Ok(b) => {
                            resumo.brilho_us.push(t0.elapsed().as_secs_f64() * 1e6);
                            resumo.brilho.push(b.medio);
                            resumo.mudanca.push(b.mudanca);
                        }
                        Err(e) => {
                            // Série incompleta não serve: sai inteira.
                            resumo.brilho_erro = Some(e);
                            resumo.brilho.clear();
                            resumo.mudanca.clear();
                            medidor = None;
                        }
                    }
                }
                if let Some(c) = conferida {
                    // Só na conferência: o quadro montado volta à CPU (o que o NVENC vai ler).
                    let mut pixels = vec![0u8; largura as usize * altura as usize * 4];
                    let r = unsafe {
                        cudarc::driver::sys::cuMemcpyDtoH_v2(
                            pixels.as_mut_ptr() as *mut std::ffi::c_void,
                            enderecos[i],
                            pixels.len(),
                        )
                    };
                    let _ = c.send(if r == cudarc::driver::sys::CUresult::CUDA_SUCCESS {
                        Ok(pixels)
                    } else {
                        Err(format!("ler o quadro montado: {r:?}"))
                    });
                }
                let us = codificar(i, &mut resumo, &mut pulado, &mut saida)?;
                resumo.codificacao_us.push(us);
                // O NVENC acabou de ler o anterior: ele volta ao anel. O atual fica preso para o repetido.
                if let Some(anterior) = ultimo.replace(i) {
                    let _ = livres.send(anterior);
                }
            }
            Tarefa::Repetir => {
                let i = ultimo.ok_or("quadro repetido sem quadro anterior")?;
                let t0 = Instant::now();
                let poc = (resumo.quadros % gop) as i32;
                // No começo do GOP o quadro tem de ser IDR: esse o NVENC codifica.
                let escrito = match pulado.as_mut().filter(|_| poc != 0).map(|p| p.quadro(poc)) {
                    Some(Ok(bytes)) => Some(bytes),
                    Some(Err(e)) => {
                        desligar(&mut pulado, &mut resumo, e)?;
                        None
                    }
                    None => None,
                };
                let us = if let Some(bytes) = escrito {
                    saida.write_all(&bytes).map_err(falha)?;
                    resumo.bytes += bytes.len() as f64;
                    resumo.quadros += 1;
                    resumo.pulados += 1;
                    t0.elapsed().as_secs_f64() * 1e6
                } else {
                    codificar(i, &mut resumo, &mut pulado, &mut saida)?
                };
                resumo.repeticao_us.push(us);
                if let Some(&b) = resumo.brilho.last() {
                    resumo.brilho.push(b);
                    resumo.mudanca.push(0.0);
                }
                resumo.repetidos += 1;
            }
            Tarefa::Fechar(resposta) => {
                fechar = Some(resposta);
                break;
            }
        }
    }
    drop(codificar);
    // S08: os decodificadores (e o ffmpeg de cada um) e o núcleo saem antes da CUDA.
    for (d, _) in &videos {
        resumo.nvdec_quadros += d.exibidos();
        resumo.nvdec_reaberturas += d.reaberturas;
        resumo.nvdec_bytes += d.bytes as f64;
    }
    drop(videos);
    drop(misturador);
    drop(medidor);
    // Ordem de liberação: fluxo e entradas (desregistra e solta a memória na CUDA) antes da sessão; o Vulkan, dono
    // da memória, só é solto pela outra thread depois desta resposta.
    drop(fluxo);
    drop(entradas);
    drop(sessao);
    drop(cuda);
    if let Some(resposta) = fechar {
        let _ = resposta.send(Ok(resumo));
    }
    Ok(())
}

fn trabalhar(
    opcoes: Opcoes,
    pedidos: mpsc::Receiver<Pedido>,
    pronto: mpsc::Sender<Result<mpsc::SyncSender<Tarefa>, String>>,
    falha_nvenc: Falha,
) {
    let resultado = (|| -> Result<(), String> {
        let (largura, altura) = (opcoes.largura, opcoes.altura);
        let fila = opcoes.fila.unwrap_or(FILA_PADRAO).clamp(1, 16) as usize;
        let mut vulkan = Vulkan::com_marca(largura, altura, opcoes.marca.unwrap_or(0))?;
        // Anel de fila + 1 buffers: um fica preso como último codificado (para o repetido).
        let mut buffers = Vec::new();
        let (livre, livres) = mpsc::channel();
        for _ in 0..=fila {
            let (i, arquivo, tamanho) = vulkan.criar_exportavel()?;
            buffers.push((arquivo, tamanho));
            let _ = livre.send(i);
        }
        let (tarefas, recebidas) = mpsc::sync_channel(TAREFAS_NA_FILA);
        let (nvenc_pronto, nvenc_espera) = mpsc::channel();
        let f = falha_nvenc.clone();
        let fio_nvenc = std::thread::spawn(move || {
            codificar_em_fila(opcoes, buffers, recebidas, livre, f, nvenc_pronto)
        });
        match nvenc_espera.recv() {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                let _ = fio_nvenc.join();
                return Err(e);
            }
            Err(_) => {
                let _ = fio_nvenc.join();
                return Err("a thread do NVENC caiu ao iniciar".into());
            }
        }
        let _ = pronto.send(Ok(tarefas.clone()));

        let mut resumo = Resumo::default();
        // Buffer copiado com marca errada: não foi à fila, serve à próxima cópia.
        let mut reserva: Option<usize> = None;
        let copiar = |vulkan: &mut Vulkan,
                      resumo: &mut Resumo,
                      reserva: &mut Option<usize>,
                      quadro: &Quadro,
                      conferir: bool|
         -> Result<(usize, Option<Vec<u8>>), String> {
            if let Some(e) = falha_nvenc.lock().ok().and_then(|f| f.clone()) {
                return Err(e);
            }
            let t0 = Instant::now();
            let i = match reserva.take() {
                Some(i) => i,
                None => livres
                    .recv()
                    .map_err(|_| falha_ou(&falha_nvenc, "a thread do NVENC caiu"))?,
            };
            resumo.espera_us.push(t0.elapsed().as_secs_f64() * 1e6);
            let t1 = Instant::now();
            match vulkan.copiar(quadro, i, conferir) {
                Ok((_, pixels)) => {
                    resumo.copia_us.push(t1.elapsed().as_secs_f64() * 1e6);
                    Ok((i, pixels))
                }
                Err(e) => {
                    *reserva = Some(i);
                    Err(e)
                }
            }
        };
        let enfileirar = |i: usize, m: Option<Montagem>, c: Conferida| {
            tarefas
                .send(Tarefa::Codificar(i, m, c))
                .map_err(|_| falha_ou(&falha_nvenc, "a thread do NVENC caiu"))
        };

        for pedido in &pedidos {
            match pedido {
                Pedido::Quadro(quadro, conferir, resposta) => {
                    let r = (|| {
                        if std::env::var_os("M02_DEPURAR").is_some() {
                            eprintln!("mmap do dma-buf: {}", contar_mmap(&quadro, largura, altura));
                        }
                        let (i, pixels) =
                            copiar(&mut vulkan, &mut resumo, &mut reserva, &quadro, conferir)?;
                        // Fila recusada: o buffer não vai ao NVENC, então volta à reserva.
                        if let Err(e) = enfileirar(i, None, None) {
                            reserva = Some(i);
                            return Err(e);
                        }
                        Ok(pixels)
                    })();
                    let _ = resposta.send(r);
                }
                Pedido::Marcado(quadro, esperado, conferir, montagem, resposta) => {
                    let r = (|| {
                        // S08: com montagem, os pixels conferidos são os do quadro montado (lidos depois da mistura).
                        let montar = montagem.is_some();
                        let (i, pixels) = copiar(
                            &mut vulkan,
                            &mut resumo,
                            &mut reserva,
                            &quadro,
                            conferir && !montar,
                        )?;
                        let lida = vulkan.faixa().and_then(marca::ler);
                        // Quadro de outro estado (ainda em trânsito) não entra no fluxo.
                        if lida != Some(esperado) {
                            reserva = Some(i);
                            return Ok((lida, false, None));
                        }
                        let (conferida, montado) = if conferir && montar {
                            let (c, r) = mpsc::channel();
                            (Some(c), Some(r))
                        } else {
                            (None, None)
                        };
                        if let Err(e) = enfileirar(i, montagem, conferida) {
                            reserva = Some(i);
                            return Err(e);
                        }
                        let pixels = match montado {
                            Some(r) => Some(r.recv().map_err(|_| {
                                falha_ou(&falha_nvenc, "a thread do NVENC caiu na montagem")
                            })??),
                            None => pixels,
                        };
                        Ok((lida, true, pixels))
                    })();
                    let _ = resposta.send(r);
                }
                Pedido::Fechar(resposta) => {
                    // A tarefa de fechar entra atrás de todas as outras: a resposta só volta com a fila vazia.
                    let (fim, espera) = mpsc::channel();
                    let r = tarefas
                        .send(Tarefa::Fechar(fim))
                        .ok()
                        .and_then(|()| espera.recv().ok());
                    let _ = fio_nvenc.join();
                    // Depois do join: o erro que derrubou a thread já está guardado.
                    let r = r.unwrap_or_else(|| {
                        Err(falha_ou(
                            &falha_nvenc,
                            "a thread do NVENC caiu antes de fechar",
                        ))
                    });
                    let r = r.map(|nvenc| Resumo {
                        quadros: nvenc.quadros,
                        repetidos: nvenc.repetidos,
                        pulados: nvenc.pulados,
                        pulado_desligado: nvenc.pulado_desligado,
                        importacoes: vulkan.importacoes() as u32,
                        cercas_pendentes: vulkan.cercas_pendentes,
                        sem_sync_file: vulkan.sem_sync_file,
                        bytes: nvenc.bytes,
                        copia_us: std::mem::take(&mut resumo.copia_us),
                        espera_us: std::mem::take(&mut resumo.espera_us),
                        codificacao_us: nvenc.codificacao_us,
                        repeticao_us: nvenc.repeticao_us,
                        montagem_us: nvenc.montagem_us,
                        nvdec_quadros: nvenc.nvdec_quadros,
                        nvdec_reaberturas: nvenc.nvdec_reaberturas,
                        nvdec_bytes: nvenc.nvdec_bytes,
                        brilho: nvenc.brilho,
                        mudanca: nvenc.mudanca,
                        brilho_us: nvenc.brilho_us,
                        brilho_erro: nvenc.brilho_erro,
                    });
                    // A CUDA já soltou a memória exportada (fim da thread do NVENC): agora o Vulkan.
                    drop(vulkan);
                    let _ = resposta.send(r);
                    return Ok(());
                }
            }
        }
        // O Motor sumiu sem fechar: a fila se esvazia e a thread do NVENC acaba antes de o Vulkan ser solto.
        drop(tarefas);
        let _ = fio_nvenc.join();
        drop(vulkan);
        Ok(())
    })();
    if let Err(e) = resultado {
        let _ = pronto.send(Err(e));
    }
}

#[napi]
impl Motor {
    #[napi(constructor)]
    pub fn new(opcoes: Opcoes) -> napi::Result<Self> {
        Codec::de(&opcoes).map_err(napi::Error::from_reason)?;
        let tamanho = (opcoes.largura, opcoes.altura);
        let marca = opcoes.marca.unwrap_or(0);
        let (canal, pedidos) = mpsc::channel();
        let (pronto, espera) = mpsc::channel();
        let falha: Falha = Arc::default();
        let f = falha.clone();
        let fio = std::thread::spawn(move || trabalhar(opcoes, pedidos, pronto, f));
        match espera.recv() {
            Ok(Ok(tarefas)) => Ok(Self {
                tamanho,
                marca,
                canal: Some(canal),
                tarefas: Some(tarefas),
                falha,
                fio: Some(fio),
                montagem: Mutex::new(None),
            }),
            Ok(Err(e)) => {
                let _ = fio.join();
                Err(napi::Error::from_reason(e))
            }
            Err(_) => Err(napi::Error::from_reason(
                "a thread do motor caiu ao iniciar",
            )),
        }
    }

    /// Copia o quadro e o põe na fila do NVENC. Com `conferir`, devolve os pixels BGRA lidos da placa (só para
    /// conferência). Volta depois da cópia, não da codificação: erro do NVENC aparece na chamada seguinte ou no fechar.
    #[napi]
    pub fn quadro(
        &self,
        plano: Plano,
        modifier: String,
        conferir: bool,
    ) -> napi::Result<Option<Buffer>> {
        let canal = self
            .canal
            .as_ref()
            .ok_or_else(|| napi::Error::from_reason("motor fechado"))?;
        let quadro = self.quadro_de(plano, &modifier)?;
        let (resposta, espera) = mpsc::channel();
        canal
            .send(Pedido::Quadro(quadro, conferir, resposta))
            .map_err(|_| napi::Error::from_reason("thread do motor caiu"))?;
        match espera.recv() {
            Ok(Ok(pixels)) => Ok(pixels.map(Buffer::from)),
            Ok(Err(e)) => Err(napi::Error::from_reason(e)),
            Err(_) => Err(napi::Error::from_reason("thread do motor caiu")),
        }
    }

    /// M03: copia o quadro e lê a marca; só põe na fila do NVENC se ela for `esperado`. Com `conferir`, devolve os
    /// pixels. Volta depois da cópia (a textura pode ser liberada), sem esperar a codificação (P10.2).
    #[napi]
    pub fn quadro_marcado(
        &self,
        plano: Plano,
        modifier: String,
        esperado: u32,
        conferir: bool,
    ) -> napi::Result<Marcado> {
        let canal = self
            .canal
            .as_ref()
            .ok_or_else(|| napi::Error::from_reason("motor fechado"))?;
        let quadro = self.quadro_de(plano, &modifier)?;
        let montagem = self.montagem.lock().ok().and_then(|m| m.clone());
        let (resposta, espera) = mpsc::channel();
        canal
            .send(Pedido::Marcado(quadro, esperado, conferir, montagem, resposta))
            .map_err(|_| napi::Error::from_reason("thread do motor caiu"))?;
        match espera.recv() {
            Ok(Ok((marca, codificado, pixels))) => Ok(Marcado {
                marca,
                codificado,
                pixels: pixels.map(Buffer::from),
            }),
            Ok(Err(e)) => Err(napi::Error::from_reason(e)),
            Err(_) => Err(napi::Error::from_reason("thread do motor caiu")),
        }
    }

    /// P10.3: repete no fluxo o último quadro posto na fila, sem página, cópia nem textura (o NVENC lê de novo o mesmo
    /// buffer). Espera só se houver `TAREFAS_NA_FILA` tarefas esperando o NVENC.
    #[napi]
    pub fn repetir(&self) -> napi::Result<()> {
        let tarefas = self
            .tarefas
            .as_ref()
            .ok_or_else(|| napi::Error::from_reason("motor fechado"))?;
        if let Some(e) = self.falha.lock().ok().and_then(|f| f.clone()) {
            return Err(napi::Error::from_reason(e));
        }
        tarefas
            .send(Tarefa::Repetir)
            .map_err(|_| napi::Error::from_reason(falha_ou(&self.falha, "a thread do NVENC caiu")))
    }

    /// S08: abre um vídeo no NVDEC (na thread do NVENC, dona da CUDA) e devolve o número dele para o `montar`.
    #[napi]
    pub fn abrir_video(&self, video: VideoNaPlaca) -> napi::Result<u32> {
        let tarefas = self
            .tarefas
            .as_ref()
            .ok_or_else(|| napi::Error::from_reason("motor fechado"))?;
        let (resposta, espera) = mpsc::channel();
        tarefas
            .send(Tarefa::AbrirVideo(video, resposta))
            .map_err(|_| napi::Error::from_reason(falha_ou(&self.falha, "a thread do NVENC caiu")))?;
        match espera.recv() {
            Ok(r) => r.map_err(napi::Error::from_reason),
            Err(_) => Err(napi::Error::from_reason(falha_ou(
                &self.falha,
                "a thread do NVENC caiu",
            ))),
        }
    }

    /// S08: a montagem dos próximos quadros (fundo e vídeo por baixo da página); nada = sem montagem.
    #[napi]
    pub fn montar(&self, montagem: Option<Montagem>) -> napi::Result<()> {
        if let Some(v) = montagem.as_ref().and_then(|m| m.video.as_ref()) {
            if v.recorte.len() != 4 {
                return Err(napi::Error::from_reason(
                    "recorte com 4 números: [x0, y0, x1, y1]",
                ));
            }
            if let Some(e) = &v.escala {
                let [sx, sy, tx, ty] = e[..] else {
                    return Err(napi::Error::from_reason(
                        "escala com 4 números: [sx, sy, tx, ty]",
                    ));
                };
                mistura::Escala::de(sx, sy, tx, ty).map_err(napi::Error::from_reason)?;
            }
            if let Some(a) = &v.arredondado {
                let (&[x0, y0, x1, y1, raio] | &[x0, y0, x1, y1, raio, _, _]) = &a[..] else {
                    return Err(napi::Error::from_reason(
                        "arredondado com 5 ou 7 números: [x0, y0, x1, y1, raio, cantos por cima, cobertor]",
                    ));
                };
                mistura::Arredondado::de(x0, y0, x1, y1, raio).map_err(napi::Error::from_reason)?;
            }
        }
        *self
            .montagem
            .lock()
            .map_err(|_| napi::Error::from_reason("montagem envenenada"))? = montagem;
        Ok(())
    }

    /// Confere o tamanho (`codedSize` = sessão + faixa da marca) e duplica o fd do quadro.
    fn quadro_de(&self, plano: Plano, modifier: &str) -> napi::Result<Quadro> {
        let esperado = (self.tamanho.0, self.tamanho.1 + self.marca);
        if (plano.largura, plano.altura) != esperado {
            return Err(napi::Error::from_reason(format!(
                "quadro {}x{}, o motor foi aberto em {}x{} (com {} linhas de marca)",
                plano.largura, plano.altura, esperado.0, esperado.1, self.marca
            )));
        }
        if plano.fd < 0 {
            return Err(napi::Error::from_reason(format!(
                "fd inválido: {}",
                plano.fd
            )));
        }
        let modifier = modifier
            .parse::<u64>()
            .map_err(|e| napi::Error::from_reason(format!("modifier: {e}")))?;
        let fd = unsafe { BorrowedFd::borrow_raw(plano.fd) }
            .try_clone_to_owned()
            .map_err(|e| napi::Error::from_reason(format!("dup do fd: {e}")))?;
        Ok(Quadro {
            fd,
            stride: plano.stride,
            offset: plano.offset,
            modifier,
        })
    }

    /// Espera a fila do NVENC esvaziar, encerra o fluxo e solta tudo. Erro do NVENC em qualquer quadro volta aqui.
    #[napi]
    pub fn fechar(&mut self) -> napi::Result<Resumo> {
        let canal = self
            .canal
            .take()
            .ok_or_else(|| napi::Error::from_reason("motor já fechado"))?;
        self.tarefas = None;
        let (resposta, espera) = mpsc::channel();
        let _ = canal.send(Pedido::Fechar(resposta));
        let r = espera
            .recv()
            .map_err(|_| napi::Error::from_reason("thread do motor caiu"));
        if let Some(fio) = self.fio.take() {
            let _ = fio.join();
        }
        r?.map_err(napi::Error::from_reason)
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn opcoes(gop: Option<u32>, qualidade: Option<u32>, razao_alfa: Option<u32>) -> Opcoes {
        Opcoes {
            largura: 64,
            altura: 64,
            saida: String::new(),
            alfa: true,
            codec: None,
            qps: None,
            preset: None,
            gop,
            qualidade,
            razao_alfa,
            marca: None,
            fila: None,
        }
    }

    /// P01: sem codec, HEVC (os experimentos e a camada do M05); "h264" pedido; outro nome e alfa no H.264 recusados.
    #[test]
    fn codec_padrao_hevc_h264_sem_alfa() {
        let mut o = opcoes(None, None, None);
        assert_eq!(Codec::de(&o), Ok(Codec::Hevc));
        o.codec = Some("h264".into());
        assert!(
            Codec::de(&o)
                .unwrap_err()
                .contains("alfa só existe no HEVC")
        );
        o.alfa = false;
        assert_eq!(Codec::de(&o), Ok(Codec::H264));
        o.codec = Some("av1".into());
        assert!(Codec::de(&o).unwrap_err().contains("«av1»"));
    }

    /// P01: H.264 perfil High, 4:2:0, CABAC, sem quadros B, IDR a cada GOP com SPS/PPS e o VUI BT.709.
    #[test]
    fn h264_high_sem_quadros_b_com_vui_bt709() {
        // O preset pode vir com quadros B: o H.264 do motor não pode ter.
        let mut c = NV_ENC_CONFIG {
            frameIntervalP: 3,
            ..Default::default()
        };
        let mut o = opcoes(None, None, None);
        o.alfa = false;
        configurar(&mut c, &o, Codec::H264);
        assert!(
            c.profileGUID == NV_ENC_H264_PROFILE_HIGH_GUID,
            "perfil High"
        );
        assert_eq!(c.frameIntervalP, 1);
        let h = unsafe { c.encodeCodecConfig.h264Config };
        assert_eq!(
            (h.idrPeriod, h.repeatSPSPPS(), h.chromaFormatIDC),
            (30, 1, 1)
        );
        assert!(matches!(
            h.entropyCodingMode,
            NV_ENC_H264_ENTROPY_CODING_MODE::NV_ENC_H264_ENTROPY_CODING_MODE_CABAC
        ));
        let vui = h.h264VUIParameters;
        assert_eq!(
            (
                vui.videoSignalTypePresentFlag,
                vui.colourDescriptionPresentFlag
            ),
            (1, 1)
        );
        assert!(matches!(
            vui.colourMatrix,
            NV_ENC_VUI_MATRIX_COEFFS::NV_ENC_VUI_MATRIX_COEFFS_BT709
        ));
        assert_eq!(c.rcParams.targetQuality, 23, "mesma qualidade do HEVC");
    }

    #[test]
    fn gop_padrao_com_idr_e_cabecalhos_em_cada_um() {
        let mut c = NV_ENC_CONFIG::default();
        configurar(&mut c, &opcoes(None, None, None), Codec::Hevc);
        let hevc = unsafe { c.encodeCodecConfig.hevcConfig };
        assert_eq!(
            (c.gopLength, hevc.idrPeriod, hevc.repeatSPSPPS()),
            (30, 30, 1)
        );
        assert_eq!(hevc.enableAlphaLayerEncoding(), 1);
        assert_eq!(c.frameIntervalP, 1);
    }

    #[test]
    fn qualidade_e_razao_zero_ficam_com_o_preset() {
        let mut c = NV_ENC_CONFIG::default();
        c.rcParams.averageBitRate = 5_000_000;
        c.rcParams.alphaLayerBitrateRatio = 15;
        configurar(&mut c, &opcoes(Some(60), Some(0), Some(0)), Codec::Hevc);
        assert_eq!(
            (
                c.gopLength,
                c.rcParams.averageBitRate,
                c.rcParams.alphaLayerBitrateRatio
            ),
            (60, 5_000_000, 15)
        );
    }

    #[test]
    fn padrao_e_qualidade_23_com_razao_4() {
        let mut c = NV_ENC_CONFIG::default();
        c.rcParams.averageBitRate = 5_000_000;
        configurar(&mut c, &opcoes(None, None, None), Codec::Hevc);
        assert!(matches!(
            c.rcParams.rateControlMode,
            NV_ENC_PARAMS_RC_MODE::NV_ENC_PARAMS_RC_VBR
        ));
        assert_eq!(
            (
                c.rcParams.averageBitRate,
                c.rcParams.targetQuality,
                c.rcParams.alphaLayerBitrateRatio
            ),
            (0, 23, 4)
        );
    }

    #[test]
    fn qualidade_constante_e_razao_do_alfa() {
        let mut c = NV_ENC_CONFIG::default();
        c.rcParams.averageBitRate = 5_000_000;
        configurar(&mut c, &opcoes(Some(0), Some(80), Some(3)), Codec::Hevc);
        assert_eq!(c.gopLength, 1, "GOP 0 vira 1");
        assert!(matches!(
            c.rcParams.rateControlMode,
            NV_ENC_PARAMS_RC_MODE::NV_ENC_PARAMS_RC_VBR
        ));
        assert_eq!(
            (
                c.rcParams.averageBitRate,
                c.rcParams.maxBitRate,
                c.rcParams.targetQuality
            ),
            (0, 0, 51)
        );
        assert_eq!(c.rcParams.alphaLayerBitrateRatio, 3);
    }

    // P10.2 e P10.3, na placa: quadros sintéticos exportados como dma-buf por outro VkDevice, como o Chromium.
    const L: u32 = 816;
    const A: u32 = 96;
    const M: u32 = 16;

    fn motor(nome: &str, fila: u32) -> (Motor, std::path::PathBuf) {
        motor_em(nome, fila, "hevc", None, None)
    }

    fn motor_em(
        nome: &str,
        fila: u32,
        codec: &str,
        qps: Option<u32>,
        gop: Option<u32>,
    ) -> (Motor, std::path::PathBuf) {
        let saida =
            std::env::temp_dir().join(format!("nativo-{nome}-{}.{codec}", std::process::id()));
        let motor = Motor::new(Opcoes {
            largura: L,
            altura: A,
            saida: saida.to_string_lossy().into(),
            alfa: false,
            codec: Some(codec.into()),
            qps,
            preset: None,
            gop,
            qualidade: None,
            razao_alfa: None,
            marca: Some(M),
            fila: Some(fila),
        })
        .expect("motor");
        (motor, saida)
    }

    /// C01: o repetido sai como P pulado escrito por nós (HEVC e H.264), menos no começo do GOP (IDR, pelo NVENC). O
    /// fluxo decodifica sem erro no ffmpeg, cada pulado é igual ao anterior e, tirados os
    /// pulados, os quadros do NVENC decodificam iguais (conferir-pulado.sh). 816 × 96 não é múltiplo da CTU de 32:
    /// passa pela divisão inferida na borda.
    #[test]
    fn repetido_sai_pulado_e_o_fluxo_decodifica() {
        let script = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../docs/experimentos/2026-10-c01-quadro-repetido-sem-nvenc/conferir-pulado.sh"
        );
        let fonte = Vulkan::new(L, A + M).expect("vulkan da fonte");
        for codec in ["hevc", "h264"] {
            let (mut motor, saida) = motor_em(&format!("pulado-{codec}"), 2, codec, None, Some(8));
            let mut fds = Vec::new();
            // Repetidos depois do 1 (3), do 4 (6: o índice 8 do fluxo é começo de GOP) e do 7 (2).
            let repeticoes = [0, 3, 0, 0, 6, 0, 0, 2, 0];
            for (n, &r) in repeticoes.iter().enumerate() {
                let (fd, plano) = quadro(&fonte, n as u32);
                let m = motor
                    .quadro_marcado(plano, "0".into(), n as u32, false)
                    .expect("quadro");
                assert!(m.codificado);
                fds.push(fd);
                for _ in 0..r {
                    motor.repetir().expect("repetir");
                }
            }
            let resumo = motor.fechar().expect("fechar");
            assert_eq!((resumo.quadros, resumo.repetidos), (20, 11), "{codec}");
            assert_eq!(
                (resumo.pulados, resumo.pulado_desligado.as_deref()),
                (10, None),
                "{codec}"
            );
            let mp4 = saida.with_extension(format!("{codec}.mp4"));
            let r = std::process::Command::new("ffmpeg")
                .args(["-v", "error", "-y", "-framerate", "30", "-i"])
                .arg(&saida)
                .args(["-c", "copy"])
                .arg(&mp4)
                .status()
                .expect("ffmpeg");
            assert!(r.success());
            let r = std::process::Command::new("bash")
                .arg(script)
                .arg(&mp4)
                .output()
                .expect("conferir");
            let texto = String::from_utf8_lossy(&r.stdout).to_string()
                + &String::from_utf8_lossy(&r.stderr);
            assert!(r.status.success(), "{codec}: {texto}");
            assert!(texto.contains("20 quadros, 10 pulados"), "{codec}: {texto}");
            let _ = std::fs::remove_file(&saida);
            let _ = std::fs::remove_file(&mp4);
        }
    }

    /// Quadro com o conteúdo e a faixa da marca de `n`, num dma-buf linear.
    fn quadro(fonte: &Vulkan, n: u32) -> (std::os::fd::OwnedFd, Plano) {
        let mut pixels: Vec<u8> = (0..A)
            .flat_map(|y| (0..L).flat_map(move |x| [x as u8, y as u8, (n * 40) as u8, 255]))
            .collect();
        let faixa = marca::desenhar(n, L as usize);
        for _ in 0..M {
            pixels.extend_from_slice(&faixa);
        }
        let (fd, stride, offset) = vulkan::testes::exportar_dma_buf(fonte, &pixels, 0);
        use std::os::fd::AsRawFd;
        let plano = Plano {
            fd: fd.as_raw_fd(),
            stride,
            offset,
            largura: L,
            altura: A + M,
        };
        (fd, plano)
    }

    fn pacotes(fluxo: &std::path::Path) -> u32 {
        let formato = if fluxo.extension().is_some_and(|e| e == "h264") {
            "h264"
        } else {
            "hevc"
        };
        let r = std::process::Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-f",
                formato,
                "-count_packets",
                "-show_entries",
            ])
            .args(["stream=nb_read_packets", "-of", "csv=p=0"])
            .arg(fluxo)
            .output()
            .expect("ffprobe");
        String::from_utf8_lossy(&r.stdout)
            .trim()
            .parse()
            .expect("pacotes")
    }

    /// A fila leva os quadros na ordem, o de marca errada fica fora, o repetido entra sem cópia, e o fechar só volta
    /// com tudo codificado: o fluxo no disco tem todos os quadros e os bytes do resumo. Em HEVC e em H.264 (P01).
    #[test]
    fn fila_codifica_na_ordem_com_repetidos_e_fecha_vazia() {
        fila_com_repetidos("hevc");
    }

    #[test]
    fn fila_com_repetidos_em_h264() {
        fila_com_repetidos("h264");
    }

    fn fila_com_repetidos(codec: &str) {
        let fonte = Vulkan::new(L, A + M).expect("vulkan da fonte");
        let (mut motor, saida) = motor_em(&format!("fila-{codec}"), 2, codec, None, None);
        let mut fds = Vec::new();
        for n in 0..6 {
            let (fd, plano) = quadro(&fonte, n);
            let r = motor
                .quadro_marcado(plano, "0".into(), n, false)
                .expect("quadro");
            assert_eq!((r.marca, r.codificado), (Some(n), true));
            fds.push(fd);
            if n % 2 == 1 {
                // Mais quadros que buffers (fila 2 = 3 buffers): a cópia espera o NVENC soltar um, sem perder nem travar.
                for _ in 0..3 {
                    motor.repetir().expect("repetir");
                }
            }
        }
        let (fd, plano) = quadro(&fonte, 99);
        let r = motor
            .quadro_marcado(plano, "0".into(), 6, false)
            .expect("quadro de marca errada");
        assert_eq!((r.marca, r.codificado), (Some(99), false));
        drop(fd);
        let resumo = motor.fechar().expect("fechar");
        assert_eq!((resumo.quadros, resumo.repetidos), (15, 9));
        assert_eq!(resumo.copia_us.len(), 7, "seis quadros e o de marca errada");
        assert_eq!(resumo.codificacao_us.len() + resumo.repeticao_us.len(), 15);
        let bytes = std::fs::metadata(&saida).expect("fluxo").len();
        assert_eq!(bytes as f64, resumo.bytes);
        assert_eq!(pacotes(&saida), 15);
        let _ = std::fs::remove_file(&saida);
        assert!(motor.repetir().is_err(), "motor fechado");
    }

    /// O que o ffmpeg lê do fluxo cru: [perfil, has_b_frames] e o qps do VUI (time_scale ÷ 2 ÷ num_units_in_tick).
    fn cabecalho_h264(fluxo: &std::path::Path) -> (String, String, f64) {
        let r = std::process::Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-f",
                "h264",
                "-show_entries",
                "stream=profile,has_b_frames",
            ])
            .args(["-of", "csv=p=0"])
            .arg(fluxo)
            .output()
            .expect("ffprobe");
        let texto = String::from_utf8_lossy(&r.stdout).trim().to_string();
        let (perfil, b) = texto.split_once(',').expect("perfil e has_b_frames");
        let t = std::process::Command::new("ffmpeg")
            .args(["-v", "trace", "-hide_banner", "-f", "h264", "-i"])
            .arg(fluxo)
            .args([
                "-c",
                "copy",
                "-bsf:v",
                "trace_headers",
                "-frames:v",
                "1",
                "-f",
                "null",
                "-",
            ])
            .output()
            .expect("ffmpeg trace_headers");
        let log = String::from_utf8_lossy(&t.stderr);
        let campo = |nome: &str| -> f64 {
            log.lines()
                .find(|l| l.contains(&format!(" {nome} ")))
                .and_then(|l| l.split('=').next_back())
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or_else(|| panic!("{nome} fora do VUI"))
        };
        let qps = campo("time_scale") / 2.0 / campo("num_units_in_tick");
        (perfil.to_string(), b.to_string(), qps)
    }

    /// P01 e P10.5: o H.264 sai no perfil High, sem quadros B e com o qps pedido no VUI (24, que não é o padrão 25 do
    /// demuxer do H.264 cru nem o 30 de antes).
    #[test]
    fn h264_high_sem_b_com_o_qps_no_vui() {
        let fonte = Vulkan::new(L, A + M).expect("vulkan da fonte");
        let (mut motor, saida) = motor_em("qps", 2, "h264", Some(24), None);
        let mut fds = Vec::new();
        for n in 0..4 {
            let (fd, plano) = quadro(&fonte, n);
            motor
                .quadro_marcado(plano, "0".into(), n, false)
                .expect("quadro");
            fds.push(fd);
        }
        motor.fechar().expect("fechar");
        assert_eq!(cabecalho_h264(&saida), ("High".into(), "0".into(), 24.0));
        let _ = std::fs::remove_file(&saida);
    }

    /// Erro do NVENC (aqui, repetir sem quadro) não volta na chamada: volta no fechar, e a thread não fica viva.
    #[test]
    fn erro_da_fila_volta_no_fechar() {
        let (mut motor, saida) = motor("erro", 2);
        motor.repetir().expect("o repetido só entra na fila");
        let e = motor.fechar().err().expect("o fechar tem de dar o erro");
        assert!(e.reason.contains("sem quadro anterior"), "{}", e.reason);
        let _ = std::fs::remove_file(&saida);
    }
}

/// P04: a versão do módulo (Cargo.toml), para a sonda do comando conferir que o `nativo.node` é deste código.
#[napi]
pub fn versao() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// M03: lê a marca na linha `y` de um quadro BGRA de largura `largura` (conferência da tarja dentro do quadro).
#[napi]
pub fn ler_marca(pixels: Buffer, largura: u32, y: u32) -> Option<u32> {
    let passo = largura as usize * 4;
    pixels
        .get(y as usize * passo..(y as usize + 1) * passo)
        .and_then(marca::ler)
}

// Depuração: lê o dma-buf pela CPU (mmap) e conta os bytes não nulos, para separar «o Chromium não desenhou»
// de «a importação no Vulkan está errada». Fora do caminho do render.
fn contar_mmap(quadro: &Quadro, largura: u32, altura: u32) -> String {
    use std::os::fd::AsRawFd;
    unsafe extern "C" {
        fn mmap(a: *mut u8, n: usize, prot: i32, flags: i32, fd: i32, off: i64) -> *mut u8;
        fn munmap(a: *mut u8, n: usize) -> i32;
    }
    let n = (quadro.offset + quadro.stride * altura) as usize;
    let p = unsafe { mmap(std::ptr::null_mut(), n, 1, 1, quadro.fd.as_raw_fd(), 0) };
    if p as isize == -1 {
        return format!("falhou: {}", std::io::Error::last_os_error());
    }
    let dados = unsafe { std::slice::from_raw_parts(p, n) };
    let nao_nulos = dados.iter().filter(|&&b| b != 0).count();
    let meio = ((quadro.offset + quadro.stride * 200.min(altura - 1) + 4 * 480.min(largura - 1))
        as usize)
        .min(n - 4);
    let aviso = if quadro.modifier == 0 {
        ""
    } else {
        " (modifier não linear: posição embaralhada)"
    };
    let r = format!(
        "{nao_nulos} de {n} não nulos; pixel (480,200) BGRA {:?}{aviso}",
        &dados[meio..meio + 4]
    );
    unsafe { munmap(p, n) };
    r
}
