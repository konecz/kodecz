// Kodecz Bench (P12): aplica o oráculo de um item à entrega de uma pasta de tarefa (saida/ ou o MP4 entregue).
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audio } from "./analise.ts";
import { coletar, renderizar } from "./coletar.ts";
import type { Item } from "./itens.ts";
import type { Dados, Resultado } from "./oraculos.ts";

export type Avaliacao = Resultado & { segundos: number; render?: { ok: boolean; erro?: string } };

/**
 * `renderSempre`: renderiza a composição mesmo quando o oráculo só lê o DOM (o rodador confere que a entrega
 * renderiza; os testes pulam para ganhar tempo).
 */
export async function avaliar(item: Item, tarefa: string, o: { renderSempre?: boolean } = {}): Promise<Avaliacao> {
  const t0 = performance.now();
  // Caso gerado (bench-gerador/adaptador.ts): o oráculo lê a evidência inteira da entrega, do jeito dele.
  const proprio = (item as Item & { avaliarProprio?(t: string): Promise<Resultado> }).avaliarProprio;
  if (proprio) {
    const fim = (r: Resultado): Avaliacao => ({ ...r, segundos: +((performance.now() - t0) / 1000).toFixed(1) });
    if (!existsSync(join(tarefa, "saida", "index.html"))) return fim({ status: "nao-conferivel", motivo: "a entrega não tem saida/index.html" });
    try { return fim(await proprio(tarefa)); } catch (e) { return fim({ status: "nao-conferivel", motivo: `o oráculo falhou: ${(e as Error).message.split("\n")[0]}` }); }
  }
  const tmp = mkdtempSync(join(tmpdir(), "kodecz-bench-avaliar-"));
  const fim = (r: Resultado, extra: Partial<Avaliacao> = {}): Avaliacao => ({ ...r, ...extra, segundos: +((performance.now() - t0) / 1000).toFixed(1) });
  try {
    const d: Dados = { col: null, mp4: null };
    let render: Avaliacao["render"];
    if (item.precisa.mp4Entregue) d.mp4 = join(tarefa, item.precisa.mp4Entregue);
    else {
      const pasta = join(tarefa, "saida");
      if (!existsSync(join(pasta, "index.html"))) return fim({ status: "nao-conferivel", motivo: "a entrega não tem saida/index.html" });
      if (item.precisa.render || o.renderSempre) {
        const mp4 = join(tmp, "render.mp4");
        const r = renderizar(pasta, mp4);
        render = { ok: r.ok, erro: r.erro };
        if (!r.ok) return fim({ status: "nao-conferivel", motivo: `o render falhou: ${r.erro}` }, { render });
        d.mp4 = mp4;
      }
      if (item.precisa.geometria) {
        try { d.col = await coletar(pasta); } catch (e) {
          return fim({ status: "nao-conferivel", motivo: `a coleta falhou: ${(e as Error).message.split("\n")[0]}` }, { render });
        }
      }
    }
    if (item.referencia) {
      const arquivos = item.referencia(tmp);
      d.referencia = Object.fromEntries(Object.entries(arquivos).map(([k, v]) => [k, audio(v)]));
    }
    try { return fim(item.oraculo(d), { render }); } catch (e) {
      return fim({ status: "nao-conferivel", motivo: `o oráculo falhou: ${(e as Error).message.split("\n")[0]}` }, { render });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
