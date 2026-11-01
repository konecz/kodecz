// S01: composições com GSAP e com Lottie na linha do tempo declarada (cli/fixtures/linha-gsap e linha-lottie). O
// cliente traz a biblioteca; nós não a versionamos (parecer jurídico, J5): o teste copia a fixture para uma pasta
// temporária junto com a biblioteca do cache local (cli/fixtures/bibliotecas.ts) e é pulado, com o comando para
// baixar, se ela não estiver lá. Cada quadro gravado tem de trazer N (ou o valor esperado) nas tarjas, e o quadro N
// tem de sair igual em ordem, começando no meio, embaralhado e depois de saltos (R03, P10.4).
// Rodar: node --test "cli/*.test.ts"
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAMINHOS, sondarPlaca } from "./regras.ts";
import { ambienteReal } from "./render.ts";
import { lerMarcaEm } from "../captura/faixa.ts";
import { bibliotecaDeTeste, fixtureComBiblioteca, type Biblioteca } from "./fixtures/bibliotecas.ts";

const CLI = new URL("./render.ts", import.meta.url).pathname;
const FIXTURES = new URL("./fixtures", import.meta.url).pathname;
const saidas = mkdtempSync(join(tmpdir(), "s01-gsap-lottie-"));
after(() => rmSync(saidas, { recursive: true, force: true }));
const falta = [CAMINHOS.hostCef].filter((p) => !existsSync(p));
const semRender = falta.length ? `falta ${falta.join(", ")} (captura/cef/montar.sh)` : false;
const placa = semRender ? null : sondarPlaca(ambienteReal());
const semPlaca = semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false);
const semBiblioteca = (nome: Biblioteca) => { const b = bibliotecaDeTeste(nome); return "falta" in b ? b.falta : false; };

function rodar(args: string[], env: Record<string, string> = {}): Promise<{ codigo: number | null; erro: string; json: any }> {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, MOTOR_DEPURAR: "1", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let saida = "", erro = "";
    p.stdout.on("data", (d) => { saida += d; });
    p.stderr.on("data", (d) => { erro += d; });
    p.on("close", (codigo) => {
      let json = null;
      try { json = JSON.parse(saida.trim().split("\n").pop() ?? ""); } catch {}
      ok({ codigo, erro, json });
    });
  });
}

/** [r, g, b] do pixel (x, y) de um quadro BGRA de 960 de largura. */
const pixel = (p: Buffer, x: number, y: number) => { const i = (y * 960 + x) * 4; return [p[i + 2], p[i + 1], p[i]]; };
const perto = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 8);
const FUNDO = [0x10, 0x16, 0x3a];
const TODOS = Array.from({ length: 60 }, (_, n) => n);

type Caso = { fixture: string; id: string; biblioteca: Biblioteca; arquivos: string[]; confere: (p: Buffer, n: number) => void };
const pastas = new Map<string, string>();
function pastaDo(c: Caso) {
  if (!pastas.has(c.fixture)) pastas.set(c.fixture, fixtureComBiblioteca(join(FIXTURES, c.fixture), join(saidas, c.fixture), c.biblioteca, c.arquivos));
  return pastas.get(c.fixture)!;
}

/** Renderiza, confere cada quadro gravado (caso.confere) e devolve o JSON e o hash de cada quadro, por N. */
async function render(c: Caso, nome: string, modo: string, quadros = TODOS, args: string[] = [], env: Record<string, string> = {}) {
  const saida = join(saidas, `${nome}.mp4`), gravados = join(saidas, `${nome}-q`);
  const r = await rodar([pastaDo(c), c.id, saida, modo, ...args, "--gravar", quadros.join(","), "--gravar-pasta", gravados], env);
  assert.equal(r.codigo, 0, r.erro);
  assert.equal(r.json.quadros, quadros.length);
  assert.doesNotMatch(r.erro, /aviso/, "nenhum aviso");
  const hashes = new Map<number, string>();
  for (const n of quadros) {
    const p = readFileSync(join(gravados, `motor-${n}.bgra`));
    c.confere(p, n);
    hashes.set(n, createHash("sha256").update(p).digest("hex"));
  }
  return { r, hashes };
}

/** R03 (P10.4): o mesmo hash, quadro a quadro, que o render inteiro em ordem: começando no 25, embaralhado e em saltos. */
async function conferirR03(c: Caso, nome: string, inteiro: Map<number, string>) {
  const confere = (outro: Map<number, string>, como: string) => {
    for (const [n, h] of outro) assert.equal(h, inteiro.get(n), `quadro ${n} ${como} difere do render inteiro`);
  };
  confere((await render(c, `${nome}-de`, "--placa", TODOS.slice(25, 45), ["--de", "25", "--quadros", "20"])).hashes, "começando no 25");
  confere((await render(c, `${nome}-embaralhado`, "--placa", TODOS, [], { M04_ORDEM: "embaralhada" })).hashes, "fora de ordem");
  const saltos = [40, 12, 2, 59, 0, 30];
  confere((await render(c, `${nome}-saltos`, "--placa", saltos, [], { M04_ORDEM: saltos.join(",") })).hashes, "depois de saltos");
}

// GSAP: a tarja da timeline pausada (y 524) e a do contador com onUpdate (y 508) trazem N; o tween de 30 ms só no 0
// (também voltando a ele depois que a raiz do GSAP o teria removido), o set no tempo 0 em todos e o set atrasado do 30
// em diante.
const GSAP: Caso = {
  fixture: "linha-gsap", id: "LinhaGsap", biblioteca: "gsap", arquivos: ["index.html"],
  confere: (p, n) => {
    assert.deepEqual([524, 508].map((y) => lerMarcaEm(p, 960, y + 8)), [n, n], `quadro ${n}: tarjas`);
    assert.ok(perto(pixel(p, 16, 16), n === 0 ? [255, 0, 0] : FUNDO), `pulso no quadro ${n}: ${pixel(p, 16, 16)}`);
    assert.ok(perto(pixel(p, 56, 16), [0, 255, 0]), `set no tempo 0, quadro ${n}: ${pixel(p, 56, 16)}`);
    assert.ok(perto(pixel(p, 96, 16), n >= 30 ? [0, 0, 255] : FUNDO), `set atrasado no quadro ${n}: ${pixel(p, 96, 16)}`);
  },
};

// Lottie: a 60 qps sem laço (N), loop true de 10 quadros (N mod 10), sem laço de 20 (para no 19) e loop 2 de 10 (três
// voltas, depois 9); o quadrado do quadrado.json (carregado por path) verde em todos.
const LOTTIE: Caso = {
  fixture: "linha-lottie", id: "LinhaLottie", biblioteca: "lottie", arquivos: ["index.html", "quadrado.json"],
  confere: (p, n) => {
    assert.deepEqual([524, 508, 492, 476].map((y) => lerMarcaEm(p, 960, y + 8)), [n, n % 10, Math.min(n, 19), n < 30 ? n % 10 : 9], `quadro ${n}: tarjas`);
    assert.ok(perto(pixel(p, 56, 16), [0, 255, 0]), `quadrado.json no quadro ${n}: ${pixel(p, 56, 16)}`);
  },
};

for (const [c, motivo, quantas] of [[GSAP, "GSAP", { gsap: 7, lottie: 0 }], [LOTTIE, "Lottie", { gsap: 0, lottie: 5 }]] as const) {
  test(`${motivo} na placa: quadro N, sem quadro repetido, e o mesmo quadro começando no meio e fora de ordem (S01, R03)`, { skip: semPlaca || semBiblioteca(c.biblioteca) }, async () => {
    const a = await render(c, `${c.fixture}-placa`, "--placa");
    assert.deepEqual(a.r.json.bibliotecas, quantas);
    // O motor não lê o que o GSAP ou o Lottie mudam: desenha todos os quadros (P10.3).
    assert.deepEqual([a.r.json.repetidos, a.r.json.repetirNao], [0, motivo]);
    assert.equal(a.r.json.aquecidos, 0);
    assert.ok(new Set(a.hashes.values()).size === 60, "os 60 quadros são distintos");
    await conferirR03(c, c.fixture, a.hashes);
  });

  test(`${motivo} na CPU: quadro N`, { skip: semRender || semBiblioteca(c.biblioteca) }, async () => {
    const a = await render(c, `${c.fixture}-cpu`, "--cpu");
    assert.deepEqual(a.r.json.bibliotecas, quantas);
  });
}

// O GSAP fora da window.gsap (módulo ES) andaria no relógio: o render cai com o motivo. A página simula o rastro que o
// GSAP deixa (window.gsapVersions) sem pôr a window.gsap; não precisa da biblioteca.
test("GSAP fora da window.gsap derruba o render com o motivo (S01)", { skip: semRender }, async () => {
  const pasta = join(saidas, "gsap-fora");
  mkdirSync(pasta);
  writeFileSync(join(pasta, "index.html"), `<!doctype html><meta charset="utf-8">
<script type="application/json" id="motor-video">{ "id": "GsapFora", "largura": 960, "altura": 540, "qps": 30, "quadros": 2 }</script>
<script>window.gsapVersions = ['3.15.0'];</script>`);
  const r = await rodar([pasta, "GsapFora", join(saidas, "gsap-fora.mp4"), "--cpu"]);
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /GSAP: a página usa o GSAP fora da window\.gsap/);
});

// O GSAP 2 (TweenMax/TweenLite) não passa pela window.gsap e andaria no relógio: recusado com o motivo.
test("GSAP 2 (TweenMax) derruba o render com o motivo (S01)", { skip: semRender }, async () => {
  const pasta = join(saidas, "gsap-2");
  mkdirSync(pasta);
  writeFileSync(join(pasta, "index.html"), `<!doctype html><meta charset="utf-8">
<script type="application/json" id="motor-video">{ "id": "Gsap2", "largura": 960, "altura": 540, "qps": 30, "quadros": 2 }</script>
<script>window.TweenMax = { version: '2.1.3' };</script>`);
  const r = await rodar([pasta, "Gsap2", join(saidas, "gsap-2.mp4"), "--cpu"]);
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /GSAP: GSAP 2 \(TweenMax\/TweenLite\) não é aceito/);
});
