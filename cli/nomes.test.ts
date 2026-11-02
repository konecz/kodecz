// Testes da interface em inglês: o comando `kodecz render|preview|check`, as opções e o bloco de declaração com os
// nomes em inglês, e os nomes antigos (em português) ainda aceitos. Sem placa nem navegador.
// Rodar: node --test cli/nomes.test.ts
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ID_BLOCO, ID_BLOCO_ANTIGO, OPCOES_PREVIA, OPCOES_CONFERIR, OPCOES_RENDER, traduzirOpcoes } from "./nomes.ts";
import { resolverComando } from "./kodecz.ts";
import { ErroDeUso, lerArgumentos, lerDeclaracao } from "./regras.ts";
import { lerOpcoesPrevia } from "./previa.ts";
import { lerArgumentosConferir } from "./conferir.ts";

const pasta = mkdtempSync(join(tmpdir(), "nomes-"));
after(() => rmSync(pasta, { recursive: true, force: true }));
const bloco = (id: string, d: unknown) => `<!doctype html>\n<script type="application/json" id="${id}">${JSON.stringify(d)}</script>`;
const comPagina = (html: string) => { const p = mkdtempSync(join(pasta, "c-")); writeFileSync(join(p, "index.html"), html); return p; };
const DECLARADA = { id: "L", largura: 960, altura: 540, qps: 30, quadros: 60 };
const falha = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: unknown) => e instanceof ErroDeUso && re.test(e.message));

test("bloco: id=\"kodecz\" com width, height, fps e frames", () => {
  assert.equal(ID_BLOCO, "kodecz");
  assert.deepEqual(lerDeclaracao(bloco("kodecz", { id: "L", width: 960, height: 540, fps: 30, frames: 60 })), DECLARADA);
});

test("bloco: os nomes antigos continuam valendo (id=\"motor-video\", largura, altura, qps, quadros)", () => {
  assert.equal(ID_BLOCO_ANTIGO, "motor-video");
  assert.deepEqual(lerDeclaracao(bloco("motor-video", DECLARADA)), DECLARADA);
  // Misturar vale: id novo com campos antigos e o contrário.
  assert.deepEqual(lerDeclaracao(bloco("kodecz", DECLARADA)), DECLARADA);
  assert.deepEqual(lerDeclaracao(bloco("motor-video", { id: "L", width: 960, height: 540, fps: 30, frames: 60 })), DECLARADA);
  assert.deepEqual(lerDeclaracao(bloco("kodecz", { id: "L", width: 960, altura: 540, fps: 30, quadros: 60 })), DECLARADA);
});

test("bloco: o mesmo campo com os dois nomes e valores diferentes é recusado", () => {
  falha(() => lerDeclaracao(bloco("kodecz", { id: "L", width: 960, largura: 1920, height: 540, fps: 30, frames: 60 })), /width.*largura/);
  // Iguais, passa.
  assert.deepEqual(lerDeclaracao(bloco("kodecz", { id: "L", width: 960, largura: 960, height: 540, fps: 30, frames: 60 })), DECLARADA);
});

test("bloco: o erro diz o nome que a página usou (e o novo quando falta)", () => {
  falha(() => lerDeclaracao(bloco("kodecz", { id: "L", width: 961, height: 540, fps: 30, frames: 60 })), /«width».*par/);
  falha(() => lerDeclaracao(bloco("kodecz", { id: "L", largura: 961, altura: 540, qps: 30, quadros: 60 })), /«largura».*par/);
  falha(() => lerDeclaracao(bloco("kodecz", { id: "L", width: 960, height: 540, frames: 60 })), /«fps»/);
  falha(() => lerDeclaracao(`<script id="kodecz">{}</script>`), /<script id="kodecz">.*application\/json/);
});

test("bloco: sem nenhum dos dois ids, não é composição", () => {
  assert.equal(lerDeclaracao(bloco("outro", DECLARADA)), null);
  assert.equal(lerDeclaracao(`<!-- ${bloco("kodecz", DECLARADA)} -->`), null);
});

test("opções: as em inglês viram as originais, com e sem =, e nada depois de --", () => {
  assert.deepEqual(traduzirOpcoes(["a", "--from", "10", "--frames=20", "--alpha", "--gpu", "--hevc", "--no-audio", "--help"], OPCOES_RENDER),
    ["a", "--de", "10", "--quadros=20", "--alfa", "--placa", "--hevc", "--sem-audio", "--ajuda"]);
  // As antigas passam como estão; posicionais e valores não são traduzidos.
  assert.deepEqual(traduzirOpcoes(["--de", "5", "--placa", "--from"], OPCOES_RENDER).slice(0, 3), ["--de", "5", "--placa"]);
  assert.deepEqual(traduzirOpcoes(["--frames", "--from"], OPCOES_RENDER), ["--quadros", "--de"]);
  assert.deepEqual(traduzirOpcoes(["--", "--from"], OPCOES_RENDER), ["--", "--from"]);
  assert.deepEqual(traduzirOpcoes(["--frame", "3", "--watch", "--serve", "--port", "9", "--out", "x"], OPCOES_PREVIA),
    ["--quadro", "3", "--observar", "--servir", "--porta", "9", "--saida", "x"]);
  assert.deepEqual(traduzirOpcoes(["--speech", "f.json", "--sample", "5", "--out", "d", "--keep"], OPCOES_CONFERIR),
    ["--falas", "f.json", "--amostra", "5", "--saida", "d", "--manter"]);
});

test("render: --from, --frames, --alpha, --gpu e --cpu dão o mesmo que --de, --quadros, --alfa e --placa", () => {
  const c = comPagina(bloco("kodecz", { id: "L", width: 960, height: 540, fps: 30, frames: 60 }));
  const novo = lerArgumentos([c, "L", "s.mp4", "--from", "10", "--frames", "20", "--gpu", "--no-audio"]);
  const antigo = lerArgumentos([c, "L", "s.mp4", "--de", "10", "--quadros", "20", "--placa", "--sem-audio"]);
  assert.deepEqual(novo, antigo);
  assert.equal(novo.modo, "placa");
  assert.equal(lerArgumentos([c, "L", "s.mp4", "--cpu"]).modo, "cpu");
  const alfa = lerArgumentos([c, "L", "s.hevc", "--alpha"]);
  assert.deepEqual([alfa.alfa, alfa.codec, alfa.modo], [true, "hevc", "placa"]);
  falha(() => lerArgumentos([c, "L", "s.mp4", "--gpu", "--cpu"]), /--gpu.*--cpu|--placa.*--cpu/);
  falha(() => lerArgumentos([c, "L", "s.mp4", "--help"]), /usage: kodecz render/);
});

test("preview e check: as opções em inglês", () => {
  const c = comPagina(bloco("kodecz", { id: "L", width: 960, height: 540, fps: 30, frames: 60 }));
  const p = lerOpcoesPrevia([c, "L", "--frame", "0,30", "--out", join(pasta, "q")]);
  assert.deepEqual(p.quadros, [0, 30]);
  assert.deepEqual(p, lerOpcoesPrevia([c, "L", "--quadro", "0,30", "--saida", join(pasta, "q")]));
  const k = lerArgumentosConferir([c, "L", "--sample", "5", "--out", join(pasta, "k")]);
  assert.deepEqual(k, lerArgumentosConferir([c, "L", "--amostra", "5", "--saida", join(pasta, "k")]));
});

test("kodecz: render, preview e check levam ao comando certo; os nomes antigos também", () => {
  assert.deepEqual(resolverComando(["render", "a", "B", "c.mp4", "--gpu"]), { script: "render.ts", args: ["a", "B", "c.mp4", "--gpu"] });
  assert.equal(resolverComando(["preview", "a", "B"]).script, "previa.ts");
  assert.equal(resolverComando(["check", "a", "B"]).script, "conferir.ts");
  assert.equal(resolverComando(["previa", "a", "B"]).script, "previa.ts");
  assert.equal(resolverComando(["conferir", "a", "B"]).script, "conferir.ts");
  falha(() => resolverComando(["renderizar"]), /unknown command «renderizar».*render, preview, check/s);
  assert.throws(() => resolverComando([]), (e: unknown) => e instanceof ErroDeUso && e.codigo === 2 && /usage: kodecz/.test(e.message));
  assert.throws(() => resolverComando(["--help"]), (e: unknown) => e instanceof ErroDeUso && e.codigo === 0);
});

test("kodecz: o executável repassa os argumentos e a saída do comando", () => {
  const bin = new URL("./kodecz.ts", import.meta.url).pathname;
  const r = spawnSync(process.execPath, [bin, "render", "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout + r.stderr, /usage: kodecz render/);
  const s = spawnSync(process.execPath, [bin, "nada"], { encoding: "utf8" });
  assert.equal(s.status, 2);
});
