// C01: quadro repetido sem codificação. Em vez de o NVENC codificar de novo o mesmo buffer (~1,9 ms em 1080p), o
// quadro repetido é um P «pulado» escrito aqui, em bytes: todo bloco copia o mesmo lugar do quadro anterior (HEVC:
// toda CU em `cu_skip_flag`, sem resíduo; H.264: todo macrobloco em `mb_skip_flag`). O decodificador reconstrói o
// quadro anterior, bit a bit.
//
// O que torna isso possível sem mexer no fluxo do NVENC:
// - HEVC: a sessão roda sem a decisão de tipo (PTD) e o POC de cada quadro do NVENC é o nosso (`displayPOCSyntax` =
//   quadros desde o IDR, contando os pulados). O pulado é TRAIL_R com o POC dele e um RPS que mantém no DPB tudo o que
//   o NVENC ainda pode referenciar (o último quadro dele, usado, e os anteriores do RPS dele, só guardados); o quadro
//   seguinte do NVENC referencia pelos POCs dele, que continuam lá. O pulado fica fora do RPS seguinte e sai do DPB.
// - H.264 (P01): a sessão usa uma referência só e o POC vem do frame_num (tipo 2); o pulado é P de referência com o
//   frame_num seguinte, e o frame_num dos quadros do NVENC é reescrito no cabeçalho (campo de largura fixa no começo
//   do slice) somando os pulados desde o IDR.
//
// Tudo o que este escritor não sabe tratar (alfa, tiles, listas ponderadas, etc.) dá erro, e quem chama codifica pelo
// NVENC como antes.

// ---------------------------------------------------------------------------------------------------------------
// Bits

#[derive(Default)]
pub struct Escritor {
    bytes: Vec<u8>,
    atual: u32,
    n: u32,
}

impl Escritor {
    pub fn u(&mut self, valor: u32, bits: u32) {
        for i in (0..bits).rev() {
            self.bit((valor >> i) & 1);
        }
    }
    pub fn bit(&mut self, b: u32) {
        self.atual = (self.atual << 1) | (b & 1);
        self.n += 1;
        if self.n == 8 {
            self.bytes.push(self.atual as u8);
            self.atual = 0;
            self.n = 0;
        }
    }
    pub fn ue(&mut self, v: u32) {
        let x = v as u64 + 1;
        let bits = 64 - x.leading_zeros();
        self.u(0, bits - 1);
        for i in (0..bits).rev() {
            self.bit(((x >> i) & 1) as u32);
        }
    }
    pub fn se(&mut self, v: i32) {
        self.ue(if v > 0 {
            (2 * v - 1) as u32
        } else {
            (-2 * v) as u32
        });
    }
    pub fn alinhado(&self) -> bool {
        self.n == 0
    }
    /// Completa o byte com zeros.
    pub fn alinhar_zero(&mut self) {
        while self.n != 0 {
            self.bit(0);
        }
    }
    pub fn rbsp(mut self) -> Vec<u8> {
        self.alinhar_zero();
        self.bytes
    }
}

pub struct Leitor<'a> {
    rbsp: &'a [u8],
    pos: usize,
}

impl<'a> Leitor<'a> {
    pub fn new(rbsp: &'a [u8]) -> Self {
        Self { rbsp, pos: 0 }
    }
    pub fn pos(&self) -> usize {
        self.pos
    }
    pub fn bit(&mut self) -> Result<u32, String> {
        let byte = *self.rbsp.get(self.pos / 8).ok_or("fim do RBSP")?;
        let b = (byte >> (7 - self.pos % 8)) & 1;
        self.pos += 1;
        Ok(u32::from(b))
    }
    pub fn u(&mut self, bits: u32) -> Result<u32, String> {
        let mut v = 0u32;
        for _ in 0..bits {
            v = (v << 1) | self.bit()?;
        }
        Ok(v)
    }
    pub fn pular(&mut self, bits: usize) {
        self.pos += bits;
    }
    pub fn ue(&mut self) -> Result<u32, String> {
        let mut zeros = 0;
        while self.bit()? == 0 {
            zeros += 1;
            if zeros > 31 {
                return Err("ue(v) inválido".into());
            }
        }
        Ok(((1u64 << zeros) - 1 + u64::from(self.u(zeros)?)) as u32)
    }
    pub fn se(&mut self) -> Result<i32, String> {
        let k = self.ue()? as i64;
        Ok(if k % 2 == 1 {
            ((k + 1) / 2) as i32
        } else {
            (-(k / 2)) as i32
        })
    }
}

/// Unidades NAL de um fluxo Annex B (sem o código de início).
pub fn nals(fluxo: &[u8]) -> Vec<&[u8]> {
    let mut inicios = Vec::new();
    let mut i = 0;
    while i + 3 <= fluxo.len() {
        if fluxo[i] == 0 && fluxo[i + 1] == 0 && fluxo[i + 2] == 1 {
            inicios.push(i + 3);
            i += 3;
        } else {
            i += 1;
        }
    }
    let mut r = Vec::new();
    for (k, &ini) in inicios.iter().enumerate() {
        let mut fim = if k + 1 < inicios.len() {
            inicios[k + 1] - 3
        } else {
            fluxo.len()
        };
        // Zeros antes do próximo código de início (o 00 00 00 01) não são da NAL.
        while fim > ini && fluxo[fim - 1] == 0 {
            fim -= 1;
        }
        r.push(&fluxo[ini..fim]);
    }
    r
}

/// Tira os bytes de prevenção de emulação (00 00 03 → 00 00).
pub fn desescapar(nal: &[u8]) -> Vec<u8> {
    let mut r = Vec::with_capacity(nal.len());
    let mut zeros = 0;
    for &b in nal {
        if zeros >= 2 && b == 3 {
            zeros = 0;
            continue;
        }
        zeros = if b == 0 { zeros + 1 } else { 0 };
        r.push(b);
    }
    r
}

/// Põe os bytes de prevenção de emulação e o código de início.
pub fn escapar(cabecalho_e_rbsp: &[u8]) -> Vec<u8> {
    let mut r = vec![0, 0, 0, 1];
    let mut zeros = 0;
    for &b in cabecalho_e_rbsp {
        if zeros >= 2 && b <= 3 {
            r.push(3);
            zeros = 0;
        }
        zeros = if b == 0 { zeros + 1 } else { 0 };
        r.push(b);
    }
    r
}

// ---------------------------------------------------------------------------------------------------------------
// CABAC (o codificador da norma: H.264 9.3.4.2, igual no HEVC 9.3.4.3), só com o que o quadro pulado usa.

#[rustfmt::skip]
const RANGE_LPS: [[u8; 4]; 64] = [
    [128,176,208,240],[128,167,197,227],[128,158,187,216],[123,150,178,205],[116,142,169,195],[111,135,160,185],
    [105,128,152,175],[100,122,144,166],[95,116,137,158],[90,110,130,150],[85,104,123,142],[81,99,117,135],
    [77,94,111,128],[73,89,105,122],[69,85,100,116],[66,80,95,110],[62,76,90,104],[59,72,86,99],[56,69,81,94],
    [53,65,77,89],[51,62,73,85],[48,59,69,80],[46,56,66,76],[43,53,63,72],[41,50,59,69],[39,48,56,65],[37,45,54,62],
    [35,43,51,59],[33,41,48,56],[32,39,46,53],[30,37,43,50],[29,35,41,48],[27,33,39,45],[26,31,37,43],[24,30,35,41],
    [23,28,33,39],[22,27,32,37],[21,26,30,35],[20,24,29,33],[19,23,27,31],[18,22,26,30],[17,21,25,28],[16,20,23,27],
    [15,19,22,25],[14,18,21,24],[14,17,20,23],[13,16,19,22],[12,15,18,21],[12,14,17,20],[11,14,16,19],[11,13,15,18],
    [10,12,15,17],[10,12,14,16],[9,11,13,15],[9,11,12,14],[8,10,12,14],[8,9,11,13],[7,9,11,12],[7,9,10,12],
    [7,8,10,11],[6,8,9,11],[6,7,9,10],[6,7,8,9],[2,2,2,2],
];
#[rustfmt::skip]
const TRANS_LPS: [u8; 64] = [
    0,0,1,2,2,4,4,5,6,7,8,9,9,11,11,12,13,13,15,15,16,16,18,18,19,19,21,21,22,22,23,24,24,25,26,26,27,27,28,29,29,30,
    30,30,31,32,32,33,33,33,34,34,35,35,35,36,36,36,37,37,37,38,38,63,
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Contexto {
    estado: u8,
    mps: u8,
}

impl Contexto {
    /// HEVC 9.3.2.2: valor de inicialização (tabela) e QP do slice.
    pub fn hevc(valor: u8, qp: i32) -> Self {
        let m = i32::from(valor >> 4) * 5 - 45;
        let n = (i32::from(valor & 15) << 3) - 16;
        Self::de_pre((((m * qp.clamp(0, 51)) >> 4) + n).clamp(1, 126))
    }
    /// H.264 9.3.1.1: par (m, n) da tabela e QP do slice.
    pub fn h264(m: i32, n: i32, qp: i32) -> Self {
        Self::de_pre((((m * qp.clamp(0, 51)) >> 4) + n).clamp(1, 126))
    }
    fn de_pre(pre: i32) -> Self {
        if pre <= 63 {
            Self {
                estado: (63 - pre) as u8,
                mps: 0,
            }
        } else {
            Self {
                estado: (pre - 64) as u8,
                mps: 1,
            }
        }
    }
}

pub struct Cabac {
    bits: Escritor,
    baixo: u32,
    faixa: u32,
    pendentes: u32,
    primeiro: bool,
}

impl Cabac {
    /// Começa no byte alinhado depois do cabeçalho do slice.
    pub fn new(bits: Escritor) -> Self {
        assert!(bits.alinhado(), "o CABAC começa alinhado");
        Self {
            bits,
            baixo: 0,
            faixa: 510,
            pendentes: 0,
            primeiro: true,
        }
    }
    fn por_bit(&mut self, b: u32) {
        if self.primeiro {
            self.primeiro = false;
        } else {
            self.bits.bit(b);
        }
        while self.pendentes > 0 {
            self.bits.bit(1 - b);
            self.pendentes -= 1;
        }
    }
    fn renormalizar(&mut self) {
        while self.faixa < 256 {
            if self.baixo < 256 {
                self.por_bit(0);
            } else if self.baixo >= 512 {
                self.baixo -= 512;
                self.por_bit(1);
            } else {
                self.baixo -= 256;
                self.pendentes += 1;
            }
            self.faixa <<= 1;
            self.baixo <<= 1;
        }
    }
    pub fn decisao(&mut self, ctx: &mut Contexto, bin: u32) {
        let lps = u32::from(RANGE_LPS[ctx.estado as usize][((self.faixa >> 6) & 3) as usize]);
        self.faixa -= lps;
        if bin != u32::from(ctx.mps) {
            self.baixo += self.faixa;
            self.faixa = lps;
            if ctx.estado == 0 {
                ctx.mps = 1 - ctx.mps;
            }
            ctx.estado = TRANS_LPS[ctx.estado as usize];
        } else {
            ctx.estado = (ctx.estado + 1).min(62);
        }
        self.renormalizar();
    }
    /// Bin de término (fim do slice). Com 1, esvazia o codificador: o último bit escrito é o rbsp_stop_one_bit.
    pub fn termino(&mut self, bin: u32) {
        self.faixa -= 2;
        if bin == 1 {
            self.baixo += self.faixa;
            self.faixa = 2;
            self.renormalizar();
            self.por_bit((self.baixo >> 9) & 1);
            self.bits.u(((self.baixo >> 7) & 3) | 1, 2);
        } else {
            self.renormalizar();
        }
    }
    /// Os bits até aqui, com o byte completado por zeros (rbsp_alignment_zero_bit).
    pub fn fim(self) -> Vec<u8> {
        self.bits.rbsp()
    }
}

// ---------------------------------------------------------------------------------------------------------------
// HEVC

#[derive(Clone, Debug)]
pub struct SpsHevc {
    pub largura: u32,
    pub altura: u32,
    pub cor_separada: bool,
    pub chroma: u32,
    pub log2_poc_lsb: u32,
    /// sps_max_dec_pic_buffering_minus1 da subcamada mais alta: o RPS tem no máximo isso.
    pub dpb_menos1: u32,
    pub log2_cb_min: u32,
    pub log2_ctb: u32,
    pub sao: bool,
    pub rps_na_sps: u32,
    /// Os RPS da SPS (o slice pode apontar um deles em vez de escrever o seu).
    pub conjuntos: Vec<Vec<(i32, bool)>>,
    pub tmvp: bool,
}

#[derive(Clone, Debug)]
pub struct PpsHevc {
    pub fatias_dependentes: bool,
    pub output_flag: bool,
    pub bits_extra: u32,
    pub cabac_init_presente: bool,
    pub qp_inicial: i32,
    pub transquant_bypass: bool,
    pub offsets_croma_no_slice: bool,
    pub ponderada: bool,
    pub tiles: bool,
    pub wpp: bool,
    pub filtro_entre_slices: bool,
    pub override_desbloqueio: bool,
    pub desbloqueio_desligado: bool,
    pub extensao_cabecalho: bool,
}

fn pular_ptl(l: &mut Leitor, sub_camadas_menos1: u32) -> Result<(), String> {
    l.pular(96);
    let mut perfil = Vec::new();
    let mut nivel = Vec::new();
    for _ in 0..sub_camadas_menos1 {
        perfil.push(l.bit()?);
        nivel.push(l.bit()?);
    }
    if sub_camadas_menos1 > 0 {
        l.pular(2 * (8 - sub_camadas_menos1 as usize));
    }
    for i in 0..sub_camadas_menos1 as usize {
        if perfil[i] == 1 {
            l.pular(88);
        }
        if nivel[i] == 1 {
            l.pular(8);
        }
    }
    Ok(())
}

/// st_ref_pic_set sem predição entre conjuntos: os deltas de POC negativos (0 positivos).
fn ler_rps(l: &mut Leitor, idx: u32) -> Result<Vec<(i32, bool)>, String> {
    if idx != 0 && l.bit()? == 1 {
        return Err("RPS com predição entre conjuntos".into());
    }
    let negativos = l.ue()?;
    let positivos = l.ue()?;
    let mut r = Vec::new();
    let mut poc = 0i32;
    for _ in 0..negativos {
        poc -= l.ue()? as i32 + 1;
        r.push((poc, l.bit()? == 1));
    }
    for _ in 0..positivos {
        l.ue()?;
        l.bit()?;
    }
    if positivos > 0 {
        return Err("RPS com POC positivo (quadros B)".into());
    }
    Ok(r)
}

pub fn ler_sps_hevc(rbsp: &[u8]) -> Result<SpsHevc, String> {
    let mut l = Leitor::new(rbsp);
    l.pular(16); // cabeçalho da NAL
    l.u(4)?;
    let sub = l.u(3)?;
    l.u(1)?;
    pular_ptl(&mut l, sub)?;
    l.ue()?;
    let chroma = l.ue()?;
    let cor_separada = chroma == 3 && l.bit()? == 1;
    let largura = l.ue()?;
    let altura = l.ue()?;
    if l.bit()? == 1 {
        for _ in 0..4 {
            l.ue()?;
        }
    }
    l.ue()?;
    l.ue()?;
    let log2_poc_lsb = l.ue()? + 4;
    let ordenacao = l.bit()?;
    let mut dpb_menos1 = 0;
    for _ in (if ordenacao == 1 { 0 } else { sub })..=sub {
        dpb_menos1 = l.ue()?;
        l.ue()?;
        l.ue()?;
    }
    let log2_cb_min = l.ue()? + 3;
    let log2_ctb = log2_cb_min + l.ue()?;
    l.ue()?;
    l.ue()?;
    l.ue()?;
    l.ue()?;
    if l.bit()? == 1 && l.bit()? == 1 {
        return Err("SPS com lista de escala".into());
    }
    l.bit()?; // amp
    let sao = l.bit()? == 1;
    if l.bit()? == 1 {
        l.u(8)?;
        l.ue()?;
        l.ue()?;
        l.bit()?;
    }
    let rps_na_sps = l.ue()?;
    let mut conjuntos = Vec::new();
    for i in 0..rps_na_sps {
        conjuntos.push(ler_rps(&mut l, i)?);
    }
    if l.bit()? == 1 {
        return Err("SPS com referências de longo prazo".into());
    }
    let tmvp = l.bit()? == 1;
    Ok(SpsHevc {
        largura,
        altura,
        cor_separada,
        chroma,
        log2_poc_lsb,
        dpb_menos1,
        log2_cb_min,
        log2_ctb,
        sao,
        rps_na_sps,
        conjuntos,
        tmvp,
    })
}

pub fn ler_pps_hevc(rbsp: &[u8]) -> Result<PpsHevc, String> {
    let mut l = Leitor::new(rbsp);
    l.pular(16);
    if l.ue()? != 0 || l.ue()? != 0 {
        return Err("PPS ou SPS com id ≠ 0".into());
    }
    let fatias_dependentes = l.bit()? == 1;
    let output_flag = l.bit()? == 1;
    let bits_extra = l.u(3)?;
    l.bit()?;
    let cabac_init_presente = l.bit()? == 1;
    l.ue()?;
    l.ue()?;
    let qp_inicial = 26 + l.se()?;
    l.bit()?;
    l.bit()?;
    if l.bit()? == 1 {
        l.ue()?;
    }
    l.se()?;
    l.se()?;
    let offsets_croma_no_slice = l.bit()? == 1;
    let ponderada = l.bit()? == 1;
    l.bit()?;
    let transquant_bypass = l.bit()? == 1;
    let tiles = l.bit()? == 1;
    let wpp = l.bit()? == 1;
    if tiles {
        return Err("PPS com tiles".into());
    }
    let filtro_entre_slices = l.bit()? == 1;
    let (mut override_desbloqueio, mut desbloqueio_desligado) = (false, false);
    if l.bit()? == 1 {
        override_desbloqueio = l.bit()? == 1;
        desbloqueio_desligado = l.bit()? == 1;
        if !desbloqueio_desligado {
            l.se()?;
            l.se()?;
        }
    }
    if l.bit()? == 1 {
        return Err("PPS com lista de escala".into());
    }
    l.bit()?; // lists_modification_present_flag (só vale com mais de uma referência usada)
    l.ue()?;
    let extensao_cabecalho = l.bit()? == 1;
    Ok(PpsHevc {
        fatias_dependentes,
        output_flag,
        bits_extra,
        cabac_init_presente,
        qp_inicial,
        transquant_bypass,
        offsets_croma_no_slice,
        ponderada,
        tiles,
        wpp,
        filtro_entre_slices,
        override_desbloqueio,
        desbloqueio_desligado,
        extensao_cabecalho,
    })
}

/// POC lsb e RPS (deltas) do cabeçalho de um slice do NVENC; IDR dá (0, vazio).
pub fn ler_slice_hevc(
    nal: &[u8],
    sps: &SpsHevc,
    pps: &PpsHevc,
) -> Result<(u32, Vec<(i32, bool)>), String> {
    let rbsp = desescapar(nal);
    let tipo = u32::from(rbsp[0] >> 1) & 63;
    let mut l = Leitor::new(&rbsp);
    l.pular(16);
    if l.bit()? != 1 {
        return Err("slice que não é o primeiro do quadro".into());
    }
    if (16..=23).contains(&tipo) {
        l.bit()?;
    }
    l.ue()?;
    l.u(pps.bits_extra)?;
    l.ue()?;
    if pps.output_flag {
        l.bit()?;
    }
    if sps.cor_separada {
        l.u(2)?;
    }
    if tipo == 19 || tipo == 20 {
        return Ok((0, Vec::new()));
    }
    let lsb = l.u(sps.log2_poc_lsb)?;
    let rps = if l.bit()? == 1 {
        // short_term_ref_pic_set_idx: Ceil(Log2(num_short_term_ref_pic_sets)) bits.
        let n = sps.rps_na_sps;
        let bits = if n > 1 {
            32 - (n - 1).leading_zeros()
        } else {
            0
        };
        let idx = l.u(bits)? as usize;
        sps.conjuntos
            .get(idx)
            .cloned()
            .ok_or("RPS da SPS fora da lista")?
    } else {
        ler_rps(&mut l, sps.rps_na_sps)?
    };
    Ok((lsb, rps))
}

/// Quem acompanha o fluxo HEVC do NVENC para escrever os pulados no meio dele.
#[derive(Default)]
pub struct PuladoHevc {
    sps: Option<SpsHevc>,
    pps: Option<PpsHevc>,
    /// POCs que o NVENC ainda pode referenciar depois do último quadro dele, do mais novo ao mais velho.
    dpb: Vec<i32>,
    /// Quadros pulados escritos (para teste e resumo).
    pub escritos: u32,
}

impl PuladoHevc {
    /// Lê o que o NVENC acabou de escrever para o quadro de POC `poc` (o nosso `displayPOCSyntax`).
    pub fn observar(&mut self, fluxo: &[u8], poc: i32) -> Result<(), String> {
        for nal in nals(fluxo) {
            if nal.len() < 2 {
                continue;
            }
            let tipo = (nal[0] >> 1) & 63;
            let camada = ((u32::from(nal[0]) & 1) << 5) | (u32::from(nal[1]) >> 3);
            if camada != 0 {
                return Err("fluxo com mais de uma camada (alfa)".into());
            }
            match tipo {
                33 => self.sps = Some(ler_sps_hevc(&desescapar(nal))?),
                34 => self.pps = Some(ler_pps_hevc(&desescapar(nal))?),
                0..=9 | 16..=21 => {
                    let (sps, pps) = match (&self.sps, &self.pps) {
                        (Some(s), Some(p)) => (s, p),
                        _ => return Err("slice antes da SPS e da PPS".into()),
                    };
                    let (lsb, rps) = ler_slice_hevc(nal, sps, pps)?;
                    let lsb_esperado = (poc as u32) & ((1 << sps.log2_poc_lsb) - 1);
                    if tipo != 19 && tipo != 20 && lsb != lsb_esperado {
                        return Err(format!(
                            "o NVENC escreveu POC {lsb}, esperado {lsb_esperado}"
                        ));
                    }
                    let mut dpb = vec![poc];
                    dpb.extend(rps.iter().map(|(d, _)| poc + d));
                    dpb.truncate(sps.dpb_menos1 as usize);
                    self.dpb = dpb;
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// O quadro pulado de POC `poc` (Annex B), igual ao último do NVENC.
    pub fn quadro(&mut self, poc: i32) -> Result<Vec<u8>, String> {
        let (sps, pps) = match (&self.sps, &self.pps) {
            (Some(s), Some(p)) => (s, p),
            _ => return Err("sem SPS e PPS".into()),
        };
        if pps.fatias_dependentes || pps.wpp || pps.tiles || pps.transquant_bypass || pps.ponderada
        {
            return Err("PPS com recurso que o pulado não escreve".into());
        }
        if self.dpb.is_empty() || self.dpb[0] >= poc {
            return Err("pulado sem quadro anterior do NVENC".into());
        }
        let mut b = Escritor::default();
        // Cabeçalho da NAL: TRAIL_R (1), camada 0, TemporalId 0.
        b.u(0, 1);
        b.u(1, 6);
        b.u(0, 6);
        b.u(1, 3);
        // slice_segment_header
        b.bit(1); // first_slice_segment_in_pic_flag
        b.ue(0); // slice_pic_parameter_set_id
        b.u(0, pps.bits_extra);
        b.ue(1); // slice_type P
        if pps.output_flag {
            b.bit(1);
        }
        if sps.cor_separada {
            return Err("SPS com planos de cor separados".into());
        }
        b.u(
            (poc as u32) & ((1 << sps.log2_poc_lsb) - 1),
            sps.log2_poc_lsb,
        );
        b.bit(0); // short_term_ref_pic_set_sps_flag
        if sps.rps_na_sps != 0 {
            b.bit(0); // inter_ref_pic_set_prediction_flag
        }
        b.ue(self.dpb.len() as u32);
        b.ue(0);
        let mut anterior = poc;
        for (i, &p) in self.dpb.iter().enumerate() {
            b.ue((anterior - p - 1) as u32);
            // Só o último do NVENC é usado (é a referência 0); os outros só ficam guardados para o NVENC.
            b.bit(u32::from(i == 0));
            anterior = p;
        }
        if sps.tmvp {
            b.bit(0); // slice_temporal_mvp_enabled_flag
        }
        if sps.sao {
            b.bit(0); // slice_sao_luma_flag
            if sps.chroma != 0 {
                b.bit(0); // slice_sao_chroma_flag
            }
        }
        b.bit(1); // num_ref_idx_active_override_flag
        b.ue(0); // num_ref_idx_l0_active_minus1
        // lists_modification só vale com NumPicTotalCurr > 1 (aqui, 1).
        if pps.cabac_init_presente {
            b.bit(0);
        }
        b.ue(4); // five_minus_max_num_merge_cand: um candidato, sem merge_idx
        b.se(0); // slice_qp_delta
        if pps.offsets_croma_no_slice {
            b.se(0);
            b.se(0);
        }
        if pps.override_desbloqueio {
            b.bit(0);
        }
        // Desbloqueio ligado (ou desligado pela PPS) e SAO desligado: o flag só existe se o desbloqueio está ligado.
        if pps.filtro_entre_slices && !pps.desbloqueio_desligado {
            b.bit(1);
        }
        if pps.extensao_cabecalho {
            b.ue(0);
        }
        // byte_alignment()
        b.bit(1);
        b.alinhar_zero();

        let qp = pps.qp_inicial;
        // Tabelas 9-11 e 9-13 (initType 1, P sem cabac_init_flag): split_cu_flag e cu_skip_flag.
        let mut divide = [107u8, 139, 126].map(|v| Contexto::hevc(v, qp));
        let mut pula = [197u8, 185, 201].map(|v| Contexto::hevc(v, qp));
        let mut c = Cabac::new(b);
        let (lw, lh) = (sps.largura, sps.altura);
        let ctb = 1u32 << sps.log2_ctb;
        let min = 1u32 << sps.log2_cb_min;
        let (gw, gh) = (lw.div_ceil(min), lh.div_ceil(min));
        // Profundidade de cada bloco mínimo (para o contexto do split_cu_flag).
        let mut prof = vec![0u8; (gw * gh) as usize];
        let (colunas, linhas) = (lw.div_ceil(ctb), lh.div_ceil(ctb));
        for cy in 0..linhas {
            for cx in 0..colunas {
                arvore(
                    &mut c,
                    &mut divide,
                    &mut pula,
                    &mut prof,
                    (gw, lw, lh, min, sps.log2_cb_min),
                    cx * ctb,
                    cy * ctb,
                    sps.log2_ctb,
                    0,
                );
                c.termino(u32::from(cy == linhas - 1 && cx == colunas - 1));
            }
        }
        // cabac_zero_words não são necessárias (o pulado é minúsculo).
        self.escritos += 1;
        Ok(escapar(&c.fim()))
    }
}

/// coding_quadtree com toda CU em skip: divide só onde a CU passa da borda (a divisão é inferida).
#[allow(clippy::too_many_arguments)]
fn arvore(
    c: &mut Cabac,
    divide: &mut [Contexto; 3],
    pula: &mut [Contexto; 3],
    prof: &mut [u8],
    (gw, lw, lh, min, log2_min): (u32, u32, u32, u32, u32),
    x: u32,
    y: u32,
    log2: u32,
    profundidade: u8,
) {
    let tam = 1u32 << log2;
    let cabe = x + tam <= lw && y + tam <= lh;
    let em = |px: u32, py: u32| (py / min * gw + px / min) as usize;
    let dividir = if cabe && log2 > log2_min {
        // 9.3.4.2.2: vizinho à esquerda e acima, se dentro do quadro, com profundidade maior.
        let esq = x > 0 && prof[em(x - 1, y)] > profundidade;
        let cima = y > 0 && prof[em(x, y - 1)] > profundidade;
        c.decisao(&mut divide[usize::from(esq) + usize::from(cima)], 0);
        false
    } else {
        log2 > log2_min
    };
    if dividir {
        let metade = tam / 2;
        for (dx, dy) in [(0, 0), (metade, 0), (0, metade), (metade, metade)] {
            if x + dx < lw && y + dy < lh {
                arvore(
                    c,
                    divide,
                    pula,
                    prof,
                    (gw, lw, lh, min, log2_min),
                    x + dx,
                    y + dy,
                    log2 - 1,
                    profundidade + 1,
                );
            }
        }
        return;
    }
    // cu_skip_flag = 1; contexto: vizinhos dentro do quadro (todos pulados).
    let n = usize::from(x > 0) + usize::from(y > 0);
    c.decisao(&mut pula[n], 1);
    let passos = tam / min;
    for j in 0..passos {
        for i in 0..passos {
            let (px, py) = (x + i * min, y + j * min);
            if px < lw && py < lh {
                prof[em(px, py)] = profundidade;
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// H.264

#[derive(Clone, Debug)]
pub struct SpsH264 {
    pub log2_frame_num: u32,
    pub poc_tipo: u32,
    pub refs: u32,
    pub mbs: u32,
    pub cor_separada: bool,
}

#[derive(Clone, Debug)]
pub struct PpsH264 {
    pub cabac: bool,
    pub qp_inicial: i32,
    pub controle_desbloqueio: bool,
    pub redundante: bool,
    pub ponderada: bool,
}

const PERFIS_ALTOS: [u32; 12] = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134];

pub fn ler_sps_h264(rbsp: &[u8]) -> Result<SpsH264, String> {
    let mut l = Leitor::new(rbsp);
    l.pular(8);
    let perfil = l.u(8)?;
    l.pular(16);
    l.ue()?;
    let mut cor_separada = false;
    if PERFIS_ALTOS.contains(&perfil) || perfil == 135 {
        if l.ue()? == 3 {
            cor_separada = l.bit()? == 1;
        }
        l.ue()?;
        l.ue()?;
        l.bit()?;
        if l.bit()? == 1 {
            return Err("SPS com matriz de escala".into());
        }
    }
    let log2_frame_num = l.ue()? + 4;
    let poc_tipo = l.ue()?;
    match poc_tipo {
        0 => {
            l.ue()?;
        }
        1 => return Err("SPS com POC tipo 1".into()),
        _ => {}
    }
    let refs = l.ue()?;
    l.bit()?;
    let largura = l.ue()? + 1;
    let altura = l.ue()? + 1;
    if l.bit()? == 0 {
        return Err("SPS com campos (entrelaçado)".into());
    }
    Ok(SpsH264 {
        log2_frame_num,
        poc_tipo,
        refs,
        mbs: largura * altura,
        cor_separada,
    })
}

pub fn ler_pps_h264(rbsp: &[u8]) -> Result<PpsH264, String> {
    let mut l = Leitor::new(rbsp);
    l.pular(8);
    if l.ue()? != 0 || l.ue()? != 0 {
        return Err("PPS ou SPS com id ≠ 0".into());
    }
    let cabac = l.bit()? == 1;
    l.bit()?;
    if l.ue()? != 0 {
        return Err("PPS com grupos de slices".into());
    }
    l.ue()?;
    l.ue()?;
    let ponderada = l.bit()? == 1;
    l.u(2)?;
    let qp_inicial = 26 + l.se()?;
    l.se()?;
    l.se()?;
    let controle_desbloqueio = l.bit()? == 1;
    l.bit()?;
    let redundante = l.bit()? == 1;
    Ok(PpsH264 {
        cabac,
        qp_inicial,
        controle_desbloqueio,
        redundante,
        ponderada,
    })
}

/// Quem acompanha o fluxo H.264 do NVENC (uma referência só, POC tipo 2): reescreve o frame_num dos quadros dele
/// somando os pulados desde o IDR e escreve os pulados como P de referência com o frame_num seguinte.
#[derive(Default)]
pub struct PuladoH264 {
    sps: Option<SpsH264>,
    pps: Option<PpsH264>,
    /// frame_num do último quadro de referência no fluxo (do NVENC, já reescrito, ou pulado).
    anterior: Option<u32>,
    /// Pulados desde o último IDR (o que se soma ao frame_num do NVENC).
    desvio: u32,
    pub escritos: u32,
}

impl PuladoH264 {
    /// Os bytes do NVENC com o frame_num reescrito (iguais aos dele antes do primeiro pulado de cada GOP).
    pub fn reescrever(&mut self, fluxo: &[u8]) -> Result<Vec<u8>, String> {
        let mut r = Vec::with_capacity(fluxo.len() + 8);
        for nal in nals(fluxo) {
            if nal.is_empty() {
                continue;
            }
            let tipo = nal[0] & 31;
            let referencia = nal[0] >> 5 != 0;
            match tipo {
                7 => self.sps = Some(ler_sps_h264(&desescapar(nal))?),
                8 => self.pps = Some(ler_pps_h264(&desescapar(nal))?),
                1 | 5 => {
                    let sps = self.sps.as_ref().ok_or("slice antes da SPS")?;
                    let maximo = 1u32 << sps.log2_frame_num;
                    if tipo == 5 {
                        self.desvio = 0;
                    }
                    let mut rbsp = desescapar(nal);
                    let mut l = Leitor::new(&rbsp);
                    l.pular(8);
                    l.ue()?;
                    l.ue()?;
                    l.ue()?;
                    if sps.cor_separada {
                        l.u(2)?;
                    }
                    let pos = l.pos();
                    let original = l.u(sps.log2_frame_num)?;
                    let novo = (original + self.desvio) % maximo;
                    if novo != original {
                        for i in 0..sps.log2_frame_num as usize {
                            let bit = (novo >> (sps.log2_frame_num as usize - 1 - i)) & 1;
                            let (byte, desl) = ((pos + i) / 8, 7 - (pos + i) % 8);
                            rbsp[byte] = (rbsp[byte] & !(1 << desl)) | ((bit as u8) << desl);
                        }
                        r.extend_from_slice(&escapar(&rbsp));
                    } else {
                        r.extend_from_slice(&[0, 0, 0, 1]);
                        r.extend_from_slice(nal);
                    }
                    if referencia {
                        self.anterior = Some(novo);
                    }
                    continue;
                }
                _ => {}
            }
            r.extend_from_slice(&[0, 0, 0, 1]);
            r.extend_from_slice(nal);
        }
        Ok(r)
    }

    /// O quadro pulado seguinte (Annex B), igual ao último quadro de referência.
    pub fn quadro(&mut self) -> Result<Vec<u8>, String> {
        let (sps, pps) = match (&self.sps, &self.pps) {
            (Some(s), Some(p)) => (s, p),
            _ => return Err("sem SPS e PPS".into()),
        };
        if sps.poc_tipo != 2 || sps.refs != 1 {
            return Err(format!(
                "H.264 com POC tipo {} e {} referências (o pulado pede 2 e 1)",
                sps.poc_tipo, sps.refs
            ));
        }
        if pps.ponderada || pps.redundante || sps.cor_separada {
            return Err("PPS com recurso que o pulado não escreve".into());
        }
        let anterior = self.anterior.ok_or("pulado sem quadro anterior")?;
        let frame_num = (anterior + 1) % (1 << sps.log2_frame_num);
        let mut b = Escritor::default();
        b.u(0, 1);
        b.u(2, 2); // nal_ref_idc: referência (a única no DPB, com uma referência só)
        b.u(1, 5); // não IDR
        b.ue(0); // first_mb_in_slice
        b.ue(5); // slice_type P (todos os slices do quadro)
        b.ue(0); // pic_parameter_set_id
        b.u(frame_num, sps.log2_frame_num);
        b.bit(1); // num_ref_idx_active_override_flag
        b.ue(0); // num_ref_idx_l0_active_minus1
        b.bit(0); // ref_pic_list_modification_flag_l0
        b.bit(0); // adaptive_ref_pic_marking_mode_flag (janela deslizante)
        if pps.cabac {
            b.ue(0); // cabac_init_idc
        }
        b.se(0); // slice_qp_delta
        if pps.controle_desbloqueio {
            b.ue(1); // disable_deblocking_filter_idc: sem desbloqueio (pulados sem resíduo nem movimento não filtram)
        }
        let mbs = sps.mbs;
        let rbsp = if pps.cabac {
            // cabac_alignment_one_bit
            while !b.alinhado() {
                b.bit(1);
            }
            // mb_skip_flag: ctxIdx 11 (vizinhos ausentes ou pulados: ctxIdxInc 0), cabac_init_idc 0: (m, n) = (23, 33).
            let mut pula = Contexto::h264(23, 33, pps.qp_inicial);
            let mut c = Cabac::new(b);
            for mb in 0..mbs {
                c.decisao(&mut pula, 1);
                c.termino(u32::from(mb == mbs - 1)); // end_of_slice_flag
            }
            c.fim()
        } else {
            b.ue(mbs); // mb_skip_run
            b.bit(1); // rbsp_stop_one_bit
            b.rbsp()
        };
        self.anterior = Some(frame_num);
        self.desvio += 1;
        self.escritos += 1;
        Ok(escapar(&rbsp))
    }
}

/// O pulado do codec da sessão.
pub enum Pulado {
    Hevc(PuladoHevc),
    H264(PuladoH264),
}

impl Pulado {
    /// O que vai para o arquivo depois de um quadro do NVENC de POC `poc` (no H.264, com o frame_num reescrito).
    pub fn observar(&mut self, fluxo: &[u8], poc: i32) -> Result<Option<Vec<u8>>, String> {
        match self {
            Pulado::Hevc(p) => p.observar(fluxo, poc).map(|()| None),
            Pulado::H264(p) => p.reescrever(fluxo).map(Some),
        }
    }
    pub fn quadro(&mut self, poc: i32) -> Result<Vec<u8>, String> {
        match self {
            Pulado::Hevc(p) => p.quadro(poc),
            Pulado::H264(p) => p.quadro(),
        }
    }
    /// Se o fluxo já depende do pulado (H.264 com frame_num deslocado): aí desligar no meio quebraria o vídeo.
    pub fn sem_volta(&self) -> bool {
        matches!(self, Pulado::H264(p) if p.desvio > 0)
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn exp_golomb_e_escape() {
        let mut e = Escritor::default();
        for v in [0, 1, 2, 3, 7, 255] {
            e.ue(v);
        }
        e.se(-3);
        e.se(4);
        let r = e.rbsp();
        let mut l = Leitor::new(&r);
        for v in [0, 1, 2, 3, 7, 255] {
            assert_eq!(l.ue().unwrap(), v);
        }
        assert_eq!(l.se().unwrap(), -3);
        assert_eq!(l.se().unwrap(), 4);
        let bruto = [0x40, 0, 0, 1, 0, 0, 0, 0, 3, 7];
        let esc = escapar(&bruto);
        assert_eq!(&esc[..4], &[0, 0, 0, 1]);
        assert_eq!(desescapar(&esc[4..]), bruto);
        assert_eq!(nals(&esc), vec![&esc[4..]]);
    }

    #[test]
    fn contexto_da_norma() {
        // 154 é o valor neutro da norma (m = 0, n = 64): estado 0, MPS 1, qualquer QP.
        for qp in [0, 26, 51] {
            assert_eq!(Contexto::hevc(154, qp), Contexto { estado: 0, mps: 1 });
        }
        // 197 (cu_skip_flag, ctx 0) no QP 26: m = 15, n = 24, pré = 48 → estado 15, MPS 0.
        assert_eq!(Contexto::hevc(197, 26), Contexto { estado: 15, mps: 0 });
    }
}
