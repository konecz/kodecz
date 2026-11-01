// Abertura rápida (serviço): `node cli/render.ts --esperar` sobe antes do job o que não depende dele (a sonda da placa,
// o weston e o navegador com o processo da GPU de pé) e só então lê o job. Usado pelo serviço como reserva de um
// processo de folga (era a reserva do serviço, tirado em 2026-10-30): enquanto um job renderiza, o próximo sandbox já abre; cada processo quente
// atende UM job e sai, como o frio, para nada passar de um cliente a outro.
//
// Protocolo com quem chama (linhas JSON; não depende do navegador):
//   stdout ← {"evento":"pronto","ms":{...}}          quando está de pé (antes disso, nada no stdout);
//   stdin  → {"argumentos":["--placa", ..., "<entrada>", "<composição>", "<saída.mp4>"]}   os argumentos do cli/render.ts;
//   depois, o mesmo do comando frio: progresso no stderr, a linha JSON do resultado no stdout e o código de saída.
// `--esperar --previa` (só o cli/previa.ts, S07): o job pode ter --gravar e «ordem» (a lista de quadros a desenhar).
// Stdin fechado sem job: libera tudo e sai com 0 (a reserva foi descartada). Falha antes do pronto: «erro: …» no
// stderr e o código do frio (3 = placa não serve).
import type { ChildProcess } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Recursos } from "./processos.ts";
import { CAMINHOS, ErroDeUso, escolherModo, lerArgumentos, type Argumentos, type Escolha, type Sonda } from "./regras.ts";

const ESPERA = new URL("./navegador-em-espera.ts", import.meta.url).pathname;
/** Tempo máximo para o navegador ficar de pé. */
const LIMITE_ABERTURA_MS = 60000;

/** O navegador já aberto, esperando as variáveis do job (renderizar, em cli/render.ts, usa no lugar de subir um). */
export type Aberto = { wayland: string; entregar: (env: Record<string, string>) => ChildProcess };

export type Dependencias = {
  sondar: () => Sonda;
  subirWeston: (r: Recursos, tmp: string) => Promise<string>;
  /** As opções do Chromium no modo placa, as mesmas do frio. */
  flags: (e: Escolha) => string[];
  placaEnv: Record<string, string>;
};

const sair = (codigo: number, texto?: string): never => {
  if (texto) process.stderr.write(`erro: ${texto}\n`);
  process.exit(codigo);
};

/** Uma linha do stdin (o job), ou null se o stdin fechou antes. */
function linhaDoStdin(): Promise<string | null> {
  return new Promise((ok) => {
    const rl = createInterface({ input: process.stdin });
    let lida = false;
    // Um job só: o stdin fecha depois dele (aberto, seguraria o processo vivo no fim).
    rl.once("line", (l) => { lida = true; rl.close(); process.stdin.destroy(); ok(l); });
    rl.once("close", () => { if (!lida) ok(null); });
  });
}

/**
 * Os argumentos do job, conferidos: só o que o processo quente atende (linha do tempo, placa, sem alfa). Na prévia
 * (S07, `--esperar --previa`, só o cli/previa.ts abre assim; o `--esperar` sozinho continua sem gravar), o job pode gravar quadros (--gravar) e
 * trazer «ordem», a lista dos quadros a desenhar (o M04_ORDEM do captura/main.ts: só esses, nessa ordem, cada salto
 * precedido do N − 1 sem captura, P10.4).
 */
export function lerJob(linha: string, { previa = false } = {}): Argumentos & { ordem: string | null } {
  let j: unknown;
  try { j = JSON.parse(linha); } catch { throw new ErroDeUso("job: linha JSON inválida"); }
  const argv = (j as { argumentos?: unknown })?.argumentos;
  if (!Array.isArray(argv) || !argv.every((x) => typeof x === "string")) throw new ErroDeUso('job: falta «argumentos», lista de textos');
  const a = lerArgumentos(argv);
  if (a.modo === "cpu" || a.alfa) throw new ErroDeUso("--esperar só atende o modo placa sem --alfa");
  if (a.manter || (a.gravar.length && !previa)) throw new ErroDeUso("--esperar não atende --gravar nem --manter");
  const ordem = (j as { ordem?: unknown }).ordem ?? null;
  if (ordem !== null) {
    if (!previa) throw new ErroDeUso("job: «ordem» só na prévia (--esperar --previa)");
    const total = a.entrada.declaracao.quadros;
    if (typeof ordem !== "string" || !/^\d+(,\d+)*$/.test(ordem) || ordem.split(",").some((n) => Number(n) >= total)) {
      throw new ErroDeUso(`job: «ordem» é a lista de quadros separados por vírgula, de 0 a ${total - 1}: ${JSON.stringify(ordem)}`);
    }
  }
  return { ...a, ordem };
}

/**
 * Abre tudo, avisa «pronto», espera o job e devolve o que o render precisa. Sai do processo (com o código do frio) se
 * a abertura falha ou o stdin fecha sem job.
 */
export async function esperarJob(d: Dependencias, { previa = false } = {}): Promise<{ a: Argumentos; e: Escolha; r: Recursos; tmp: string; aberto: Aberto }> {
  const r = new Recursos();
  r.aoSinal();
  const ms: Record<string, number> = {};
  let t = performance.now();
  const marcar = (nome: string) => { const agora = performance.now(); ms[nome] = Math.round(agora - t); t = agora; };
  let e: Escolha;
  try { e = escolherModo("placa", d.sondar); } catch (erro) {
    if (erro instanceof ErroDeUso) sair(erro.codigo, erro.message);
    throw erro;
  }
  marcar("sonda");
  const tmp = r.pasta("motor-render-");
  let aberto: Aberto;
  try {
    const wayland = await d.subirWeston(r, tmp);
    marcar("weston");
    const env = { ...process.env as Record<string, string>, ...d.placaEnv, WAYLAND_DISPLAY: wayland,
      MOTOR_ESPERA_MAIN: join(CAMINHOS.captura, "main.ts") };
    // P02: o navegador-em-espera.ts no Node com os ganchos do CEF (como o frio, cli/render.ts).
    if (process.env.HOME && !env.NODE_COMPILE_CACHE) env.NODE_COMPILE_CACHE = join(process.env.HOME, ".cache", "motor-video", "node-compilado");
    const p = r.iniciar(process.execPath, ["--import", CAMINHOS.ganchosCef, ESPERA, "--no-sandbox", ...d.flags(e)], { env, stdio: ["pipe", "pipe", "pipe"] });
    await new Promise<void>((ok, falha) => {
      const log: string[] = [];
      let resto = "";
      const relogio = setTimeout(() => falha(new Error(`o navegador não abriu em ${LIMITE_ABERTURA_MS / 1000} s:\n${log.slice(-8).join("\n")}`)), LIMITE_ABERTURA_MS);
      const fim = () => { clearTimeout(relogio); p.stdout!.off("data", ler); p.stderr!.off("data", guardar); p.off("close", morreu);
        // Parados até o render ligar os ouvintes dele: nada do que o navegador disser depois se perde.
        p.stdout!.pause(); p.stderr!.pause(); };
      const ler = (x: Buffer) => {
        const partes = (resto + x).split("\n"); resto = partes.pop()!;
        for (const l of partes) { log.push(l); if (l === "espera: pronto") { fim(); ok(); return; } }
      };
      const guardar = (x: Buffer) => { log.push(...String(x).split("\n").filter(Boolean)); };
      const morreu = (c: number | null, s: string | null) => { fim(); falha(new Error(`o navegador saiu (${c ?? s}) antes de abrir:\n${log.slice(-8).join("\n")}`)); };
      p.stdout!.on("data", ler); p.stderr!.on("data", guardar); p.on("close", morreu);
    });
    marcar("navegador");
    aberto = {
      wayland,
      entregar: (vars) => { p.stdin!.end(`${JSON.stringify(vars)}\n`); return p; },
    };
  } catch (erro) {
    await r.liberar();
    return sair(1, (erro as Error).message);
  }
  process.stdout.write(`${JSON.stringify({ evento: "pronto", ms })}\n`);
  const linha = await linhaDoStdin();
  if (linha === null) { await r.liberar(); return sair(0); }
  try {
    const { ordem, ...a } = lerJob(linha, { previa });
    // O render passa o ambiente deste processo à captura (cli/render.ts, renderizar).
    if (ordem) process.env.M04_ORDEM = ordem; else delete process.env.M04_ORDEM;
    return { a, e, r, tmp, aberto };
  } catch (erro) {
    await r.liberar();
    if (erro instanceof ErroDeUso) return sair(2, erro.message);
    throw erro;
  }
}
