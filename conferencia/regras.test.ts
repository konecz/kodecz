// Testes das regras da conferência (S04), funções puras sobre a geometria, os rostos e as falas, sem Electron.
// Rodar: node --test "conferencia/*.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { comMargem, conferirZoom, escalasDoApresentador, faixaSaindo, interpolarRosto, intersecao, LIMITES, linhas,
  quadrosAmostrados, rostoNaTela, rostoRelativo, textosTremendo, trechos, zooms, type Caixa, type Fala, type Geometria } from "./regras.ts";
import { conferir } from "./conferir.ts";

const perto = (a: number[], b: number[], eps = 1e-6) => a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < eps, `${a} ≠ ${b}`));

test("linhas: spans e tamanhos diferentes na mesma linha dão 1; quebra dá 2", () => {
  assert.equal(linhas([]), 0);
  assert.equal(linhas([[10, 100, 80, 40], [95, 100, 60, 40], [160, 104, 50, 32]]), 1);
  // Sobrescrito: caixa menor, mais alta, mas que cobre mais da metade da menor altura.
  assert.equal(linhas([[10, 100, 80, 40], [92, 92, 20, 24]]), 1);
  assert.equal(linhas([[10, 100, 300, 40], [10, 142, 120, 40]]), 2);
  // Escala por transform: tudo maior, mesma linha.
  assert.equal(linhas([[10, 100, 160, 80], [175, 100, 120, 80]]), 1);
  assert.equal(linhas([[0, 0, 10, 10], [0, 20, 10, 10], [0, 40, 10, 10]]), 3);
});

test("margem do rosto: +25 % em cima, +10 % embaixo e nos lados", () => {
  perto(comMargem([100, 100, 100, 200]), [90, 50, 120, 270]);
  assert.deepEqual(LIMITES.margemRosto, { cima: 0.25, baixo: 0.10, lados: 0.10 });
});

test("interseção com margem: encostando no queixo passa sem margem e falha com ela; longe passa", () => {
  const rosto: Caixa = [100, 100, 100, 200];
  const texto: Caixa = [80, 305, 200, 30]; // 5 px abaixo do queixo
  assert.equal(intersecao(texto, rosto), 0);
  assert.ok(intersecao(texto, comMargem(rosto)) > 0);
  assert.equal(intersecao([400, 400, 50, 20], comMargem(rosto)), 0);
  assert.equal(intersecao([0, 0, 10, 10], [5, 5, 10, 10]), 25);
});

test("rosto relativo ao apresentador, levado pelo zoom 1,0 → 1,3", () => {
  const ap0: Caixa = [0, 0, 400, 600];
  const rosto: Caixa = [150, 100, 100, 120];
  const rel = rostoRelativo(rosto, ap0);
  perto(rel, [0.375, 1 / 6, 0.25, 0.2]);
  // Zoom de 1,3 pelo centro do apresentador: caixa (−60, −90, 520, 780).
  perto(rostoNaTela(rel, [-60, -90, 520, 780]), [-60 + 0.375 * 520, -90 + 780 / 6, 130, 156]);
});

test("interpolação do rosto entre amostras; fora delas, a mais próxima; sem amostra com rosto, null", () => {
  const a = [{ n: 0, rel: [0, 0, 0.2, 0.2] as Caixa }, { n: 10, rel: [0.1, 0.2, 0.2, 0.2] as Caixa }, { n: 20, rel: null }];
  perto(interpolarRosto(a, 5)!, [0.05, 0.1, 0.2, 0.2]);
  perto(interpolarRosto(a, 0)!, [0, 0, 0.2, 0.2]);
  perto(interpolarRosto(a, 25)!, [0.1, 0.2, 0.2, 0.2]);
  assert.equal(interpolarRosto([{ n: 0, rel: null }], 0), null);
  assert.equal(interpolarRosto([], 3), null);
});

/** Escala de N quadros: base 1, com trechos [de, ate, valor final] interpolados linearmente. */
function escalas(total: number, passos: [number, number, number][], lenta = 0): (number | null)[] {
  const s: number[] = [];
  let v = 1;
  for (let n = 0; n < total; n++) {
    for (const [de, ate, alvo] of passos) if (n > de && n <= ate) v += (alvo - v) / (ate - n + 1);
    s.push(v * (1 + lenta * n));
  }
  return s;
}

test("zooms: punch-in de 6 quadros com saída de 6; aproximação lenta de 3 % em 5 s ignorada", () => {
  const z = zooms(escalas(120, [[20, 26, 1.2], [70, 76, 1]]));
  assert.equal(z.length, 1);
  assert.equal(z[0].entrada, 21);
  assert.equal(z[0].saida, 71);
  assert.equal(z[0].corte, false);
  assert.deepEqual(zooms(escalas(150, [], 0.03 / 150)), []);
});

test("zooms: punch-in sobre a aproximação lenta; subida lenta demais (5 % em 30 quadros) não é punch-in", () => {
  const z = zooms(escalas(150, [[30, 34, 1.15], [90, 96, 1]], 0.03 / 150));
  assert.equal(z.length, 1);
  assert.equal(z[0].entrada, 31);
  assert.equal(z[0].saida, 91);
  assert.deepEqual(zooms(escalas(120, [[10, 40, 1.05]])), []);
});

test("zooms: corte de cena com o zoom ativo e fim do vídeo contam como saída", () => {
  const s = escalas(100, [[10, 12, 1.3]]);
  s[50] = null; // o apresentador sai
  const z = zooms(s);
  assert.equal(z.length, 1);
  assert.equal(z[0].saida, 50);
  assert.equal(z[0].corte, true);
  const fim = zooms(escalas(40, [[10, 12, 1.3]]));
  assert.equal(fim[0].saida, 40);
  assert.equal(fim[0].corte, true);
});

// Fala com duas frases: «Isto muda tudo. Agora veja.», em segundos.
const FALAS: Fala[] = [
  { t: "Isto", ini: 0.5, fim: 0.8, bloco: 1 }, { t: "muda", ini: 0.8, fim: 1.1, bloco: 1 },
  { t: "tudo.", ini: 1.1, fim: 1.6, bloco: 1 }, { t: "Agora", ini: 2.2, fim: 2.6, bloco: 1 },
  { t: "veja.", ini: 2.6, fim: 3.0, bloco: 1 },
];
const QPS = 30;
const zoom = (entrada: number, saida: number) => ({ entrada, pico: entrada + 3, saida, corte: false });
const semFaixa = (total: number) => Array.from({ length: total }, () => [] as string[]);

test("zoom passa: entra em «muda» e sai na pausa entre as frases", () => {
  const r = conferirZoom(zoom(26, 54), FALAS, semFaixa(120), QPS, 120);
  assert.deepEqual(r.falhas, []);
  assert.deepEqual(r.avisos, []);
});

test("zoom falha: saída por duração fixa, antes do ponto, com quanto faltou em ms", () => {
  const r = conferirZoom(zoom(26, 41), FALAS, semFaixa(120), QPS, 120);
  assert.equal(r.falhas.length, 1);
  assert.match(r.falhas[0].motivo, /zoom returns 233 ms before the end of the sentence «Isto muda tudo\.»/);
});

test("zoom falha: saída já na frase seguinte", () => {
  const r = conferirZoom(zoom(26, 70), FALAS, semFaixa(120), QPS, 120);
  assert.equal(r.falhas.length, 1);
  assert.match(r.falhas[0].motivo, /zoom returns during the next sentence/);
});

test("zoom: a borda de 1 quadro nos dois lados", () => {
  // Fim da frase em 1,6 s = quadro 48; próxima palavra em 2,2 s = quadro 66.
  assert.deepEqual(conferirZoom(zoom(26, 47), FALAS, semFaixa(120), QPS, 120).falhas, []);
  assert.equal(conferirZoom(zoom(26, 46), FALAS, semFaixa(120), QPS, 120).falhas.length, 1);
  assert.deepEqual(conferirZoom(zoom(26, 67), FALAS, semFaixa(120), QPS, 120).falhas, []);
  assert.equal(conferirZoom(zoom(26, 68), FALAS, semFaixa(120), QPS, 120).falhas.length, 1);
});

test("zoom: frase sem pausa dá aviso; zoom sem fala dá aviso", () => {
  const colada = FALAS.map((f) => (f.t === "Agora" ? { ...f, ini: 1.6 } : f));
  const r = conferirZoom(zoom(26, 48), colada, semFaixa(120), QPS, 120);
  assert.deepEqual(r.falhas, []);
  assert.match(r.avisos.join("\n"), /with no pause/);
  const mudo = conferirZoom(zoom(100, 110), FALAS, semFaixa(120), QPS, 120);
  assert.match(mudo.avisos.join("\n"), /without speech/);
});

test("zoom: a faixa sai junto (até 3 quadros); a que fica dá falha", () => {
  const faixas = semFaixa(120);
  for (let n = 26; n < 57; n++) faixas[n].push("0");
  assert.deepEqual(conferirZoom(zoom(26, 54), FALAS, faixas, QPS, 120).falhas, []);
  faixas[57].push("0"); faixas[58].push("0");
  const r = conferirZoom(zoom(26, 54), FALAS, faixas, QPS, 120);
  assert.equal(r.falhas.length, 1);
  assert.match(r.falhas[0].motivo, /lower third only starts leaving 5 frames after the zoom starts returning/);
});

test("trechos: quadros seguidos viram um trecho, com o pior quadro", () => {
  const t = trechos([
    { n: 3, chave: "a", valor: 1 }, { n: 4, chave: "a", valor: 5 }, { n: 5, chave: "a", valor: 2 },
    { n: 9, chave: "a", valor: 1 }, { n: 4, chave: "b", valor: 1 },
  ]);
  assert.deepEqual(t.map((x) => [x.chave, x.de, x.ate, x.pior]), [["a", 3, 5, 4], ["b", 4, 4, 4], ["a", 9, 9, 9]]);
});

// Composição sintética de 4 quadros, 1000 × 1000, rosto no alto do apresentador.
const COMP = { id: "Teste", largura: 1000, altura: 1000, qps: 30, quadros: 4 };
const geo = (n: number, extra: Partial<Geometria> = {}): Geometria => ({
  n, apresentador: [0, 0, 1000, 1000], textos: [], legendas: [], faixas: [], naoConferidos: [], ...extra,
});
const ROSTOS = [{ n: 0, rel: [0.4, 0.2, 0.2, 0.25] as Caixa }];

test("conferir: texto sobre o rosto (G15) só nos quadros em que encosta, com o pior quadro", () => {
  const legenda = { texto: "Legenda", caixas: [[300, 800, 400, 50]] as Caixa[], estouro: false };
  const g = [0, 1, 2, 3].map((n) => geo(n, { legendas: [legenda], textos: [{ texto: "Chip", papel: null,
    caixas: [n === 1 || n === 2 ? [380, 250 + n, 100, 40] : [50, 50, 100, 40]] as Caixa[] }, { texto: "Legenda", papel: "legenda", caixas: legenda.caixas }] }));
  const r = conferir({ comp: COMP, geometrias: g, rostos: ROSTOS, falas: [] });
  assert.deepEqual(r.falhas.map((f) => [f.regra, f.de, f.ate, f.texto]), [["G15", 1, 2, "Chip"]]);
  assert.match(r.falhas[0].motivo, /text over the presenter's face/);
});

test("conferir: legenda em duas linhas e legenda cortada (G17)", () => {
  const g = [0, 1, 2, 3].map((n) => geo(n, { legendas: [
    { texto: "Duas", caixas: n < 2 ? [[300, 800, 400, 50], [300, 852, 200, 50]] : [[300, 800, 400, 50]], estouro: false },
    { texto: "Larga", caixas: [[-20, 900, 1100, 50]], estouro: n === 3 },
  ] }));
  const r = conferir({ comp: COMP, geometrias: g, rostos: ROSTOS, falas: [] });
  const g17 = r.falhas.filter((f) => f.regra === "G17").map((f) => [f.texto, f.de, f.ate]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  assert.deepEqual(g17, [["Duas", 0, 1], ["Larga", 0, 3]]);
  assert.match(r.falhas.find((f) => f.texto === "Duas")!.motivo, /caption on 2 lines/);
  assert.match(r.falhas.find((f) => f.texto === "Larga")!.motivo, /caption cut off/);
});

test("conferir: sem legenda marcada com texto na tela e sem rosto dão aviso, não falha; 9:16 sem destino não confere a zona", () => {
  const g = [0, 1, 2, 3].map((n) => geo(n, { textos: [{ texto: "Solto", papel: null, caixas: [[300, 900, 100, 40]] as Caixa[] }] }));
  const r = conferir({ comp: COMP, geometrias: g, rostos: [{ n: 0, rel: null }], falas: [] });
  assert.deepEqual(r.falhas, []);
  const avisos = r.avisos.map((a) => a.motivo).join("\n");
  assert.match(avisos, /data-papel="legenda"/);
  assert.match(avisos, /no face found/);
  const vertical = { ...COMP, largura: 540, altura: 960 };
  const gv = [0, 1, 2, 3].map((n) => geo(n, { apresentador: [0, 0, 540, 960], textos: [{ texto: "Baixo", papel: "legenda", caixas: [[100, 800, 300, 40]] as Caixa[] }],
    legendas: [{ texto: "Baixo", caixas: [[100, 800, 300, 40]], estouro: false }] }));
  const rv = conferir({ comp: vertical, geometrias: gv, rostos: ROSTOS, falas: [] });
  assert.deepEqual(rv.falhas, []);
  assert.deepEqual(rv.avisos.filter((a) => a.regra === "G19").map((a) => a.motivo), ["vertical video without data-destino on <html>: G19 (Reels and ad safe area) not checked"]);
});

// Calibração nos vídeos reais (2026-11, docs/experimentos/2026-11-s04-calibrar.md): os casos de fronteira, em sintético.

test("G15 calibrado: título que entra em fade pela testa (0,11 → 0,49) passa; a partir de 0,5 conta", () => {
  const chip = (n: number, opacidade: number) => geo(n, { textos: [{ texto: "Título", papel: null, opacidade, caixas: [[380, 250, 300, 40]] as Caixa[] }] });
  const fade = [0.11, 0.30, 0.49, 0.49].map((o, n) => chip(n, o));
  assert.deepEqual(conferir({ comp: COMP, geometrias: fade, rostos: ROSTOS, falas: [] }).falhas, []);
  const meio = [0.11, 0.30, 0.49, 0.5].map((o, n) => chip(n, o));
  const r = conferir({ comp: COMP, geometrias: meio, rostos: ROSTOS, falas: [] });
  assert.deepEqual(r.falhas.map((f) => [f.regra, f.de, f.ate]), [["G15", 3, 3]]);
  assert.equal(LIMITES.opacidadeLegivel, 0.5);
  // Sem opacidade na geometria (coleta antiga): conta como 1.
  const antiga = [0, 1, 2, 3].map((n) => geo(n, { textos: [{ texto: "Título", papel: null, caixas: [[380, 250, 300, 40]] as Caixa[] }] }));
  assert.equal(conferir({ comp: COMP, geometrias: antiga, rostos: ROSTOS, falas: [] }).falhas.length, 1);
});

test("zoom calibrado: o corte de um take no cartão para outro em tela cheia não é punch-in", () => {
  // Take A no cartão (largura 400) até o quadro 9; take B em tela cheia (largura 1000) do 10 em diante, sem zoom.
  const g = Array.from({ length: 30 }, (_, n) => geo(n, { apresentador: [0, 0, n < 10 ? 400 : 1000, 1000], take: n < 10 ? "a@0" : "b@10" }));
  const e = escalasDoApresentador(g);
  assert.equal(e[10], null);
  assert.equal(e[11], 1);
  assert.deepEqual(zooms(e), []);
  // Sem o take (coleta antiga), o salto vira punch-in: era o falso positivo dos vídeos reais.
  assert.equal(zooms(escalasDoApresentador(g.map((x) => ({ ...x, take: undefined })))).length, 1);
  // O primeiro e o último quadro de cada take entram na amostra do rosto.
  const amostra = quadrosAmostrados(g, [], 100);
  assert.ok(amostra.includes(9) && amostra.includes(10));
});

test("zoom calibrado: zoom ativo no corte de take sai como corte", () => {
  const larg = (n: number) => (n < 5 ? 1000 : n < 8 ? 1000 * (1 + 0.04 * (n - 4)) : 1120);
  const g = Array.from({ length: 30 }, (_, n) => geo(n, { apresentador: [0, 0, n < 20 ? larg(n) : 1000, 1000], take: n < 20 ? "a@0" : "b@20" }));
  const zs = zooms(escalasDoApresentador(g));
  assert.equal(zs.length, 1);
  assert.deepEqual([zs[0].saida, zs[0].corte], [20, true]);
});

test("faixa calibrada: fade de 13 quadros que começa na saída passa; que começa 2 quadros depois falha", () => {
  type F = { chave: string; opacidade?: number; caixa?: Caixa };
  const mola = [0.995, 0.929, 0.821, 0.699, 0.58, 0.473, 0.38, 0.301, 0.237, 0.185, 0.143, 0.11, 0.085, 0.065];
  const comFade = (atraso: number) => {
    const f: F[][] = Array.from({ length: 120 }, () => []);
    for (let n = 26; n < 54 + atraso; n++) f[n].push({ chave: "0", opacidade: 1 });
    mola.forEach((o, i) => f[54 + atraso + i].push({ chave: "0", opacidade: o }));
    return f;
  };
  // O quadro 54 é a saída e o fade (a mola do vídeo aprovado) começa nele: cai abaixo de 90 % no 56, 2 quadros depois.
  assert.deepEqual(conferirZoom(zoom(26, 54), FALAS, comFade(0), QPS, 120).falhas, []);
  assert.deepEqual(conferirZoom(zoom(26, 54), FALAS, comFade(1), QPS, 120).falhas, []);
  const tarde = conferirZoom(zoom(26, 54), FALAS, comFade(2), QPS, 120);
  assert.equal(tarde.falhas.length, 1);
  assert.match(tarde.falhas[0].motivo, /lower third only starts leaving 4 frames after/);
});

test("faixa calibrada: a que só flutua (anda, mas fica na tela) falha por não sumir em 30 quadros", () => {
  const f: { chave: string; opacidade: number; caixa: Caixa }[][] = Array.from({ length: 120 }, () => []);
  for (let n = 26; n < 120; n++) f[n].push({ chave: "0", opacidade: 1, caixa: [80, 900 + 3 * Math.sin(n), 600, 80] });
  const r = conferirZoom(zoom(26, 54), FALAS, f, QPS, 120);
  assert.equal(r.falhas.length, 1);
  assert.match(r.falhas[0].motivo, /lower third still on screen 66 frames after .* \(limit 30\)/);
});

test("faixa calibrada: deslizar para fora (a caixa anda) conta como saindo", () => {
  const ref = { chave: "0", opacidade: 1, caixa: [80, 900, 600, 80] as Caixa };
  assert.equal(faixaSaindo(ref, { ...ref }), false);
  assert.equal(faixaSaindo(ref, { ...ref, caixa: [80 - 11, 900, 600, 80] }), false); // 11 px < 2 % de 600
  assert.equal(faixaSaindo(ref, { ...ref, caixa: [80 - 13, 900, 600, 80] }), true);
  assert.equal(faixaSaindo(ref, { ...ref, opacidade: 0.89 }), true);
  assert.equal(faixaSaindo(ref, undefined), true);
});

// A G19 (zona segura só com destino declarado) está em paridade.test.ts.

test("tremor: texto que cresce devagar por mais de 5 s dá aviso; 5 s, a flutuação de 3,5 s e o fim de mola passam", () => {
  // Zoom lento numa tela com texto: a caixa cresce 0,3 px por quadro (30 qps); corrida de N quadros com mudança.
  const lento = (corrida: number, opacidade = 1) => Array.from({ length: corrida + 1 + 10 }, (_, n) => geo(n, { apresentador: null,
    textos: [{ texto: "Linha de teste", papel: null, opacidade, caixas: [[100, 500, 400 + 0.3 * Math.min(n, corrida), 60]] as Caixa[] }] }));
  assert.deepEqual(textosTremendo(lento(150), 30), []);
  const r = textosTremendo(lento(151), 30);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].regra, r[0].de, r[0].ate], ["tremor", 0, 151]);
  assert.match(r[0].motivo, /text «Linha de teste» drifting slowly without stopping .* for 5\.1 s: it shakes/);
  // Apagado (abaixo de 0,5) não conta.
  assert.deepEqual(textosTremendo(lento(300, 0.4), 30), []);
  // A frase que flutua no reel aprovado: 105 quadros (3,5 s).
  assert.deepEqual(textosTremendo(lento(105), 30), []);
  // Fim de mola: variações que caem até parar (abaixo de 0,05 px) não somam 5 s.
  let x = 100;
  const mola = Array.from({ length: 200 }, (_, n) => { x += 40 * Math.exp(-n / 6); return geo(n, { apresentador: null,
    textos: [{ texto: "Entra", papel: null, caixas: [[x, 500, 300, 60]] as Caixa[] }] }); });
  assert.deepEqual(textosTremendo(mola, 30), []);
  // Na conferência, sai como aviso, nunca falha.
  const c = conferir({ comp: { ...COMP, quadros: 162 }, geometrias: lento(151), rostos: [], falas: [] });
  assert.deepEqual(c.falhas, []);
  assert.equal(c.avisos.filter((a) => a.regra === "tremor").length, 1);
});

test("tremor: textos que tremem juntos (a tela respirando) viram um aviso só", () => {
  const g = Array.from({ length: 200 }, (_, n) => geo(n, { apresentador: null, textos: ["A", "B", "C"].map((texto, i) => (
    { texto, papel: null, caixas: [[100, 100 + 100 * i + 0.2 * n, 300, 60]] as Caixa[] })) }));
  const r = textosTremendo(g, 30);
  assert.equal(r.length, 1);
  assert.match(r[0].motivo, /3 texts \(like «A»\)/);
});
