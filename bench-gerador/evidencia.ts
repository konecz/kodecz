// Kodecz Bench (P12): a evidência de uma entrega, o que os três motores de oráculo leem (bench-gerador/motores.ts).
// Uma coleta por página (geometria do S04 + bench/sonda.js + bench-gerador/sonda-estilo.js, em todo quadro) e, quando
// alguma regra precisa do pixel ou do som, um render na placa (sob flock -s, em bench/coletar.ts). Todas as regras são
// avaliadas sobre a mesma evidência. A evidência traz só o que sai da página, do render, da biblioteca de mídia rotulada
// e da tarefa: nunca o modelo da cena nem a mutação.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { coletar, renderizar, type Coletado } from "../bench/coletar.ts";
import type { Tarefa } from "./mundo.ts";
import type { Amostra, Fundo } from "../conferencia/regras.ts";

export const SONDA_ESTILO = new URL("./sonda-estilo.js", import.meta.url).pathname;

export type Render = { ok: boolean; erro?: string; memoriaMB?: number; quadros?: number };
export type Evidencia = {
  tarefa: Tarefa;
  /** A biblioteca de mídia rotulada do mundo (o que cada arquivo é), da tarefa e não do que o agente entregou. */
  rotulos: Record<string, Record<string, unknown>>;
  /** O index.html entregue. */
  fonte: string;
  /** Arquivos da entrega (caminho relativo a saida/ → bytes). */
  arquivos: Record<string, number>;
  col: Coletado | null;
  /** Uma segunda coleta da mesma página (o que muda entre duas cargas: K-COD-02, K-FER-06). */
  col2: Coletado | null;
  travou: boolean;
  console: string[];
  /** O MP4 que as regras de sinal leem: o render da página, ou o arquivo entregue (quando a tarefa pede um). */
  mp4: string | null;
  /** O render da própria página pelo motor (referência, quando o MP4 lido é o entregue). */
  mp4Render?: string | null;
  render: Render | null;
  /** A evidência da partida (para o diff antes/depois dos pedidos de revisão). */
  antes: Evidencia | null;
  /** Contas de sinal já feitas (lumas, áudio…), na memória. */
  cache: Map<string, unknown>;
  /** Só na conferência (conferencia/conferir.ts): o rosto pelas amostras do detector (no bench, pela mídia rotulada) e
   * o fundo real dos textos (comando «fundos» da coleta), que o contraste usa no lugar da cadeia de fundos do CSS. */
  rostos?: Amostra[];
  fundos?: Fundo[];
};

function listar(dir: string, raiz = dir): Record<string, number> {
  const r: Record<string, number> = {};
  if (!existsSync(dir)) return r;
  for (const nome of readdirSync(dir)) {
    const c = join(dir, nome), s = statSync(c);
    if (s.isDirectory()) Object.assign(r, listar(c, raiz)); else r[relative(raiz, c)] = s.size;
  }
  return r;
}

export type Pedido = {
  /** Renderizar (as regras de pixel, som e metadado do MP4). */
  render: boolean;
  /** Medir o pico de memória do render. */
  memoria?: boolean;
  /** Pós-processo do MP4 entregue (args do ffmpeg); null: o próprio render. */
  entrega?: string[] | null;
  /** O MP4 já entregue pelo agente (caminho), em vez do render. */
  mp4Entregue?: string | null;
  /** Coletar duas vezes. */
  duas?: boolean;
  /** Onde guardar o MP4. */
  mp4Destino: string;
};

/** A evidência da entrega em `pasta` (a pasta da composição, saida/). */
export async function evidencia(pasta: string, tarefa: Tarefa, rotulos: Evidencia["rotulos"], o: Pedido): Promise<Evidencia> {
  const fonte = readFileSync(join(pasta, "index.html"), "utf8");
  const ev: Evidencia = { tarefa, rotulos, fonte, arquivos: listar(pasta), col: null, col2: null, travou: false, console: [], mp4: null, render: null, antes: null, cache: new Map() };
  const decl = /"quadros":\s*(\d+)/.exec(fonte);
  const limiteMs = 20_000 + Number(decl?.[1] ?? 3000) * 40;
  try {
    ev.col = await coletar(pasta, { extras: [SONDA_ESTILO], limiteMs });
    ev.travou = !!ev.col.travou;
    ev.console = ev.col.console ?? [];
    if (ev.travou) ev.col = null;
  } catch (e) {
    ev.console.push(`coleta falhou: ${(e as Error).message.split("\n")[0]}`);
  }
  if (o.duas && ev.col) {
    try { ev.col2 = await coletar(pasta, { extras: [SONDA_ESTILO], limiteMs }); } catch { /* fica sem a segunda */ }
  }
  if (o.mp4Entregue) {
    ev.mp4 = existsSync(o.mp4Entregue) ? o.mp4Entregue : null;
    // A referência para comparar quadro a quadro com o que foi entregue.
    if (o.render && !ev.travou && ev.mp4) { const r = renderizar(pasta, o.mp4Destino, []); ev.mp4Render = r.ok ? o.mp4Destino : null; }
  } else if (o.render && !ev.travou) {
    let r = renderizar(pasta, o.mp4Destino, [], { memoria: o.memoria, limiteMs: Math.min(15 * 60_000, limiteMs * 4) });
    // A leitura do ffmpeg às vezes volta com EINTR (os error 4) no módulo nativo: uma nova tentativa.
    if (!r.ok && /os error 4/.test(r.erro ?? "")) r = renderizar(pasta, o.mp4Destino, [], { memoria: o.memoria, limiteMs: Math.min(15 * 60_000, limiteMs * 4) });
    ev.render = { ok: r.ok, erro: r.erro, memoriaMB: r.memoriaMB, quadros: r.resumo?.quadros };
    if (r.ok) {
      ev.mp4 = o.mp4Destino;
      ev.mp4Render = o.mp4Destino;
      if (o.entrega?.length) {
        const saida = o.mp4Destino.replace(/\.mp4$/, "-entregue.mp4");
        const f = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", o.mp4Destino, ...o.entrega, saida], { encoding: "utf8" });
        ev.mp4 = f.status === 0 ? saida : null;
        if (f.status !== 0) ev.console.push(`entrega falhou: ${f.stderr.trim().split("\n").slice(-1)[0]}`);
      }
    }
  }
  return ev;
}

/** A evidência sem o que não vai para o disco (cache e a de antes), para guardar em JSON. */
export const paraJson = (ev: Evidencia) => ({ ...ev, cache: undefined, antes: undefined });
export function deJson(j: any, antes: Evidencia | null = null): Evidencia {
  // Evidência guardada antes do campo mp4Render: o render da página é o próprio MP4, salvo o entregue (pós-processado).
  const mp4Render = j.mp4Render !== undefined ? j.mp4Render : j.mp4 && !/-entregue\.mp4$/.test(j.mp4) ? j.mp4 : null;
  return { ...j, mp4Render, antes, cache: new Map() };
}
