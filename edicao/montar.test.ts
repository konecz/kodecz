// Tests of `kodecz assemble` (edicao/montar.ts, cli/montar.ts) and of the montar.ts of the blocks, with a synthetic
// edit (R01: invented speech, the fictitious brand of blocos/marca, silent WAV files written here). No GPU, no browser
// (--no-check). The end-to-end render is edicao/ponta-a-ponta.test.ts.
// Run: node --test edicao/montar.test.ts
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BLOCOS, ErroDaEdicao, montarEdicao } from "./montar.ts";

const tmp = mkdtempSync(join(tmpdir(), "kodecz-assemble-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const KODECZ = new URL("../cli/kodecz.ts", import.meta.url).pathname;

/** A silent mono 16-bit WAV of `segundos`. */
function wav(caminho: string, segundos: number, taxa = 8000) {
  const n = Math.round(segundos * taxa), b = Buffer.alloc(44 + 2 * n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + 2 * n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(taxa, 24);
  b.writeUInt32LE(taxa * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(2 * n, 40);
  writeFileSync(caminho, b);
}

const PALAVRAS = [
  { texto: "Olá,", inicio: 0.5, fim: 0.9 }, { texto: "isto", inicio: 1.0, fim: 1.3 }, { texto: "é", inicio: 1.3, fim: 1.4 },
  { texto: "um", inicio: 1.4, fim: 1.5 }, { texto: "teste.", inicio: 1.5, fim: 2.0 },
  { texto: "Cresce", inicio: 3.0, fim: 3.5 }, { texto: "rápido!", inicio: 3.5, fim: 4.0 },
  { texto: "Fim.", inicio: 5.0, fim: 5.5 },
];

function pasta(nome: string, edicao: Record<string, unknown>, voz = 6) {
  const p = join(tmp, nome);
  mkdirSync(join(p, "midia"), { recursive: true });
  writeFileSync(join(p, "falas.json"), JSON.stringify({ palavras: PALAVRAS }));
  wav(join(p, "midia", "voz.wav"), voz);
  for (const s of ["whoosh", "pop", "ding", "trilha"]) wav(join(p, "midia", `${s}.wav`), 1);
  writeFileSync(join(p, "midia", "take.mp4"), "not decoded by assemble");
  writeFileSync(join(p, "midia", "foto.png"), "not decoded by assemble");
  writeFileSync(join(p, "edicao.json"), JSON.stringify(edicao));
  return p;
}

const EDICAO = {
  composicao: { id: "EdicaoSintetica", largura: 1920, altura: 1080, fps: 30 },
  marca: join(BLOCOS, "marca", "DESIGN.md"),
  falas: "falas.json",
  voz: "midia/voz.wav",
  destino: "youtube",
  itens: [
    { bloco: "cena", de: 0, ate: { palavra: "cresce" }, itens: [
      { bloco: "video", src: "midia/take.mp4", mudo: true, papel: "apresentador" },
      { bloco: "titulo-entrada", de: { palavra: "isto" }, ate: { fimDaFrase: { palavra: "isto" } }, titulo: "Um <teste>", subtitulo: "Sintético" },
    ] },
    { bloco: "cena", de: { palavra: "cresce" }, ate: { palavra: "fim" }, transicao: { tipo: "fade" }, itens: [
      { bloco: "contagem", de: { palavra: "cresce" }, ate: { palavra: "rapido", borda: "fim" }, valor: 312, rotulo: "itens", sufixo: " %" },
      { bloco: "grafico-barras", de: 3.2, barras: [{ valor: 4, rotulo: "a" }, { valor: 9, rotulo: "b", destaque: true }] },
    ] },
    { bloco: "cena", de: { palavra: "fim" }, ate: 6, transicao: { tipo: "deslizar", duracao: 10, lado: "esquerda" }, itens: [
      { bloco: "grafico-linha", valores: [1, 3, 2, 5] },
      { bloco: "imagem", src: "midia/foto.png", de: 5.2, ajuste: "contain" },
    ] },
    { bloco: "audio", src: "midia/pop.wav", de: 1, ate: 1.5, volume: 0.5 },
  ],
  sons: [
    { src: "midia/whoosh.wav", em: { palavra: "cresce" }, antes: 0.4, volume: 0.3 },
    { src: "midia/pop.wav", em: { palavra: "isto" }, volume: 0.6 },
    { src: "midia/ding.wav", em: { fimDaFrase: { palavra: "cresce" } }, fim: 4.5, volume: 0.8 },
  ],
  trilha: { src: "midia/trilha.wav", volume: 0.4, abaixarSobVoz: 14, atraso: 4 },
};

test("assemble: the composition folder with declaration, brand, blocks, media and sound", async () => {
  const p = pasta("completa", EDICAO);
  const r = await montarEdicao(join(p, "edicao.json"), join(p, "saida"));
  const html = readFileSync(join(p, "saida", "index.html"), "utf8");
  assert.equal(r.quadros, 180); // the voice lasts 6 s
  assert.match(html, /<script type="application\/json" id="kodecz">\n\{"id":"EdicaoSintetica","width":1920,"height":1080,"fps":30,"frames":180\}\n<\/script>/);
  assert.match(html, /:root \{ --fps: 30; \}/);
  assert.match(html, /<html data-destino="youtube">/);
  // Brand first, then the blocks' CSS in the order they first appear (the scene before what it holds).
  const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(links, ["marca/marca.css", "blocos/cena/bloco.css", "blocos/titulo-entrada/bloco.css",
    "blocos/transicao-deslizar/bloco.css", "blocos/transicao-fade/bloco.css", "blocos/contagem/bloco.css", "blocos/grafico-barras/bloco.css",
    "blocos/grafico-linha/bloco.css"]);
  for (const l of links) assert.ok(existsSync(join(p, "saida", l)), l);
  assert.match(readFileSync(join(p, "saida", "marca", "marca.css"), "utf8"), /--color-ground: #101828/);
  assert.match(html, /<script src="blocos\/grafico-linha\/bloco\.js"><\/script>/);
  assert.ok(existsSync(join(p, "saida", "blocos", "grafico-linha", "bloco.js")));
  // Scenes: the fade keeps the first scene until it ends (90 + 15); the slide ends the second at 150 + 10, exactly.
  assert.match(html, /<section class="kz-cena" data-bloco="cena" style="--inicio: 0; --fim: 105">/);
  assert.match(html, /<section class="kz-cena" data-bloco="cena" style="--inicio: 90; --fim: 160">\n<div class="kz-desliza-sai" data-bloco="transicao-deslizar" style="--duracao: 10; --desliza-x: -100%">\n<div class="kz-fade" data-bloco="transicao-fade" style="--duracao: 15">/);
  assert.match(html, /<section class="kz-cena" data-bloco="cena" style="--inicio: 150; --fim: 180">\n<div class="kz-desliza-entra" data-bloco="transicao-deslizar" style="--duracao: 10; --desliza-x: -100%">/);
  // The video inherits the scene, which the fade made longer.
  assert.match(html, /<video class="kz-midia" src="midia\/take\.mp4" data-inicio="0" data-quadros="105" muted data-papel="apresentador"><\/video>/);
  // Word triggers: «isto» at 1.0 s = frame 30; end of its sentence 2.0 + 0.15 s = frame 65. Text is escaped.
  assert.match(html, /data-bloco="titulo-entrada" style="--inicio: 30; --fim: 65">\n {2}<h1 class="kz-titulo-principal">Um &lt;teste&gt;<\/h1>/);
  assert.match(html, /data-bloco="contagem" style="--inicio: 90; --fim: 120; --valor: 312; --sufixo: &quot; %&quot;"/);
  assert.match(html, /data-bloco="grafico-barras" style="--inicio: 96; --maximo: 9">/);
  assert.match(html, /<div class="kz-barra kz-destaque" style="--valor: 9; --ordem: 1">/);
  assert.match(html, /data-bloco="grafico-linha" data-valores="1 3 2 5" data-maximo="5"/);
  assert.match(html, /<img class="kz-midia kz-trecho" src="midia\/foto\.png" alt="" style="--inicio: 156; --fim: 180; object-fit: contain">/);
  // Sound: voice, the built-in audio with its 3-frame end, event sounds, the music.
  assert.match(html, /<audio src="midia\/voz\.wav" data-inicio="0" data-papel="voz"><\/audio>/);
  assert.match(html, /<audio src="midia\/pop\.wav" data-inicio="30" data-quadros="15" data-volume="0:0\.5 12:0\.5 15:0"><\/audio>/);
  assert.match(html, /<audio src="midia\/whoosh\.wav" data-inicio="78" data-volume="0\.3" data-papel="som">/);
  assert.match(html, /<audio src="midia\/ding\.wav" data-inicio="125" data-quadros="10" data-volume="0:0\.8 7:0\.8 10:0" data-papel="som">/);
  const trilha = html.match(/<audio src="midia\/trilha\.wav" data-inicio="4" data-quadros="176" data-volume="([^"]+)" data-papel="trilha">/);
  assert.ok(trilha, "the music");
  assert.match(trilha[1], /^0:0\.4 /);
  assert.match(trilha[1], /:0\.0798/); // 0.4 × 10^(−14/20)
  // Media are links to the sources; block files are copies.
  assert.ok(lstatSync(join(p, "saida", "midia", "take.mp4")).isSymbolicLink());
  assert.ok(!lstatSync(join(p, "saida", "blocos", "cena", "bloco.css")).isSymbolicLink());
  // No clock, no random, no requestAnimationFrame in the page (R03).
  assert.doesNotMatch(html, /Date\.now|performance\.now|Math\.random|requestAnimationFrame|setTimeout|setInterval/);
});

test("assemble: edicao.resolvida.json has every trigger in frames", async () => {
  const p = pasta("resolvida", EDICAO);
  await montarEdicao(join(p, "edicao.json"), join(p, "saida"));
  const j = JSON.parse(readFileSync(join(p, "saida", "edicao.resolvida.json"), "utf8"));
  assert.equal(j.composicao.quadros, 180);
  assert.deepEqual(j.itens.map((i: { de: number; ate: number }) => [i.de, i.ate]), [[0, 105], [90, 160], [150, 180], [30, 45]]);
  const titulo = j.itens[0].itens.find((i: { bloco: string }) => i.bloco === "titulo-entrada");
  assert.deepEqual([titulo.de, titulo.ate], [30, 65]);
  // The second scene: the slide's leaving layer around the fade's layer around its children.
  assert.equal(j.itens[1].itens[0].bloco, "transicao-deslizar");
  assert.equal(j.itens[1].itens[0].papel, "sai");
  assert.equal(j.itens[1].itens[0].itens[0].bloco, "transicao-fade");
  assert.equal(j.sons[0].inicio, 78);
  assert.equal(j.trilha.inicio, 4);
  assert.doesNotMatch(JSON.stringify(j), /"palavra"|"fimDaFrase"|"segundo"/, "no trigger left unresolved");
});

test("assemble: the same edit gives the same page, byte for byte", async () => {
  const p = pasta("repetida", EDICAO);
  const a = await montarEdicao(join(p, "edicao.json"), join(p, "s1"));
  const b = await montarEdicao(join(p, "edicao.json"), join(p, "s2"));
  assert.equal(a.html.replaceAll("s1", "s2"), b.html);
  // Assembling again over the same folder works (links replaced).
  await montarEdicao(join(p, "edicao.json"), join(p, "s1"));
});

test("assemble: errors say where and what", async () => {
  const caso = async (nome: string, mudar: (e: typeof EDICAO) => unknown, re: RegExp) => {
    const e = structuredClone(EDICAO);
    const p = pasta(nome, mudar(e) as Record<string, unknown> ?? e);
    await assert.rejects(montarEdicao(join(p, "edicao.json"), join(p, "saida")), (x: Error) => x instanceof ErroDaEdicao && re.test(x.message));
  };
  await caso("palavra", (e) => { (e.itens[0].itens![1] as Record<string, unknown>).de = { palavra: "tste" }; return e; },
    /itens\[0\]\.itens\[1\]: word «tste» is not in the speech; closest: teste/);
  await caso("desconhecido", (e) => { e.itens.push({ bloco: "nao-existe" } as never); return e; }, /unknown block «nao-existe»/);
  await caso("arquivo", (e) => { e.sons[0].src = "midia/falta.wav"; return e; }, /sons\[0\]: file not found: midia\/falta\.wav/);
  await caso("transicao", (e) => { (e.itens[1].transicao as Record<string, unknown>).tipo = "girar"; return e; }, /itens\[1\]\.transicao/);
  await caso("ordem", (e) => { (e.itens[0] as Record<string, unknown>).ate = 0; return e; }, /itens\[0\]: ends at frame 0/);
  await caso("composicao", (e) => { (e.composicao as Record<string, unknown>).largura = 1081; return e; }, /composicao\.largura/);
  await caso("sem-duracao", () => ({ composicao: EDICAO.composicao, itens: [] }), /composicao\.quadros/);
});

test("assemble: a block without montar.ts is a clear error", async () => {
  const blocos = join(tmp, "blocos-falsos");
  mkdirSync(join(blocos, "so-html"), { recursive: true });
  writeFileSync(join(blocos, "so-html", "KODECZ.md"), "---\nname: so-html\n---\n");
  const p = pasta("sem-montar", { composicao: { ...EDICAO.composicao, quadros: 30 }, itens: [{ bloco: "so-html" }] });
  await assert.rejects(montarEdicao(join(p, "edicao.json"), join(p, "saida"), { blocos }),
    /block «so-html» has no assembly yet \(blocos\/so-html\/montar\.ts is missing\)/);
});

test("assemble: media a block receives (src, logo…) is published to midia/ and the block gets that path", async () => {
  const blocos = join(tmp, "blocos-midia");
  mkdirSync(join(blocos, "eco"), { recursive: true });
  writeFileSync(join(blocos, "eco", "KODECZ.md"), "---\nname: eco\n---\n");
  writeFileSync(join(blocos, "eco", "montar.ts"),
    "export function montar(item) { return { html: `<i data-src=\\\"${item.src}\\\" data-logo=\\\"${item.logo}\\\" data-url=\\\"${item.imagem}\\\"></i>` }; }\n");
  const p = pasta("midia-de-bloco", { composicao: { ...EDICAO.composicao, quadros: 30 },
    itens: [{ bloco: "eco", src: "midia/take.mp4", logo: "midia/foto.png", imagem: "https://exemplo.invalid/a.png" }] });
  await montarEdicao(join(p, "edicao.json"), join(p, "saida"), { blocos });
  const html = readFileSync(join(p, "saida", "index.html"), "utf8");
  assert.match(html, /data-src="midia\/take\.mp4"/);
  assert.match(html, /data-logo="midia\/foto\.png"/);
  assert.match(html, /data-url="https:\/\/exemplo\.invalid\/a\.png"/);
  assert.ok(lstatSync(join(p, "saida", "midia", "take.mp4")).isSymbolicLink());
  assert.ok(lstatSync(join(p, "saida", "midia", "foto.png")).isSymbolicLink());
});

test("kodecz assemble: the command, its JSON line and its exit codes", () => {
  const p = pasta("cli", EDICAO);
  const r = spawnSync(process.execPath, [KODECZ, "assemble", join(p, "edicao.json"), join(p, "saida"), "--no-check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true);
  assert.equal(j.quadros, 180);
  assert.equal(j.conferencia, null);
  assert.match(j.proximo, /kodecz render .* EdicaoSintetica out\.mp4/);
  const uso = spawnSync(process.execPath, [KODECZ, "assemble", "so-um"], { encoding: "utf8" });
  assert.equal(uso.status, 2);
  assert.match(uso.stderr, /usage: kodecz assemble/);
  writeFileSync(join(p, "ruim.json"), "{");
  const ruim = spawnSync(process.execPath, [KODECZ, "assemble", join(p, "ruim.json"), join(p, "s"), "--no-check"], { encoding: "utf8" });
  assert.equal(ruim.status, 1);
  assert.match(ruim.stderr, /^error: edit is not valid JSON/);
});
