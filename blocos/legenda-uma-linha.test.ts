// H01 legenda-uma-linha no padrão aprovado: a preparação (montar.ts) com palavras sintéticas (a largura medida no
// arquivo da fonte, as regras de quebra, os tempos do destaque e a posição por formato) e o exemplo 9:16 no quadro N
// (conferir-dom.ts), sem achados, com só a palavra falada em accent e a entrada subindo.
// Rodar: node --test blocos/legenda-uma-linha.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CAMINHOS } from "../cli/regras.ts";
import { BLOCOS, conferirPagina, familiasDaMarca, fontesQueFaltam, type Resultado } from "./conferir-dom.ts";
import { abrirFonte, arquivoDaFonte, estimativa } from "./legenda-uma-linha/fonte.ts";
import { FRACAS, montar, montarFrases, type ContextoMontagem, type Palavra } from "./legenda-uma-linha/montar.ts";

const ler = (...p: string[]) => readFileSync(join(BLOCOS, ...p), "utf8");
const inter = arquivoDaFonte("Inter", 700);
const semInter = inter ? false : "falta a Inter 700 no fontconfig";

/** Palavras sintéticas em sequência, 0,3 s cada, sem pausa (o texto com a pontuação do roteiro). */
function falar(texto: string, inicio = 1, passo = 0.3): Palavra[] {
  return texto.split(/\s+/).filter(Boolean).map((t, i) => ({ texto: t, inicio: inicio + i * passo, fim: inicio + i * passo + passo * 0.8 }));
}
function contexto(palavras: Palavra[], largura = 1080, altura = 1920, fps = 30): ContextoMontagem {
  const q = (s: number) => Math.round(s * fps);
  const quando = (p: string, n = 1) => palavras.filter((x) => x.texto.replace(/[^\p{L}\p{N}]/gu, "") === p)[n - 1];
  return { fps, largura, altura, palavras, q, quando, fimDaFrase: (s) => s + 0.15,
    tempo: (ref) => (typeof ref === "number" ? ref : quando(String(ref)).inicio) };
}
const opcoes = (disponivel: number, medidor = estimativa(0.6)) => ({ disponivel, tamanho: 50, espacamentoEm: 0, medidor });
const textos = (fr: { palavras: Palavra[] }[]) => fr.map((f) => f.palavras.map((p) => p.texto).join(" "));
const limpa = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}$]/gu, "");

test("fonte: a largura sai do hmtx da Inter (o «i» bem mais estreito que o «M», proporcional ao tamanho)", { skip: semInter }, () => {
  const f = abrirFonte(inter!);
  const i = f.largura("i", 100), M = f.largura("M", 100);
  assert.ok(i > 15 && i < 35 && M > 75 && M < 100, `i ${i}, M ${M}`);
  assert.ok(Math.abs(f.largura("Olá, mundo", 52) * 2 - f.largura("Olá, mundo", 104)) < 1e-9);
  assert.ok(Math.abs(f.largura("ab", 50, 0.1) - f.largura("ab", 50) - 10) < 1e-9, "letter-spacing por caractere");
  assert.ok(f.largura("ção", 50) > 0, "acentos e cedilha pelo cmap");
  assert.throws(() => abrirFonte(join(BLOCOS, "legenda-uma-linha", "bloco.css")), /não é TrueType/);
});

test("fonte: família que o fontconfig não acha vira null (quem chama cai na estimativa)", () => {
  assert.equal(arquivoDaFonte("Família Que Não Existe Kz", 700), null);
  assert.equal(estimativa(0.6).largura("abcde", 10), 30);
});

test("frases: nenhuma passa da largura, e toda pontuação fecha a frase", () => {
  const p = falar("Hoje vamos ver três coisas. Primeiro, o quadro inteiro; depois a caixa da legenda que acende a palavra falada agora! E por fim? O resto da conversa sobre medidas e fontes");
  const fr = montarFrases(p, opcoes(900));
  for (const f of fr) assert.ok(f.largura <= 900 + 1e-9, `«${textos([f])[0]}» com ${f.largura} px`);
  for (const f of fr) f.palavras.slice(0, -1).forEach((x) => assert.doesNotMatch(x.texto, /[.,:;!?…]$/, textos([f])[0]));
  assert.deepEqual(textos(fr).slice(0, 3), ["Hoje vamos ver três coisas.", "Primeiro,", "o quadro inteiro;"]);
  assert.ok(fr.every((f) => f.tamanho === 50), "nenhuma encolheu");
});

test("frases: artigo, preposição e conjunção do fim descem para a frase seguinte", () => {
  // 0,6 em × 50 px = 30 px por caractere; 600 px = 20 caracteres. «Vamos olhar para a» tem 18 e «casa» não cabe.
  const fr = montarFrases(falar("Vamos olhar para a casa de vidro e o jardim do vizinho"), opcoes(600));
  for (const f of fr.slice(0, -1)) assert.ok(!FRACAS.has(limpa(f.palavras.at(-1)!.texto)), `«${textos([f])[0]}» acaba em palavra fraca`);
  assert.deepEqual(textos(fr), ["Vamos olhar", "para a casa de vidro", "e o jardim", "do vizinho"]);
});

test("frases: a palavra curta que fecha a frase leva a anterior junto", () => {
  // «Isso aconteceu bem naquele» (26) não cabe em 28 com «mês.»: «naquele» desce com «mês.».
  const fr = montarFrases(falar("Isso aconteceu bem naquele mês."), opcoes(26 * 30));
  assert.deepEqual(textos(fr), ["Isso aconteceu bem", "naquele mês."]);
  // Configurável: curtaFecha 0 desliga (a palavra curta fica sozinha).
  assert.deepEqual(textos(montarFrases(falar("Isso aconteceu bem naquele mês."), { ...opcoes(26 * 30), curtaFecha: 0 })),
    ["Isso aconteceu bem naquele", "mês."]);
});

test("frases: palavra longa sozinha encolhe a fonte da frase em vez de quebrar", () => {
  const fr = montarFrases(falar("Isto é anticonstitucionalissimamente longo."), opcoes(600));
  const longa = fr.find((f) => f.palavras.some((x) => x.texto.startsWith("anticonst")))!;
  assert.ok(longa.tamanho < 50, `tamanho ${longa.tamanho}`);
  assert.ok(longa.largura <= 600, `largura ${longa.largura}`);
  assert.ok(Math.abs(estimativa(0.6).largura(textos([longa])[0], longa.tamanho) - longa.largura) < 1e-9);
  assert.ok(fr.filter((f) => f !== longa).every((f) => f.tamanho === 50), "só a frase da palavra longa encolhe");
});

test("frases: vírgula fecha, menos a palavra curta sozinha da lista de exceções («Ó,», «Um:»)", () => {
  assert.deepEqual(textos(montarFrases(falar("Ó, olha isso aqui. Um: medir antes."), opcoes(900))), ["Ó, olha isso aqui.", "Um: medir antes."]);
  assert.deepEqual(textos(montarFrases(falar("Sim, olha isso aqui."), opcoes(900))), ["Sim,", "olha isso aqui."]);
  // A lista é configurável: sem exceções e sem o limite de tamanho, «Ó,» fecha sozinha.
  assert.deepEqual(textos(montarFrases(falar("Ó, olha isso aqui."), { ...opcoes(900), naoFecham: [], curtaMax: 0 })), ["Ó,", "olha isso aqui."]);
  // Ponto final sempre fecha, mesmo curto.
  assert.deepEqual(textos(montarFrases(falar("Ó. Olha."), opcoes(900))), ["Ó.", "Olha."]);
});

test("frases: com a fonte de verdade, nenhuma frase passa da largura na Inter 700 de 56 px", { skip: semInter }, () => {
  const f = abrirFonte(inter!);
  const p = falar("Quando a gente mede cada palavra na fonte de verdade, a legenda nunca quebra em duas linhas, mesmo com palavras compridíssimas como desproporcionalidade ou interdisciplinaridade.");
  for (const fr of montarFrases(p, { disponivel: 700, tamanho: 56, espacamentoEm: 0, medidor: f })) {
    const w = f.largura(fr.palavras.map((x) => x.texto.replace(/[,;]$/, "")).join(" "), fr.tamanho);
    assert.ok(w <= 700 + 1e-6, `«${textos([fr])[0]}» ${w} px`);
  }
});

test("montar: uma <p> por frase com data-papel, tempos em quadros e o destaque até o fim + 0,15 s, cortado pela palavra seguinte", () => {
  const p: Palavra[] = [
    { texto: "Cada", inicio: 1.0, fim: 1.3 }, { texto: "frase", inicio: 1.32, fim: 1.6 }, // a seguinte começa antes de 1,45
    { texto: "cabe,", inicio: 2.0, fim: 2.3 }, // pausa: o destaque vai até 2,45
    { texto: "e", inicio: 3.0, fim: 3.1 }, { texto: "acende.", inicio: 3.1, fim: 3.6 },
  ];
  const m = montar({ larguraEm: 0.6 }, contexto(p, 1920, 1080));
  assert.deepEqual(m.css, ["bloco.css"]);
  assert.deepEqual(m.js, ["bloco.js"]);
  const frases = [...m.html.matchAll(/<p class="kz-legenda"([^>]*)>([\s\S]*?)<\/p>/g)];
  assert.equal(frases.length, 2);
  for (const f of frases) assert.match(f[1], /data-papel="legenda"/);
  // A frase antecipa 0,05 s; o --fim é o --inicio da seguinte; a última fica 0,6 s depois da última palavra.
  assert.match(frases[0][1], /--inicio: 29; --fim: 89/);
  assert.match(frases[1][1], /--inicio: 89; --fim: 126/);
  const spans = [...m.html.matchAll(/<span class="kz-palavra"([^>]*)>([^<]*)<\/span>/g)].map((s) => [s[2], s[1]]);
  assert.deepEqual(spans.map((s) => s[0]), ["Cada", "frase", "cabe", "e", "acende."], "vírgula e ponto e vírgula saem do texto da tela");
  assert.match(spans[2][1], /data-t="cabe,"/, "o texto com a pontuação fica em data-t (window.motor_falas)");
  assert.match(spans[0][1], /--inicio: 30; --fim: 39; --apaga: 40"/, "«Cada» apaga quando «frase» acende");
  assert.match(spans[2][1], /--inicio: 60; --fim: 69"/, "«cabe» fica até o fim + a folga do CSS");
  assert.match(spans[3][1], /--apaga: 93"/);
  assert.doesNotMatch(m.html, /data-destaque|data-entrada/, "falada e sem entrada são o padrão");
  assert.match(m.html, /<!-- legenda-uma-linha: estimativa de 0.6 em por caractere -->/);
});

test("montar: modos (progresso, subir), posição por formato e zona segura", () => {
  const p = falar("Uma frase só.");
  const h = montar({ larguraEm: 0.6 }, contexto(p, 1920, 1080)).html;
  assert.match(h, /--legenda-base: 64px/, "16:9: base 56 px, mas nunca abaixo da zona segura de 64 px");
  assert.match(montar({ larguraEm: 0.6, seguro: 40 }, contexto(p, 1920, 1080)).html, /--legenda-base: 56px/);
  const v = montar({ larguraEm: 0.6, destaque: "progresso", entrada: "subir" }, contexto(p)).html;
  assert.match(v, /data-destaque="progresso"/);
  assert.match(v, /data-entrada="subir"/);
  assert.match(v, /data-ancora="topo"[^>]*--legenda-topo: 1440px/, "9:16: 75 % da altura");
  assert.match(montar({ larguraEm: 0.6, topo: 1112 }, contexto(p)).html, /--legenda-topo: 1112px/, "logo abaixo do queixo");
  assert.match(montar({ larguraEm: 0.6, topo: "60%" }, contexto(p)).html, /--legenda-topo: 1152px/);
  // Reels (G19): os 35 % de baixo livres; a caixa (56 × 1,15 + 2 × 16 = 96,4 px, arredondado para 97) termina até 1248.
  const r = montar({ larguraEm: 0.6, destino: "reels", tamanho: 56, alturaLinha: 1.15 }, contexto(p)).html;
  const topo = Number(/--legenda-topo: (\d+)px/.exec(r)![1]);
  assert.ok(topo + 97 <= 1248 && topo > 1100, `topo ${topo}`);
  // A largura da caixa: nunca além da zona segura dos lados.
  const larg = Number(/--legenda-largura: (\d+)px/.exec(montar({ larguraEm: 0.6, largura: 1080 }, contexto(p)).html)![1]);
  assert.equal(larg, 1080 - 2 * 64);
  assert.throws(() => montar({ destaque: "tudo" as any }, contexto(p)), /destaque/);
  assert.throws(() => montar({ larguraEm: 0.6, de: 10, ate: 11 }, contexto(p)), /nenhuma palavra/);
});

test("montar: de/ate pelo ctx.tempo recortam as palavras; família da marca medida pelo arquivo", { skip: semInter }, () => {
  const p = falar("Antes disso. Agora sim, a parte certa. Depois.", 0, 0.5);
  const m = montar({ de: "Agora", ate: "Depois", familia: "Inter", peso: 700, tamanho: 52 }, contexto(p, 1920, 1080));
  assert.doesNotMatch(m.html, /Antes|Depois/);
  assert.match(m.html, />Agora</);
  assert.match(m.html, /--font-caption: 'Inter'; --font-caption-weight: 700; --legenda-tamanho: 52px/);
  assert.match(m.html, /<!-- legenda-uma-linha: métricas de .*Inter-Bold\.ttf -->/);
});

// --- O exemplo 9:16 no quadro N (CEF na CPU), igual ao que o montar.ts gera -------------------------------------------
const semCef = existsSync(CAMINHOS.hostCef) ? false : `falta ${CAMINHOS.hostCef} (captura/cef/montar.sh)`;
const faltam = fontesQueFaltam(familiasDaMarca(ler("marca", "marca.css")));
const semDom = semCef || (faltam.length ? `faltam as fontes da marca (${faltam.join(", ")})` : false);
const COR = { ink: "rgb(245, 243, 238)", accent: "rgb(255, 182, 72)" };
const m = (r: Resultado, n: number, sel: string, prop: string) => r.medidas![`${n} ${sel} ${prop}`];

/** A fala sintética do exemplo-9x16.html (o test confere que a página é a saída do montar.ts para ela). */
export const FALA_EXEMPLO: Palavra[] = [
  ["Ó,", 0.3, 0.5], ["repare", 0.55, 0.9], ["na", 0.92, 1.0], ["legenda.", 1.02, 1.5],
  ["Ela", 1.92, 2.1], ["acende", 2.12, 2.5], ["só", 2.52, 2.7], ["a", 2.72, 2.8], ["palavra", 2.82, 3.2], ["falada", 3.22, 3.6],
  ["e", 3.62, 3.7], ["nunca", 3.72, 4.0], ["quebra", 4.02, 4.4], ["em", 4.42, 4.5], ["duas", 4.52, 4.8], ["linhas,", 4.82, 5.3],
  ["Pneumoultramicroscopicossilicovulcanoconiótico.", 5.6, 7.0],
].map(([texto, inicio, fim]) => ({ texto: texto as string, inicio: inicio as number, fim: fim as number }));
export const ITEM_EXEMPLO = { familia: "Inter", peso: 700, tamanho: 56, alturaLinha: 1.15, entrada: "subir" as const, topo: 1112 };

test("exemplo-9x16.html é a saída do montar.ts para a fala do exemplo", { skip: semInter }, () => {
  const mont = montar(ITEM_EXEMPLO, contexto(FALA_EXEMPLO));
  assert.ok(ler("legenda-uma-linha", "exemplo-9x16.html").includes(mont.html), "regerar o exemplo-9x16.html com o montar.ts");
});

test("exemplo-9x16: sem achados; só a palavra falada em accent (com a folga); a frase entra subindo 10 px; a palavra longa cabe", { skip: semDom || semInter }, async () => {
  // Quadros: 64 = 2,13 s («acende»: Ela já foi); 71 = 2,37 s; 78 = 2,6 s («só»); 159 = 5,3 s («linhas,» ainda acesa
  // pela folga até 5,45 s); 165 = 5,5 s (apagou: pausa).
  const medir: [number, string, string][] = [64, 78, 159, 165].map((n) => [n, ".kz-palavra", "color"] as [number, string, string]);
  medir.push([56, ".kz-legenda", "transform"], [58, ".kz-legenda", "transform"], [62, ".kz-legenda", "transform"],
    [200, ".kz-legenda", "caixa"], [200, ".kz-legenda", "font-size"]);
  const r = await conferirPagina(BLOCOS, "legenda-uma-linha/exemplo-9x16.html", { medir });
  assert.deepEqual(r.achados.map((a) => a.mensagem), []);
  const acesas = (n: number) => (m(r, n, ".kz-palavra", "color") as string[]).flatMap((c, i) => (c === COR.accent ? [i] : []));
  const nomes = FALA_EXEMPLO.map((p) => p.texto);
  assert.deepEqual(acesas(64).map((i) => nomes[i]), ["acende"]);
  assert.deepEqual(acesas(78).map((i) => nomes[i]), ["só"]);
  assert.deepEqual(acesas(159).map((i) => nomes[i]), ["linhas,"]);
  assert.deepEqual(acesas(165), []);
  assert.ok((m(r, 64, ".kz-palavra", "color") as string[]).every((c) => c === COR.ink || c === COR.accent));
  // A segunda frase («Ela acende…») começa no quadro q(1,85) = 56: sobe de 10 px a 0 em 0,12 s (3,6 quadros).
  const ty = (n: number) => (m(r, n, ".kz-legenda", "transform") as string[]).map((t) => (t === "none" ? 0 : Number(t.split(",")[5].replace(")", ""))));
  assert.equal(ty(56)[1], 10);
  assert.ok(ty(58)[1] > 0 && ty(58)[1] < 10, `meio da subida: ${ty(58)[1]}`);
  assert.equal(ty(62)[1], 0);
  // A palavra longa encolheu a fonte e cabe na caixa dentro da zona segura.
  const caixa = (m(r, 200, ".kz-legenda", "caixa") as any[]).at(-1);
  assert.ok(parseFloat((m(r, 200, ".kz-legenda", "font-size") as string[]).at(-1)!) < 56, "a frase da palavra longa encolheu");
  assert.ok(caixa.left >= 64 && caixa.left + caixa.width <= 1080 - 64, JSON.stringify(caixa));
});
