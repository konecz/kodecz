// cartela (H09) for `kodecz assemble` (docs/formatos/edicao.md):
// { "bloco": "cartela", "de", "ate", "texto": "…", "rotulo"?: "…", "fundo"?: "accent", "tinta"?: "ground" }.
// `fundo` and `tinta` are color names of the brand (--color-<name>), never a loose hex.
import type { ContextoMontagem, Montado } from "../../edicao/tipos.ts";
import { esc, estilo, quadros, texto } from "../../edicao/html.ts";

function cor(item: Record<string, unknown>, campo: string): string | undefined {
  const v = item[campo];
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !/^[a-z][a-z0-9-]*$/.test(v)) throw new Error(`cartela: «${campo}» is a brand color name (accent, ground, ink…), got ${JSON.stringify(v)}`);
  return `var(--color-${v})`;
}

export function montar(item: Record<string, unknown>, ctx: ContextoMontagem): Montado {
  const { inicio, fim } = quadros(item, ctx);
  const chamada = texto(item, "texto", "cartela");
  const vars = { inicio, fim, "cartela-fundo": cor(item, "fundo"), "cartela-tinta": cor(item, "tinta") };
  const rotulo = item.rotulo === undefined ? "" : `\n  <p class="kz-cartela-rotulo">${esc(texto(item, "rotulo", "cartela"))}</p>`;
  return {
    html: `<div class="kz-cartela" data-bloco="cartela" style="${estilo(vars, item.variaveis)}">${rotulo}\n` +
      `  <p class="kz-cartela-texto">${esc(chamada)}</p>\n</div>`,
    css: ["bloco.css"],
  };
}
