// transicao-wipe (H06) for `kodecz assemble` (docs/formatos/edicao.md). Usually a scene's
// `"transicao": { "tipo": "wipe", "duracao": 15, "lado": "esquerda" }`; directly, { "bloco": "transicao-wipe", … }
// inside a scene. `lado` is where the edge comes from: esquerda (default), direita, cima, baixo.
import type { ContextoMontagem, Montado } from "../../edicao/tipos.ts";
import { estilo, numeroOpcional } from "../../edicao/html.ts";

const LADOS: Record<string, string> = {
  esquerda: "inset(0 100% 0 0)", direita: "inset(0 0 0 100%)", cima: "inset(0 0 100% 0)", baixo: "inset(100% 0 0 0)",
};

export function montar(item: Record<string, unknown>, _ctx: ContextoMontagem): Montado {
  const duracao = numeroOpcional(item, "duracao", "transicao-wipe", true);
  const lado = item.lado === undefined ? undefined : String(item.lado);
  if (lado !== undefined && !Object.hasOwn(LADOS, lado)) throw new Error(`transicao-wipe: «lado» is ${Object.keys(LADOS).join(", ")}; got «${lado}»`);
  const conteudo = typeof item.conteudo === "string" ? item.conteudo : "";
  const vars = { duracao, "wipe-de": lado === undefined ? undefined : LADOS[lado] };
  return {
    html: `<div class="kz-wipe" data-bloco="transicao-wipe" style="${estilo(vars, item.variaveis)}">\n${conteudo}</div>`,
    css: ["bloco.css"],
  };
}
