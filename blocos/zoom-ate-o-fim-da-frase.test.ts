// H02 v2: o take do apresentador montado por montar.ts (aproximação lenta + punch-in de 12 % por ênfase, trava nas
// bordas, recorte 16:9 → 9:16 e cartão). As contas são lidas dos keyframes gerados, interpolados no quadro como o
// motor faz (currentTime = N / fps, linear entre keyframes), e o DOM do exemplo é conferido no CEF (conferir-dom.ts).
// Rodar: node --test blocos/zoom-ate-o-fim-da-frase.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAMINHOS } from "../cli/regras.ts";
import { BLOCOS, conferirPagina } from "./conferir-dom.ts";
import { contextoDeExemplo, ITEM_DE_EXEMPLO, montar, paginaDeExemplo, type ContextoMontagem } from "./zoom-ate-o-fim-da-frase/montar.ts";

const ler = (...p: string[]) => readFileSync(join(BLOCOS, ...p), "utf8");

type Quadro = Record<string, number>;
/** Os @keyframes de `nome` no HTML gerado: [{ offset 0..1, propriedade: valor }]. */
function keyframes(html: string, nome: string): { o: number; v: Quadro }[] {
  const m = new RegExp(`@keyframes ${nome} \\{([\\s\\S]*?)\\n\\}`).exec(html);
  assert.ok(m, `sem @keyframes ${nome}`);
  return [...m[1].matchAll(/([\d.]+)% \{([^}]*)\}/g)].map(([, o, corpo]) => ({
    o: Number(o) / 100,
    v: Object.fromEntries([...corpo.matchAll(/([\w-]+):\s*(-?[\d.]+)(px)?/g)].map(([, p, x]) => [p, Number(x)])),
  }));
}
/** O valor dos keyframes no progresso p (0..1), linear entre os vizinhos (fill both). */
function em(ks: { o: number; v: Quadro }[], p: number): Quadro {
  if (p <= ks[0].o) return ks[0].v;
  const j = ks.findIndex((k) => k.o >= p);
  if (j < 0) return ks[ks.length - 1].v;
  const a = ks[j - 1] ?? ks[j], b = ks[j];
  const t = b.o === a.o ? 1 : (p - a.o) / (b.o - a.o);
  return Object.fromEntries(Object.keys(b.v).map((k) => [k, a.v[k] + (b.v[k] - a.v[k]) * t]));
}
/** A animação de um take no HTML: nomes dos keyframes, quadro de início e duração em quadros. */
function take(html: string) {
  const nome = (v: string) => new RegExp(`${v}:\\s*([\\w-]+)`).exec(html)![1];
  const inicio = Number(/class="kz-take"[^>]*--inicio:\s*(\d+)/.exec(html)![1]);
  const n = Number(/--kz-n:\s*(\d+)/.exec(html)![1]);
  const caixa = keyframes(html, nome("--kz-caixa")), video = keyframes(html, nome("--kz-video"));
  return { inicio, n, caixa: (f: number) => em(caixa, (f - inicio) / n), video: (f: number) => em(video, (f - inicio) / n) };
}

const ctx = contextoDeExemplo();
const FONTE = { "16:9": [1920, 1080], "9:16": [1080, 1920] } as const;

test("montar: vídeo do apresentador com papel, início, recorte e quadros do take; bloco.css e data-bloco", () => {
  const m = montar(ITEM_DE_EXEMPLO, ctx);
  assert.deepEqual(m.css, ["bloco.css"]);
  assert.match(m.html, /data-bloco="zoom-ate-o-fim-da-frase"/);
  assert.match(m.html, /<video class="kz-take-video" data-papel="apresentador" src="\.\.\/midia\/apresentador\.mp4" data-inicio="0" data-recorte="0" data-quadros="195">/);
  // Nada de transform: o zoom é a caixa do vídeo (a escala num ancestral manda o quadro para o canvas).
  assert.doesNotMatch(m.html, /transform|scale\(/);
  assert.equal(m.html, montar(ITEM_DE_EXEMPLO, ctx).html, "determinístico");
});

test("montar: no quadro do fim da frase de cada ênfase o zoom volta ao da aproximação lenta; no meio, +12 %", () => {
  const m = montar(ITEM_DE_EXEMPLO, ctx);
  const t = take(m.html);
  const [W0] = FONTE["16:9"];
  const k = Math.max(ctx.largura / 1920, ctx.altura / 1080);
  const lenta = (f: number) => 1 + 0.06 * (f - t.inicio) / t.n;
  const zoom = (f: number) => t.video(f).width / (W0 * k);
  const enfases = ITEM_DE_EXEMPLO.enfases!.map((e) => {
    const p = ctx.quando(e as string);
    return { inicio: ctx.q(p.inicio), fim: ctx.q(ctx.fimDaFrase(p.inicio)) };
  });
  assert.equal(enfases.length, 2);
  for (const e of enfases) {
    assert.ok(Math.abs(zoom(e.inicio - 1) - lenta(e.inicio - 1)) < 1e-4, `antes da ênfase (${e.inicio - 1}): só a aproximação`);
    assert.ok(Math.abs(zoom(e.fim) - lenta(e.fim)) < 1e-4, `no fim da frase (${e.fim}): ${zoom(e.fim)} ≠ ${lenta(e.fim)}`);
    // A mola (damping 18) assenta em ~0,5 s: no meio da ênfase, a aproximação + 0,12.
    const meio = e.inicio + 18;
    assert.ok(meio < e.fim - 12, "a ênfase do exemplo é longa o bastante");
    assert.ok(Math.abs(zoom(meio) - (lenta(meio) + 0.12)) < 0.003, `no meio (${meio}): ${zoom(meio)}`);
    // Overshoot leve: passa de +12 % no máximo 1 %.
    const pico = Math.max(...Array.from({ length: e.fim - e.inicio }, (_, i) => zoom(e.inicio + i) - lenta(e.inicio + i)));
    assert.ok(pico > 0.12 && pico < 0.1212, `pico ${pico}`);
  }
});

/** Variações: fonte 16:9 e 9:16, foco nos cantos, aproximação forte, cartão com a passagem. */
const VARIACOES: { nome: string; ctx: ContextoMontagem; item: Parameters<typeof montar>[0] }[] = [
  { nome: "16:9 → 9:16, foco no centro", ctx, item: ITEM_DE_EXEMPLO },
  { nome: "16:9 → 9:16, foco no canto de cima à esquerda", ctx, item: { ...ITEM_DE_EXEMPLO, foco: { x: 0, y: 0 } } },
  { nome: "16:9 → 9:16, foco no canto de baixo à direita", ctx, item: { ...ITEM_DE_EXEMPLO, foco: { x: 1920, y: 1080 }, aproximacao: { de: 1, ate: 1.3 } } },
  { nome: "16:9 → 16:9", ctx: contextoDeExemplo(1920, 1080), item: { ...ITEM_DE_EXEMPLO, foco: { x: 1900, y: 20 } } },
  { nome: "9:16 → 9:16", ctx, item: { ...ITEM_DE_EXEMPLO, formatoFonte: "9:16", foco: { x: 540, y: 1900 } } },
  { nome: "16:9 → cartão com passagem", ctx, item: { ...ITEM_DE_EXEMPLO, cartao: { x: 40, y: 40, w: 1000, h: 760, raio: 32, em: 0.8, foco: { x: 700, y: 560 } } } },
  { nome: "16:9 → cartão desde o início", ctx: contextoDeExemplo(1920, 1080), item: { ...ITEM_DE_EXEMPLO, foco: { x: 1919, y: 1079 }, cartao: { x: 70, y: 80, w: 720, h: 920, raio: 32 } } },
];

test("montar: em todo quadro o vídeo cobre a caixa (nenhuma posição sai das bordas) e a caixa fica no pixel", () => {
  for (const { nome, ctx: c, item } of VARIACOES) {
    const t = take(montar(item, c).html);
    const [W0, H0] = FONTE[item.formatoFonte ?? "16:9"];
    for (let f = t.inicio; f < t.inicio + t.n; f++) {
      const cx = t.caixa(f), v = t.video(f);
      const w = cx.width ?? c.largura, h = cx.height ?? c.altura;
      for (const x of [cx.left ?? 0, cx.top ?? 0, w, h]) assert.ok(Math.abs(x - Math.round(x)) < 1e-6, `${nome}, quadro ${f}: caixa fora do pixel`);
      assert.ok(v.left <= 1e-6 && v.top <= 1e-6, `${nome}, quadro ${f}: borda de cima/esquerda à mostra (${v.left}, ${v.top})`);
      assert.ok(v.left + v.width >= w - 1e-6 && v.top + v.height >= h - 1e-6, `${nome}, quadro ${f}: borda de baixo/direita à mostra`);
      assert.ok(Math.abs(v.width / v.height - W0 / H0) < 1e-3, `${nome}, quadro ${f}: proporção da fonte`);
    }
  }
});

test("montar: cartão com passagem vai da tela cheia à caixa em 22 quadros, com raio e contorno", () => {
  const item = VARIACOES[5].item;
  const t = take(montar(item, ctx).html);
  const em = ctx.q(0.8);
  assert.deepEqual([t.caixa(em - 1).width, t.caixa(em - 1).height, t.caixa(em - 1)["border-radius"]], [1080, 1920, 0]);
  const fim = t.caixa(em + 22);
  assert.deepEqual([fim.left, fim.top, fim.width, fim.height, fim["border-radius"], fim["outline-width"]], [40, 40, 1000, 760, 32, 4]);
  const meio = t.caixa(em + 6);
  assert.ok(meio.width < 1080 && meio.width > 1000, `meio da passagem: ${meio.width}`);
});

test("montar: duas ênfases na mesma frase, palavra que não existe e take ao contrário são recusados", () => {
  assert.throws(() => montar({ ...ITEM_DE_EXEMPLO, enfases: ["segundo", "tudo"] }, ctx), /mesma frase/);
  assert.throws(() => montar({ ...ITEM_DE_EXEMPLO, enfases: ["xyz"] }, ctx), /xyz/);
  assert.throws(() => montar({ ...ITEM_DE_EXEMPLO, de: 3, ate: 2 }, ctx), /depois/);
});

test("exemplo-apresentador.html é a saída do montar.ts (node blocos/zoom-ate-o-fim-da-frase/montar.ts exemplo)", () => {
  assert.equal(ler("zoom-ate-o-fim-da-frase", "exemplo-apresentador.html"), paginaDeExemplo());
});

// --- DOM, no quadro N (CEF na CPU) -------------------------------------------------------------------------------
const semCef = existsSync(CAMINHOS.hostCef) ? false : `falta ${CAMINHOS.hostCef} (captura/cef/montar.sh)`;

test("exemplo-apresentador: sem achados; o punch-in que ainda não voltou no fim da frase é acusado (G21)", { skip: semCef }, async () => {
  const r = await conferirPagina(BLOCOS, "zoom-ate-o-fim-da-frase/exemplo-apresentador.html",
    { medir: [[0, ".kz-take-video", "caixa"], [100, ".kz-take-video", "caixa"]] });
  assert.equal(r.quadros, 195);
  assert.deepEqual(r.achados.map((a) => a.mensagem), []);
  // O <video> virou canvas, posicionado pela caixa, no quadro 0 (1080 de largura × 1,778 de cobertura).
  const caixa = r.medidas!["0 .kz-take-video caixa"][0] as { width: number; height: number; top: number };
  assert.ok(Math.abs(caixa.width - 1920 * 16 / 9) < 0.5 && caixa.top <= 0, JSON.stringify(caixa));

  // A frase acaba 4 quadros antes do que o take acha: o punch-in ainda está no ar no --fim do marcador.
  const pasta = mkdtempSync(join(tmpdir(), "h02-"));
  try {
    for (const c of ["marca/marca.css", "zoom-ate-o-fim-da-frase/bloco.css"]) writeFileSync(join(pasta, c.replace("/", "-")), ler(c));
    const errada = paginaDeExemplo().replace("../marca/marca.css", "marca-marca.css").replace("bloco.css", "zoom-ate-o-fim-da-frase-bloco.css")
      .replace(/(class="kz-take-enfase"[^>]*--fim: )(\d+)/, (_, a, n) => `${a}${Number(n) - 4}`)
      .replace(/<video[^>]*><\/video>/, "");
    writeFileSync(join(pasta, "index.html"), errada);
    const e = await conferirPagina(pasta, "index.html");
    assert.deepEqual(e.achados.map((a) => a.id), ["zoom.enfase-volta"]);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});
