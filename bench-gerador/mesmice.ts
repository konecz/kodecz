// Kodecz Bench (P12): K-IA-09 (mesmice) é métrica da RODADA, não oráculo por caso: o mesmo agente entrega vídeos
// com a mesma estrutura, os mesmos efeitos e a mesma composição, qualquer que seja o pedido. A medida: a semelhança
// média (Jaccard) entre as assinaturas de estilo das entregas da rodada, duas a duas. A assinatura de uma entrega é o
// conjunto das declarações de CSS (propriedade e valor, números arredondados), dos easings, das famílias de letra e
// das cores que ela usa, sem o conteúdo (texto e mídia). Perto de 1: tudo igual; a base do mundo (casos diferentes)
// dá a referência.
import { readFileSync } from "node:fs";

/** A assinatura de estilo de uma página (index.html). */
export function assinatura(html: string): Set<string> {
  const s = new Set<string>();
  const sem = html.replace(/<script type="application\/json" id="(?:kodecz|motor-video)">[\s\S]*?<\/script>/, "").replace(/window\.motor_falas = .*;/, "");
  const arred = (v: string) => v.replace(/-?\d+(\.\d+)?/g, (n) => String(Math.round(Number(n) / 8) * 8)).replace(/\s+/g, " ").trim();
  for (const m of sem.matchAll(/([a-z-]+)\s*:\s*([^;"'{}<>]+)[;"']/g)) {
    const p = m[1].toLowerCase();
    if (["src", "href", "content", "id"].includes(p)) continue;
    s.add(`${p}:${arred(m[2]).slice(0, 60)}`);
  }
  for (const m of sem.matchAll(/(cubic-bezier\([^)]+\)|ease-in-out|ease-out|ease-in|linear|steps\([^)]+\))/g)) s.add(`easing:${m[1]}`);
  for (const m of sem.matchAll(/#[0-9a-fA-F]{6}\b/g)) s.add(`cor:${m[0].toLowerCase()}`);
  for (const m of sem.matchAll(/<(section|h1|h2|div|img|video|canvas|svg|span)\b/g)) s.add(`tag:${m[1]}`);
  return s;
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return a.size + b.size - i ? i / (a.size + b.size - i) : 1;
};

/** Semelhança média entre as entregas (arquivos index.html), duas a duas; null com menos de duas. */
export function mesmice(arquivos: string[]): number | null {
  const as = arquivos.map((f) => assinatura(readFileSync(f, "utf8")));
  if (as.length < 2) return null;
  let s = 0, n = 0;
  for (let i = 0; i < as.length; i++) for (let j = i + 1; j < as.length; j++) { s += jaccard(as[i], as[j]); n++; }
  return +(s / n).toFixed(3);
}
