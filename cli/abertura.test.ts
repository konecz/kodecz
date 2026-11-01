// Testes da abertura rápida (cli/abertura.ts): o que o processo quente aceita como job e, na placa, o R03 (o mesmo
// hash em cada quadro decodificado no quente e no frio) e a liberação (nenhum processo sobra, com ou sem job).
// Rodar: node --test "cli/*.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lerJob } from "./abertura.ts";
import { ErroDeUso, CAMINHOS, sondarPlaca } from "./regras.ts";
import { ambienteReal } from "./render.ts";

const CLI = new URL("./render.ts", import.meta.url).pathname;
const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;
const SINTETICA = join(FIXTURES, "linha-sintetica");

test("job: só a linha do tempo na placa, sem --alfa, --gravar nem --manter; linha quebrada é erro de uso", () => {
  const job = (argumentos: unknown) => JSON.stringify({ argumentos });
  const a = lerJob(job(["--placa", "--sem-contencao", "--", SINTETICA, "LinhaSintetica", "/tmp/x.mp4"]));
  assert.equal(a.entrada.tipo, "linha");
  assert.equal(a.composicao, "LinhaSintetica");
  for (const [linha, re] of [
    ["{", /JSON/],
    [JSON.stringify({ argumentos: "x" }), /argumentos/],
    [job(["--cpu", SINTETICA, "LinhaSintetica", "/tmp/x.mp4"]), /modo placa/],
    [job(["--placa", "--gravar", "1", "--gravar-pasta", "/tmp/g", SINTETICA, "LinhaSintetica", "/tmp/x.mp4"]), /--gravar/],
    [job(["--placa", "--manter", SINTETICA, "LinhaSintetica", "/tmp/x.mp4"]), /--manter/],
    // A entrada do Remotion saiu do motor (2026-10-31): a pasta sem o bloco motor-video é recusada com o motivo.
    [job(["--placa", FIXTURES, "Sintetica", "/tmp/x.mp4"]), /linha do tempo/],
  ] as const) {
    assert.throws(() => lerJob(linha), (e: unknown) => e instanceof ErroDeUso && re.test(e.message), linha);
  }
});

// A reserva abre pelo CEF, a captura do motor (P02; desde 2026-10-31 a única).
const sonda = existsSync(CAMINHOS.hostCef) ? sondarPlaca(ambienteReal()) : null;
const semPlaca = !sonda ? "sem o host do CEF (captura/cef/montar.sh)" : !sonda.ok ? `placa não serve: ${sonda.motivo}` : false;

// A captura é sempre pelo CEF: o job que ainda pede --captura recebe o motivo.
test("job na reserva: --captura é recusado, com o motivo", () => {
  const job = (argumentos: unknown) => JSON.stringify({ argumentos });
  const args = ["--placa", "--", SINTETICA, "LinhaSintetica", "/tmp/x.mp4"];
  assert.equal(lerJob(job(args)).entrada.tipo, "linha");
  for (const extra of [["--captura", "electron"], ["--captura=cef"]]) {
    assert.throws(() => lerJob(job([...extra, ...args])), (e: unknown) => e instanceof ErroDeUso && /--captura saiu.*CEF/s.test(e.message));
  }
});


/** Processos com a marca no ambiente (o render, o weston, o navegador e os filhos herdam). */
function marcados(marca: string): number[] {
  const achados: number[] = [];
  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try { if (readFileSync(`/proc/${pid}/environ`, "latin1").split("\0").includes(`MOTOR_TESTE_ABERTURA=${marca}`)) achados.push(Number(pid)); } catch {}
  }
  return achados;
}

/** Sobe o quente, espera o «pronto» e entrega o job (null: fecha o stdin sem job). */
function quente(argumentos: string[] | null, marca: string, env: Record<string, string> = {}): Promise<{ codigo: number | null; pronto: any; resultado: any; erro: string }> {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [CLI, "--esperar"], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, MOTOR_TESTE_ABERTURA: marca, ...env } });
    let saida = "", erro = "", pronto: any = null;
    p.stderr.on("data", (d) => { erro += d; });
    p.stdout.on("data", (d) => {
      saida += d;
      const linhas = saida.split("\n");
      if (!pronto && linhas.length > 1) {
        pronto = JSON.parse(linhas[0]);
        if (argumentos) p.stdin.end(`${JSON.stringify({ argumentos })}\n`); else p.stdin.end();
      }
    });
    p.on("close", (codigo) => {
      let resultado = null;
      try { resultado = JSON.parse(saida.trim().split("\n").pop() ?? ""); } catch {}
      ok({ codigo, pronto, resultado, erro });
    });
  });
}
const md5s = (mp4: string) => execFileSync("ffmpeg", ["-v", "error", "-i", mp4, "-f", "framemd5", "-"], { encoding: "utf8" })
  .split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").pop()!.trim());

test("R03 no quente: o mesmo hash em cada quadro que o frio, e nenhum processo sobra", { skip: semPlaca }, async () => {
  const pasta = mkdtempSync(join(tmpdir(), "abertura-"));
  try {
    for (const [fixture, id, n] of [["linha-sintetica", "LinhaSintetica", 60], ["linha-parada", "LinhaParada", 0]] as const) {
      const entrada = join(FIXTURES, fixture);
      const frio = join(pasta, `${fixture}-frio.mp4`), q = join(pasta, `${fixture}-quente.mp4`);
      const f = spawnSync(process.execPath, [CLI, entrada, id, frio, "--placa", "--sem-contencao"], { encoding: "utf8" });
      assert.equal(f.status, 0, f.stderr);
      const marca = randomUUID();
      const r = await quente(["--placa", "--sem-contencao", "--", entrada, id, q], marca);
      assert.equal(r.codigo, 0, r.erro);
      assert.equal(r.pronto.evento, "pronto");
      assert.ok(r.pronto.ms.navegador >= 0 && r.pronto.ms.weston >= 0, JSON.stringify(r.pronto));
      assert.equal(r.resultado.ok, true);
      const a = md5s(frio), b = md5s(q);
      if (n) assert.equal(a.length, n);
      assert.ok(a.length > 0);
      assert.deepEqual(b, a, `${fixture}: o mesmo hash em cada quadro decodificado`);
      assert.deepEqual(marcados(marca), [], "processo que sobrou do quente");
      process.stderr.write(`R03 quente × frio: ${fixture}, ${a.length} quadros iguais (abertura ${JSON.stringify(r.pronto.ms)})\n`);
    }
  } finally { rmSync(pasta, { recursive: true, force: true }); }
});

test("quente sem job (stdin fechado) e job inválido: sai sem deixar processo nem pasta", { skip: semPlaca }, async () => {
  const marca = randomUUID();
  // TMPDIR só deste teste: os outros arquivos de teste renderizam em paralelo e criam motor-render-* no /tmp comum.
  const tmp = mkdtempSync(join(tmpdir(), "abertura-tmp-"));
  const env = { TMPDIR: tmp };
  const vazio = await quente(null, marca, env);
  assert.equal(vazio.codigo, 0, vazio.erro);
  assert.deepEqual(marcados(marca), []);
  const invalido = await quente(["--cpu", SINTETICA, "LinhaSintetica", "/tmp/x.mp4"], marca, env);
  assert.equal(invalido.codigo, 2);
  assert.match(invalido.erro, /modo placa/);
  assert.deepEqual(marcados(marca), []);
  const depois = readdirSync(tmp).filter((d) => d.startsWith("motor-render-"));
  rmSync(tmp, { recursive: true, force: true });
  assert.deepEqual(depois, [], "pasta temporária que sobrou");
});
