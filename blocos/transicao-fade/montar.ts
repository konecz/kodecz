// transicao-fade (H05) for `kodecz assemble` (docs/formatos/edicao.md). Usually written as a scene's
// `"transicao": { "tipo": "fade", "duracao": 15 }`: the assembler wraps the scene's children in this block and keeps
// the previous scene until the fade ends. Directly: { "bloco": "transicao-fade", "duracao": 15, "itens": [...] }
// inside a scene. Starts at the scene's --inicio (inherited); `duracao` in frames.
import type { ContextoMontagem, Montado } from "../../edicao/tipos.ts";
import { estilo, numeroOpcional } from "../../edicao/html.ts";

export function montar(item: Record<string, unknown>, _ctx: ContextoMontagem): Montado {
  const duracao = numeroOpcional(item, "duracao", "transicao-fade", true);
  const conteudo = typeof item.conteudo === "string" ? item.conteudo : "";
  return {
    html: `<div class="kz-fade" data-bloco="transicao-fade" style="${estilo({ duracao }, item.variaveis)}">\n${conteudo}</div>`,
    css: ["bloco.css"],
  };
}
