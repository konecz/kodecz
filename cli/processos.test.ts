// Liberação de recursos do comando de render (M08): todo filho morre (o grupo inteiro, com os netos) e a pasta
// temporária some, no fim normal, no erro e no SIGTERM. Sem placa: os filhos são `sleep`.
// Rodar: node --test "cli/*.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grupoVivo, Recursos } from "./processos.ts";

const PROCESSOS = new URL("./processos.ts", import.meta.url).pathname;

test("liberar() mata o grupo inteiro (filho e neto) e apaga a pasta", async () => {
  const r = new Recursos();
  const pasta = r.pasta("m08-proc-");
  writeFileSync(join(pasta, "x"), "1");
  const p = r.iniciar("sh", ["-c", "sleep 60 & sleep 60"]);
  await new Promise((ok) => setTimeout(ok, 100));
  assert.equal(grupoVivo(p.pid!), true);
  await r.liberar();
  assert.equal(grupoVivo(p.pid!), false);
  assert.equal(existsSync(pasta), false);
});

test("filho que ignora SIGTERM leva SIGKILL depois da espera", async () => {
  const r = new Recursos({ espera: 200 });
  const p = r.iniciar("sh", ["-c", "trap '' TERM; sleep 60 & wait"]);
  await new Promise((ok) => setTimeout(ok, 100));
  const t0 = performance.now();
  await r.liberar();
  assert.equal(grupoVivo(p.pid!), false);
  assert.ok(performance.now() - t0 < 3000);
});

test("--manter: a pasta fica, os processos morrem igual", async () => {
  const r = new Recursos({ manter: true });
  const pasta = r.pasta("m08-proc-");
  const p = r.iniciar("sleep", ["60"]);
  await r.liberar();
  assert.equal(grupoVivo(p.pid!), false);
  assert.equal(existsSync(pasta), true);
  rmSync(pasta, { recursive: true, force: true });
});

test("arquivo parcial registrado é apagado no erro", async () => {
  const r = new Recursos();
  const pasta = mkdtempSync(join(tmpdir(), "m08-proc-"));
  const parcial = join(pasta, "saida.parcial.mp4");
  writeFileSync(parcial, "pela metade");
  r.parcial(parcial);
  await r.liberar();
  assert.equal(existsSync(parcial), false);
  rmSync(pasta, { recursive: true, force: true });
});

test("SIGTERM no processo que usa os Recursos: sai com 143, sem filho vivo nem pasta", async () => {
  const programa = `
    import { Recursos } from ${JSON.stringify(PROCESSOS)};
    const r = new Recursos(); r.aoSinal();
    const pasta = r.pasta("m08-sinal-");
    const p = r.iniciar("sh", ["-c", "sleep 60 & sleep 60"]);
    console.log(JSON.stringify({ pasta, pid: p.pid }));
    setInterval(() => {}, 1000);`;
  const filho = spawn(process.execPath, ["--input-type=module", "-e", programa], { stdio: ["ignore", "pipe", "inherit"] });
  const linha: string = await new Promise((ok) => filho.stdout.once("data", (d) => ok(String(d))));
  const { pasta, pid } = JSON.parse(linha);
  assert.equal(existsSync(pasta), true);
  assert.equal(grupoVivo(pid), true);
  const codigo = await new Promise((ok) => { filho.on("close", (c, s) => ok(c ?? s)); filho.kill("SIGTERM"); });
  assert.equal(codigo, 143);
  assert.equal(grupoVivo(pid), false);
  assert.equal(existsSync(pasta), false);
});

/** Sobe um processo que usa os Recursos com um filho que ignora SIGTERM (a liberação demora `espera` ms). */
async function filhoComRecursos(espera: number) {
  const programa = `
    import { Recursos } from ${JSON.stringify(PROCESSOS)};
    const r = new Recursos({ espera: ${espera} }); r.aoSinal();
    const pasta = r.pasta("m08-sinal-");
    const p = r.iniciar("sh", ["-c", "trap '' TERM INT; sleep 60 & wait"]);
    console.log(JSON.stringify({ pasta, pid: p.pid }));
    setInterval(() => {}, 1000);`;
  const filho = spawn(process.execPath, ["--input-type=module", "-e", programa], { stdio: ["ignore", "pipe", "pipe"] });
  const linha: string = await new Promise((ok) => filho.stdout.once("data", (d) => ok(String(d))));
  const fim: Promise<number | string | null> = new Promise((ok) => filho.on("close", (c, s) => ok(c ?? s)));
  return { filho, fim, ...JSON.parse(linha) as { pasta: string; pid: number } };
}

test("SIGINT: sai com 130, sem filho vivo nem pasta", async () => {
  const { filho, fim, pasta, pid } = await filhoComRecursos(300);
  filho.kill("SIGINT");
  assert.equal(await fim, 130);
  assert.equal(grupoVivo(pid), false);
  assert.equal(existsSync(pasta), false);
});

test("dois sinais seguidos: o segundo é ignorado até a liberação acabar (sem órfão)", async () => {
  const { filho, fim, pasta, pid } = await filhoComRecursos(800);
  filho.kill("SIGTERM");
  await new Promise((ok) => setTimeout(ok, 150)); // no meio da espera da liberação
  filho.kill("SIGINT");
  filho.kill("SIGTERM");
  assert.equal(await fim, 143);
  assert.equal(grupoVivo(pid), false, "o filho que ignora SIGTERM ficou órfão");
  assert.equal(existsSync(pasta), false);
});

// Regressão (S07): o sinal e o erro do filho morto chamam liberar() ao mesmo tempo; quem chamou por segundo e saía do
// processo logo depois (cli/abertura.ts, sair) cortava a liberação no meio e a temporária sobrava.
test("liberar() chamado de novo durante a liberação espera a mesma, até a pasta sumir", async () => {
  const r = new Recursos({ espera: 300 });
  const pasta = r.pasta("m08-proc-");
  r.iniciar("sh", ["-c", "trap '' TERM; sleep 60"]);
  await new Promise((ok) => setTimeout(ok, 100));
  const primeira = r.liberar();
  await r.liberar();
  assert.equal(existsSync(pasta), false, "a segunda voltou antes de a pasta sumir");
  await primeira;
});
