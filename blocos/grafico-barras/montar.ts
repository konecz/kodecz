// grafico-barras (H11) for `kodecz assemble` (docs/formatos/edicao.md):
// { "bloco": "grafico-barras", "de", "barras": [ { "valor": 42, "rotulo": "jan", "destaque"?: true } ],
//   "maximo"?: (default: the largest value), "sufixo"?: " %", "passo"?: 4, "duracao"?: 27, "topo"?: "30%",
//   "altura"?: "46%" }. The first bar grows at `de`, each next one `passo` frames later, in `duracao` frames.
import type { ContextoMontagem, Montado } from "../../edicao/tipos.ts";
import { esc, estilo, numeroOpcional, quadros, textoCss } from "../../edicao/html.ts";

export function montar(item: Record<string, unknown>, ctx: ContextoMontagem): Montado {
  const { inicio } = quadros(item, ctx);
  if (!Array.isArray(item.barras) || item.barras.length === 0) throw new Error("grafico-barras: «barras» is a list of { valor, rotulo }");
  const barras = item.barras.map((b: unknown, k: number) => {
    const x = (b ?? {}) as Record<string, unknown>;
    if (typeof x.valor !== "number" || !Number.isInteger(x.valor) || x.valor < 0) throw new Error(`grafico-barras: barras[${k}].valor must be an integer ≥ 0`);
    return { valor: x.valor, rotulo: x.rotulo === undefined ? "" : String(x.rotulo), destaque: x.destaque === true };
  });
  const maior = Math.max(...barras.map((b) => b.valor));
  const maximo = numeroOpcional(item, "maximo", "grafico-barras") ?? maior;
  if (maximo < maior || maximo <= 0) throw new Error(`grafico-barras: «maximo» (${maximo}) must be > 0 and ≥ the largest value (${maior})`);
  const vars = {
    inicio, maximo, sufixo: item.sufixo === undefined ? undefined : textoCss(item.sufixo),
    passo: numeroOpcional(item, "passo", "grafico-barras", true), duracao: numeroOpcional(item, "duracao", "grafico-barras", true),
    "barras-topo": item.topo, "barras-altura": item.altura,
  };
  const linhas = barras.map((b, k) =>
    `  <div class="kz-barra${b.destaque ? " kz-destaque" : ""}" style="--valor: ${b.valor}; --ordem: ${k}"><i class="kz-barra-coluna"></i>` +
    `<b class="kz-barra-num" data-valor="${b.valor}"></b><i class="kz-barra-rotulo">${esc(b.rotulo)}</i></div>`);
  return {
    html: `<div class="kz-barras" data-bloco="grafico-barras" style="${estilo(vars, item.variaveis)}">\n${linhas.join("\n")}\n</div>`,
    css: ["bloco.css"],
  };
}
