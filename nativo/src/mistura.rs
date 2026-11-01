// S08, degrau 2: o quadro do vídeo (NV12 do NVDEC) misturado por baixo da textura da página, na placa, antes do NVENC.
// A página chega com alfa pré-multiplicado (a janela é transparente) e um buraco transparente onde o vídeo fica; cada
// pixel sai `página + por_baixo × (255 − alfa) / 255`, arredondado, com alfa 255. Por baixo: o vídeo dentro do recorte
// e, fora dele, o fundo da página (a cor do fundo da raiz, tirada da página pelo motor), se houver. O vídeo vai no
// tamanho dele (o texel direto) ou ampliado/reduzido (`Escala`, bilinear como o Chromium desenha o canvas escalado).
//
// A cor do vídeo é a mesma conta do cor-limpa.js (P05, M09): YUV 4:2:0 de 8 bits para RGB, igual bit a bit ao ffmpeg
// (yuv420p → bgr24, flags bilinear), croma pelo vizinho (x >> 1, y >> 1), cada termo o piso de c·x / 2^13.
//
// O núcleo é PTX escrito à mão, compilado pelo driver na carga do módulo (cuModuleLoadData): sem o kit da CUDA nem
// compilador de shader na máquina, sem dependência nova.
use cudarc::driver::sys::*;
use std::ffi::c_void;

const BITS: f64 = 8192.0; // 2^13

/// Coeficientes inteiros (escala 2^13) de uma matriz e faixa, como o `coeficientes` do cor-limpa.js.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Coeficientes {
    pub y0: i32,
    pub cy: i32,
    pub cr: i32,
    pub cgu: i32,
    pub cgv: i32,
    pub cb: i32,
}

/// Math.round do JS (metade para cima), que o cor-limpa.js usa; o `round` do Rust afasta do zero.
fn arredondar(v: f64) -> i32 {
    (v + 0.5).floor() as i32
}

impl Coeficientes {
    /// `matriz`: o nome do WebCodecs (VideoColorSpace.matrix) que a sonda dá (midia-linha.ts, corDoVideo), ou nada;
    /// `cheia`: faixa cheia. A regra de escolha é a do cor-limpa.js (`escolha`).
    pub fn de(matriz: Option<&str>, cheia: bool, altura: u32) -> Result<Self, String> {
        let norma = match matriz {
            None => {
                if cheia || altura < 720 {
                    "bt601"
                } else {
                    "bt709"
                }
            }
            Some("bt709") => "bt709",
            Some("smpte170m") | Some("bt470bg") => "bt601",
            Some("smpte240m") => "smpte240m",
            Some("bt2020-ncl") => "bt2020",
            Some(outra) => return Err(format!("matriz de cor {outra} não é tratada pelo motor")),
        };
        let (kr, kb) = match norma {
            "bt601" => (0.299, 0.114),
            "bt709" => (0.2126, 0.0722),
            "smpte240m" => (0.212, 0.087),
            _ => (0.2627, 0.0593),
        };
        let kg = 1.0 - kr - kb;
        let (ey, ec) = if cheia {
            (1.0, 1.0)
        } else {
            (255.0 / 219.0, 255.0 / 224.0)
        };
        let q = |v: f64| arredondar(v * BITS);
        Ok(Self {
            y0: if cheia { 0 } else { 16 },
            cy: q(ey),
            cr: q(2.0 * (1.0 - kr) * ec),
            cb: q(2.0 * (1.0 - kb) * ec),
            cgu: q((-2.0 * kb * (1.0 - kb) / kg) * ec),
            cgv: q((-2.0 * kr * (1.0 - kr) / kg) * ec),
        })
    }
}

/// Onde o vídeo vai no quadro: a origem (canto de cima à esquerda do vídeo inteiro, em pixels do quadro) e o recorte
/// visível [x0, x1) × [y0, y1), dentro do vídeo e do quadro. Com `escala`, o vídeo vai ampliado ou reduzido (a origem
/// inteira não vale; ver `Escala`).
#[derive(Clone, Copy, Debug)]
pub struct Posicao {
    pub x: i32,
    pub y: i32,
    pub recorte: [i32; 4],
    pub escala: Option<Escala>,
    pub arredondado: Option<Arredondado>,
}

/// S08, escala ≠ 1: o vídeo desenhado como o Chromium desenha o canvas escalado (medido contra o caminho do canvas,
/// registro do S08, seção 7): o texel u (bordas em 0..largura) vai a `t + s·u` no quadro, e o pixel de centro c lê o
/// vídeo em `(c − t)/s − 0,5`, bilinear entre os 4 texels vizinhos (presos à borda), cada um com a cor inteira do
/// cor-limpa.js. Guardada como o núcleo usa: `f = (x + 0,5)·is + o`, com `is = 1/s` e `o = −t/s − 0,5` em f32.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Escala {
    pub isx: f32,
    pub ox: f32,
    pub isy: f32,
    pub oy: f32,
}

impl Escala {
    /// `s` (pixels do quadro por texel) e `t` (onde a borda esquerda e a de cima do vídeo caem no quadro).
    pub fn de(sx: f64, sy: f64, tx: f64, ty: f64) -> Result<Self, String> {
        // A página manda só de 0,5 para cima; o piso aqui evita 1/s infinito em f32.
        if !(sx.is_finite() && sy.is_finite() && tx.is_finite() && ty.is_finite() && sx >= 1e-3 && sy >= 1e-3) {
            return Err(format!("escala inválida: s = ({sx}, {sy}), t = ({tx}, {ty})"));
        }
        Ok(Self {
            isx: (1.0 / sx) as f32,
            ox: (-tx / sx - 0.5) as f32,
            isy: (1.0 / sy) as f32,
            oy: (-ty / sy - 0.5) as f32,
        })
    }
}

/// S08, recorte arredondado (um ancestral do vídeo com `overflow` diferente de `visible` e `border-radius`, como o
/// cartão da apresentadora): o retângulo [x0, x1) × [y0, y1) com os quatro cantos de raio `raio` (círculo).
/// Medido contra o caminho do canvas (registro do S08, seção 8): o Chromium cobre o pixel de centro p com
/// `clamp(raio + 0,5 − d, 0, 1)`, d a distância de p ao centro do círculo do canto (a conta analítica do Skia para o
/// retângulo arredondado com antisserrilhado); e, na faixa do canto (0 < c < 1), o que a página pinta ali fica por
/// baixo do vídeo (a sombra e o contorno do cartão vão na camada de baixo): `c·vídeo + (1 − c)·(página + fundo·(1 − a))`.
/// Fora da faixa, a mistura de sempre (c = 1: o vídeo por baixo da página; c = 0: o fundo).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Arredondado {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
    pub raio: f32,
    /// Os cantos com algo da página por cima do vídeo (bit 0 o de cima à esquerda, 1 o de cima à direita, 2 o de baixo
    /// à esquerda, 3 o de baixo à direita): neles, a página inteira vai por cima do vídeo coberto,
    /// `página + (c·vídeo + (1 − c)·fundo)·(1 − a)` (a página diz quando, `take-placa.js`).
    pub por_cima: u32,
    /// O que cobre esses cantos (o fundo da legenda, quase opaco): BGRA pré-multiplicado em 0xAARRGGBB, 0 = nada. Onde o
    /// pixel da página é esse fundo sobre o que está por baixo (a sombra e o contorno do cartão), a conta exata:
    /// `c·(cobertor + vídeo·(1 − a_cobertor)) + (1 − c)·(página + fundo·(1 − a))`; onde não é (o texto da legenda), a de
    /// cima.
    pub cobertor: u32,
}

impl Arredondado {
    pub fn com_por_cima(mut self, por_cima: u32, cobertor: u32) -> Self {
        self.por_cima = por_cima & 15;
        self.cobertor = cobertor;
        self
    }

    /// O pixel da página (BGRA) é o cobertor sobre algo (cada canal entre o cobertor e o cobertor mais o que sobra do
    /// alfa, com 2 níveis de folga para o arredondamento)?
    #[cfg(test)]
    pub fn so_cobertor(&self, px: &[u8]) -> bool {
        let ac = (self.cobertor >> 24) as i32;
        let a = i32::from(px[3]);
        ac > 0 && a + 2 >= ac && (0..3).all(|i| {
            let d = i32::from(px[i]) - ((self.cobertor >> (8 * i)) & 255) as i32;
            d >= -2 && d <= a - ac + 2
        })
    }

    /// O canto do pixel (x, y): 0 de cima à esquerda, 1 de cima à direita, 2 de baixo à esquerda, 3 de baixo à direita.
    #[cfg(test)]
    pub fn canto(&self, x: i32, y: i32) -> u32 {
        let (cx, cy) = (x as f32 + 0.5, y as f32 + 0.5);
        let esq = ((self.x0 + self.raio) - cx) > (cx - (self.x1 - self.raio));
        let cima = ((self.y0 + self.raio) - cy) > (cy - (self.y1 - self.raio));
        u32::from(!esq) + 2 * u32::from(!cima)
    }

    pub fn de(x0: f64, y0: f64, x1: f64, y1: f64, raio: f64) -> Result<Self, String> {
        if !([x0, y0, x1, y1, raio].iter().all(|v| v.is_finite()) && raio > 0.0 && 2.0 * raio <= x1 - x0 && 2.0 * raio <= y1 - y0) {
            return Err(format!("recorte arredondado inválido: [{x0}, {y0}, {x1}, {y1}] com raio {raio}"));
        }
        Ok(Self { x0: x0 as f32, y0: y0 as f32, x1: x1 as f32, y1: y1 as f32, raio: raio as f32, por_cima: 0, cobertor: 0 })
    }

    /// A cobertura do pixel (x, y), de 0 a 1, com as mesmas operações em f32 do núcleo (a referência dos testes).
    #[cfg(test)]
    pub fn cobertura(&self, x: i32, y: i32) -> f32 {
        let (cx, cy) = (x as f32 + 0.5, y as f32 + 0.5);
        let dx = ((self.x0 + self.raio) - cx).max(cx - (self.x1 - self.raio)).max(0.0);
        let dy = ((self.y0 + self.raio) - cy).max(cy - (self.y1 - self.raio)).max(0.0);
        if !(dx > 0.0 && dy > 0.0) {
            return 1.0;
        }
        ((self.raio + 0.5) - dx.mul_add(dx, dy * dy).sqrt()).clamp(0.0, 1.0)
    }
}

/// O texel (x, y) do NV12 em `%rd3` (largura `%r14`, altura `%r15`) convertido em R, G, B (f32), com a conta inteira
/// do caminho sem escala; `%k0..%k5` são os coeficientes. Usa `%t*` e `%u*` de rascunho.
fn texel_ptx(x: &str, y: &str, r: &str, g: &str, b: &str) -> String {
    format!(
        r#"
	mul.wide.u32 %u0, {y}, %r14; cvt.u64.u32 %u1, {x}; add.u64 %u0, %u0, %u1; add.u64 %u0, %u0, %rd3;
	ld.global.u8 %t0, [%u0];
	mul.wide.u32 %u2, %r14, %r15; add.u64 %u2, %u2, %rd3;
	shr.u32 %t1, {y}, 1; mul.wide.u32 %u1, %t1, %r14; add.u64 %u2, %u2, %u1;
	and.b32 %t1, {x}, 0xFFFFFFFE; cvt.u64.u32 %u1, %t1; add.u64 %u2, %u2, %u1;
	ld.global.u8 %t1, [%u2]; ld.global.u8 %t2, [%u2+1];
	sub.s32 %t1, %t1, 128; sub.s32 %t2, %t2, 128;
	sub.s32 %t0, %t0, %k0; mul.lo.s32 %t0, %t0, %k1; shr.s32 %t0, %t0, 13;
	mul.lo.s32 %t3, %k2, %t2; shr.s32 %t3, %t3, 13; add.s32 %t3, %t3, %t0;
	mul.lo.s32 %t4, %k3, %t1; shr.s32 %t4, %t4, 13; mul.lo.s32 %t5, %k4, %t2; shr.s32 %t5, %t5, 13;
	add.s32 %t4, %t4, %t5; add.s32 %t4, %t4, %t0;
	mul.lo.s32 %t5, %k5, %t1; shr.s32 %t5, %t5, 13; add.s32 %t5, %t5, %t0;
	max.s32 %t3, %t3, 0; min.s32 %t3, %t3, 255; max.s32 %t4, %t4, 0; min.s32 %t4, %t4, 255;
	max.s32 %t5, %t5, 0; min.s32 %t5, %t5, 255;
	cvt.rn.f32.s32 {r}, %t3; cvt.rn.f32.s32 {g}, %t4; cvt.rn.f32.s32 {b}, %t5;"#
    )
}

/// Bilinear de um canal: `c00..c11` (f32), pesos `%f3` (x) e `%f4` (y); o resultado arredondado (metade para cima)
/// vai ao registrador inteiro `saida`. Todas as operações com arredondamento explícito (sem contração em fma além
/// das escritas), para a referência na CPU dar o mesmo bit a bit.
fn lerp_ptx(c00: &str, c10: &str, c01: &str, c11: &str, saida: &str) -> String {
    format!(
        r#"
	sub.rn.f32 %f20, {c10}, {c00}; fma.rn.f32 %f21, %f20, %f3, {c00};
	sub.rn.f32 %f20, {c11}, {c01}; fma.rn.f32 %f22, %f20, %f3, {c01};
	sub.rn.f32 %f20, %f22, %f21; fma.rn.f32 %f23, %f20, %f4, %f21;
	add.rn.f32 %f23, %f23, 0f3F000000; cvt.rmi.s32.f32 {saida}, %f23;
	max.s32 {saida}, {saida}, 0; min.s32 {saida}, {saida}, 255;"#
    )
}

/// O trecho do núcleo com escala: a partir do pixel (`%r4`, `%r6`), põe R, G, B em `%r22`, `%r23`, `%r25`.
fn escala_ptx() -> String {
    let mut s = String::from(
        r#"
ESCALA:
	ld.param.s32 %k0, [ky0]; ld.param.s32 %k1, [kcy]; ld.param.s32 %k2, [kcr];
	ld.param.s32 %k3, [kcgu]; ld.param.s32 %k4, [kcgv]; ld.param.s32 %k5, [kcb];
	ld.param.u32 %r14, [vl]; ld.param.u32 %r15, [va];
	// f = (pixel + 0.5)*is + o; texel de baixo = piso(f); peso = f - piso(f)
	cvt.rn.f32.s32 %f1, %r4; add.rn.f32 %f1, %f1, 0f3F000000;
	ld.param.f32 %f5, [isx]; ld.param.f32 %f6, [ox]; fma.rn.f32 %f1, %f1, %f5, %f6;
	cvt.rn.f32.s32 %f2, %r6; add.rn.f32 %f2, %f2, 0f3F000000;
	ld.param.f32 %f5, [isy]; ld.param.f32 %f6, [oy]; fma.rn.f32 %f2, %f2, %f5, %f6;
	cvt.rmi.f32.f32 %f7, %f1; sub.rn.f32 %f3, %f1, %f7; cvt.rzi.s32.f32 %r32, %f7;
	cvt.rmi.f32.f32 %f8, %f2; sub.rn.f32 %f4, %f2, %f8; cvt.rzi.s32.f32 %r34, %f8;
	add.s32 %r33, %r32, 1; add.s32 %r35, %r34, 1;
	// presos na borda do video
	sub.s32 %r36, %r14, 1; sub.s32 %r37, %r15, 1;
	max.s32 %r32, %r32, 0; min.s32 %r32, %r32, %r36; max.s32 %r33, %r33, 0; min.s32 %r33, %r33, %r36;
	max.s32 %r34, %r34, 0; min.s32 %r34, %r34, %r37; max.s32 %r35, %r35, 0; min.s32 %r35, %r35, %r37;"#,
    );
    s += &texel_ptx("%r32", "%r34", "%f10", "%f11", "%f12");
    s += &texel_ptx("%r33", "%r34", "%f13", "%f14", "%f15");
    s += &texel_ptx("%r32", "%r35", "%f16", "%f17", "%f18");
    s += &texel_ptx("%r33", "%r35", "%f24", "%f25", "%f26");
    s += &lerp_ptx("%f10", "%f13", "%f16", "%f24", "%r22");
    s += &lerp_ptx("%f11", "%f14", "%f17", "%f25", "%r23");
    s += &lerp_ptx("%f12", "%f15", "%f18", "%f26", "%r25");
    s += "\n\tbra.uni MISTURA;\n";
    s
}

fn ptx() -> String {
    PTX.replace("//ESCALA//", &escala_ptx())
}

const PTX: &str = r#"
.version 7.0
.target sm_50
.address_size 64

.visible .entry misturar(
	.param .u64 saida, .param .u32 passo,
	.param .s32 x0, .param .s32 y0, .param .s32 x1, .param .s32 y1,
	.param .u64 nv12, .param .u32 vl, .param .u32 va, .param .s32 vx, .param .s32 vy,
	.param .s32 cx0, .param .s32 cy0, .param .s32 cx1, .param .s32 cy1,
	.param .u32 fundo, .param .u32 tem_fundo,
	.param .s32 ky0, .param .s32 kcy, .param .s32 kcr, .param .s32 kcgu, .param .s32 kcgv, .param .s32 kcb,
	.param .u32 escalado, .param .f32 isx, .param .f32 ox, .param .f32 isy, .param .f32 oy,
	.param .u32 arred, .param .f32 ax0, .param .f32 ay0, .param .f32 ax1, .param .f32 ay1, .param .f32 araio,
	.param .u32 por_cima, .param .u32 cobertor
)
{
	.reg .pred %p<12>;
	.reg .b32 %r<40>;
	.reg .b64 %rd<10>;
	.reg .f32 %f<40>;
	.reg .b32 %k<6>;
	.reg .b32 %t<16>;
	.reg .b64 %u<4>;

	mov.u32 %r1, %ctaid.x; mov.u32 %r2, %ntid.x; mov.u32 %r3, %tid.x;
	mad.lo.s32 %r4, %r1, %r2, %r3;
	ld.param.s32 %r5, [x0]; add.s32 %r4, %r4, %r5;
	mov.u32 %r1, %ctaid.y; mov.u32 %r2, %ntid.y; mov.u32 %r3, %tid.y;
	mad.lo.s32 %r6, %r1, %r2, %r3;
	ld.param.s32 %r5, [y0]; add.s32 %r6, %r6, %r5;
	ld.param.s32 %r7, [x1]; setp.ge.s32 %p1, %r4, %r7; @%p1 bra FIM;
	ld.param.s32 %r7, [y1]; setp.ge.s32 %p1, %r6, %r7; @%p1 bra FIM;

	// pagina: BGRA na memoria (B no byte baixo, alfa no alto)
	ld.param.u64 %rd1, [saida]; ld.param.u32 %r8, [passo];
	mul.wide.u32 %rd2, %r6, %r8; add.u64 %rd1, %rd1, %rd2;
	mul.wide.u32 %rd2, %r4, 4; add.u64 %rd1, %rd1, %rd2;
	ld.global.u32 %r9, [%rd1];
	shr.u32 %r10, %r9, 24;
	// opaco: nada por baixo aparece, salvo na faixa do canto arredondado (%p4 opaco, %p5 com recorte arredondado)
	setp.eq.u32 %p4, %r10, 255;
	ld.param.u32 %r38, [arred]; setp.ne.u32 %p5, %r38, 0;
	@%p5 bra OPACO_OK; @%p4 bra FIM;
OPACO_OK:

	// dentro do recorte do video?
	ld.param.u64 %rd3, [nv12];
	setp.eq.u64 %p2, %rd3, 0; @%p2 bra FUNDO;
	ld.param.s32 %r11, [cx0]; setp.lt.s32 %p2, %r4, %r11; @%p2 bra FUNDO;
	ld.param.s32 %r11, [cx1]; setp.ge.s32 %p2, %r4, %r11; @%p2 bra FUNDO;
	ld.param.s32 %r11, [cy0]; setp.lt.s32 %p2, %r6, %r11; @%p2 bra FUNDO;
	ld.param.s32 %r11, [cy1]; setp.ge.s32 %p2, %r6, %r11; @%p2 bra FUNDO;
	@%p5 bra ARRED;
VIDEO:
	ld.param.u32 %r11, [escalado]; setp.ne.u32 %p2, %r11, 0; @%p2 bra ESCALA;

	ld.param.s32 %r11, [vx]; sub.s32 %r12, %r4, %r11;
	ld.param.s32 %r11, [vy]; sub.s32 %r13, %r6, %r11;
	ld.param.u32 %r14, [vl]; ld.param.u32 %r15, [va];
	// Y em nv12 + vy*vl + vx
	mul.wide.u32 %rd4, %r13, %r14; cvt.u64.u32 %rd5, %r12; add.u64 %rd4, %rd4, %rd5; add.u64 %rd4, %rd4, %rd3;
	ld.global.u8 %r16, [%rd4];
	// U, V em nv12 + vl*va + (vy >> 1)*vl + (vx & ~1)
	mul.wide.u32 %rd6, %r14, %r15; add.u64 %rd6, %rd6, %rd3;
	shr.u32 %r17, %r13, 1; mul.wide.u32 %rd7, %r17, %r14; add.u64 %rd6, %rd6, %rd7;
	and.b32 %r18, %r12, 0xFFFFFFFE; cvt.u64.u32 %rd7, %r18; add.u64 %rd6, %rd6, %rd7;
	ld.global.u8 %r19, [%rd6];
	ld.global.u8 %r20, [%rd6+1];
	sub.s32 %r19, %r19, 128; sub.s32 %r20, %r20, 128;
	// ty = (cy*(Y - y0)) >> 13; cada termo de croma com o proprio >> 13 (aritmetico: piso, como o JS)
	ld.param.s32 %r21, [ky0]; sub.s32 %r16, %r16, %r21;
	ld.param.s32 %r21, [kcy]; mul.lo.s32 %r16, %r16, %r21; shr.s32 %r16, %r16, 13;
	ld.param.s32 %r21, [kcr]; mul.lo.s32 %r22, %r21, %r20; shr.s32 %r22, %r22, 13; add.s32 %r22, %r22, %r16;
	ld.param.s32 %r21, [kcgu]; mul.lo.s32 %r23, %r21, %r19; shr.s32 %r23, %r23, 13;
	ld.param.s32 %r21, [kcgv]; mul.lo.s32 %r24, %r21, %r20; shr.s32 %r24, %r24, 13;
	add.s32 %r23, %r23, %r24; add.s32 %r23, %r23, %r16;
	ld.param.s32 %r21, [kcb]; mul.lo.s32 %r25, %r21, %r19; shr.s32 %r25, %r25, 13; add.s32 %r25, %r25, %r16;
	max.s32 %r22, %r22, 0; min.s32 %r22, %r22, 255;
	max.s32 %r23, %r23, 0; min.s32 %r23, %r23, 255;
	max.s32 %r25, %r25, 0; min.s32 %r25, %r25, 255;
	bra.uni MISTURA;
//ESCALA//
ARRED:
	// c = raio + 0.5 - d no canto; 1 fora dele (Arredondado::cobertura, as mesmas operacoes)
	cvt.rn.f32.s32 %f32, %r4; add.rn.f32 %f32, %f32, 0f3F000000;
	cvt.rn.f32.s32 %f33, %r6; add.rn.f32 %f33, %f33, 0f3F000000;
	ld.param.f32 %f34, [araio];
	ld.param.f32 %f35, [ax0]; add.rn.f32 %f35, %f35, %f34; sub.rn.f32 %f35, %f35, %f32;
	ld.param.f32 %f36, [ax1]; sub.rn.f32 %f36, %f36, %f34; sub.rn.f32 %f36, %f32, %f36;
	setp.gt.f32 %p8, %f35, %f36;
	max.f32 %f35, %f35, %f36; max.f32 %f35, %f35, 0f00000000;
	ld.param.f32 %f37, [ay0]; add.rn.f32 %f37, %f37, %f34; sub.rn.f32 %f37, %f37, %f33;
	ld.param.f32 %f36, [ay1]; sub.rn.f32 %f36, %f36, %f34; sub.rn.f32 %f36, %f33, %f36;
	setp.gt.f32 %p9, %f37, %f36;
	max.f32 %f37, %f37, %f36; max.f32 %f37, %f37, 0f00000000;
	mov.f32 %f30, 0f3F800000;
	setp.gt.f32 %p6, %f35, 0f00000000; setp.gt.f32 %p7, %f37, 0f00000000; and.pred %p6, %p6, %p7;
	@!%p6 bra ARRED_C;
	mul.rn.f32 %f36, %f37, %f37; fma.rn.f32 %f36, %f35, %f35, %f36; sqrt.rn.f32 %f36, %f36;
	add.rn.f32 %f30, %f34, 0f3F000000; sub.rn.f32 %f30, %f30, %f36;
ARRED_C:
	setp.le.f32 %p6, %f30, 0f00000000; @%p6 bra FUNDO;
	setp.lt.f32 %p6, %f30, 0f3F800000; @%p6 bra VIDEO;
	// c = 1: a mistura de sempre (sem a faixa); opaco, nada a fazer
	@%p4 bra FIM;
	setp.ne.u32 %p5, %r38, %r38;
	bra.uni VIDEO;
FUNDO:
	@%p4 bra FIM;
	// o fundo nunca e a faixa do canto
	setp.ne.u32 %p5, %r38, %r38;
	ld.param.u32 %r26, [tem_fundo]; setp.eq.u32 %p3, %r26, 0; @%p3 bra FIM;
	ld.param.u32 %r26, [fundo];
	shr.u32 %r22, %r26, 16; and.b32 %r22, %r22, 255;
	shr.u32 %r23, %r26, 8; and.b32 %r23, %r23, 255;
	and.b32 %r25, %r26, 255;
MISTURA:
	@%p5 bra BANDA;
	// c = pagina + (por_baixo*(255 - a) + 127) / 255
	mov.u32 %r27, 255; sub.u32 %r27, %r27, %r10;
	and.b32 %r28, %r9, 255;
	mad.lo.u32 %r29, %r25, %r27, 127; div.u32 %r29, %r29, 255; add.u32 %r28, %r28, %r29;
	shr.u32 %r30, %r9, 8; and.b32 %r30, %r30, 255;
	mad.lo.u32 %r29, %r23, %r27, 127; div.u32 %r29, %r29, 255; add.u32 %r30, %r30, %r29;
	shr.u32 %r31, %r9, 16; and.b32 %r31, %r31, 255;
	mad.lo.u32 %r29, %r22, %r27, 127; div.u32 %r29, %r29, 255; add.u32 %r31, %r31, %r29;
	min.u32 %r28, %r28, 255; min.u32 %r30, %r30, 255; min.u32 %r31, %r31, 255;
	shl.b32 %r30, %r30, 8; shl.b32 %r31, %r31, 16;
	or.b32 %r28, %r28, %r30; or.b32 %r28, %r28, %r31; or.b32 %r28, %r28, 0xFF000000;
	st.global.u32 [%rd1], %r28;
	bra.uni FIM;
BANDA:
	// faixa do canto: s = c*video + (1 - c)*u, u = pagina + fundo*(255 - a)/255 (a pagina toda por baixo do video)
	ld.param.u32 %r26, [tem_fundo]; setp.ne.u32 %p6, %r26, 0; ld.param.u32 %r24, [fundo];
	mov.u32 %r27, 255; sub.u32 %r27, %r27, %r10;
	// o canto do pixel (p8 esquerda, p9 cima) tem algo por cima?
	ld.param.u32 %t6, [por_cima]; selp.u32 %t7, 0, 1, %p8; selp.u32 %r11, 0, 2, %p9; add.u32 %t7, %t7, %r11;
	shr.u32 %t6, %t6, %t7; and.b32 %t6, %t6, 1; setp.ne.u32 %p10, %t6, 0; @%p10 bra BANDA_CIMA;
	shr.u32 %r29, %r9, 0; and.b32 %r29, %r29, 255;
	shr.u32 %r11, %r24, 0; and.b32 %r11, %r11, 255; mad.lo.u32 %r11, %r11, %r27, 127; div.u32 %r11, %r11, 255;
	@%p6 add.u32 %r29, %r29, %r11; min.u32 %r29, %r29, 255;
	cvt.rn.f32.u32 %f27, %r29; cvt.rn.f32.s32 %f28, %r25; sub.rn.f32 %f28, %f28, %f27;
	fma.rn.f32 %f28, %f28, %f30, %f27; add.rn.f32 %f28, %f28, 0f3F000000; cvt.rmi.s32.f32 %r28, %f28;
	max.s32 %r28, %r28, 0; min.s32 %r28, %r28, 255;
	shr.u32 %r29, %r9, 8; and.b32 %r29, %r29, 255;
	shr.u32 %r11, %r24, 8; and.b32 %r11, %r11, 255; mad.lo.u32 %r11, %r11, %r27, 127; div.u32 %r11, %r11, 255;
	@%p6 add.u32 %r29, %r29, %r11; min.u32 %r29, %r29, 255;
	cvt.rn.f32.u32 %f27, %r29; cvt.rn.f32.s32 %f28, %r23; sub.rn.f32 %f28, %f28, %f27;
	fma.rn.f32 %f28, %f28, %f30, %f27; add.rn.f32 %f28, %f28, 0f3F000000; cvt.rmi.s32.f32 %r30, %f28;
	max.s32 %r30, %r30, 0; min.s32 %r30, %r30, 255;
	shr.u32 %r29, %r9, 16; and.b32 %r29, %r29, 255;
	shr.u32 %r11, %r24, 16; and.b32 %r11, %r11, 255; mad.lo.u32 %r11, %r11, %r27, 127; div.u32 %r11, %r11, 255;
	@%p6 add.u32 %r29, %r29, %r11; min.u32 %r29, %r29, 255;
	cvt.rn.f32.u32 %f27, %r29; cvt.rn.f32.s32 %f28, %r22; sub.rn.f32 %f28, %f28, %f27;
	fma.rn.f32 %f28, %f28, %f30, %f27; add.rn.f32 %f28, %f28, 0f3F000000; cvt.rmi.s32.f32 %r31, %f28;
	max.s32 %r31, %r31, 0; min.s32 %r31, %r31, 255;
	shl.b32 %r30, %r30, 8; shl.b32 %r31, %r31, 16;
	or.b32 %r28, %r28, %r30; or.b32 %r28, %r28, %r31; or.b32 %r28, %r28, 0xFF000000;
	st.global.u32 [%rd1], %r28;
	bra.uni FIM;
BANDA_CIMA:
	// com o cobertor (o fundo da legenda): se o pixel da pagina e ele sobre algo, a conta exata (Arredondado::cobertor)
	ld.param.u32 %t8, [cobertor]; shr.u32 %t9, %t8, 24;
	setp.eq.u32 %p11, %t9, 0; @%p11 bra CIMA_C;
	add.u32 %t10, %r10, 2; setp.lt.u32 %p11, %t10, %t9; @%p11 bra CIMA_C;
	sub.s32 %t11, %r10, %t9; add.s32 %t11, %t11, 2;
	shr.u32 %t12, %r9, 0; and.b32 %t12, %t12, 255; shr.u32 %t13, %t8, 0; and.b32 %t13, %t13, 255; sub.s32 %t12, %t12, %t13;
	setp.lt.s32 %p11, %t12, -2; @%p11 bra CIMA_C; setp.gt.s32 %p11, %t12, %t11; @%p11 bra CIMA_C;
	shr.u32 %t12, %r9, 8; and.b32 %t12, %t12, 255; shr.u32 %t13, %t8, 8; and.b32 %t13, %t13, 255; sub.s32 %t12, %t12, %t13;
	setp.lt.s32 %p11, %t12, -2; @%p11 bra CIMA_C; setp.gt.s32 %p11, %t12, %t11; @%p11 bra CIMA_C;
	shr.u32 %t12, %r9, 16; and.b32 %t12, %t12, 255; shr.u32 %t13, %t8, 16; and.b32 %t13, %t13, 255; sub.s32 %t12, %t12, %t13;
	setp.lt.s32 %p11, %t12, -2; @%p11 bra CIMA_C; setp.gt.s32 %p11, %t12, %t11; @%p11 bra CIMA_C;
	mov.u32 %t14, 255; sub.u32 %t14, %t14, %t9;
	// alfa do video coberto em 8 bits (a passagem com o canto do Chromium): ax = arred(c*255)
	mul.rn.f32 %f29, %f30, 0f437F0000; add.rn.f32 %f29, %f29, 0f3F000000; cvt.rmi.s32.f32 %t15, %f29;
	mov.u32 %t10, 255; sub.u32 %t10, %t10, %t15;
	shr.u32 %t13, %t8, 0; and.b32 %t13, %t13, 255;
	cvt.rn.f32.s32 %f28, %r25; mul.rn.f32 %f28, %f28, %f30; add.rn.f32 %f28, %f28, 0f3F000000; cvt.rmi.s32.f32 %t12, %f28;
	mad.lo.u32 %t12, %t12, %t14, 127; div.u32 %t12, %t12, 255;
	shr.u32 %r29, %r9, 0; and.b32 %r29, %r29, 255; max.u32 %r29, %r29, %t13; sub.u32 %r29, %r29, %t13;
	shr.u32 %r11, %r24, 0; and.b32 %r11, %r11, 255; mad.lo.u32 %r11, %r11, %r27, 127; div.u32 %r11, %r11, 255;
	@%p6 add.u32 %r29, %r29, %r11;
	mad.lo.u32 %r29, %r29, %t10, 127; div.u32 %r29, %r29, 255;
	add.u32 %r28, %t13, %t12; add.u32 %r28, %r28, %r29; min.u32 %r28, %r28, 255;
	shr.u32 %t13, %t8, 8; and.b32 %t13, %t13, 255;
	cvt.rn.f32.s32 %f28, %r23; mul.rn.f32 %f28, %f28, %f30; add.rn.f32 %f28, %f28, 0f3F000000; cvt.rmi.s32.f32 %t12, %f28;
	mad.lo.u32 %t12, %t12, %t14, 127; div.u32 %t12, %t12, 255;
	shr.u32 %r29, %r9, 8; and.b32 %r29, %r29, 255; max.u32 %r29, %r29, %t13; sub.u32 %r29, %r29, %t13;
	shr.u32 %r11, %r24, 8; and.b32 %r11, %r11, 255; mad.lo.u32 %r11, %r11, %r27, 127; div.u32 %r11, %r11, 255;
	@%p6 add.u32 %r29, %r29, %r11;
	mad.lo.u32 %r29, %r29, %t10, 127; div.u32 %r29, %r29, 255;
	add.u32 %r30, %t13, %t12; add.u32 %r30, %r30, %r29; min.u32 %r30, %r30, 255;
	shr.u32 %t13, %t8, 16; and.b32 %t13, %t13, 255;
	cvt.rn.f32.s32 %f28, %r22; mul.rn.f32 %f28, %f28, %f30; add.rn.f32 %f28, %f28, 0f3F000000; cvt.rmi.s32.f32 %t12, %f28;
	mad.lo.u32 %t12, %t12, %t14, 127; div.u32 %t12, %t12, 255;
	shr.u32 %r29, %r9, 16; and.b32 %r29, %r29, 255; max.u32 %r29, %r29, %t13; sub.u32 %r29, %r29, %t13;
	shr.u32 %r11, %r24, 16; and.b32 %r11, %r11, 255; mad.lo.u32 %r11, %r11, %r27, 127; div.u32 %r11, %r11, 255;
	@%p6 add.u32 %r29, %r29, %r11;
	mad.lo.u32 %r29, %r29, %t10, 127; div.u32 %r29, %r29, 255;
	add.u32 %r31, %t13, %t12; add.u32 %r31, %r31, %r29; min.u32 %r31, %r31, 255;
	shl.b32 %r30, %r30, 8; shl.b32 %r31, %r31, 16;
	or.b32 %r28, %r28, %r30; or.b32 %r28, %r28, %r31; or.b32 %r28, %r28, 0xFF000000;
	st.global.u32 [%rd1], %r28;
	bra.uni FIM;
CIMA_C:
	// canto com algo por cima: o video com a cobertura sobre o fundo vai por baixo da pagina toda
	shr.u32 %r11, %r24, 0; and.b32 %r11, %r11, 255; @!%p6 mov.u32 %r11, 0;
	cvt.rn.f32.u32 %f27, %r11; cvt.rn.f32.s32 %f28, %r25; sub.rn.f32 %f28, %f28, %f27;
	fma.rn.f32 %f28, %f28, %f30, %f27; add.rn.f32 %f28, %f28, 0f3F000000; cvt.rmi.s32.f32 %r29, %f28;
	max.s32 %r29, %r29, 0; min.s32 %r29, %r29, 255;
	mad.lo.u32 %r29, %r29, %r27, 127; div.u32 %r29, %r29, 255;
	shr.u32 %r28, %r9, 0; and.b32 %r28, %r28, 255; add.u32 %r28, %r28, %r29; min.u32 %r28, %r28, 255;
	shr.u32 %r11, %r24, 8; and.b32 %r11, %r11, 255; @!%p6 mov.u32 %r11, 0;
	cvt.rn.f32.u32 %f27, %r11; cvt.rn.f32.s32 %f28, %r23; sub.rn.f32 %f28, %f28, %f27;
	fma.rn.f32 %f28, %f28, %f30, %f27; add.rn.f32 %f28, %f28, 0f3F000000; cvt.rmi.s32.f32 %r29, %f28;
	max.s32 %r29, %r29, 0; min.s32 %r29, %r29, 255;
	mad.lo.u32 %r29, %r29, %r27, 127; div.u32 %r29, %r29, 255;
	shr.u32 %r30, %r9, 8; and.b32 %r30, %r30, 255; add.u32 %r30, %r30, %r29; min.u32 %r30, %r30, 255;
	shr.u32 %r11, %r24, 16; and.b32 %r11, %r11, 255; @!%p6 mov.u32 %r11, 0;
	cvt.rn.f32.u32 %f27, %r11; cvt.rn.f32.s32 %f28, %r22; sub.rn.f32 %f28, %f28, %f27;
	fma.rn.f32 %f28, %f28, %f30, %f27; add.rn.f32 %f28, %f28, 0f3F000000; cvt.rmi.s32.f32 %r29, %f28;
	max.s32 %r29, %r29, 0; min.s32 %r29, %r29, 255;
	mad.lo.u32 %r29, %r29, %r27, 127; div.u32 %r29, %r29, 255;
	shr.u32 %r31, %r9, 16; and.b32 %r31, %r31, 255; add.u32 %r31, %r31, %r29; min.u32 %r31, %r31, 255;
	shl.b32 %r30, %r30, 8; shl.b32 %r31, %r31, 16;
	or.b32 %r28, %r28, %r30; or.b32 %r28, %r28, %r31; or.b32 %r28, %r28, 0xFF000000;
	st.global.u32 [%rd1], %r28;
	bra.uni FIM;
FIM:
	ret;
}
"#;

pub(crate) fn cu(r: CUresult, contexto: &str) -> Result<(), String> {
    if r == CUresult::CUDA_SUCCESS {
        Ok(())
    } else {
        Err(format!("{contexto}: {r:?}"))
    }
}

/// Carrega um PTX escrito à mão (compilado pelo driver) e a função `nome` dele. O registro de erro do compilador do
/// driver vem na mensagem (PTX inválido diz a linha).
pub(crate) fn carregar_ptx(ptx: &str, nome: &std::ffi::CStr, qual: &str) -> Result<(CUmodule, CUfunction), String> {
    let fonte = std::ffi::CString::new(ptx).unwrap();
    let mut modulo: CUmodule = std::ptr::null_mut();
    let mut registro = vec![0u8; 8192];
    let mut opcoes = [
        CUjit_option::CU_JIT_ERROR_LOG_BUFFER,
        CUjit_option::CU_JIT_ERROR_LOG_BUFFER_SIZE_BYTES,
    ];
    let mut valores: [*mut c_void; 2] =
        [registro.as_mut_ptr() as *mut c_void, registro.len() as *mut c_void];
    let r = unsafe {
        cuModuleLoadDataEx(
            &mut modulo,
            fonte.as_ptr() as *const c_void,
            2,
            opcoes.as_mut_ptr(),
            valores.as_mut_ptr(),
        )
    };
    if r != CUresult::CUDA_SUCCESS {
        let fim = registro.iter().position(|&b| b == 0).unwrap_or(registro.len());
        return Err(format!(
            "carregar o PTX {qual}: {r:?}: {}",
            String::from_utf8_lossy(&registro[..fim])
        ));
    }
    let mut funcao: CUfunction = std::ptr::null_mut();
    if let Err(e) = cu(
        unsafe { cuModuleGetFunction(&mut funcao, modulo, nome.as_ptr()) },
        "cuModuleGetFunction",
    ) {
        unsafe { cuModuleUnload(modulo) };
        return Err(e);
    }
    Ok((modulo, funcao))
}

/// O núcleo carregado. A CUDA tem de estar corrente na thread (a do NVENC).
pub struct Misturador {
    modulo: CUmodule,
    funcao: CUfunction,
}

/// Uma mistura: o quadro da página (BGRA, `passo` bytes por linha), o vídeo (opcional) e o fundo (opcional, 0xRRGGBB).
pub struct Mistura<'a> {
    pub saida: CUdeviceptr,
    pub passo: u32,
    pub largura: u32,
    pub altura: u32,
    pub video: Option<(CUdeviceptr, u32, u32, Posicao, &'a Coeficientes)>,
    pub fundo: Option<u32>,
}

impl Misturador {
    pub fn novo() -> Result<Self, String> {
        let (modulo, funcao) = carregar_ptx(&ptx(), c"misturar", "da mistura")?;
        Ok(Self { modulo, funcao })
    }

    /// Lança a mistura no fluxo padrão e espera ela acabar (o NVENC lê o buffer logo depois).
    pub fn misturar(&self, m: &Mistura) -> Result<(), String> {
        let sem = Coeficientes {
            y0: 0,
            cy: 0,
            cr: 0,
            cgu: 0,
            cgv: 0,
            cb: 0,
        };
        let (nv12, vl, va, pos, k) = match &m.video {
            Some((p, l, a, pos, k)) => (*p, *l, *a, *pos, *k),
            None => (
                0,
                0,
                0,
                Posicao {
                    x: 0,
                    y: 0,
                    recorte: [0; 4],
                    escala: None,
                    arredondado: None,
                },
                &sem,
            ),
        };
        // Com fundo, o quadro inteiro; sem, só o recorte do vídeo.
        let regiao = if m.fundo.is_some() {
            [0, 0, m.largura as i32, m.altura as i32]
        } else {
            pos.recorte
        };
        if regiao[2] <= regiao[0] || regiao[3] <= regiao[1] {
            return Ok(());
        }
        let mut saida = m.saida;
        let mut passo = m.passo;
        let [mut x0, mut y0, mut x1, mut y1] = regiao;
        let mut nv12 = nv12;
        let (mut vl, mut va) = (vl, va);
        let (mut vx, mut vy) = (pos.x, pos.y);
        let [mut cx0, mut cy0, mut cx1, mut cy1] = pos.recorte;
        let mut fundo = m.fundo.unwrap_or(0);
        let mut tem_fundo = u32::from(m.fundo.is_some());
        let (mut ky0, mut kcy, mut kcr, mut kcgu, mut kcgv, mut kcb) =
            (k.y0, k.cy, k.cr, k.cgu, k.cgv, k.cb);
        let mut escalado = u32::from(pos.escala.is_some());
        let e = pos.escala.unwrap_or(Escala { isx: 1.0, ox: 0.0, isy: 1.0, oy: 0.0 });
        let (mut isx, mut ox, mut isy, mut oy) = (e.isx, e.ox, e.isy, e.oy);
        let mut arred = u32::from(pos.arredondado.is_some());
        let ar = pos.arredondado.unwrap_or(Arredondado { x0: 0.0, y0: 0.0, x1: 0.0, y1: 0.0, raio: 0.0, por_cima: 0, cobertor: 0 });
        let (mut ax0, mut ay0, mut ax1, mut ay1, mut araio) = (ar.x0, ar.y0, ar.x1, ar.y1, ar.raio);
        let mut por_cima = ar.por_cima;
        let mut cobertor = ar.cobertor;
        let mut params: [*mut c_void; 36] = [
            &mut saida as *mut _ as *mut c_void,
            &mut passo as *mut _ as *mut c_void,
            &mut x0 as *mut _ as *mut c_void,
            &mut y0 as *mut _ as *mut c_void,
            &mut x1 as *mut _ as *mut c_void,
            &mut y1 as *mut _ as *mut c_void,
            &mut nv12 as *mut _ as *mut c_void,
            &mut vl as *mut _ as *mut c_void,
            &mut va as *mut _ as *mut c_void,
            &mut vx as *mut _ as *mut c_void,
            &mut vy as *mut _ as *mut c_void,
            &mut cx0 as *mut _ as *mut c_void,
            &mut cy0 as *mut _ as *mut c_void,
            &mut cx1 as *mut _ as *mut c_void,
            &mut cy1 as *mut _ as *mut c_void,
            &mut fundo as *mut _ as *mut c_void,
            &mut tem_fundo as *mut _ as *mut c_void,
            &mut ky0 as *mut _ as *mut c_void,
            &mut kcy as *mut _ as *mut c_void,
            &mut kcr as *mut _ as *mut c_void,
            &mut kcgu as *mut _ as *mut c_void,
            &mut kcgv as *mut _ as *mut c_void,
            &mut kcb as *mut _ as *mut c_void,
            &mut escalado as *mut _ as *mut c_void,
            &mut isx as *mut _ as *mut c_void,
            &mut ox as *mut _ as *mut c_void,
            &mut isy as *mut _ as *mut c_void,
            &mut oy as *mut _ as *mut c_void,
            &mut arred as *mut _ as *mut c_void,
            &mut ax0 as *mut _ as *mut c_void,
            &mut ay0 as *mut _ as *mut c_void,
            &mut ax1 as *mut _ as *mut c_void,
            &mut ay1 as *mut _ as *mut c_void,
            &mut araio as *mut _ as *mut c_void,
            &mut por_cima as *mut _ as *mut c_void,
            &mut cobertor as *mut _ as *mut c_void,
        ];
        let (bx, by) = (32u32, 8u32);
        let (gx, gy) = (
            ((x1 - x0) as u32).div_ceil(bx),
            ((y1 - y0) as u32).div_ceil(by),
        );
        cu(
            unsafe {
                cuLaunchKernel(
                    self.funcao,
                    gx,
                    gy,
                    1,
                    bx,
                    by,
                    1,
                    0,
                    std::ptr::null_mut(),
                    params.as_mut_ptr(),
                    std::ptr::null_mut(),
                )
            },
            "lançar a mistura",
        )?;
        cu(unsafe { cuStreamSynchronize(std::ptr::null_mut()) }, "esperar a mistura")
    }
}

impl Drop for Misturador {
    fn drop(&mut self) {
        unsafe { cuModuleUnload(self.modulo) };
    }
}

/// A mesma conta na CPU (referência dos testes).
#[cfg(test)]
pub fn referencia(
    pagina: &[u8],
    largura: u32,
    altura: u32,
    video: Option<(&[u8], u32, u32, Posicao, &Coeficientes)>,
    fundo: Option<u32>,
) -> Vec<u8> {
    let mut saida = pagina.to_vec();
    for y in 0..altura as i32 {
        for x in 0..largura as i32 {
            let o = ((y as u32 * largura + x as u32) * 4) as usize;
            let a = u32::from(pagina[o + 3]);
            // Com recorte arredondado, a cobertura do canto (só dentro do recorte do vídeo).
            let c = match video {
                Some((_, _, _, pos, _)) => match pos.arredondado {
                    Some(ar) if x >= pos.recorte[0] && x < pos.recorte[2] && y >= pos.recorte[1] && y < pos.recorte[3] => {
                        ar.cobertura(x, y)
                    }
                    _ => 1.0,
                },
                None => 1.0,
            };
            let banda = c > 0.0 && c < 1.0;
            if a == 255 && !banda {
                continue;
            }
            let mut por_baixo = None;
            if let Some((nv12, vl, va, pos, k)) = video {
                let [cx0, cy0, cx1, cy1] = pos.recorte;
                if x >= cx0 && x < cx1 && y >= cy0 && y < cy1 && c > 0.0 {
                    let texel = |lx: usize, ly: usize| -> [i32; 3] {
                        let (vl, va) = (vl as usize, va as usize);
                        let yy = i32::from(nv12[ly * vl + lx]);
                        let uv = vl * va + (ly >> 1) * vl + (lx & !1);
                        let (u, v) = (i32::from(nv12[uv]) - 128, i32::from(nv12[uv + 1]) - 128);
                        let ty = (k.cy * (yy - k.y0)) >> 13;
                        let r = ty + ((k.cr * v) >> 13);
                        let g = ty + ((k.cgu * u) >> 13) + ((k.cgv * v) >> 13);
                        let b = ty + ((k.cb * u) >> 13);
                        [b.clamp(0, 255), g.clamp(0, 255), r.clamp(0, 255)]
                    };
                    let c = match pos.escala {
                        None => texel((x - pos.x) as usize, (y - pos.y) as usize),
                        Some(e) => {
                            // As mesmas operações f32 do núcleo (fma onde ele usa fma).
                            let fx = (x as f32 + 0.5).mul_add(e.isx, e.ox);
                            let fy = (y as f32 + 0.5).mul_add(e.isy, e.oy);
                            let (px, py) = (fx.floor(), fy.floor());
                            let (a, b) = (fx - px, fy - py);
                            let preso = |v: i32, n: u32| v.clamp(0, n as i32 - 1) as usize;
                            let (x0, x1) = (preso(px as i32, vl), preso(px as i32 + 1, vl));
                            let (y0, y1) = (preso(py as i32, va), preso(py as i32 + 1, va));
                            let (c00, c10, c01, c11) = (texel(x0, y0), texel(x1, y0), texel(x0, y1), texel(x1, y1));
                            let mut c = [0i32; 3];
                            for i in 0..3 {
                                let f = |v: i32| v as f32;
                                let cima = (f(c10[i]) - f(c00[i])).mul_add(a, f(c00[i]));
                                let baixo = (f(c11[i]) - f(c01[i])).mul_add(a, f(c01[i]));
                                let v = (baixo - cima).mul_add(b, cima);
                                c[i] = ((v + 0.5).floor() as i32).clamp(0, 255);
                            }
                            c
                        }
                    };
                    por_baixo = Some([c[0] as u32, c[1] as u32, c[2] as u32]);
                }
            }
            if por_baixo.is_none()
                && let Some(f) = fundo
            {
                por_baixo = Some([f & 255, (f >> 8) & 255, (f >> 16) & 255]);
            }
            if banda {
                let v = por_baixo.expect("na faixa o vídeo está por baixo");
                let ar = video.and_then(|(_, _, _, pos, _)| pos.arredondado).unwrap();
                if ar.por_cima >> ar.canto(x, y) & 1 == 1 && ar.so_cobertor(&pagina[o..o + 4]) {
                    let ac = ar.cobertor >> 24;
                    // O vídeo coberto em 8 bits (x = arred(c·v), alfa ax = arred(c·255)), como a passagem do canto do
                    // Chromium; por baixo dele, o que a página tem fora o cobertor, sobre o fundo; o cobertor por cima.
                    let ax = ((c * 255.0 + 0.5).floor()) as u32;
                    for i in 0..3 {
                        let lc = (ar.cobertor >> (8 * i)) & 255;
                        let x = ((v[i] as f32 * c + 0.5).floor()) as u32;
                        let mut w = u32::from(pagina[o + i]).max(lc) - lc;
                        if let Some(f) = fundo {
                            w += (((f >> (8 * i)) & 255) * (255 - a) + 127) / 255;
                        }
                        let s = lc + (x * (255 - ac) + 127) / 255 + (w * (255 - ax) + 127) / 255;
                        saida[o + i] = s.min(255) as u8;
                    }
                    saida[o + 3] = 255;
                    continue;
                }
                if ar.por_cima >> ar.canto(x, y) & 1 == 1 {
                    // Algo por cima no canto: o vídeo coberto sobre o fundo, por baixo da página toda.
                    for i in 0..3 {
                        let u = fundo.map_or(0, |f| (f >> (8 * i)) & 255);
                        let s = (v[i] as f32 - u as f32).mul_add(c, u as f32);
                        let s = ((s + 0.5).floor() as i32).clamp(0, 255) as u32;
                        saida[o + i] = (u32::from(pagina[o + i]) + (s * (255 - a) + 127) / 255).min(255) as u8;
                    }
                    saida[o + 3] = 255;
                    continue;
                }
                for i in 0..3 {
                    let mut u = u32::from(pagina[o + i]);
                    if let Some(f) = fundo {
                        u = (u + (((f >> (8 * i)) & 255) * (255 - a) + 127) / 255).min(255);
                    }
                    let s = (v[i] as f32 - u as f32).mul_add(c, u as f32);
                    saida[o + i] = ((s + 0.5).floor() as i32).clamp(0, 255) as u8;
                }
                saida[o + 3] = 255;
                continue;
            }
            let Some(c) = por_baixo else { continue };
            for i in 0..3 {
                saida[o + i] = (u32::from(pagina[o + i]) + (c[i] * (255 - a) + 127) / 255).min(255) as u8;
            }
            saida[o + 3] = 255;
        }
    }
    saida
}

#[cfg(test)]
mod testes {
    use super::*;
    use cudarc::driver::CudaContext;
    use std::process::{Command, Stdio};

    fn tem_placa() -> bool {
        std::path::Path::new("/dev/nvidiactl").exists()
    }

    /// Gerador simples e determinístico (sem dependência).
    struct Aleatorio(u64);
    impl Aleatorio {
        fn proximo(&mut self) -> u32 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 >> 16) as u32
        }
    }

    fn subir(dados: &[u8]) -> CUdeviceptr {
        let mut p = 0;
        cu(unsafe { cuMemAlloc_v2(&mut p, dados.len()) }, "alloc").unwrap();
        cu(unsafe { cuMemcpyHtoD_v2(p, dados.as_ptr() as *const c_void, dados.len()) }, "HtoD").unwrap();
        p
    }

    fn descer(p: CUdeviceptr, n: usize) -> Vec<u8> {
        let mut v = vec![0u8; n];
        cu(unsafe { cuMemcpyDtoH_v2(v.as_mut_ptr() as *mut c_void, p, n) }, "DtoH").unwrap();
        v
    }

    /// Página com alfa pré-multiplicado: buraco transparente, opaco e semitransparente misturados.
    fn pagina(l: u32, a: u32, r: &mut Aleatorio) -> Vec<u8> {
        let mut p = vec![0u8; (l * a * 4) as usize];
        for px in p.chunks_mut(4) {
            let alfa = match r.proximo() % 4 {
                0 | 1 => 0,
                2 => 255,
                _ => r.proximo() % 256,
            };
            for c in px.iter_mut().take(3) {
                *c = (r.proximo() % (alfa + 1)) as u8;
            }
            px[3] = alfa as u8;
        }
        p
    }

    fn nv12(l: u32, a: u32, r: &mut Aleatorio) -> Vec<u8> {
        (0..l * a * 3 / 2).map(|_| r.proximo() as u8).collect()
    }

    /// Núcleo = referência, bit a bit, com o vídeo deslocado e recortado, com e sem fundo, em todas as matrizes.
    #[test]
    fn mistura_igual_a_referencia() {
        if !tem_placa() {
            eprintln!("pulado: sem placa");
            return;
        }
        let cuda = CudaContext::new(0).unwrap();
        let m = Misturador::novo().unwrap();
        let mut r = Aleatorio(0x5eed_1234_abcd);
        let (l, a) = (320u32, 180u32);
        let (vl, va) = (200u32, 120u32);
        let esc = |sx, sy, tx, ty| Some(Escala::de(sx, sy, tx, ty).unwrap());
        let casos: [(Option<&str>, bool, Option<u32>, Posicao); 11] = [
            (None, false, None, Posicao { x: 0, y: 0, recorte: [0, 0, 200, 120], escala: None, arredondado: None }),
            (Some("bt709"), false, Some(0x10163a), Posicao { x: 50, y: 30, recorte: [60, 40, 250, 150], escala: None, arredondado: None }),
            (Some("smpte170m"), false, Some(0x000000), Posicao { x: -40, y: -10, recorte: [0, 0, 160, 110], escala: None, arredondado: None }),
            (Some("smpte240m"), true, None, Posicao { x: 130, y: 70, recorte: [130, 70, 320, 180], escala: None, arredondado: None }),
            (Some("bt2020-ncl"), true, Some(0xffffff), Posicao { x: 10, y: 10, recorte: [11, 13, 209, 129], escala: None, arredondado: None }),
            (None, true, Some(0x0b1220), Posicao { x: 0, y: 0, recorte: [0, 0, 0, 0], escala: None, arredondado: None }),
            // Escala ≠ 1 (S08): ampliado cobrindo o quadro com origem fracionária, ampliado num recorte, reduzido à
            // metade com bordas inteiras, escala diferente em x e y, e ampliado passando das bordas (texels presos).
            (Some("bt709"), false, Some(0x10163a), Posicao { x: 0, y: 0, recorte: [0, 0, 320, 180], escala: esc(1.7, 1.7, -21.6, -13.35), arredondado: None }),
            (Some("bt709"), false, None, Posicao { x: 0, y: 0, recorte: [40, 20, 300, 170], escala: esc(1.21, 1.21, -9.9, 4.4), arredondado: None }),
            (Some("smpte170m"), true, Some(0xffffff), Posicao { x: 0, y: 0, recorte: [10, 20, 110, 80], escala: esc(0.5, 0.5, 10.0, 20.0), arredondado: None }),
            (None, false, None, Posicao { x: 0, y: 0, recorte: [0, 0, 320, 180], escala: esc(1.6, 1.5, 0.0, 0.0), arredondado: None }),
            (Some("bt2020-ncl"), false, Some(0x000000), Posicao { x: 0, y: 0, recorte: [0, 0, 320, 180], escala: esc(1.05, 1.05, 3.7, 2.2), arredondado: None }),
        ];
        for (matriz, cheia, fundo, pos) in casos {
            let k = Coeficientes::de(matriz, cheia, va).unwrap();
            let p = pagina(l, a, &mut r);
            let v = nv12(vl, va, &mut r);
            let (pp, pv) = (subir(&p), subir(&v));
            m.misturar(&Mistura {
                saida: pp,
                passo: l * 4,
                largura: l,
                altura: a,
                video: Some((pv, vl, va, pos, &k)),
                fundo,
            })
            .unwrap();
            let lido = descer(pp, p.len());
            let esperado = referencia(&p, l, a, Some((&v, vl, va, pos, &k)), fundo);
            let dif = lido.iter().zip(&esperado).filter(|(x, y)| x != y).count();
            assert_eq!(dif, 0, "{matriz:?} cheia={cheia} fundo={fundo:?} {pos:?}: {dif} bytes diferentes");
            unsafe {
                cuMemFree_v2(pp);
                cuMemFree_v2(pv);
            }
        }
        drop(m);
        drop(cuda);
    }

    /// S08, recorte arredondado (cartão com `overflow: hidden` e `border-radius`): núcleo = referência, bit a bit, com o
    /// texel direto e com escala, com e sem fundo, raio inteiro e fracionário, página opaca na faixa do canto.
    #[test]
    fn arredondado_igual_a_referencia() {
        if !tem_placa() {
            eprintln!("pulado: sem placa");
            return;
        }
        let cuda = CudaContext::new(0).unwrap();
        let m = Misturador::novo().unwrap();
        let mut r = Aleatorio(0xa22e_d0d0);
        let (l, a, vl, va) = (320u32, 180u32, 200u32, 120u32);
        let arr = |x0, y0, x1, y1, raio| Some(Arredondado::de(x0, y0, x1, y1, raio).unwrap());
        let casos: [(Option<u32>, Posicao); 8] = [
            (Some(0x10163a), Posicao { x: 50, y: 30, recorte: [60, 40, 250, 150], escala: None, arredondado: arr(60.0, 40.0, 250.0, 150.0, 32.0) }),
            (None, Posicao { x: 50, y: 30, recorte: [60, 40, 250, 150], escala: None, arredondado: arr(60.0, 40.0, 250.0, 150.0, 24.6) }),
            (Some(0xf3eee4), Posicao { x: 0, y: 0, recorte: [20, 10, 300, 170], escala: Some(Escala::de(1.7, 1.7, -21.6, -13.35).unwrap()), arredondado: arr(20.0, 10.0, 300.0, 170.0, 32.0) }),
            // O recorte menor que o retângulo arredondado (outro recorte por dentro) e raio grande.
            (Some(0xffffff), Posicao { x: 0, y: 0, recorte: [40, 20, 280, 160], escala: Some(Escala::de(1.21, 1.21, -9.9, 4.4).unwrap()), arredondado: arr(30.0, 15.0, 290.0, 165.0, 60.0) }),
            (None, Posicao { x: 10, y: 10, recorte: [11, 13, 209, 129], escala: None, arredondado: arr(11.0, 13.0, 209.0, 129.0, 0.5) }),
            // Algo por cima em dois cantos (o de baixo à direita e o de cima à esquerda), com e sem fundo.
            (Some(0xf3eee4), Posicao { x: 0, y: 0, recorte: [20, 10, 300, 170], escala: Some(Escala::de(1.7, 1.7, -21.6, -13.35).unwrap()), arredondado: arr(20.0, 10.0, 300.0, 170.0, 32.0).map(|a| a.com_por_cima(0b1001, 0)) }),
            (None, Posicao { x: 50, y: 30, recorte: [60, 40, 250, 150], escala: None, arredondado: arr(60.0, 40.0, 250.0, 150.0, 24.6).map(|a| a.com_por_cima(0b0110, 0)) }),
            // Com o cobertor (um fundo de 92 % de alfa): a página com ele sobre algo e com outra coisa, misturadas.
            (Some(0xf3eee4), Posicao { x: 0, y: 0, recorte: [20, 10, 300, 170], escala: Some(Escala::de(1.7, 1.7, -21.6, -13.35).unwrap()), arredondado: arr(20.0, 10.0, 300.0, 170.0, 32.0).map(|a| a.com_por_cima(0b1111, 0xeb0e1d35)) }),
        ];
        for (fundo, pos) in casos {
            let k = Coeficientes::de(Some("bt709"), false, va).unwrap();
            let mut p = pagina(l, a, &mut r);
            // Com cobertor, metade dos pixels é ele sobre algo (o caminho exato), a outra metade, o que veio.
            if let Some(ar) = pos.arredondado.filter(|a| a.cobertor != 0) {
                let ac = ar.cobertor >> 24;
                for px in p.chunks_mut(4).step_by(2) {
                    let (sa, sc) = (r.proximo() % 256, r.proximo() % 256);
                    let sc = sc.min(sa);
                    for i in 0..3 {
                        px[i] = (((ar.cobertor >> (8 * i)) & 255) + (sc * (255 - ac) + 127) / 255).min(255) as u8;
                    }
                    px[3] = (ac + (sa * (255 - ac) + 127) / 255).min(255) as u8;
                }
            }
            let v = nv12(vl, va, &mut r);
            let (pp, pv) = (subir(&p), subir(&v));
            m.misturar(&Mistura { saida: pp, passo: l * 4, largura: l, altura: a, video: Some((pv, vl, va, pos, &k)), fundo }).unwrap();
            let lido = descer(pp, p.len());
            let esperado = referencia(&p, l, a, Some((&v, vl, va, pos, &k)), fundo);
            let dif = lido.iter().zip(&esperado).filter(|(x, y)| x != y).count();
            assert_eq!(dif, 0, "fundo={fundo:?} {pos:?}: {dif} bytes diferentes");
            unsafe {
                cuMemFree_v2(pp);
                cuMemFree_v2(pv);
            }
        }
        drop(m);
        drop(cuda);
    }

    /// A cobertura do canto é a do Skia (medida contra o caminho do canvas, registro do S08, seção 8): o pixel de centro
    /// c, a distância d do centro do círculo do canto, cobre `clamp(raio + 0,5 − d, 0, 1)`; e a mistura na faixa do canto
    /// põe a página inteira por baixo do vídeo: `c·vídeo + (1 − c)·(página + fundo·(1 − alfa))`.
    #[test]
    fn arredondado_cobertura_do_skia() {
        let ar = Arredondado::de(100.0, 50.0, 500.0, 450.0, 32.0).unwrap();
        assert_eq!(ar.cobertura(300, 200), 1.0);
        assert_eq!(ar.cobertura(100, 200), 1.0); // na borda reta
        assert_eq!(ar.cobertura(100, 50), 0.0); // no canto do retângulo, fora do círculo
        // Centro do círculo do canto de cima à esquerda em (132, 82); o pixel (110, 60) tem centro a 30,4 dele (dentro).
        let d = (21.5f32 * 21.5 + 21.5 * 21.5).sqrt();
        assert!((ar.cobertura(110, 60) - (32.5 - d).clamp(0.0, 1.0)).abs() < 1e-6);
        // Um pixel da faixa: d = 31,8… → c ≈ 0,68.
        let (x, y) = (132 - 23, 82 - 23);
        let d = (22.5f32 * 22.5 + 22.5 * 22.5).sqrt();
        assert!((ar.cobertura(x, y) - (32.5 - d)).abs() < 1e-6 && ar.cobertura(x, y) > 0.0 && ar.cobertura(x, y) < 1.0);
        // A mistura na faixa, com página transparente e fundo preto: o vídeo branco vira c·255.
        let k = Coeficientes::de(Some("bt709"), false, 2).unwrap();
        let (vl, va) = (600u32, 500u32);
        let mut v = vec![235u8; (vl * va) as usize];
        v.extend(std::iter::repeat_n(128u8, (vl * va / 2) as usize));
        let pos = Posicao { x: 0, y: 0, recorte: [100, 50, 500, 450], escala: None, arredondado: Some(ar) };
        let p = vec![0u8; (vl * va * 4) as usize];
        let s = referencia(&p, vl, va, Some((&v, vl, va, pos, &k)), Some(0));
        let o = ((y as u32 * vl + x as u32) * 4) as usize;
        let c = ar.cobertura(x, y);
        assert_eq!(s[o], ((255.0 * c + 0.5).floor()) as u8);
        assert_eq!(s[o + 3], 255);
        // Página opaca na faixa (o contorno do cartão, por baixo do vídeo no Chromium): c·vídeo + (1 − c)·página.
        let mut p = vec![0u8; (vl * va * 4) as usize];
        p[o..o + 4].copy_from_slice(&[40, 80, 120, 255]);
        let s = referencia(&p, vl, va, Some((&v, vl, va, pos, &k)), Some(0));
        assert_eq!(s[o], ((255.0 - 40.0) * c + 40.0 + 0.5).floor() as u8);
    }

    /// Escala 1 com origem inteira pelo caminho bilinear = o caminho sem escala, bit a bit (o peso é 0 em todo pixel).
    #[test]
    fn escala_1_igual_ao_caminho_sem_escala() {
        if !tem_placa() {
            eprintln!("pulado: sem placa");
            return;
        }
        let cuda = CudaContext::new(0).unwrap();
        let m = Misturador::novo().unwrap();
        let mut r = Aleatorio(0x1e5c_a1a);
        let (l, a, vl, va) = (320u32, 180u32, 200u32, 120u32);
        let k = Coeficientes::de(Some("bt709"), false, va).unwrap();
        let p = pagina(l, a, &mut r);
        let v = nv12(vl, va, &mut r);
        let pv = subir(&v);
        let mut saidas = Vec::new();
        for escala in [None, Some(Escala::de(1.0, 1.0, 50.0, 30.0).unwrap())] {
            let pp = subir(&p);
            let pos = Posicao { x: 50, y: 30, recorte: [60, 40, 250, 150], escala, arredondado: None };
            m.misturar(&Mistura { saida: pp, passo: l * 4, largura: l, altura: a, video: Some((pv, vl, va, pos, &k)), fundo: Some(0x10163a) })
                .unwrap();
            saidas.push(descer(pp, p.len()));
            unsafe { cuMemFree_v2(pp) };
        }
        unsafe { cuMemFree_v2(pv) };
        assert!(saidas[0] == saidas[1], "escala 1 saiu diferente do caminho sem escala");
        drop(m);
        drop(cuda);
    }

    /// A cor do vídeo pelo núcleo (página transparente) = ffmpeg yuv420p → bgr24 bilinear (o oráculo do P05), em todas
    /// as matrizes e faixas, numa imagem com todos os Y e croma variados.
    #[test]
    fn cor_igual_ao_ffmpeg() {
        if !tem_placa() {
            eprintln!("pulado: sem placa");
            return;
        }
        let cuda = CudaContext::new(0).unwrap();
        let m = Misturador::novo().unwrap();
        let mut r = Aleatorio(0xc0_1e_50);
        let (l, a) = (512u32, 256u32);
        // I420 aleatório (o ffmpeg lê I420); o núcleo lê NV12: o mesmo croma, intercalado.
        let n = (l * a) as usize;
        let i420: Vec<u8> = (0..n * 3 / 2).map(|_| r.proximo() as u8).collect();
        let mut nv = i420[..n].to_vec();
        for i in 0..n / 4 {
            nv.push(i420[n + i]);
            nv.push(i420[n + n / 4 + i]);
        }
        let pagina = vec![0u8; n * 4];
        for (matriz, nome_ff, cheia) in [
            ("bt709", "bt709", false),
            ("bt709", "bt709", true),
            ("smpte170m", "bt601", false),
            ("smpte170m", "bt601", true),
            ("smpte240m", "smpte240m", false),
            ("bt2020-ncl", "bt2020", false),
        ] {
            let k = Coeficientes::de(Some(matriz), cheia, a).unwrap();
            let (pp, pv) = (subir(&pagina), subir(&nv));
            let pos = Posicao { x: 0, y: 0, recorte: [0, 0, l as i32, a as i32], escala: None, arredondado: None };
            m.misturar(&Mistura { saida: pp, passo: l * 4, largura: l, altura: a, video: Some((pv, l, a, pos, &k)), fundo: None })
                .unwrap();
            let lido = descer(pp, n * 4);
            unsafe {
                cuMemFree_v2(pp);
                cuMemFree_v2(pv);
            }
            let filtro = format!(
                "scale={l}:{a}:flags=bilinear:in_color_matrix={nome_ff}:in_range={}:out_range=pc",
                if cheia { "pc" } else { "tv" }
            );
            let mut f = Command::new("ffmpeg")
                .args(["-v", "error", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", &format!("{l}x{a}"), "-i", "-", "-vf", &filtro,
                    "-f", "rawvideo", "-pix_fmt", "bgr24", "-"])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap();
            let mut entrada = f.stdin.take().unwrap();
            let dados = i420.clone();
            let escritor = std::thread::spawn(move || {
                use std::io::Write;
                entrada.write_all(&dados).unwrap();
            });
            let saida = f.wait_with_output().unwrap();
            escritor.join().unwrap();
            let bgr = saida.stdout;
            assert_eq!(bgr.len(), n * 3);
            let dif = (0..n)
                .filter(|&i| lido[i * 4..i * 4 + 3] != bgr[i * 3..i * 3 + 3] || lido[i * 4 + 3] != 255)
                .count();
            assert_eq!(dif, 0, "{matriz} cheia={cheia}: {dif} pixels diferentes do ffmpeg");
        }
        drop(m);
        drop(cuda);
    }
}
