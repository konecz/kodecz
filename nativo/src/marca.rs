// M03: a marca do quadro. A página desenha o número do quadro numa faixa fora da área codificada, em blocos
// opacos de 16 px: branco, preto (sincronia), os 24 bits de N (do mais alto ao mais baixo) e os 24 bits do
// complemento. Ler a marca diz qual estado da página está no quadro, sem confiar no ritmo da captura.
// A mesma faixa (`pagina.html` do M03, `marca()`) é desenhada dentro do quadro como tarja de conferência.

pub const BLOCO: usize = 16;
pub const BITS: usize = 24;
pub const BLOCOS: usize = 2 + 2 * BITS;

/// 1 para branco, 0 para preto, `None` para qualquer outra coisa (faixa ausente, transparente ou misturada).
fn bit(px: &[u8]) -> Option<u32> {
    let (b, g, r, a) = (px[0], px[1], px[2], px[3]);
    if a < 250 {
        return None;
    }
    if r >= 200 && g >= 200 && b >= 200 {
        Some(1)
    } else if r <= 55 && g <= 55 && b <= 55 {
        Some(0)
    } else {
        None
    }
}

/// Lê N de uma linha BGRA que cruza a faixa (largura ≥ 800 px). `None` se a faixa não confere.
pub fn ler(linha: &[u8]) -> Option<u32> {
    if linha.len() < BLOCOS * BLOCO * 4 {
        return None;
    }
    let bloco = |i: usize| bit(&linha[(i * BLOCO + BLOCO / 2) * 4..][..4]);
    if bloco(0)? != 1 || bloco(1)? != 0 {
        return None;
    }
    let mut n = 0u32;
    for i in 0..BITS {
        let b = bloco(2 + i)?;
        if bloco(2 + BITS + i)? != 1 - b {
            return None;
        }
        n = (n << 1) | b;
    }
    Some(n)
}

#[cfg(test)]
pub fn desenhar(n: u32, largura: usize) -> Vec<u8> {
    let mut linha = vec![0u8; largura * 4];
    for x in 0..(BLOCOS * BLOCO).min(largura) {
        let i = x / BLOCO;
        let branco = match i {
            0 => true,
            1 => false,
            _ if i < 2 + BITS => (n >> (BITS - 1 - (i - 2))) & 1 == 1,
            _ => (n >> (BITS - 1 - (i - 2 - BITS))) & 1 == 0,
        };
        let v = if branco { 255 } else { 0 };
        linha[x * 4..x * 4 + 4].copy_from_slice(&[v, v, v, 255]);
    }
    linha
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn le_o_que_desenhou() {
        for n in [0, 1, 2, 29, 30, 449, 1 << 20, (1 << 24) - 1] {
            assert_eq!(ler(&desenhar(n, 1920)), Some(n), "n = {n}");
        }
    }

    #[test]
    fn recusa_faixa_ausente_ou_estragada() {
        assert_eq!(ler(&vec![0u8; 1920 * 4]), None, "transparente");
        assert_eq!(ler(&vec![255u8; 1920 * 4]), None, "branca");
        assert_eq!(ler(&desenhar(7, 100)), None, "curta");
        // Um bit trocado sem o complemento (quadro rasgado entre dois estados) não passa.
        let mut l = desenhar(5, 1920);
        let x = (2 + BITS - 1) * BLOCO + BLOCO / 2;
        l[x * 4..x * 4 + 3].copy_from_slice(&[0, 0, 0]);
        assert_eq!(ler(&l), None, "bit sem o complemento");
        // Meio-tom (antisserrilhado, alfa parcial) não vira bit.
        let mut l = desenhar(5, 1920);
        l[(BLOCO / 2) * 4 + 3] = 128;
        assert_eq!(ler(&l), None, "alfa parcial");
    }
}
