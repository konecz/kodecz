// Kodecz Bench (P12): o que os oráculos leem de uma composição em linha do tempo. A geometria de cada quadro vem da
// coleta da conferência do S04 (o mesmo Electron na CPU, o quadro N posto como no render), com o bench/sonda.js a
// mais; o render vai pelo motor na placa, sob a trava da placa compartilhada.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coleta } from "../cli/conferir.ts";
import { Recursos } from "../cli/processos.ts";
import { lerDeclaracao, type Declaracao } from "../cli/regras.ts";
import { lerFalas } from "../conferencia/falas.ts";
import type { Fala, Geometria } from "../conferencia/regras.ts";

export const RAIZ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
export const TRAVA_PLACA = process.env.MOTOR_TRAVA_PLACA ?? "/tmp/motor-video-placa.lock";
/**
 * [comando, argumentos] do processo na trava compartilhada da placa (flock -s). Dentro do `verificar.sh completo`, que
 * já segura a mesma trava em modo exclusivo (MOTOR_TRAVA_PLACA_TOMADA=1), roda direto: pedir de novo daria impasse.
 */
export function naTrava(cmd: string, args: string[]): [string, string[]] {
  return process.env.MOTOR_TRAVA_PLACA_TOMADA === "1" ? [cmd, args] : ["flock", ["-s", TRAVA_PLACA, cmd, ...args]];
}
const SONDA = join(RAIZ, "bench", "sonda.js");

export type Extra = {
  midias: { k: number; tag: string; src: string; papel: string | null; caixa: number[]; conteudo: number[]; op: number }[];
  els: { k: number; papel: string | null; celula: string | null; caixa: number[]; op: number; cor: string; fundo: string; peso: string; texto: string }[];
  pintados: { k: number; caixa: number[]; op: number; celulas: string[]; dentro: string | null; sig: string }[];
};
export type Quadro = Geometria & { extra: Extra };
export type Coletado = { decl: Declaracao; falas: Fala[]; quadros: Quadro[];
  /** Erros que a página escreveu no console (o Electron da coleta repassa os de nível erro). */
  console?: string[];
  /** A coleta não terminou no tempo-limite (`limiteMs`): a página segurou um quadro e não soltou. */
  travou?: boolean;
  /** Pico de memória (MB) do cgroup da coleta (a contenção põe o Electron num scope próprio), quando dá para ler. */
  memoriaMB?: number };

export function declaracaoDe(pasta: string): Declaracao {
  const arquivo = join(pasta, "index.html");
  if (!existsSync(arquivo)) throw new Error(`não há ${arquivo}`);
  const d = lerDeclaracao(readFileSync(arquivo, "utf8"));
  if (!d) throw new Error(`${arquivo} sem o bloco motor-video`);
  return d;
}

/**
 * Geometria (S04) e sonda do bench em todos os quadros da composição. `extras`: scripts de página a mais (depois da
 * sonda); `limiteMs`: tempo-limite da coleta dos quadros (padrão 600 s): passado, volta `travou` em vez de erro.
 */
export async function coletar(pasta: string, o: { extras?: string[]; limiteMs?: number } = {}): Promise<Coletado> {
  const decl = declaracaoDe(pasta);
  const r = new Recursos();
  const tmp = mkdtempSync(join(tmpdir(), "kodecz-bench-coleta-"));
  try {
    const coleta = new Coleta(r, { contencao: true }, { pasta, declaracao: decl }, [SONDA, ...(o.extras ?? [])]);
    const pronto = await coleta.esperar();
    let falas: Fala[] = [];
    falas = pronto.falas ? lerFalas(pronto.falas) : [];
    const arquivo = join(tmp, "geometria.jsonl");
    const consoleDe = () => coleta.log.filter((l) => l.startsWith("página: ")).map((l) => l.slice(8));
    try {
      await coleta.pedir({ cmd: "geometria", de: 0, ate: decl.quadros, arquivo }, o.limiteMs ?? 600000);
    } catch (e) {
      if (!o.limiteMs || !/não respondeu/.test((e as Error).message)) throw e;
      try { coleta.p.kill("SIGKILL"); } catch { /* já saiu */ }
      return { decl, falas, quadros: [], console: consoleDe(), travou: true };
    }
    const quadros: Quadro[] = readFileSync(arquivo, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const memoriaMB = picoDoCgroup(coleta.p.pid);
    await coleta.pedir({ cmd: "sair" }, 10000).catch(() => {});
    try { coleta.p.stdin!.end(); } catch { /* já fechou */ }
    return { decl, falas, quadros, console: consoleDe(), ...(memoriaMB !== undefined ? { memoriaMB } : {}) };
  } finally {
    await r.liberar();
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** memory.peak do cgroup v2 de um processo (o scope da contenção), em MB. */
function picoDoCgroup(pid: number | undefined): number | undefined {
  if (!pid) return undefined;
  try {
    const linha = readFileSync(`/proc/${pid}/cgroup`, "utf8").split("\n").find((l) => l.startsWith("0::"));
    if (!linha) return undefined;
    const pico = readFileSync(join("/sys/fs/cgroup", linha.slice(3).trim(), "memory.peak"), "utf8");
    return Math.round(Number(pico) / 2 ** 20);
  } catch { return undefined; }
}

/**
 * Render pelo motor (placa por padrão), na trava compartilhada da placa (flock -s: espera só quem mede com -x). Devolve
 * o JSON do comando ou o erro. `memoria`: mede o pico de memória residente (MB) do maior processo do render (GNU time, %M), em `memoriaMB`. */
export function renderizar(pasta: string, saida: string, extra: string[] = [], o: { memoria?: boolean; limiteMs?: number } = {}): { ok: boolean; erro?: string; resumo?: any; memoriaMB?: number } {
  const decl = declaracaoDe(pasta);
  const tempo = o.memoria ? ["/usr/bin/time", "-f", "kodecz-maxrss %M"] : [];
  const [cmd, ...pre] = [...tempo, process.execPath];
  const r = spawnSync(...naTrava(cmd, [...pre, join(RAIZ, "cli", "render.ts"), pasta, decl.id, saida, ...extra]),
    { encoding: "utf8", maxBuffer: 64 << 20, timeout: o.limiteMs ?? 15 * 60_000 });
  const kb = /kodecz-maxrss (\d+)/.exec(r.stderr ?? "")?.[1];
  const memoriaMB = kb ? Math.round(Number(kb) / 1024) : undefined;
  const linha = (r.stdout ?? "").trim().split("\n").reverse().find((l) => l.startsWith("{"));
  if (r.status !== 0 || !linha) return { ok: false, erro: (r.stderr || r.stdout || String(r.error ?? "")).trim().split("\n").filter((l) => !l.startsWith("kodecz-maxrss")).slice(-6).join("\n"), memoriaMB };
  return { ok: true, resumo: JSON.parse(linha), memoriaMB };
}
