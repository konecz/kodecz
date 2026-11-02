// Instalação em um passo (P03). Entrada: ./instalar.sh na raiz (confere o Node e chama este arquivo).
//   node instalar/instalar.ts [--verificar] [--sistema] [--sem-render]
// Confere os pré-requisitos do sistema (instalar/sistema.ts), faz o que não pede sudo (instalar/etapas.ts e
// instalar/navegador.ts, idempotentes por hash), sonda a placa e renderiza a composição sintética de verificação na
// placa (duas vezes, iguais quadro a quadro: R03) e na CPU. No fim diz `ready` ou o que falta, com o comando.
//   --verificar   só confere (não instala nem renderiza; a sonda da placa roda, ela não muda nada)
//   --sistema     instala os pacotes do apt que faltam, pedindo sudo (sem isso, só imprime o comando)
//   --sem-render  pula o render de verificação
// Saída: 0 ready; 1 falta algo (a lista diz o quê); 2 argumento inválido.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { INSTALACAO as C } from "./caminhos.ts";
import { ambienteSistema, comandoApt, conferirSistema } from "./sistema.ts";
import { etapaConferencia, etapaNativo, etapaNpm, type Executar, rodarEtapas } from "./etapas.ts";
import { avisoSandbox, etapasDoNavegador } from "./navegador.ts";

const escrever = (linha: string) => process.stdout.write(`${linha}\n`);
const LOGS = join(C.raiz, "tmp", "logs", "instalar");

/** Executor de verdade: a saída longa (npm, cargo) vai para tmp/logs/instalar/; na falha, o erro traz o fim dela. */
const executar: Executar = (comando, args, { cwd, env }) => {
  mkdirSync(LOGS, { recursive: true });
  const nome = `${new Date().toISOString().replace(/[:.]/g, "-")}-${comando.split("/").pop()}.log`;
  const r = spawnSync(comando, args, { cwd, env: env ?? process.env, encoding: "utf8", maxBuffer: 1 << 28 });
  const texto = `$ ${comando} ${args.join(" ")}  (em ${cwd})\n${r.stdout ?? ""}${r.stderr ?? ""}`;
  writeFileSync(join(LOGS, nome), texto);
  if (r.error || r.status !== 0) {
    const fim = texto.trim().split("\n").slice(-15).join("\n");
    throw new Error(`${comando.split("/").pop()} ${args.join(" ")} exited with ${r.error?.message ?? r.status} (log: ${join(LOGS, nome)})\n${fim}`);
  }
};

function lerOpcoes() {
  try {
    return parseArgs({ options: { verificar: { type: "boolean" }, sistema: { type: "boolean" }, "sem-render": { type: "boolean" },
      ajuda: { type: "boolean", short: "h" }, help: { type: "boolean" } } }).values;
  } catch (erro) {
    process.stderr.write(`error: ${(erro as Error).message}\nusage: ./instalar.sh [--verificar] [--sistema] [--sem-render]\n`);
    process.exit(2);
  }
}

/** Render curto da composição sintética: o erro (ou null) e o framemd5 de cada quadro do MP4. */
function renderVerificacao(modo: "placa" | "cpu", saida: string): { erro: string | null; hashes: string[] } {
  const r = spawnSync(process.execPath, [C.render, C.verificacao.entrada, C.verificacao.composicao, saida, `--${modo}`],
    { encoding: "utf8", timeout: 180000, killSignal: "SIGKILL" });
  if (r.status !== 0) return { erro: (r.stderr || r.error?.message || `exited with ${r.status}`).trim().split("\n").slice(-3).join(" | "), hashes: [] };
  const f = spawnSync("ffmpeg", ["-v", "error", "-i", saida, "-map", "0:v", "-f", "framemd5", "-"], { encoding: "utf8" });
  const hashes = f.stdout.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").pop()!.trim());
  if (hashes.length !== C.verificacao.quadros) return { erro: `${hashes.length} frames in the MP4, expected ${C.verificacao.quadros}`, hashes };
  return { erro: null, hashes };
}

async function principal() {
  const o = lerOpcoes();
  if (o.ajuda || o.help) { escrever("usage: ./instalar.sh [--verificar] [--sistema] [--sem-render]\n  --verificar   only check what is missing (installs and renders nothing)\n  --sistema     also install the missing apt packages (asks for sudo)\n  --sem-render  skip the verification render"); return; }
  const verificar = o.verificar === true;
  const faltas: string[] = [];
  const avisos: string[] = [];

  escrever(`kodecz: ${verificar ? "checking" : "installing"} in ${C.raiz}`);
  escrever("\nsystem");
  const ambiente = ambienteSistema(C.raiz);
  let s = conferirSistema(ambiente);
  // Fora do Debian/Ubuntu (Fedora, Arch…): os nomes dos pacotes são os do Debian e o --sistema não tem como instalar.
  const semApt = ambiente.comando("apt-get") === null;
  const linhaPacotes = () => semApt
    ? `no apt-get on this machine: install the equivalents of these Debian packages with your distribution's package manager:\n    → ${s.pacotes.join(" ")}`
    : `missing system packages (or run ./instalar.sh --sistema):\n    → ${comandoApt(s.pacotes, ambiente.uid).join(" ")}`;
  if (s.pacotes.length && o.sistema && !verificar && semApt) escrever("✗ --sistema: no apt-get, the installer cannot install packages on this distribution");
  if (s.pacotes.length && o.sistema && !verificar && !semApt) {
    const apt = comandoApt(s.pacotes, ambiente.uid);
    escrever(`… installing packages: ${apt.join(" ")}`);
    const sudo = ambiente.uid === 0 ? [] : ["sudo"];
    const atualizar = spawnSync([...sudo, "apt-get"][0], [...sudo, "apt-get", "update"].slice(1), { stdio: "inherit" });
    const instalar = atualizar.status === 0 ? spawnSync(apt[0], apt.slice(1), { stdio: "inherit" }) : atualizar;
    if (instalar.status !== 0) escrever(`✗ apt exited with ${instalar.status}`);
    s = conferirSistema(ambienteSistema(C.raiz)); // ambiente novo: o cache do ldconfig mudou com o apt
  }
  for (const f of s.faltas) escrever(`${f.bloqueia ? "✗" : "!"} ${f.oQue}${f.comando && !f.comando.startsWith("apt: ") ? `\n    → ${f.comando}` : ""}`);
  if (s.pacotes.length) escrever(`  ${linhaPacotes()}`);
  if (!s.faltas.length) escrever("✓ all in place");
  for (const f of s.faltas) {
    if (f.comando?.startsWith("apt: ")) continue;
    (f.bloqueia ? faltas : avisos).push(f.comando ? `${f.oQue} → ${f.comando}` : f.oQue);
  }
  if (s.pacotes.length) faltas.unshift(semApt ? `system packages (Debian names) → ${s.pacotes.join(" ")}` : `system packages → ${comandoApt(s.pacotes, ambiente.uid).join(" ")}`);
  const bloqueado = s.faltas.some((f) => f.bloqueia);
  if (bloqueado && !verificar) {
    escrever("\nthe system is not ready: fix the items above and run again (nothing was installed)");
    process.exitCode = 1;
    return;
  }

  escrever("\nkodecz (no sudo)");
  const [captura, conf] = C.pacotesNpm;
  const { conferirModelo } = await import("../conferencia/rosto.ts");
  const { RETRATO } = await import("../conferencia/preparar.ts");
  const fix = join(C.conferencia.pasta, "fixtures");
  const fixturesComRosto = () => existsSync(RETRATO.reduzido) && readdirSync(fix, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(fix, d.name, "index.html")))
    .every((d) => existsSync(join(fix, d.name, "rosto.jpg")) && existsSync(join(fix, d.name, "rosto.mp4")))
    ? null : "the test portrait is missing from the check compositions";
  const etapas = [
    etapaNpm(captura.nome, captura.pasta, executar),
    ...etapasDoNavegador(C.electron, C.cef, s, executar),
    etapaNpm(conf.nome, conf.pasta, executar),
    etapaConferencia(C.conferencia, () => conferirModelo() ?? fixturesComRosto(), executar),
    etapaNativo(C.nativo, s, executar),
  ];
  const r = await rodarEtapas(etapas, { verificar, avisar: (l) => escrever(l) });
  faltas.push(...r.faltas);
  const sandbox = existsSync(C.electron.original) ? avisoSandbox(C.electron.original) : null;
  if (sandbox) avisos.push(sandbox);

  escrever("\nGPU and render");
  if (r.faltas.length) escrever("– skipped: kodecz is not fully installed");
  else {
    const { sondarPlaca } = await import("../cli/regras.ts");
    const { ambienteReal } = await import("../cli/render.ts");
    // P02: a placa pela captura do render (o CEF).
    const sonda = sondarPlaca(ambienteReal());
    if (sonda.ok) escrever(`✓ GPU: Vulkan and NVENC open on ${sonda.renderNode}`);
    else {
      escrever(`${sonda.ausente ? "!" : "✗"} GPU: ${sonda.motivo}`);
      (sonda.ausente ? avisos : faltas).push(`GPU: ${sonda.motivo}`);
    }
    if (!verificar && !o["sem-render"]) {
      if (!process.env.XDG_RUNTIME_DIR) faltas.push("XDG_RUNTIME_DIR is empty (weston needs it; run in a user session)");
      const pasta = mkdtempSync(join(tmpdir(), "motor-instalar-"));
      try {
        const cpu = renderVerificacao("cpu", join(pasta, "cpu.mp4"));
        escrever(cpu.erro ? `✗ CPU render: ${cpu.erro}` : `✓ CPU render: ${cpu.hashes.length} frames`);
        if (cpu.erro) faltas.push(`CPU render: ${cpu.erro}`);
        if (sonda.ok) {
          const a = renderVerificacao("placa", join(pasta, "placa-1.mp4"));
          const b = a.erro ? a : renderVerificacao("placa", join(pasta, "placa-2.mp4"));
          const iguais = !a.erro && !b.erro && a.hashes.join() === b.hashes.join();
          const erro = a.erro ?? b.erro ?? (iguais ? null : "two GPU renders came out different (R03)");
          escrever(erro ? `✗ GPU render: ${erro}` : `✓ GPU render: ${a.hashes.length} frames, two renders identical frame by frame (R03)`);
          if (erro) faltas.push(`GPU render: ${erro}`);
        }
      } finally { rmSync(pasta, { recursive: true, force: true }); }
    }
  }

  escrever("");
  for (const a of avisos) escrever(`warning: ${a}`);
  if (faltas.length) {
    escrever(`${verificar ? "missing" : "not ready; missing"}:`);
    for (const f of faltas) escrever(`  - ${f.split("\n")[0]}`);
    process.exitCode = 1;
  } else escrever(verificar ? "everything is installed" : `ready${s.placa ? "" : " (CPU mode only: see the warnings)"}`);
}

await principal();
