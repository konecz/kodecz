// Brilho por quadro, medido na placa durante o render (decisão do responsável de 2026-11-01: a piscada é medida no
// render, no quadro que já passa pela placa, e não decodificando o MP4). Cada quadro que vai ao NVENC (o BGRA da
// página, já com o take montado) passa por um núcleo que soma o luma de todos os pixels e a diferença absoluta para o
// quadro anterior (o buffer dele ainda está preso no anel, para o quadro repetido). Só voltam à CPU dois números.
//
// Escala: a do Y do MP4 (BT.709 de faixa limitada, preto 16 e branco 235, a conversão que o NVENC faz do ARGB;
// registro do M02), para os números baterem com a calibração do S04 (o brilho medido no MP4 entregue). Luma de cada
// pixel com pesos inteiros de soma 2^16 (13933 R + 46871 G + 4732 B, os 0,2126 / 0,7152 / 0,0722 do BT.709): a soma
// é exata em u64, e a média, uma divisão no fim.
//
// O núcleo é PTX escrito à mão, como o da mistura (mistura.rs): sem o kit da CUDA na máquina.
use super::mistura::{carregar_ptx, cu};
use cudarc::driver::sys::*;
use std::ffi::c_void;

/// Pesos do luma (soma 2^16), os mesmos escritos no PTX; aqui, para a referência dos testes.
#[cfg(test)]
const PESOS: [u32; 3] = [13933, 46871, 4732];
/// Linhas somadas por thread (uma coluna cada); a faixa de cada bloco no eixo y.
const LINHAS: u32 = 16;
const BLOCO: u32 = 256;

const PTX: &str = r#"
.version 7.0
.target sm_50
.address_size 64

.visible .entry medir_brilho(
	.param .u64 quadro, .param .u64 anterior, .param .u32 passo, .param .u32 largura, .param .u32 altura,
	.param .u32 linhas, .param .u64 totais
)
{
	.reg .pred %p<4>;
	.reg .b32 %r<32>;
	.reg .b64 %rd<16>;

	// x = a coluna desta thread; [y0, y1) = as linhas deste bloco
	mov.u32 %r1, %ctaid.x; mov.u32 %r2, %ntid.x; mov.u32 %r3, %tid.x;
	mad.lo.s32 %r4, %r1, %r2, %r3;
	ld.param.u32 %r5, [largura]; ld.param.u32 %r6, [altura]; ld.param.u32 %r7, [linhas];
	mov.u32 %r8, %ctaid.y; mul.lo.u32 %r9, %r8, %r7;
	add.u32 %r10, %r9, %r7; min.u32 %r10, %r10, %r6;
	mov.u64 %rd1, 0;
	mov.u64 %rd2, 0;
	// coluna fora do quadro: soma 0, mas entra na reducao do warp
	setp.ge.u32 %p1, %r4, %r5; @%p1 bra REDUZ;
	ld.param.u64 %rd3, [quadro]; ld.param.u64 %rd4, [anterior]; ld.param.u32 %r11, [passo];
	setp.ne.u64 %p2, %rd4, 0;
	mul.wide.u32 %rd5, %r4, 4;
	mul.wide.u32 %rd6, %r9, %r11; add.u64 %rd6, %rd6, %rd5;
	cvt.u64.u32 %rd7, %r11;
	mov.u32 %r12, %r9;
LACO:
	setp.ge.u32 %p3, %r12, %r10; @%p3 bra REDUZ;
	// BGRA na memoria: B no byte baixo; luma = 13933 R + 46871 G + 4732 B
	add.u64 %rd8, %rd3, %rd6; ld.global.u32 %r13, [%rd8];
	bfe.u32 %r14, %r13, 16, 8; bfe.u32 %r15, %r13, 8, 8; bfe.u32 %r16, %r13, 0, 8;
	mul.lo.u32 %r17, %r14, 13933; mad.lo.u32 %r17, %r15, 46871, %r17; mad.lo.u32 %r17, %r16, 4732, %r17;
	cvt.u64.u32 %rd9, %r17; add.u64 %rd1, %rd1, %rd9;
	@!%p2 bra PROXIMA;
	add.u64 %rd8, %rd4, %rd6; ld.global.u32 %r13, [%rd8];
	bfe.u32 %r14, %r13, 16, 8; bfe.u32 %r15, %r13, 8, 8; bfe.u32 %r16, %r13, 0, 8;
	mul.lo.u32 %r18, %r14, 13933; mad.lo.u32 %r18, %r15, 46871, %r18; mad.lo.u32 %r18, %r16, 4732, %r18;
	sub.s32 %r19, %r17, %r18; abs.s32 %r19, %r19;
	cvt.u64.u32 %rd9, %r19; add.u64 %rd2, %rd2, %rd9;
PROXIMA:
	add.u64 %rd6, %rd6, %rd7; add.u32 %r12, %r12, 1;
	bra.uni LACO;
REDUZ:
	// soma do warp por shfl.down (cada u64 em duas metades de 32 bits); a raia 0 soma nos totais
	//REDUCAO//
	and.b32 %r20, %r3, 31; setp.ne.u32 %p1, %r20, 0; @%p1 bra FIM;
	ld.param.u64 %rd11, [totais];
	atom.global.add.u64 %rd12, [%rd11], %rd1;
	atom.global.add.u64 %rd12, [%rd11+8], %rd2;
FIM:
	ret;
}
"#;

/// Um passo da soma do warp: `soma += a do vizinho a `d` raias`, para os dois acumuladores.
fn reducao_ptx() -> String {
    let mut s = String::new();
    for d in [16, 8, 4, 2, 1] {
        for acc in ["%rd1", "%rd2"] {
            s += &format!(
                "\tmov.b64 {{%r21, %r22}}, {acc}; shfl.sync.down.b32 %r23, %r21, {d}, 31, 0xffffffff; \
                 shfl.sync.down.b32 %r24, %r22, {d}, 31, 0xffffffff; mov.b64 %rd10, {{%r23, %r24}}; \
                 add.u64 {acc}, {acc}, %rd10;\n"
            );
        }
    }
    s
}

/// O brilho de um quadro, na escala do Y do MP4 (0 a 255; preto 16, branco 235).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Brilho {
    /// Média do luma do quadro.
    pub medio: f64,
    /// Média da diferença absoluta do luma, pixel a pixel, para o quadro anterior (0 sem anterior).
    pub mudanca: f64,
}

impl Brilho {
    /// Das somas do núcleo (luma × 2^16, em u64) para a escala do Y do MP4.
    pub fn das_somas(soma: u64, diferenca: u64, pixels: u64) -> Self {
        let escala = |v: u64| v as f64 / (65536.0 * pixels as f64) * 219.0 / 255.0;
        Self { medio: 16.0 + escala(soma), mudanca: escala(diferenca) }
    }
}

/// O núcleo carregado, os dois totais na placa e um fluxo próprio. A CUDA tem de estar corrente na thread (a do NVENC).
/// O fluxo é próprio e não bloqueante: no fluxo padrão (legado), a cópia de volta sincroniza com todo o contexto, que é o
/// primário, dividido com as outras sessões do mesmo processo (nos testes, várias em paralelo travavam às vezes).
pub struct Medidor {
    modulo: CUmodule,
    funcao: CUfunction,
    totais: CUdeviceptr,
    fluxo: CUstream,
}

impl Medidor {
    pub fn novo() -> Result<Self, String> {
        let (modulo, funcao) = carregar_ptx(&PTX.replace("//REDUCAO//", &reducao_ptx()), c"medir_brilho", "do brilho")?;
        let mut totais = 0;
        if let Err(e) = cu(unsafe { cuMemAlloc_v2(&mut totais, 16) }, "memória do brilho") {
            unsafe { cuModuleUnload(modulo) };
            return Err(e);
        }
        let mut fluxo: CUstream = std::ptr::null_mut();
        if let Err(e) = cu(unsafe { cuStreamCreate(&mut fluxo, CUstream_flags::CU_STREAM_NON_BLOCKING as u32) }, "fluxo do brilho") {
            unsafe {
                cuMemFree_v2(totais);
                cuModuleUnload(modulo);
            }
            return Err(e);
        }
        Ok(Self { modulo, funcao, totais, fluxo })
    }

    /// As somas do luma do quadro e da diferença para o anterior (0 sem anterior), exatas. Espera o núcleo acabar.
    pub fn somas(&self, quadro: CUdeviceptr, anterior: Option<CUdeviceptr>, passo: u32, largura: u32, altura: u32) -> Result<(u64, u64), String> {
        if largura == 0 || altura == 0 {
            return Ok((0, 0));
        }
        cu(unsafe { cuMemsetD8Async(self.totais, 0, 16, self.fluxo) }, "zerar o brilho")?;
        let (mut q, mut a, mut p, mut l, mut h, mut n, mut t) =
            (quadro, anterior.unwrap_or(0), passo, largura, altura, LINHAS, self.totais);
        let mut params: [*mut c_void; 7] = [
            &mut q as *mut _ as *mut c_void,
            &mut a as *mut _ as *mut c_void,
            &mut p as *mut _ as *mut c_void,
            &mut l as *mut _ as *mut c_void,
            &mut h as *mut _ as *mut c_void,
            &mut n as *mut _ as *mut c_void,
            &mut t as *mut _ as *mut c_void,
        ];
        cu(
            unsafe {
                cuLaunchKernel(
                    self.funcao,
                    largura.div_ceil(BLOCO),
                    altura.div_ceil(LINHAS),
                    1,
                    BLOCO,
                    1,
                    1,
                    0,
                    self.fluxo,
                    params.as_mut_ptr(),
                    std::ptr::null_mut(),
                )
            },
            "lançar o brilho",
        )?;
        let mut v = [0u64; 2];
        cu(unsafe { cuMemcpyDtoHAsync_v2(v.as_mut_ptr() as *mut c_void, self.totais, 16, self.fluxo) }, "ler o brilho")?;
        cu(unsafe { cuStreamSynchronize(self.fluxo) }, "esperar o brilho")?;
        Ok((v[0], v[1]))
    }

    pub fn medir(&self, quadro: CUdeviceptr, anterior: Option<CUdeviceptr>, passo: u32, largura: u32, altura: u32) -> Result<Brilho, String> {
        let (s, d) = self.somas(quadro, anterior, passo, largura, altura)?;
        Ok(Brilho::das_somas(s, d, u64::from(largura) * u64::from(altura)))
    }
}

impl Drop for Medidor {
    fn drop(&mut self) {
        unsafe {
            cuStreamDestroy_v2(self.fluxo);
            cuMemFree_v2(self.totais);
            cuModuleUnload(self.modulo);
        }
    }
}

/// A mesma conta na CPU (a referência dos testes): as somas do luma e da diferença, exatas.
#[cfg(test)]
pub fn referencia(quadro: &[u8], anterior: Option<&[u8]>, passo: usize, largura: usize, altura: usize) -> (u64, u64) {
    let luma = |px: &[u8]| PESOS[0] * u32::from(px[2]) + PESOS[1] * u32::from(px[1]) + PESOS[2] * u32::from(px[0]);
    let (mut s, mut d) = (0u64, 0u64);
    for y in 0..altura {
        for x in 0..largura {
            let i = y * passo + 4 * x;
            let w = luma(&quadro[i..i + 4]);
            s += u64::from(w);
            if let Some(a) = anterior {
                d += u64::from(w.abs_diff(luma(&a[i..i + 4])));
            }
        }
    }
    (s, d)
}

#[cfg(test)]
mod testes {
    use super::*;
    use cudarc::driver::CudaContext;

    fn tem_placa() -> bool {
        std::path::Path::new("/dev/nvidiactl").exists()
    }

    fn subir(dados: &[u8]) -> CUdeviceptr {
        let mut p = 0;
        cu(unsafe { cuMemAlloc_v2(&mut p, dados.len()) }, "alloc").unwrap();
        cu(unsafe { cuMemcpyHtoD_v2(p, dados.as_ptr() as *const c_void, dados.len()) }, "HtoD").unwrap();
        p
    }

    fn aleatorio(n: usize, semente: u64) -> Vec<u8> {
        let mut x = semente;
        (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                (x >> 24) as u8
            })
            .collect()
    }

    /// Núcleo = referência, exato, em tamanhos que não fecham o bloco (largura) nem a faixa (altura), com passo maior
    /// que a linha, com e sem o anterior; e os extremos (preto e branco) na escala do Y do MP4.
    #[test]
    fn brilho_igual_a_referencia() {
        if !tem_placa() {
            eprintln!("pulado: sem placa");
            return;
        }
        let ctx = CudaContext::new(0).unwrap();
        ctx.bind_to_thread().unwrap();
        let m = Medidor::novo().unwrap();
        for (l, a, passo) in [(1920usize, 1080usize, 1920 * 4), (333, 77, 1400), (1, 1, 4), (4096, 2160, 4096 * 4)] {
            let q = aleatorio(passo * a, 7 + l as u64);
            let ant = aleatorio(passo * a, 99 + a as u64);
            let (pq, pa) = (subir(&q), subir(&ant));
            let sem = m.somas(pq, None, passo as u32, l as u32, a as u32).unwrap();
            assert_eq!(sem, (referencia(&q, None, passo, l, a).0, 0), "{l}x{a} sem anterior");
            let com = m.somas(pq, Some(pa), passo as u32, l as u32, a as u32).unwrap();
            assert_eq!(com, referencia(&q, Some(&ant), passo, l, a), "{l}x{a} com anterior");
            unsafe {
                cuMemFree_v2(pq);
                cuMemFree_v2(pa);
            }
        }
        let (l, a) = (640usize, 360usize);
        let preto = subir(&[0, 0, 0, 255].repeat(l * a));
        let branco = subir(&[255u8; 4].repeat(l * a));
        let b = m.medir(branco, Some(preto), (l * 4) as u32, l as u32, a as u32).unwrap();
        let p = m.medir(preto, None, (l * 4) as u32, l as u32, a as u32).unwrap();
        assert_eq!(p, Brilho { medio: 16.0, mudanca: 0.0 });
        assert!((b.medio - 235.0).abs() < 1e-9 && (b.mudanca - 219.0).abs() < 1e-9, "{b:?}");
        unsafe {
            cuMemFree_v2(preto);
            cuMemFree_v2(branco);
        }
    }
}
