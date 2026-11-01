// P10.3: quadros da linha do tempo declarada iguais ao anterior, que o motor repete sem página, cópia nem textura.
// Os intervalos vêm da própria página (window.motor_intervalos, no main.ts): [início, fim] em ms do vídeo de cada
// animação da document.timeline, a partir do getComputedTiming (fim null = sem fim). Fora do intervalo, o valor é o do
// preenchimento (ou nenhum), que não muda; então o quadro N só pode mudar se algum intervalo toca [t(N−1), t(N)].
// A regra é conservadora nas bordas (fechado dos dois lados): na dúvida, desenha.

/**
 * Quadros N do trecho [primeiro, primeiro + total) iguais ao N−1. O primeiro do trecho nunca entra (não há anterior
 * desenhado neste render).
 * Integração do P10 (P10.5): o vídeo embutido muda o quadro sem animação. Cada trecho [início, fim], em quadros da
 * composição (fechado), marca os quadros que podem mudar: para o vídeo, do primeiro quadro dele (data-inicio) ao que
 * limpa o canvas (data-inicio + data-quadros). É exato: dentro, o quadro do vídeo é função só de N; fora, o canvas
 * fica vazio.
 * @param {Array<[number, number | null]>} intervalos
 * @param {Array<[number, number]>} [trechos]
 */
export function quadrosParados(intervalos, primeiro, total, qps, trechos = []) {
  if (!(qps > 0)) throw new Error(`qps inválido: ${qps}`);
  for (const i of intervalos) {
    const [inicio, fim] = i ?? [];
    if (!Number.isFinite(inicio) || !(fim === null || Number.isFinite(fim))) throw new Error(`intervalo inválido: ${JSON.stringify(i)}`);
  }
  for (const q of trechos) {
    const [inicio, fim] = q ?? [];
    if (!Number.isInteger(inicio) || !Number.isInteger(fim) || fim < inicio) throw new Error(`trecho inválido: ${JSON.stringify(q)}`);
  }
  const t = (n) => (n * 1000) / qps;
  const parados = [];
  for (let n = primeiro + 1; n < primeiro + total; n++) {
    const anda = intervalos.some(([inicio, fim]) => (fim === null || t(n - 1) <= fim) && t(n) >= inicio)
      || trechos.some(([inicio, fim]) => n >= inicio && n <= fim);
    if (!anda) parados.push(n);
  }
  return parados;
}
