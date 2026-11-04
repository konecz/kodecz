// grafico-linha (H12) for `kodecz assemble` (docs/formatos/edicao.md):
// { "bloco": "grafico-linha", "de", "valores": [30, 45, 62], "maximo"?: (default: the largest value),
//   "duracao"?: 45, "sufixo"?: " %", "topo"?: "30%", "altura"?: "46%", "largura"?: "52%" }.
// The line draws itself from `de` in `duracao` frames; bloco.js builds the SVG on load.
import type { ContextoMontagem, Montado } from "../../edicao/tipos.ts";
import { estilo, numeroOpcional, quadros, textoCss } from "../../edicao/html.ts";

export function montar(item: Record<string, unknown>, ctx: ContextoMontagem): Montado {
  const { inicio } = quadros(item, ctx);
  const valores = item.valores;
  if (!Array.isArray(valores) || valores.length < 2 || !valores.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0)) {
    throw new Error("grafico-linha: «valores» is a list of at least two numbers ≥ 0");
  }
  const maior = Math.max(...(valores as number[]));
  const maximo = numeroOpcional(item, "maximo", "grafico-linha") ?? maior;
  if (maximo < maior || maximo <= 0) throw new Error(`grafico-linha: «maximo» (${maximo}) must be > 0 and ≥ the largest value (${maior})`);
  const vars = {
    inicio, duracao: numeroOpcional(item, "duracao", "grafico-linha", true),
    sufixo: item.sufixo === undefined ? undefined : textoCss(item.sufixo),
    "linha-topo": item.topo, "linha-altura": item.altura, "linha-largura": item.largura,
  };
  return {
    html: `<figure class="kz-linha" data-bloco="grafico-linha" data-valores="${valores.join(" ")}" data-maximo="${maximo}"\n` +
      `        style="${estilo(vars, item.variaveis)}">\n` +
      `  <svg aria-hidden="true"><polyline class="kz-linha-traco" pathLength="1"></polyline></svg>\n  <b class="kz-linha-num"></b>\n</figure>`,
    css: ["bloco.css"],
    js: ["bloco.js"],
  };
}
