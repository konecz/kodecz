// titulo-entrada (H08) for `kodecz assemble` (docs/formatos/edicao.md):
// { "bloco": "titulo-entrada", "de", "ate", "titulo": "…", "subtitulo"?: "…", "atrasoSub"?: 6, "topo"?: "36%",
//   "alinhar"?: "centro" | "esquerda" }. `atrasoSub` in frames after the title.
import type { ContextoMontagem, Montado } from "../../edicao/tipos.ts";
import { esc, estilo, numeroOpcional, quadros, texto } from "../../edicao/html.ts";

export function montar(item: Record<string, unknown>, ctx: ContextoMontagem): Montado {
  const { inicio, fim } = quadros(item, ctx);
  const titulo = texto(item, "titulo", "titulo-entrada");
  const atraso = numeroOpcional(item, "atrasoSub", "titulo-entrada", true) ?? 6;
  const alinhar = item.alinhar ?? "centro";
  if (alinhar !== "centro" && alinhar !== "esquerda") throw new Error(`titulo-entrada: «alinhar» is "centro" or "esquerda", got ${JSON.stringify(alinhar)}`);
  const vars = {
    inicio, fim, "titulo-topo": item.topo,
    "titulo-alinhar": alinhar === "esquerda" ? "flex-start" : undefined, "titulo-texto": alinhar === "esquerda" ? "left" : undefined,
  };
  const sub = item.subtitulo === undefined ? "" :
    `\n  <p class="kz-titulo-sub" style="--atraso: ${atraso}">${esc(texto(item, "subtitulo", "titulo-entrada"))}</p>`;
  return {
    html: `<div class="kz-titulo" data-bloco="titulo-entrada" style="${estilo(vars, item.variaveis)}">\n` +
      `  <h1 class="kz-titulo-principal">${esc(titulo)}</h1>${sub}\n</div>`,
    css: ["bloco.css"],
  };
}
