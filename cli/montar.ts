// `kodecz assemble <edit.json> <out-folder>`: the edit as data (docs/formatos/edicao.md) becomes a composition folder
// for `kodecz render` (edicao/montar.ts), then the blocks' DOM checks run on it (blocos/conferir-dom.ts) unless
// --no-check. stdout: one JSON line with the summary; warnings and findings on stderr.
// Codes: 0 done (warnings allowed); 1 error in the edit; 2 arguments; 4 the DOM check found a P0.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ErroDaEdicao, montarEdicao } from "../edicao/montar.ts";

export const USO_MONTAR = `usage: kodecz assemble <edit.json> <out-folder> [--no-check]

  Builds the composition folder (index.html, marca/, blocos/, midia/ links, edicao.resolvida.json) from an edit
  written as JSON: docs/formatos/edicao.md. Then runs the blocks' DOM checks on it (blocos/conferir-dom.ts).

  --no-check   skip the DOM check
  -h, --help   this help

Next: kodecz render <out-folder> <composicao.id> out.mp4`;

const CONFERIR_DOM = new URL("../blocos/conferir-dom.ts", import.meta.url).pathname;
const avisar = (t: string) => process.stderr.write(`kodecz assemble: ${t}\n`);

type Achado = { id: string; prioridade: string; quadro: number; onde: string; mensagem: string };

/** Runs the DOM check of the blocks on the folder; null when it could not run (the reason is warned). */
export function conferirDom(pasta: string): Achado[] | null {
  const r = spawnSync(process.execPath, [CONFERIR_DOM, pasta, "index.html"], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status === 0 || r.status === 1) {
    try { return JSON.parse(r.stdout).achados as Achado[]; } catch { /* falls through */ }
  }
  avisar(`warning: the DOM check could not run (exit ${r.status ?? r.signal}): ${(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" / ")}`);
  return null;
}

async function principal(argv: string[]): Promise<number> {
  let a;
  try {
    a = parseArgs({ args: argv, allowPositionals: true, options: { "no-check": { type: "boolean" }, help: { type: "boolean", short: "h" } } });
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n\n${USO_MONTAR}\n`);
    return 2;
  }
  if (a.values.help) { process.stdout.write(`${USO_MONTAR}\n`); return 0; }
  if (a.positionals.length !== 2) { process.stderr.write(`error: expected <edit.json> <out-folder>\n\n${USO_MONTAR}\n`); return 2; }
  const [edicao, saida] = a.positionals.map((p) => resolve(p));
  let r;
  try { r = await montarEdicao(edicao, saida); } catch (e) {
    if (e instanceof ErroDaEdicao) { process.stderr.write(`error: ${e.message}\n`); return 1; }
    throw e;
  }
  for (const x of r.avisos) avisar(`warning: ${x}`);
  const id = (r.resolvida.composicao as { id: string }).id;
  let achados: Achado[] | null = null;
  if (!a.values["no-check"]) {
    achados = conferirDom(saida);
    for (const x of (achados ?? []).slice(0, 30)) avisar(`${x.prioridade} ${x.id} frame ${x.quadro}: ${x.mensagem}`);
    if (achados && achados.length > 30) avisar(`… and ${achados.length - 30} more findings (all of them in the JSON on stdout)`);
  }
  const p0 = (achados ?? []).filter((x) => x.prioridade === "P0").length;
  process.stdout.write(`${JSON.stringify({ ok: p0 === 0, pasta: saida, composicao: id, quadros: r.quadros, avisos: r.avisos,
    conferencia: achados === null ? null : { achados: achados.length, p0 }, ...(achados?.length ? { achados } : {}),
    proximo: `kodecz render ${saida} ${id} out.mp4` })}\n`);
  return p0 ? 4 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await principal(process.argv.slice(2));
