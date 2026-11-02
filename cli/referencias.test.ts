// Testes dos quadros de referência (S05): o PNG sem perda, a régua do R03, a amostragem pela linha do tempo e o
// comando `cli/referencias.ts` de ponta a ponta com a composição sintética (R01), na placa quando a sonda a acha e na
// CPU senão. Rodar: node --test "cli/*.test.ts"
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAMINHOS, sondarPlaca } from "./regras.ts";
import { ambienteReal } from "./render.ts";
import { amostrar, dePng, dentroDaRegua, diferenca, marcosDaLinha, paraPng, REGUA_CRUZADA, REGUA_R03 } from "./quadros.ts";

const CLI = new URL("./referencias.ts", import.meta.url).pathname;
const FIXTURE = new URL("./fixtures/linha-sintetica", import.meta.url).pathname;
const pasta = mkdtempSync(join(tmpdir(), "s05-referencias-"));
after(() => rmSync(pasta, { recursive: true, force: true }));
const falta = [CAMINHOS.hostCef].filter((p) => !existsSync(p));
const semRender = falta.length ? `falta ${falta.join(", ")} (captura/cef/montar.sh)` : false;
const placa = semRender ? null : sondarPlaca(ambienteReal());
const MODO = placa?.ok ? "placa" : "cpu";

type Rodada = { codigo: number | null; erro: string; json: any };
function rodar(args: string[]): Rodada {
  const p = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
  let json = null;
  try { json = JSON.parse(p.stdout.trim().split("\n").pop() ?? ""); } catch {}
  return { codigo: p.status, erro: p.stderr, json };
}
/** Cópia da fixture, com `troca` aplicada ao index.html. */
function copia(nome: string, troca?: [string, string]) {
  const destino = join(pasta, nome);
  cpSync(FIXTURE, destino, { recursive: true });
  if (troca) mudar(destino, troca);
  return destino;
}
function mudar(destino: string, [de, para]: [string, string]) {
  const html = readFileSync(join(destino, "index.html"), "utf8");
  assert.ok(html.includes(de), `a fixture não tem «${de}»`);
  writeFileSync(join(destino, "index.html"), html.replace(de, para));
}

// ---- Funções puras ----

test("PNG: ida e volta exata do BGRA pré-multiplicado, com todo alfa, e o ffmpeg lê o mesmo RGBA", () => {
  const L = 256, A = 64, bgra = Buffer.alloc(L * A * 4);
  let semente = 7;
  const aleatorio = () => (semente = (semente * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < bgra.length; i += 4) {
    const a = (i / 4) % 256; // todos os alfas, de 0 a 255
    for (let k = 0; k < 3; k++) bgra[i + k] = Math.floor(aleatorio() * (a + 1));
    bgra[i + 3] = a;
  }
  const png = paraPng(bgra, L, A);
  const volta = dePng(png);
  assert.deepEqual([volta.largura, volta.altura], [L, A]);
  assert.ok(volta.bgra.equals(bgra), "a volta do PNG mudou o quadro");
  // Leitor de fora: o RGBA do ffmpeg é o alfa direto que escrevemos.
  const arquivo = join(pasta, "teste.png");
  writeFileSync(arquivo, png);
  const ff = spawnSync("ffmpeg", ["-v", "error", "-i", arquivo, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 24 });
  assert.equal(ff.status, 0, String(ff.stderr));
  for (let i = 0; i < bgra.length; i += 4) {
    const a = bgra[i + 3];
    assert.equal(ff.stdout[i + 3], a);
    if (a) assert.equal(Math.round((ff.stdout[i] * a) / 255), bgra[i + 2], `pixel ${i / 4}`);
  }
});

test("PNG: recusa quadro que não é pré-multiplicado (cor maior que o alfa)", () => {
  assert.throws(() => paraPng(Buffer.from([200, 0, 0, 100]), 1, 1), /não é pré-multiplicado/);
  assert.throws(() => paraPng(Buffer.alloc(12), 2, 2), /esperado 2×2×4/);
});

test("régua do R03: até 2 níveis e SSIM ≥ 0,999; a cruzada (placa × CPU) só olha o SSIM sobre preto", () => {
  const a = Buffer.from([10, 20, 30, 255, 0, 0, 0, 255]), b = Buffer.from([10, 23, 30, 255, 0, 0, 0, 255]);
  assert.deepEqual(diferenca(a, b), { nivel: 3, pixels: 1 });
  assert.deepEqual(diferenca(a, a), { nivel: 0, pixels: 0 });
  assert.equal(dentroDaRegua({ nivel: 2, ssim: 0.999 }, REGUA_R03), true);
  assert.equal(dentroDaRegua({ nivel: 3, ssim: 1 }, REGUA_R03), false);
  assert.equal(dentroDaRegua({ nivel: 1, ssim: 0.998 }, REGUA_R03), false);
  assert.equal(dentroDaRegua({ nivel: 60, ssim: 0.998 }, REGUA_CRUZADA), true);
  assert.equal(REGUA_CRUZADA.fundo, "black");
});

test("marcos da linha do tempo: início e fim das animações literais da fixture, sem as infinitas nem as calculadas", () => {
  // pulso 30 ms (0, 1); título CSS 1 s com 0,2 s de atraso (6, 36); caixa animate 1200 ms com 300 de atraso (9, 45).
  // As tarjas (infinitas, com duração em variável) ficam de fora.
  assert.deepEqual(marcosDaLinha(readFileSync(join(FIXTURE, "index.html"), "utf8"), 30, 60), [0, 1, 6, 9, 36, 45]);
  const html = `<style>.a { animation: x 500ms ease 1s 2, y 2s linear infinite; }
    .b { animation-name: z; animation-duration: 0.5s; animation-delay: 100ms; }</style>
    <div style="animation: w 10s"></div><!-- <style>.c { animation: c 1s 3s; }</style> -->
    <script>el.animate([{ opacity: 0 }], 400); el.animate([{ opacity: 0 }], { duration: d, delay: 100 });</script>`;
  // .a: 1000…2000 ms (30, 60); .b: 100…600 (3, 18); w: 0…10000 (0, último = 89); animate 400 (0, 12).
  assert.deepEqual(marcosDaLinha(html, 30, 90), [0, 3, 12, 18, 30, 60, 89]);
});

test("amostragem: primeiro, último, um a cada N e os marcos, sem repetir", () => {
  assert.deepEqual(amostrar(60, 30, [6, 36, 59, 99]), [0, 6, 30, 36, 59]);
  assert.deepEqual(amostrar(1, 30), [0]);
});

// ---- Comando, de ponta a ponta ----

test("uso: sem subcomando, subcomando errado e referência ausente saem com 2, sem render", () => {
  const r = rodar([]);
  assert.equal(r.codigo, 2);
  assert.match(r.erro, /uso: node cli\/referencias.ts/);
  assert.equal(rodar(["apagar", FIXTURE]).codigo, 2);
  const sem = rodar(["conferir", copia("sem-referencias")]);
  assert.equal(sem.codigo, 2);
  assert.match(sem.erro, /sem referências .*aprovar/);
  assert.doesNotMatch(sem.erro, /renderizando/);
  assert.match(rodar(["aprovar", FIXTURE, "--lista", "0,x"]).erro, /--lista/);
  assert.equal(rodar(["aprovar", FIXTURE, "--lista", "60"]).codigo, 2, "quadro fora da composição");
  // A entrada do Remotion saiu do motor (2026-10-31): pacote sem o bloco motor-video é recusado com o motivo.
  const pacote = join(pasta, "pacote-remotion");
  mkdirSync(pacote);
  writeFileSync(join(pacote, "index.html"), "<!doctype html>");
  const remotion = rodar(["aprovar", pacote, "Sintetica"]);
  assert.equal(remotion.codigo, 2);
  assert.match(remotion.erro, /Remotion projects are no longer accepted.*linha-do-tempo\.md/);
  assert.match(rodar(["aprovar", FIXTURE, "--props", "{}"]).erro, /props/);
});

const aprovada = copia("aprovada");

test(`aprovar a fixture (${MODO}): amostragem automática, PNG por quadro e referencias.json; conferir passa`, { skip: semRender }, () => {
  const a = rodar(["aprovar", aprovada, `--${MODO}`, "--por", "teste"]);
  assert.equal(a.codigo, 0, a.erro);
  assert.equal(a.json.modo, MODO);
  // 0 e 59 (primeiro e último), a cada 30 (qps), e os marcos 1, 6, 9, 36 e 45 das animações.
  assert.deepEqual(a.json.quadros, [0, 1, 6, 9, 30, 36, 45, 59]);
  const dir = join(aprovada, "referencias", "LinhaSintetica");
  assert.equal(a.json.pasta, dir);
  const ref = JSON.parse(readFileSync(join(dir, "referencias.json"), "utf8"));
  assert.equal(ref.composicao, "LinhaSintetica");
  assert.deepEqual([ref.largura, ref.altura, ref.formatoEntrada], [960, 540, "linha"]);
  const m = ref.modos[MODO];
  assert.equal(m.aprovadoPor, "teste");
  assert.match(m.motor, /^[0-9a-f]{7,}/);
  assert.ok(!Number.isNaN(Date.parse(m.data)));
  assert.deepEqual(m.quadros.map((q: any) => q.n), a.json.quadros);
  for (const q of m.quadros) {
    assert.match(q.sha256, /^[0-9a-f]{64}$/);
    assert.equal(readFileSync(join(dir, q.arquivo)).length, q.bytes);
  }
  assert.deepEqual(readdirSync(dir).sort(), ["referencias.json", ...m.quadros.map((q: any) => q.arquivo)].sort());

  const c = rodar(["conferir", aprovada, `--${MODO}`]);
  assert.equal(c.codigo, 0, c.erro);
  assert.equal(c.json.ok, true);
  assert.deepEqual([c.json.comparados, c.json.iguais, c.json.falhas.length], [8, 8, 0]);
  assert.deepEqual(c.json.regua, REGUA_R03);
});

test("mudança visível (cor do título): conferir falha só nos quadros em que o título aparece, com a imagem da diferença", { skip: semRender }, () => {
  const destino = copia("titulo");
  cpSync(join(aprovada, "referencias"), join(destino, "referencias"), { recursive: true });
  mudar(destino, ["color: #fff;", "color: #ffd400;"]);
  const diferencas = join(pasta, "diferencas-titulo");
  const c = rodar(["conferir", destino, `--${MODO}`, "--diferencas", diferencas]);
  assert.equal(c.codigo, 1, c.erro);
  assert.equal(c.json.ok, false);
  // O título entra no quadro 6 com opacidade 0 (invisível) e aparece do 9 em diante.
  assert.deepEqual(c.json.falhas.map((f: any) => f.n), [9, 30, 36, 45, 59]);
  for (const f of c.json.falhas) {
    assert.ok(f.nivel > 2 && f.pixels > 100 && f.ssim < 1, JSON.stringify(f));
    const img = dePng(readFileSync(f.diferenca));
    assert.deepEqual([img.largura, img.altura], [960, 540]);
    assert.ok(existsSync(f.atual));
  }
  assert.match(c.erro, /regressão: 5 de 8 quadros/);
  assert.match(c.erro, /quadro 9:/);
});

test("mudança de 1 nível no fundo (dentro da régua do R03): conferir passa e conta os quadros diferentes", { skip: semRender }, () => {
  const destino = copia("um-nivel");
  cpSync(join(aprovada, "referencias"), join(destino, "referencias"), { recursive: true });
  mudar(destino, ["background: #10163a;", "background: #10163b;"]);
  const c = rodar(["conferir", destino, `--${MODO}`]);
  assert.equal(c.codigo, 0, c.erro);
  assert.equal(c.json.iguais, 0);
  assert.equal(c.json.dentroDaRegua, 8);
  assert.equal(c.json.maiorNivel, 1);
  assert.ok(c.json.menorSsim >= 0.999);
});

test("modo diferente da referência: sem --cruzado sai com 2; com --cruzado usa a régua cruzada (SSIM sobre preto)", { skip: semRender }, () => {
  const outro = MODO === "placa" ? "cpu" : "placa";
  if (outro === "placa") return; // sem placa, não há o que cruzar (a CPU sempre existe; a recíproca, não)
  const r = rodar(["conferir", aprovada, `--${outro}`]);
  assert.equal(r.codigo, 2);
  assert.match(r.erro, /referências só do modo placa.*--cruzado/);
  const c = rodar(["conferir", aprovada, `--${outro}`, "--cruzado"]);
  assert.equal(c.codigo, 0, c.erro);
  assert.equal(c.json.modo, "cpu");
  assert.equal(c.json.modoReferencia, "placa");
  assert.deepEqual(c.json.regua, REGUA_CRUZADA);
  assert.ok(c.json.menorSsim >= REGUA_CRUZADA.ssim);
});
