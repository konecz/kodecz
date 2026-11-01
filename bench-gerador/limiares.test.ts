// Kodecz Bench (P12): os limiares calibrados com fonte (docs/experimentos/2026-11-p12-calibrar-limiares.md), com a
// regra lida do especificacoes.json. Evidência sintética; a de loudness usa o ffmpeg na CPU (segundos, sem placa).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { avaliarRegra, foraDaFaixa } from "./motores.ts";
import { lerEspecificacoes } from "./provas.ts";

const es = lerEspecificacoes();
const QPS = 30, L = 1920, A = 1080;

/** Evidência mínima: um elemento de tela cheia com a escala de cada quadro. */
function comEscalas(escalas: number[], memoria?: { coleta?: number; render?: number }): any {
  const quadros = escalas.map((s) => ({ extra: { estilo: { vis: [[1, [L / 2 - (L * s) / 2, A / 2 - (A * s) / 2, L * s, A * s], 1]] } } }));
  return { tarefa: { qps: QPS, dim: { largura: L, altura: A } }, rotulos: {}, fonte: "", arquivos: {}, travou: false, console: [], mp4: null, antes: null, cache: new Map(),
    col: { decl: { qps: QPS, largura: L, altura: A, quadros: quadros.length }, falas: [], quadros, memoriaMB: memoria?.coleta }, col2: null,
    render: memoria?.render !== undefined ? { ok: true, memoriaMB: memoria.render } : null };
}
const parado = (seg: number, s = 1) => Array(Math.round(seg * QPS)).fill(s);
/** De s0 a s1 em `seg` segundos, com a curva `f` (0..1 → 0..1). */
const rampa = (s0: number, s1: number, seg: number, f = (x: number) => x) => Array.from({ length: Math.round(seg * QPS) }, (_, i) => s0 + (s1 - s0) * f((i + 1) / Math.round(seg * QPS)));

test("K-ACE-04: o zoom de ênfase curto dos aprovados passa; o zoom contínuo da errada não", () => {
  const r = es["K-ACE-04"].regra;
  // Como o mais forte dos aprovados: tela cheia de 1 a 1,69 em 0,67 s (com easing), parada e volta.
  const enfase = comEscalas([...parado(1), ...rampa(1, 1.69, 0.67, (x) => 1 - (1 - x) ** 3), ...parado(2, 1.69), ...rampa(1.69, 1, 0.67), ...parado(1)]);
  assert.equal(avaliarRegra(r, enfase).status, "certo");
  // Ken Burns lento: 1 a 1,1 em 5 s.
  assert.equal(avaliarRegra(r, comEscalas([...parado(0.5), ...rampa(1, 1.1, 5), ...parado(0.5)])).status, "certo");
  // A errada no grau «no» (g = 0,35): de 1 a 1,7 em 2 s, linear.
  assert.equal(avaliarRegra(r, comEscalas([...rampa(1, 1.7, 2), ...parado(1, 1.7)])).status, "erro");
  // O grau «abaixo» (g = 0,12): de 1 a 1,24 em 2 s.
  assert.equal(avaliarRegra(r, comEscalas([...rampa(1, 1.24, 2), ...parado(1, 1.24)])).status, "certo");
});

test("K-FER-10: o pico dos aprovados passa; o da errada não", () => {
  const r = es["K-FER-10"].regra;
  assert.equal(avaliarRegra(r, comEscalas(parado(1), { coleta: 889, render: 725 })).status, "certo");
  assert.equal(avaliarRegra(r, comEscalas(parado(1), { coleta: 3667, render: 470 })).status, "erro");
});

test("foraDaFaixa: 0 dentro, a distância à borda fora", () => {
  assert.equal(foraDaFaixa(-17, -20, -9), 0);
  assert.equal(foraDaFaixa(-20, -20, -9), 0);
  assert.equal(foraDaFaixa(-22.5, -20, -9), 2.5);
  assert.equal(foraDaFaixa(-6, -20, -9), 3);
});

test("K-AUD-02: seno de 1 kHz em estéreo (lê na loudness o nível de pico, EBU Tech 3341) dentro e fora da faixa", () => {
  const r = es["K-AUD-02"].regra, dir = mkdtempSync(join(tmpdir(), "kodecz-limiares-"));
  try {
    const status = (amp: number) => {
      const mp4 = join(dir, `${amp}.mp4`);
      const s = `${amp}*sin(2*PI*1000*t)`;
      const f = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `aevalsrc=${s}|${s}:s=48000:d=4`, "-c:a", "aac", "-b:a", "192k", mp4], { encoding: "utf8" });
      assert.equal(f.status, 0, f.stderr);
      return avaliarRegra(r, { ...comEscalas(parado(1)), mp4 }).status;
    };
    assert.equal(status(0.112), "certo"); // −19 LUFS, como os aprovados de fala
    assert.equal(status(0.1), "certo"); // −20,0 LUFS: o piso (a regra de antes, −14 ± 5, acusava)
    assert.equal(status(0.094), "erro"); // −20,5 LUFS, logo abaixo do piso
    assert.equal(status(0.05), "erro"); // −26 LUFS
    assert.equal(status(0.5), "erro"); // −6 LUFS
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
