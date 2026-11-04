// cena (H04) for `kodecz assemble` (docs/formatos/edicao.md): { "bloco": "cena", "de", "ate", "itens": [...] }.
// The children come in as `conteudo` (their HTML, built by the assembler). A scene's `transicao` (fade, wipe,
// deslizar) is expanded by the assembler into the transition block around the children.
import type { ContextoMontagem, Montado } from "../../edicao/tipos.ts";
import { estilo, quadros } from "../../edicao/html.ts";

export function montar(item: Record<string, unknown>, ctx: ContextoMontagem): Montado {
  const { inicio, fim } = quadros(item, ctx);
  if (inicio === undefined || fim === undefined) throw new Error("cena: «de» and «ate» are required");
  if (fim <= inicio) throw new Error(`cena: ends at frame ${fim}, not after its start (${inicio})`);
  const conteudo = typeof item.conteudo === "string" ? item.conteudo : "";
  return {
    html: `<section class="kz-cena" data-bloco="cena" style="${estilo({ inicio, fim }, item.variaveis)}">\n${conteudo}</section>`,
    css: ["bloco.css"],
  };
}
