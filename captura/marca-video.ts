// M09: a marca do vídeo sintético (gerar-midia.sh do experimento do vídeo embutido): o número do quadro do vídeo em
// 12 blocos de 120 px na faixa y 1040–1079 (bit 0 à esquerda). Com o vídeo em tela cheia na composição 1920×1080,
// o quadro capturado N tem de trazer o quadro N (+ o corte do início) do vídeo (R03).

/** Lê a marca no quadro BGRA (pré-multiplicado; o vídeo é opaco) de largura × 1080, pelo canal G no meio de cada bloco. */
export function lerMarcaVideo(pixels, largura, { y = 1060, blocos = 12, passo = 120 } = {}) {
  if (pixels.length !== largura * 1080 * 4) throw new Error(`quadro com ${pixels.length} bytes, esperado ${largura * 1080 * 4}`);
  let v = 0;
  for (let b = 0; b < blocos; b++) if (pixels[(y * largura + b * passo + passo / 2) * 4 + 1] > 128) v |= 1 << b;
  return v;
}

/** Confere o registro do main.ts ({n, video}): o vídeo de cada quadro N tem de ser N + deslocamento. */
export function conferirVideo(quadros, { deslocamento = 0, total }) {
  const errados = [];
  let conferidos = 0, faltando = Math.max(0, total - quadros.length);
  for (const { n, video } of quadros) {
    if (typeof video !== 'number') { faltando++; continue; }
    conferidos++;
    if (video !== n + deslocamento) errados.push({ n, video, esperado: n + deslocamento });
  }
  return { conferidos, errados, faltando };
}
