// Brilho por quadro e aviso de piscada (decisão do responsável de 2026-11-01: a piscada é medida durante o render, na
// placa, no quadro que já passa por ela; não decodificando o MP4). O nativo mede cada quadro antes do NVENC
// (nativo/src/brilho.rs); aqui, a série vira o arquivo ao lado da saída e o resumo do JSON do render. Formato:
// docs/formatos/brilho.md.
import { writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

/** Versão do formato do arquivo (docs/formatos/brilho.md); muda só se um campo mudar de sentido. */
export const FORMATO_BRILHO = 1;

/**
 * Pico isolado acima disto (na escala do Y do MP4) é piscada. Calibração do S04 (docs/experimentos/2026-11-s04-calibrar.md):
 * 131,2 no vídeo reprovado pela piscada contra 30,3 no máximo nos aprovados (a cortina de transição); 60 fica no
 * meio, com o dobro de folga sobre os aprovados. Conferido no render (registro do S08, seção 9).
 */
export const LIMITE_PISCADA = 60;

export type Piscada = { quadro: number; pico: number; brilho: number; antes: number; depois: number };

/**
 * Picos isolados de brilho: o quadro i que salta para o mesmo lado em relação aos dois vizinhos (mais claro que os
 * dois, o clarão, ou mais escuro que os dois, o quadro preto). O pico é o menor dos dois saltos (a mesma medida da
 * calibração do S04). Devolve os acima de `limite`, com o número do quadro na composição (`de` + i).
 */
export function picosIsolados(brilho: readonly number[], limite = LIMITE_PISCADA, de = 0): Piscada[] {
  const r: Piscada[] = [];
  for (let i = 1; i + 1 < brilho.length; i++) {
    const a = brilho[i] - brilho[i - 1], b = brilho[i] - brilho[i + 1];
    if (Math.sign(a) === 0 || Math.sign(a) !== Math.sign(b)) continue;
    const pico = Math.min(Math.abs(a), Math.abs(b));
    if (pico > limite) r.push({ quadro: de + i, pico: arred(pico), brilho: arred(brilho[i]), antes: arred(brilho[i - 1]), depois: arred(brilho[i + 1]) });
  }
  return r;
}

/** O maior pico isolado (qualquer tamanho), ou null se não houver. */
export function maiorPico(brilho: readonly number[], de = 0): { quadro: number; pico: number } | null {
  const todos = picosIsolados(brilho, 0, de);
  return todos.reduce<{ quadro: number; pico: number } | null>((m, p) => (!m || p.pico > m.pico ? { quadro: p.quadro, pico: p.pico } : m), null);
}

const arred = (v: number) => Math.round(v * 100) / 100;

/** O arquivo da série ao lado da saída: `video.mp4` → `video.brilho.json`. */
export function arquivoDoBrilho(saida: string): string {
  return join(dirname(saida), `${basename(saida, extname(saida))}.brilho.json`);
}

/**
 * Grava a série (`brilho` e `mudanca`, um valor por quadro do arquivo) ao lado da saída e devolve o resumo para o JSON do
 * render. `de`: o primeiro quadro renderizado (--de). `alfa`: a camada do M05 (RGB pré-multiplicado sobre preto, que vai
 * ser montada sobre outra coisa): a série sai, mas sem procurar piscada (um elemento de um quadro sobre o transparente
 * acusaria à toa).
 */
export function gravarBrilho(saida: string, brilho: readonly number[], mudanca: readonly number[],
  { qps, de, msBrilho, alfa = false }: { qps: number; de: number; msBrilho: number | null; alfa?: boolean }) {
  const limite = alfa ? null : LIMITE_PISCADA;
  const piscadas = limite === null ? [] : picosIsolados(brilho, limite, de);
  const arquivo = arquivoDoBrilho(saida);
  writeFileSync(arquivo, `${JSON.stringify({
    formato: FORMATO_BRILHO, escala: "Y do MP4 (BT.709, faixa limitada: preto 16, branco 235)", qps, de, limitePiscada: limite,
    piscadas, brilho: brilho.map(arred), mudanca: mudanca.map(arred),
  })}\n`);
  const soma = brilho.reduce((s, v) => s + v, 0);
  return {
    arquivo, medio: brilho.length ? arred(soma / brilho.length) : null,
    minimo: brilho.length ? arred(brilho.reduce((m, v) => Math.min(m, v))) : null,
    maximo: brilho.length ? arred(brilho.reduce((m, v) => Math.max(m, v))) : null,
    maiorPico: maiorPico(brilho, de), maiorMudanca: mudanca.length ? arred(mudanca.reduce((m, v) => Math.max(m, v))) : null,
    limitePiscada: limite, piscadas, msBrilho,
  };
}
