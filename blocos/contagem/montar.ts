// contagem (H13) for `kodecz assemble` (docs/formatos/edicao.md). Counting up from 0 to `valor` between `de` and
// `ate`: { "bloco": "contagem", "de", "ate", "valor": 312, "rotulo"?, "prefixo"?: "R$ ", "sufixo"?: " %",
// "x"?: "50%", "topo"?: "50%", "tamanho"?: 1.6 }. Countdown, one number per second from N to 1 (`ate` is then
// de + N seconds): { "bloco": "contagem", "de", "regressiva": 3 }. Without «de»/«ate», the scene's are inherited.
import type { ContextoMontagem, Montado } from "../../edicao/tipos.ts";
import { esc, estilo, numeroOpcional, quadros, texto, textoCss } from "../../edicao/html.ts";

export function montar(item: Record<string, unknown>, ctx: ContextoMontagem): Montado {
  const q = quadros(item, ctx);
  const posicao = { "contagem-x": item.x, "contagem-topo": item.topo, "contagem-tamanho": numeroOpcional(item, "tamanho", "contagem") };
  const rotulo = item.rotulo === undefined ? "" : `\n  <span class="kz-contagem-rotulo">${esc(texto(item, "rotulo", "contagem"))}</span>`;
  const regressiva = numeroOpcional(item, "regressiva", "contagem", true);
  if (regressiva !== undefined) {
    if (q.inicio === undefined) throw new Error("contagem: a countdown needs «de» (its end is de + N seconds)");
    if (regressiva < 1 || regressiva > 60) throw new Error(`contagem: «regressiva» counts down from N to 1, N from 1 to 60; got ${regressiva}`);
    const fim = q.inicio + regressiva * ctx.fps;
    return {
      html: `<div class="kz-contagem kz-regressiva" data-bloco="contagem" style="${estilo({ inicio: q.inicio, de: regressiva, fim, ...posicao }, item.variaveis)}">\n` +
        `  <b class="kz-contagem-num" data-valor="1"></b>${rotulo}\n</div>`,
      css: ["bloco.css"],
    };
  }
  const valor = numeroOpcional(item, "valor", "contagem", true);
  if (valor === undefined) throw new Error("contagem: «valor» (an integer) or «regressiva» is required");
  if (q.fim !== undefined && q.inicio !== undefined && q.fim <= q.inicio) throw new Error("contagem: «ate» (when the count reaches the value) must come after «de»");
  const vars = {
    inicio: q.inicio, fim: q.fim, valor,
    prefixo: item.prefixo === undefined ? undefined : textoCss(item.prefixo),
    sufixo: item.sufixo === undefined ? undefined : textoCss(item.sufixo), ...posicao,
  };
  return {
    html: `<div class="kz-contagem" data-bloco="contagem" style="${estilo(vars, item.variaveis)}">\n` +
      `  <b class="kz-contagem-num" data-valor="${valor}"></b>${rotulo}\n</div>`,
    css: ["bloco.css"],
  };
}
