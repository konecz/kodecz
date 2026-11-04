// The assembly context (ContextoMontagem, edicao/tipos.ts): turns a trigger (a second, a spoken word, the end of a
// sentence) into seconds and frames, from the words of the speech. Pure: no file, no clock.
import type { ContextoMontagem, Gatilho, Palavra } from "./tipos.ts";

/** Slack after the last word of a sentence: the pause where a zoom goes back or a strip leaves (G21). */
export const FOLGA_FRASE = 0.15;

/** A word for comparison: no accents (NFD without combining marks), lowercase, letters and digits only. */
export function normalizarPalavra(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** Whether the word closes a sentence: it ends in . ! ? or … (closing quotes and brackets after the mark count). */
export function fechaFrase(texto: string): boolean {
  return /[.!?…][\s"'”’»)\]}]*$/u.test(texto.trim());
}

function distancia(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let anterior = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const guardado = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = guardado;
    }
  }
  return d[b.length];
}

/** Up to five distinct words of the speech closest to `alvo` (edit distance, then order in the speech). */
export function parecidas(palavras: Palavra[], alvo: string): string[] {
  const n = normalizarPalavra(alvo);
  const vistas = new Map<string, { texto: string; d: number; k: number }>();
  palavras.forEach((p, k) => {
    const chave = normalizarPalavra(p.texto);
    if (!chave || vistas.has(chave)) return;
    const contem = Math.min(n.length, chave.length) >= 3 && (chave.includes(n) || n.includes(chave));
    const d = contem ? Math.min(distancia(n, chave), 1) : distancia(n, chave);
    vistas.set(chave, { texto: p.texto.replace(/[^\p{L}\p{N}]+$/u, "").replace(/^[^\p{L}\p{N}]+/u, ""), d, k });
  });
  return [...vistas.values()].sort((a, b) => a.d - b.d || a.k - b.k).slice(0, 5).map((v) => v.texto);
}

const ehNumero = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const descrever = (x: unknown) => JSON.stringify(x) ?? String(x);

export function criarContexto(o: { fps: number; largura: number; altura: number; palavras: Palavra[] }): ContextoMontagem {
  const { fps, largura, altura, palavras } = o;
  const chaves = palavras.map((p) => normalizarPalavra(p.texto));

  const q = (segundos: number) => Math.round(segundos * fps + 1e-6);

  function quando(palavra: string, ocorrencia = 1): Palavra {
    const n = normalizarPalavra(String(palavra));
    if (!n) throw new Error(`word trigger «${palavra}» is empty once accents and punctuation are removed`);
    if (!Number.isInteger(ocorrencia) || ocorrencia < 1) throw new Error(`occurrence of «${palavra}» must be an integer ≥ 1, got ${descrever(ocorrencia)}`);
    const achadas = palavras.filter((_, k) => chaves[k] === n);
    if (achadas.length === 0) {
      const p = parecidas(palavras, n);
      throw new Error(`word «${palavra}» is not in the speech` + (p.length ? `; closest: ${p.join(", ")}` : " (the speech has no words)"));
    }
    if (ocorrencia > achadas.length) {
      throw new Error(`word «${palavra}», occurrence ${ocorrencia}: it is spoken only ${achadas.length} time(s)`);
    }
    return achadas[ocorrencia - 1];
  }

  function fimDaFrase(segundos: number): number {
    if (palavras.length === 0) throw new Error("end of sentence: the speech has no words (missing «falas»?)");
    let k = 0;
    for (let i = 0; i < palavras.length; i++) if (palavras[i].inicio <= segundos + 1e-9) k = i;
    while (k < palavras.length - 1 && !fechaFrase(palavras[k].texto)) k++;
    return palavras[k].fim + FOLGA_FRASE;
  }

  function tempo(ref: Gatilho): number {
    if (typeof ref === "number") {
      if (!Number.isFinite(ref)) throw new Error(`invalid trigger ${descrever(ref)}: a number of seconds`);
      if (ref < 0) throw new Error(`trigger ${ref} is negative: seconds must be ≥ 0`);
      return ref;
    }
    if (ref && typeof ref === "object") {
      const r = ref as Record<string, unknown>;
      if ("segundo" in r) { if (!ehNumero(r.segundo)) throw new Error(`invalid trigger ${descrever(ref)}: «segundo» must be a number`); return tempo(r.segundo); }
      if ("palavra" in r) {
        const borda = r.borda ?? "inicio";
        if (borda !== "inicio" && borda !== "fim") throw new Error(`invalid trigger ${descrever(ref)}: «borda» is "inicio" or "fim"`);
        const desl = r.deslocamento ?? 0;
        if (!ehNumero(desl)) throw new Error(`invalid trigger ${descrever(ref)}: «deslocamento» is a number of seconds`);
        const p = quando(String(r.palavra), (r.ocorrencia as number | undefined) ?? 1);
        return Math.max(0, p[borda] + desl);
      }
      if ("fimDaFrase" in r) return fimDaFrase(tempo(r.fimDaFrase as Gatilho));
    }
    throw new Error(`invalid trigger ${descrever(ref)}: use seconds, { "segundo" }, { "palavra" } or { "fimDaFrase" }`);
  }

  return { fps, largura, altura, palavras, q, quando, fimDaFrase, tempo };
}
