// M08: a marca da faixa lida em JS, para o modo CPU (o quadro já está na CPU, sem o módulo nativo). A regra é a de
// nativo/src/marca.rs: blocos opacos de 16 px, branco, preto, os 24 bits de N e os 24 do complemento.
export const BLOCO = 16, BITS = 24, BLOCOS = 2 + 2 * BITS;

// 1 branco, 0 preto, null para o resto (ausente, transparente ou misturado), com as mesmas margens do marca.rs.
function bit(linha, x) {
  const i = x * 4;
  const b = linha[i], g = linha[i + 1], r = linha[i + 2], a = linha[i + 3];
  if (a < 250) return null;
  if (r >= 200 && g >= 200 && b >= 200) return 1;
  if (r <= 55 && g <= 55 && b <= 55) return 0;
  return null;
}

/** N de uma linha BGRA que cruza a faixa, ou null se ela não confere. */
export function lerFaixa(linha) {
  if (linha.length < BLOCOS * BLOCO * 4) return null;
  const bloco = (i) => bit(linha, i * BLOCO + BLOCO / 2);
  if (bloco(0) !== 1 || bloco(1) !== 0) return null;
  let n = 0;
  for (let i = 0; i < BITS; i++) {
    const b = bloco(2 + i);
    if (b === null || bloco(2 + BITS + i) !== 1 - b) return null;
    n = n * 2 + b;
  }
  return n;
}

/** A marca na linha y de um quadro BGRA de `largura` (o lerMarca do nativo). */
export function lerMarcaEm(pixels, largura, y) {
  const passo = largura * 4;
  if ((y + 1) * passo > pixels.length) return null;
  return lerFaixa(pixels.subarray(y * passo, (y + 1) * passo));
}
