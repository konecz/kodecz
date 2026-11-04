// Word timings for `kodecz prepare words` (docs/formatos/preparo.md): the text comes from the script, the times from
// the recognizer. Pure functions, no recognizer here: the script and the recognized words are aligned by their keys
// (lowercase, no accents, letters and digits only), so «Balde,» and « balde» match. Where they differ («2.000» in the
// script, «dois mil» in the audio, or a word the recognizer got wrong), the script words of that stretch share the time
// of the recognized words of the same stretch, in proportion to their length.
// TypeScript with erasable syntax only: Node 24 runs it directly.

/** One word of the speech file: `{ "palavras": [ { "texto", "inicio", "fim" } ] }`, times in seconds. */
export interface Palavra { texto: string; inicio: number; fim: number }
/** One recognized word: its text (only used to align) and its times in seconds. */
export interface Reconhecida { texto: string; inicio: number; fim: number }

export interface Alinhamento {
  palavras: Palavra[];
  /** Script words matched one to one, by key. */
  iguais: number;
  /** Stretches where the script and the audio differ: the script text, the recognized text. */
  trocas: { roteiro: string; falado: string }[];
  /** Script words with nothing recognized in their stretch (placed in the gap between their neighbours). */
  semPar: string[];
  /** Recognized words with no script word in their stretch (ignored). */
  extras: string[];
  /** 2 × matched / (script words + recognized words), 0 to 1. */
  semelhanca: number;
}

/** The key of a word: lowercase, accents removed, only a–z and 0–9 («2.000» → «2000», «Ação!» → «acao»). */
export function chave(palavra: string): string {
  return palavra.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The words of the script, split on whitespace. A token with no letter or digit («—», «…») is not a word: it joins the
 * word before it (or the next one, at the start), so the text keeps it.
 */
export function palavrasDoRoteiro(texto: string): string[] {
  const saida: string[] = [];
  let pendente = "";
  for (const t of texto.split(/\s+/).filter(Boolean)) {
    if (chave(t)) { saida.push(pendente ? `${pendente} ${t}` : t); pendente = ""; }
    else if (saida.length) saida[saida.length - 1] += ` ${t}`;
    else pendente = pendente ? `${pendente} ${t}` : t;
  }
  if (pendente && saida.length === 0) return [];
  return saida;
}

/** Pairs (i, j) of a longest common subsequence of the two key lists, in order. */
function pares(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length;
  if (!n || !m) return [];
  const larg = m + 1;
  const t = new Uint32Array((n + 1) * larg);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * larg + j] = a[i] === b[j] ? t[(i + 1) * larg + j + 1] + 1 : Math.max(t[(i + 1) * larg + j], t[i * larg + j + 1]);
    }
  }
  const saida: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { saida.push([i, j]); i++; j++; }
    else if (t[(i + 1) * larg + j] >= t[i * larg + j + 1]) i++;
    else j++;
  }
  return saida;
}

const arred = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Aligns the script words to the recognized ones. `corte` (seconds), when given, caps every time: the end of the
 * voice plus a margin, so a word never ends in the silence after the speech.
 */
export function alinhar(roteiro: string[], reconhecidas: Reconhecida[], corte?: number): Alinhamento {
  const ka = roteiro.map(chave), kb = reconhecidas.map((w) => chave(w.texto));
  // Recognized tokens with no letter or digit (a lone «-») take part in no match.
  const b = kb.map((k, j) => k || `\u0000${j}`);
  const ps = pares(ka, b);
  const tempos: ([number, number] | null)[] = roteiro.map(() => null);
  const trocas: Alinhamento["trocas"] = [], semPar: string[] = [], extras: string[] = [];
  const pendentes: [number, number][] = []; // script stretches with no recognized words: filled after the others
  const peso = (i: number) => Math.max(1, ka[i].length);
  let ai = 0, aj = 0;
  for (const [pi, pj] of [...ps, [roteiro.length, reconhecidas.length] as [number, number]]) {
    if (pi > ai && pj > aj) {
      const ini = reconhecidas[aj].inicio, fim = reconhecidas[pj - 1].fim;
      const total = Array.from({ length: pi - ai }, (_, k) => peso(ai + k)).reduce((s, x) => s + x, 0);
      let acum = 0;
      for (let i = ai; i < pi; i++) {
        const a = ini + (fim - ini) * acum / total;
        acum += peso(i);
        tempos[i] = [a, ini + (fim - ini) * acum / total];
      }
      trocas.push({ roteiro: roteiro.slice(ai, pi).join(" "), falado: reconhecidas.slice(aj, pj).map((w) => w.texto.trim()).join(" ") });
    } else if (pi > ai) {
      pendentes.push([ai, pi]);
      semPar.push(...roteiro.slice(ai, pi));
    } else if (pj > aj) {
      extras.push(...reconhecidas.slice(aj, pj).map((w) => w.texto.trim()).filter((x) => chave(x)));
    }
    if (pi < roteiro.length) tempos[pi] = [reconhecidas[pj].inicio, reconhecidas[pj].fim];
    ai = pi + 1; aj = pj + 1;
  }
  for (const [i1, i2] of pendentes) {
    let x = 0;
    for (let k = i1 - 1; k >= 0; k--) if (tempos[k]) { x = tempos[k]![1]; break; }
    let y = x;
    for (let k = i2; k < tempos.length; k++) if (tempos[k]) { y = tempos[k]![0]; break; }
    if (y < x) y = x;
    const q = i2 - i1;
    for (let k = 0; k < q; k++) tempos[i1 + k] = [x + (y - x) * k / q, x + (y - x) * (k + 1) / q];
  }
  // Times never go back and never pass the cut.
  let ultimo = 0;
  const palavras = roteiro.map((texto, i) => {
    let [a, f] = tempos[i]!;
    if (corte !== undefined) { a = Math.min(a, corte); f = Math.min(f, corte); }
    a = Math.max(a, ultimo); f = Math.max(f, a);
    ultimo = a;
    return { texto, inicio: arred(a), fim: arred(f) };
  });
  const soma = roteiro.length + reconhecidas.length;
  return { palavras, iguais: ps.length, trocas, semPar, extras, semelhanca: soma ? arred(2 * ps.length / soma) : 1 };
}

/**
 * The end of the voice, in seconds: the end of the last window (20 ms) whose RMS level is above the threshold
 * (−45 dBFS). The whole length when no window is.
 */
export function fimDaVoz(amostras: Float32Array, taxa: number, limiarDb = -45, janela = 0.02): number {
  const n = Math.max(1, Math.round(taxa * janela));
  const janelas = Math.floor(amostras.length / n);
  for (let k = janelas - 1; k >= 0; k--) {
    let s = 0;
    for (let i = k * n; i < (k + 1) * n; i++) s += amostras[i] * amostras[i];
    if (20 * Math.log10(Math.sqrt(s / n) + 1e-9) > limiarDb) return arred((k + 1) * n / taxa);
  }
  return arred(amostras.length / taxa);
}
