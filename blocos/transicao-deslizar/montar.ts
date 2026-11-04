// transicao-deslizar (H07) for `kodecz assemble` (docs/formatos/edicao.md). Usually a scene's
// `"transicao": { "tipo": "deslizar", "duracao": 15, "lado": "direita" }`: the assembler wraps this scene in the
// entering layer (`papel: "entra"`) and the previous one in the leaving layer (`papel: "sai"`), and makes the previous
// scene end at this one's start + duracao. `lado` is where the new scene comes from: direita (default) or esquerda.
import type { ContextoMontagem, Montado } from "../../edicao/tipos.ts";
import { estilo, numeroOpcional } from "../../edicao/html.ts";

export function montar(item: Record<string, unknown>, _ctx: ContextoMontagem): Montado {
  const duracao = numeroOpcional(item, "duracao", "transicao-deslizar", true);
  const papel = item.papel ?? "entra";
  if (papel !== "entra" && papel !== "sai") throw new Error(`transicao-deslizar: «papel» is "entra" or "sai", got ${JSON.stringify(papel)}`);
  const lado = item.lado ?? "direita";
  if (lado !== "direita" && lado !== "esquerda") throw new Error(`transicao-deslizar: «lado» is "direita" or "esquerda", got ${JSON.stringify(lado)}`);
  const conteudo = typeof item.conteudo === "string" ? item.conteudo : "";
  const vars = { duracao, "desliza-x": lado === "esquerda" ? "-100%" : undefined };
  return {
    html: `<div class="kz-desliza-${papel}" data-bloco="transicao-deslizar" style="${estilo(vars, item.variaveis)}">\n${conteudo}</div>`,
    css: ["bloco.css"],
  };
}
