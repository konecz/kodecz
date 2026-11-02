#!/usr/bin/env node
// The `kodecz` command: `kodecz render|preview|check …` runs cli/render.ts, cli/previa.ts or cli/conferir.ts in this
// same process, with the rest of the arguments. It is the `bin` of package.json (`npm link` or `npm i -g .` in a clone).
// The original Portuguese subcommand names (previa, conferir) still work.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ErroDeUso } from "./regras.ts";

const COMANDOS: Record<string, string> = {
  render: "render.ts", preview: "previa.ts", check: "conferir.ts",
  // Deprecated: the original names.
  previa: "previa.ts", conferir: "conferir.ts",
};

export const USO = `usage: kodecz <command> [arguments]

  render <folder> <composition> <out.mp4>   render the composition to an MP4 (GPU or CPU)
  preview <folder> <composition> --frame N  one or more frames as PNG, in one to two seconds
  check <folder> <composition>              check every frame (text over a face, captions, contrast…) without rendering

  kodecz <command> --help   the options of each command
  kodecz --version          the version

A composition is a folder with index.html and its <script type="application/json" id="kodecz"> block:
docs/formatos/linha-do-tempo.md.`;

/** The script of the subcommand and its arguments. Throws ErroDeUso (code 0 for --help, 2 for a usage error). */
export function resolverComando(argv: string[]): { script: string; args: string[] } {
  const [comando, ...args] = argv;
  if (comando === undefined) throw new ErroDeUso(USO);
  if (comando === "-h" || comando === "--help" || comando === "help") throw new ErroDeUso(USO, 0);
  const script = Object.hasOwn(COMANDOS, comando) ? COMANDOS[comando] : null;
  if (!script) throw new ErroDeUso(`unknown command «${comando}»: use render, preview, check\n\n${USO}`);
  return { script, args };
}

async function principal() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--version" || argv[0] === "-v") {
    const pacote = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    process.stdout.write(`kodecz ${pacote.version}\n`);
    return;
  }
  let c;
  try { c = resolverComando(argv); } catch (erro) {
    if (erro instanceof ErroDeUso) {
      (erro.codigo === 0 ? process.stdout : process.stderr).write(`${erro.codigo === 0 ? "" : "error: "}${erro.message}\n`);
      process.exit(erro.codigo);
    }
    throw erro;
  }
  // Each command runs its main function when it is the script Node started (process.argv[1]): it becomes that script.
  const script = realpathSync(fileURLToPath(new URL(`./${c.script}`, import.meta.url)));
  process.argv = [process.argv[0], script, ...c.args];
  await import(script);
}

const proprio = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (import.meta.url === `file://${proprio}`) await principal();
