// H14 faixa-do-tema: o montar.ts (contrato do `kodecz assemble`) com gatilhos sintéticos, sem navegador; e o DOM no
// quadro N (conferir-dom.ts, CEF na CPU): o exemplo certo sem achados e com a faixa no eixo da legenda, logo acima dela;
// o 9:16 sintético; e o exemplo errado acusado (rosto, duas faixas juntas, linha quebrada).
// Rodar: node --test blocos/faixa-do-tema.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAMINHOS } from "../cli/regras.ts";
import { BLOCOS, blocosDaPagina, conferirPagina, familiasDaMarca, fontesQueFaltam, type Resultado } from "./conferir-dom.ts";
import { montar, type ContextoMontagem, type Palavra } from "./faixa-do-tema/montar.ts";

const ler = (...p: string[]) => readFileSync(join(BLOCOS, ...p), "utf8");

// --- montar.ts, com gatilhos sintéticos --------------------------------------------------------------------------
const PALAVRAS: Palavra[] = [
  { texto: "Cada", inicio: 0.4, fim: 0.7 }, { texto: "trecho", inicio: 0.7, fim: 1.1 }, { texto: "tem", inicio: 1.1, fim: 1.3 },
  { texto: "tema.", inicio: 1.3, fim: 1.85 }, { texto: "Depois", inicio: 2.4, fim: 2.8 }, { texto: "vem", inicio: 2.8, fim: 3.0 },
  { texto: "outro", inicio: 3.0, fim: 3.3 }, { texto: "tema.", inicio: 3.3, fim: 3.9 },
];

/** Um contexto de montagem sintético: gatilho é número (segundos), palavra (texto) ou { palavra, ocorrencia }. */
function contexto(fps = 30, palavras = PALAVRAS): ContextoMontagem {
  const quando = (palavra: string, ocorrencia = 1) => {
    const achadas = palavras.filter((p) => p.texto.replace(/[.,!?;:]$/, "") === palavra);
    if (!achadas[ocorrencia - 1]) throw new Error(`palavra ${palavra} (${ocorrencia}) não está na fala`);
    return achadas[ocorrencia - 1];
  };
  return {
    fps, largura: 1920, altura: 1080, palavras, quando,
    q: (s) => Math.round(s * fps),
    fimDaFrase: (s) => (palavras.find((p) => p.fim > s && /[.!?]$/.test(p.texto)) ?? palavras[palavras.length - 1]).fim + 0.15,
    tempo: (ref) => typeof ref === "number" ? ref : typeof ref === "string" ? quando(ref).inicio
      : quando((ref as { palavra: string }).palavra, (ref as { ocorrencia?: number }).ocorrencia).inicio,
  };
}
const estilo = (html: string, v: string) => Number(new RegExp(`${v}: (-?[\\d.]+)`).exec(html)?.[1]);

test("montar: --inicio na palavra, --fim no fim da frase (sem ate), css do bloco e texto escapado", () => {
  const ctx = contexto();
  const r = montar({ texto: "Tema <um> & dois", de: "trecho" }, ctx);
  assert.deepEqual(blocosDaPagina(r.html), ["faixa-do-tema"]);
  assert.match(r.html, /data-papel="faixa"/);
  assert.equal(estilo(r.html, "--inicio"), 21, "0,7 s × 30");
  assert.equal(estilo(r.html, "--fim"), 60, "fim de «tema.» (1,85 s) + 0,15 s = 2 s");
  assert.equal(estilo(r.html, "--faixa-entrada"), 15);
  assert.equal(estilo(r.html, "--faixa-saida"), 9);
  assert.equal(estilo(r.html, "--faixa-letras"), 16);
  assert.match(r.html, />Tema &lt;um&gt; &amp; dois</);
  assert.deepEqual(r.css, ["bloco.css"]);
  assert.match(r.html, /data-estilo="cartao"/);
  assert.match(r.html, /data-entrada="mola"/);
});

test("montar: ate explícito, variante barra com cortina e os parâmetros de posição viram variáveis", () => {
  const r = montar({ texto: "Outro tema", de: { palavra: "tema", ocorrencia: 2 }, ate: 5, estilo: "barra", entrada: "cortina",
    teto: "48vh", folga: "28px" }, contexto());
  assert.equal(estilo(r.html, "--inicio"), 99);
  assert.equal(estilo(r.html, "--fim"), 150);
  assert.match(r.html, /data-estilo="barra" data-entrada="cortina"/);
  assert.match(r.html, /--faixa-teto: 48vh; --faixa-folga: 28px/);
  assert.throws(() => montar({ texto: "x", de: 1, teto: "40%" }, contexto()), /teto.*px.*vh/);
});

test("montar: a duração da entrada e da saída acompanha o fps", () => {
  const r = montar({ texto: "Sessenta", de: 1, ate: 3 }, contexto(60));
  assert.deepEqual([estilo(r.html, "--inicio"), estilo(r.html, "--fim"), estilo(r.html, "--faixa-entrada"), estilo(r.html, "--faixa-saida")],
    [60, 180, 30, 18]);
});

test("montar: a faixa que entraria antes de a anterior sair é atrasada até a saída dela (ajustar, o padrão)", () => {
  const ctx = contexto();
  montar({ texto: "Primeira", de: 0.4, ate: 2 }, ctx); // fim 60, sai até 69
  const r = montar({ texto: "Segunda", de: 1.5, ate: 4 }, ctx);
  assert.equal(estilo(r.html, "--inicio"), 69, "entra no quadro em que a primeira acabou de sair");
  assert.equal(estilo(r.html, "--fim"), 120);
  // Outro grupo e outro contexto não cruzam com esta.
  assert.equal(estilo(montar({ texto: "Outra trilha", de: 1.5, ate: 4, grupo: "capitulo" }, ctx).html, "--inicio"), 45);
  assert.equal(estilo(montar({ texto: "Outro vídeo", de: 1.5, ate: 4 }, contexto()).html, "--inicio"), 45);
});

test("montar: recusa a sobreposição quando pedido, e quando o ajuste não deixa a faixa parada na tela", () => {
  const ctx = contexto();
  montar({ texto: "Primeira", de: 0.4, ate: 2 }, ctx);
  assert.throws(() => montar({ texto: "Segunda", de: 1.5, ate: 4, sobreposicao: "recusar" }, ctx), /cruza.*Primeira.*69/);
  assert.throws(() => montar({ texto: "Curta demais", de: 1.5, ate: 2.6 }, ctx), /não sobra tempo/);
  // A recusada não ocupou o lugar: a seguinte, depois da primeira, entra onde pediu.
  assert.equal(estilo(montar({ texto: "Terceira", de: 2.4, ate: 4 }, ctx).html, "--inicio"), 72);
});

test("montar: recusa texto vazio ou com quebra de linha, ate antes do de e estilo ou entrada desconhecidos", () => {
  const ctx = contexto();
  assert.throws(() => montar({ texto: "  ", de: 1 }, ctx), /texto vazio/);
  assert.throws(() => montar({ texto: "Duas\nlinhas", de: 1 }, ctx), /uma linha/);
  assert.throws(() => montar({ texto: "Ao contrário", de: 2, ate: 1 }, ctx), /ate.*depois do de/);
  assert.throws(() => montar({ texto: "x", de: 1, estilo: "pilula" as never }, ctx), /estilo/);
  assert.throws(() => montar({ texto: "x", de: 1, entrada: "salto" as never }, ctx), /entrada/);
});

// --- DOM, no quadro N (CEF na CPU) -------------------------------------------------------------------------------
const semCef = existsSync(CAMINHOS.hostCef) ? false : `falta ${CAMINHOS.hostCef} (captura/cef/montar.sh)`;
const faltam = fontesQueFaltam(familiasDaMarca(ler("marca", "marca.css")));
const semDom = semCef || (faltam.length ? `faltam no sistema as fontes da marca dos blocos (${faltam.join(", ")})` : false);
const m = (r: Resultado, n: number, sel: string, prop: string) => r.medidas![`${n} ${sel} ${prop}`];
const semAchados = (r: Resultado) => assert.deepEqual(r.achados.map((a) => a.mensagem), []);
type Caixa = { left: number; top: number; width: number; height: number };

test("exemplo: sem achados com a legenda junto; a faixa no eixo da legenda, logo acima, entra, fica e sai", { skip: semDom }, async () => {
  const medir: [number, string, string][] = [
    [40, ".kz-faixa-cartao", "caixa"], [40, ".kz-legenda", "caixa"],
    ...[11, 30, 63, 70].map((n) => [n, ".kz-faixa", "opacity"] as [number, string, string]),
    ...[74, 100, 135, 140].map((n) => [n, ".kz-faixa", "clip-path"] as [number, string, string]),
    [133, ".kz-faixa-cartao", "opacity"], [100, ".kz-faixa-texto", "transform"], [81, ".kz-faixa-texto", "transform"],
  ];
  const r = await conferirPagina(BLOCOS, "faixa-do-tema/exemplo.html", { medir });
  semAchados(r);
  const [cartao] = m(r, 40, ".kz-faixa-cartao", "caixa") as Caixa[];
  const legenda = (m(r, 40, ".kz-legenda", "caixa") as Caixa[])[0];
  assert.ok(Math.abs(cartao.left + cartao.width / 2 - 960) < 1, `centro da faixa: ${cartao.left + cartao.width / 2}`);
  assert.ok(Math.abs(legenda.left + legenda.width / 2 - 960) < 1, "a legenda no mesmo eixo");
  const folga = legenda.top - (cartao.top + cartao.height);
  assert.ok(Math.abs(folga - 20) < 1.5, `folga entre a faixa e a legenda: ${folga}`);
  // Mola (a primeira faixa, 12 a 60): apagada antes, inteira no meio, e já caindo 3 quadros depois do --fim (G21).
  const op = (n: number) => Number(m(r, n, ".kz-faixa", "opacity")[0]);
  assert.deepEqual([op(11), op(30), op(70)], [0, 1, 0]);
  assert.ok(op(63) < 0.9, `3 quadros depois do --fim: ${op(63)}`);
  // Cortina (a segunda, 75 a 130): fechada no começo, aberta no meio, recolhida para a direita no fim.
  const clip = (n: number) => m(r, n, ".kz-faixa", "clip-path")[1] as string;
  assert.equal(clip(74), "inset(0% 100% 0% 0%)");
  assert.equal(clip(100), "inset(0%)");
  assert.equal(clip(140), "inset(0% 0% 0% 100%)");
  assert.ok(Number(m(r, 133, ".kz-faixa-cartao", "opacity")[1]) < 0.9, "o cartão começa a sair até 3 quadros depois do --fim (G21)");
  // Barra: o texto sobe de dentro do cartão e para no lugar.
  assert.match(m(r, 100, ".kz-faixa-texto", "transform")[1] as string, /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  assert.match(m(r, 81, ".kz-faixa-texto", "transform")[1] as string, /^matrix\(1, 0, 0, 1, 0, [1-9]/);
});

test("exemplo errado: acusa a faixa sobre o rosto, duas faixas juntas e a linha quebrada; a legenda não", { skip: semDom }, async () => {
  const e = await conferirPagina(BLOCOS, "faixa-do-tema/exemplo-errado.html");
  const por = (id: string) => [...new Set(e.achados.filter((a) => a.id === id).map((a) => a.quadro))];
  const ids = new Set(e.achados.map((a) => a.id));
  assert.deepEqual([...ids].sort(), ["faixa.rosto", "faixa.uma-linha", "faixa.uma-por-vez"], JSON.stringify(e.achados.slice(0, 3)));
  assert.ok(e.achados.every((a) => a.prioridade === "P0"));
  const rosto = por("faixa.rosto");
  assert.ok(rosto[0] >= 10 && rosto.every((n) => n < 50), `rosto: ${rosto}`);
  assert.match(e.achados.find((a) => a.id === "faixa.rosto")!.mensagem, /^t=0,\d\d · \.kz-faixa-teto · a faixa sobe \d+ px acima da linha do queixo/);
  const juntas = por("faixa.uma-por-vez");
  assert.equal(juntas[0], 36, "a segunda aparece no quadro seguinte ao --inicio dela");
  assert.ok(juntas.every((n) => n < 50), `duas faixas: ${juntas}`);
  assert.ok(por("faixa.uma-linha").every((n) => n >= 80 && n < 120));
});

test("9:16: a faixa fica acima da legenda erguida no :root, maior, e o texto longo encolhe sem quebrar nem cortar", { skip: semDom }, async () => {
  const pasta = mkdtempSync(join(tmpdir(), "faixa-916-"));
  try {
    for (const c of ["marca/marca.css", "faixa-do-tema/bloco.css", "legenda-uma-linha/bloco.css"]) writeFileSync(join(pasta, c.replace("/", "-")), ler(c));
    const faixa = (texto: string, inicio: number, fim: number) => `<div class="kz-faixa" data-bloco="faixa-do-tema" data-estilo="cartao"
      data-entrada="mola" style="--inicio: ${inicio}; --fim: ${fim}; --faixa-letras: ${texto.length}"><p class="kz-faixa-cartao" data-papel="faixa"><span
      class="kz-faixa-texto">${texto}</span></p><i class="kz-faixa-cortina"></i><i class="kz-faixa-teto"></i></div>`;
    writeFileSync(join(pasta, "index.html"), `<!doctype html><meta charset="utf-8">
<script type="application/json" id="kodecz">{ "id": "V", "width": 1080, "height": 1920, "fps": 30, "frames": 80 }</script>
<link rel="stylesheet" href="marca-marca.css"><link rel="stylesheet" href="faixa-do-tema-bloco.css"><link rel="stylesheet" href="legenda-uma-linha-bloco.css">
<style>:root { --fps: 30; --legenda-base: 30%; } html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: var(--color-muted); }</style>
${faixa("Tema curto", 0, 38)}${faixa("Um tema bem mais comprido que não caberia na largura", 48, 80)}
<div class="kz-legendas" data-bloco="legenda-uma-linha"><p class="kz-legenda" data-papel="legenda" style="--inicio: 0; --fim: 80"><span
  class="kz-palavra" style="--inicio: 0; --fim: 80">Legenda erguida.</span></p></div>`);
    const r = await conferirPagina(pasta, "index.html", { medir: [[20, ".kz-faixa-cartao", "caixa"], [20, ".kz-legenda", "caixa"],
      [20, ".kz-faixa-cartao", "font-size"], [60, ".kz-faixa-cartao", "font-size"]] });
    semAchados(r);
    const cartao = (m(r, 20, ".kz-faixa-cartao", "caixa") as Caixa[])[0], legenda = (m(r, 20, ".kz-legenda", "caixa") as Caixa[])[0];
    assert.ok(Math.abs(legenda.top - cartao.top - cartao.height - 20) < 1.5, `folga no 9:16: ${legenda.top - cartao.top - cartao.height}`);
    assert.ok(Math.abs(cartao.left + cartao.width / 2 - 540) < 1);
    assert.equal(m(r, 20, ".kz-faixa-cartao", "font-size")[0], "44px");
    const encolhida = parseFloat(m(r, 60, ".kz-faixa-cartao", "font-size")[1] as string);
    assert.ok(encolhida < 44 && encolhida > 24, `texto longo: ${encolhida}px`);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});
