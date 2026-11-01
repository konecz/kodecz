// A conferência sobre o conjunto único de regras (conferencia/conferir.ts, regras em bench-gerador/especificacoes.json)
// contra a de antes (régua congelada em fixtures/conferir-antigo.ts), nas mesmas coletas sintéticas: as falhas têm de
// ser as mesmas, regra a regra; os avisos também, fora a G19, que mudou de propósito (só com destino declarado,
// decisão do responsável de 2026-11-01). Mais a G19 com e sem destino, a G20 sobre o fundo real e as situações.
// Rodar: node --test "conferencia/*.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { conferir as conferirAntigo } from "./fixtures/conferir-antigo.ts";
import { conferir, conferir as conferirComRegras, destinoDe } from "./conferir.ts";
import { codigoNaConferencia, situacaoDe, situacaoNaConferencia } from "../bench-gerador/mutacoes.ts";
import type { Amostra, Caixa, Composicao, Fala, Fundo, Geometria } from "./regras.ts";
import { lerRegras } from "../bench-gerador/provas.ts";

type Dados = { comp: Composicao; geometrias: Geometria[]; rostos: Amostra[]; falas: Fala[] };

const geo = (n: number, extra: Partial<Geometria> = {}): Geometria => ({
  n, apresentador: [0, 0, 1000, 1000], textos: [], legendas: [], faixas: [], naoConferidos: [], ...extra,
});
const COMP: Composicao = { id: "Teste", largura: 1000, altura: 1000, qps: 30, quadros: 4 };
const ROSTOS: Amostra[] = [{ n: 0, rel: [0.4, 0.2, 0.2, 0.25] }];
const palavras = (frases: string[][], inicio = 0.3, passo = 0.3, pausa = 0.6): Fala[] => {
  const r: Fala[] = [];
  let t = inicio;
  frases.forEach((f, b) => { for (const p of f) { r.push({ t: p, ini: t, fim: t + passo * 0.8, bloco: b }); t += passo; } t += pausa; });
  return r;
};

/** Gerador determinístico (mulberry32). */
function sorteio(semente: number) {
  let a = semente >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Coleta sintética aleatória: apresentador com punch-ins e cortes de take, textos (alguns sobre o rosto, alguns em
 * fade), legendas (às vezes em duas linhas ou cortadas), faixa, texto tremendo, canvas sobre o apresentador. */
function aleatoria(semente: number, vertical: boolean): Dados {
  const r = sorteio(semente), L = vertical ? 540 : 1000, A = vertical ? 960 : 1000, total = 240 + Math.floor(r() * 120);
  const comp: Composicao = { id: `Sorteio${semente}`, largura: L, altura: A, qps: 30, quadros: total };
  const falas = palavras([["Isto", "muda", "tudo."], ["De", "verdade,", "agora."], ["Mais", "uma", "frase", "longa."], ["Fim."]], 0.4, 0.25 + r() * 0.2);
  const zoomIni = 30 + Math.floor(r() * 40), zoomFim = zoomIni + 20 + Math.floor(r() * 60), corteTake = Math.floor(total * (0.5 + r() * 0.3));
  const semAp = r() < 0.15 ? [Math.floor(total * 0.8), Math.floor(total * 0.9)] : [-1, -1];
  const geometrias: Geometria[] = [];
  for (let n = 0; n < total; n++) {
    const s = n >= zoomIni && n < zoomIni + 6 ? 1 + 0.03 * (n - zoomIni + 1) : n >= zoomIni + 6 && n < zoomFim ? 1.18 : n >= zoomFim && n < zoomFim + 6 ? 1.18 - 0.03 * (n - zoomFim + 1) : 1;
    const base = n < corteTake ? L * 0.5 : L;
    const ap: Caixa | null = n >= semAp[0] && n < semAp[1] ? null : [0, 0, base * s, A * s];
    const textos: Geometria["textos"] = [];
    // Chip que passa pelo rosto num trecho, às vezes em fade.
    const sobre = n > total * 0.3 && n < total * 0.3 + 15;
    textos.push({ texto: "Chip", papel: null, opacidade: sobre && semente % 3 === 0 ? 0.3 + n % 5 * 0.1 : 1,
      caixas: [sobre ? [base * 0.42, A * 0.22, 80, 30] : [10, 10, 80, 30]] });
    // Título que cresce devagar (tremor) em parte das sementes.
    if (semente % 2 === 0) textos.push({ texto: "Título", papel: null, caixas: [[100, A * 0.5, 300 + 0.3 * Math.min(n, 200), 50]] });
    // Rodapé perto da borda (G19 no vertical).
    textos.push({ texto: `Rodapé ${Math.floor(n / 50)}`, papel: null, caixas: [[40, A * 0.9, 200, 30]] });
    const duas = r() < 0.08, cortada = r() < 0.04;
    const leg = { texto: `Legenda ${Math.floor(n / 40)}`, caixas: (duas ? [[100, A * 0.7, 300, 40], [100, A * 0.7 + 42, 200, 40]] : [[cortada ? -10 : 100, A * 0.7, 300, 40]]) as Caixa[], estouro: false };
    textos.push({ texto: leg.texto, papel: "legenda", caixas: leg.caixas });
    const faixas = n >= zoomIni - 5 && n < zoomFim + (semente % 4 === 1 ? 50 : 2) ? [{ chave: "0\u0000Faixa", texto: "Faixa", opacidade: 1, caixa: [50, A * 0.6, 400, 60] as Caixa }] : [];
    const naoConferidos = semente % 5 === 2 && n > 100 && n < 110 ? [{ tipo: "canvas", caixa: [0, 0, 200, 200] as Caixa }] : [];
    geometrias.push(geo(n, { apresentador: ap, take: n < corteTake ? "a@0" : "b@1", textos, legendas: [leg], faixas, naoConferidos }));
  }
  const rostos: Amostra[] = [];
  for (let n = 0; n < total; n += 10) rostos.push({ n, rel: r() < 0.1 ? null : [0.4 + r() * 0.02, 0.2, 0.2, 0.25] });
  return { comp, geometrias, rostos, falas: semente % 7 === 3 ? [] : falas };
}

/** As coletas dos testes de regras.ts (os casos de fronteira) e as aleatórias. */
function coletas(): [string, Dados][] {
  const chip = (o: number[]) => o.map((opacidade, n) => geo(n, { textos: [{ texto: "Título", papel: null, opacidade, caixas: [[380, 250, 300, 40]] as Caixa[] }] }));
  const legenda = { texto: "Legenda", caixas: [[300, 800, 400, 50]] as Caixa[], estouro: false };
  const lista: [string, Dados][] = [
    ["G15 chip", { comp: COMP, rostos: ROSTOS, falas: [], geometrias: [0, 1, 2, 3].map((n) => geo(n, { legendas: [legenda], textos: [
      { texto: "Chip", papel: null, caixas: [n === 1 || n === 2 ? [380, 250 + n, 100, 40] : [50, 50, 100, 40]] as Caixa[] },
      { texto: "Legenda", papel: "legenda", caixas: legenda.caixas }] })) }],
    ["G17", { comp: COMP, rostos: ROSTOS, falas: [], geometrias: [0, 1, 2, 3].map((n) => geo(n, { legendas: [
      { texto: "Duas", caixas: n < 2 ? [[300, 800, 400, 50], [300, 852, 200, 50]] : [[300, 800, 400, 50]], estouro: false },
      { texto: "Larga", caixas: [[-20, 900, 1100, 50]], estouro: n === 3 }] })) }],
    ["avisos", { comp: COMP, rostos: [{ n: 0, rel: null }], falas: [], geometrias: [0, 1, 2, 3].map((n) => geo(n, { textos: [{ texto: "Solto", papel: null, caixas: [[300, 900, 100, 40]] as Caixa[] }] })) }],
    ["fade", { comp: COMP, rostos: ROSTOS, falas: [], geometrias: chip([0.11, 0.30, 0.49, 0.5]) }],
    ["sem apresentador", { comp: COMP, rostos: [], falas: [], geometrias: [0, 1].map((n) => geo(n, { apresentador: null })) }],
  ];
  for (let s = 1; s <= 24; s++) lista.push([`sorteio ${s}`, aleatoria(s, s % 2 === 1)]);
  return lista;
}

const semG19 = <T extends { regra: string }>(xs: T[]) => xs.filter((x) => x.regra !== "G19");
const ordenar = <T>(xs: T[]) => [...xs].map((x) => JSON.stringify(x)).sort();

test("paridade regra a regra: a mesma falha (G15, G17, G21) e os mesmos avisos que a conferência de antes", () => {
  let falhas = 0;
  for (const [nome, d] of coletas()) {
    const antes = conferirAntigo(d), agora = conferir(d);
    for (const regra of ["G15", "G17", "G21"]) {
      assert.deepEqual(agora.falhas.filter((f) => f.regra === regra), antes.falhas.filter((f) => f.regra === regra), `${nome}: ${regra}`);
    }
    assert.deepEqual(agora.falhas, antes.falhas, `${nome}: ordem das falhas`);
    assert.deepEqual(ordenar(semG19(agora.avisos)), ordenar(semG19(antes.avisos)), `${nome}: avisos`);
    assert.deepEqual(agora.zooms, antes.zooms, `${nome}: zooms`);
    falhas += antes.falhas.length;
  }
  // As coletas exercitam as três regras (senão a paridade seria vazia).
  assert.ok(falhas > 30, `só ${falhas} falhas nas coletas`);
});

test("G19 sem destino não acusa; com destino Reels ou anúncio acusa como falha (K-PLA-01 é automática)", () => {
  const vertical: Composicao = { ...COMP, largura: 540, altura: 960, quadros: 6 };
  const digitos = ["(", "(0", "(00", "(00)", "(00) 9", "(00) 91"];
  const g = digitos.map((texto, n) => geo(n, { apresentador: null, textos: [
    { texto, papel: null, caixas: [[100, 800, 40 + 10 * n, 40]] as Caixa[] },
    { texto: "Entrando", papel: null, opacidade: 0.3, caixas: [[5, 100, 100, 40]] as Caixa[] },
  ] }));
  const d = { comp: vertical, geometrias: g, rostos: [], falas: [] };
  // A régua antiga avisava em todo vertical; agora, sem destino, nada.
  assert.equal(conferirAntigo(d).avisos.filter((a) => a.regra === "G19").length, 1);
  const sem = conferir(d);
  assert.deepEqual(sem.falhas.filter((x) => x.regra === "G19"), []);
  // Só o aviso de cobertura: vertical sem destino, a zona não foi conferida.
  assert.deepEqual(sem.avisos.filter((x) => x.regra === "G19").map((a) => a.motivo), ["vídeo vertical sem data-destino no <html>: G19 (zona segura do Reels e do anúncio) não conferida"]);
  assert.match(conferir({ ...d, destino: "site" }).avisos.map((a) => a.motivo).join("\n"), /data-destino «site» desconhecido/);
  assert.deepEqual(conferir({ ...d, destino: "youtube" }).falhas.filter((f) => f.regra === "G19"), []);
  for (const destino of ["reels", "anuncio"]) {
    const r = conferir({ ...d, destino });
    const g19 = r.falhas.filter((f) => f.regra === "G19");
    assert.equal(g19.length, 1, destino);
    assert.deepEqual([g19[0].de, g19[0].ate], [0, 5]);
    assert.match(g19[0].motivo, /6 textos \(como «\(»\) fora da zona segura/);
    assert.doesNotMatch(g19[0].motivo, /Entrando/);
  }
  // 16:9 num anúncio: o quadro vai no meio da tela do celular; só o texto na borda de baixo cai na zona da interface.
  const deitado: Composicao = { ...COMP, largura: 1920, altura: 1080, quadros: 2 };
  const meio = [0, 1].map((n) => geo(n, { apresentador: null, textos: [{ texto: "Meio", papel: null, caixas: [[800, 500, 300, 60]] as Caixa[] }] }));
  assert.deepEqual(conferir({ comp: deitado, geometrias: meio, rostos: [], falas: [], destino: "anuncio" }).falhas, []);
  const borda = [0, 1].map((n) => geo(n, { apresentador: null, textos: [{ texto: "Borda", papel: null, caixas: [[800, 1040, 300, 38]] as Caixa[] }] }));
  assert.equal(conferir({ comp: deitado, geometrias: borda, rostos: [], falas: [], destino: "anuncio" }).falhas.length, 1);
});

test("destino: data-destino normalizado (caixa, espaços e acento); outro valor fica como veio", () => {
  assert.equal(destinoDe(" Reels "), "reels");
  assert.equal(destinoDe("anúncio"), "anuncio");
  assert.equal(destinoDe("TikTok"), "tiktok");
  assert.equal(destinoDe("site"), "site");
  assert.equal(destinoDe(""), null);
  assert.equal(destinoDe(null), null);
});

/** Um texto com fundo real medido (o que a coleta grava no comando «fundos»). */
const fundo = (n: number, cor: string, rgb: [number, number, number], fs = 40, fw = 400, texto = "Texto de teste"): Fundo =>
  ({ n, textos: [{ texto, papel: null, cor, fs, fw, caixas: [[100, 100, 400, 50]], fundo: rgb }] });

test("G20 sobre o fundo real (com a situação da classe, automática): branco sobre claro falha; sobre escuro passa; texto grande pede 3:1 e o pequeno 4,5:1", () => {
  const d = { comp: COMP, geometrias: [geo(0), geo(1)], rostos: ROSTOS, falas: [] };
  // Sem a sobreposição «aviso» da conferência: vale a situação da K-COR-01 (automática), a do bench.
  const regras = lerRegras(), auto = { ...regras, "K-COR-01": { ...regras["K-COR-01"], conferencia: "G20" } };
  const conferir = (x: Parameters<typeof conferirComRegras>[0]) => conferirComRegras(x, { regras: auto });
  const claro = conferir({ ...d, fundos: [fundo(0, "rgb(255, 255, 255)", [235, 235, 235]), fundo(30, "rgb(255, 255, 255)", [230, 230, 230])] });
  const g20 = claro.falhas.filter((f) => f.regra === "G20");
  assert.equal(g20.length, 1);
  assert.deepEqual([g20[0].de, g20[0].ate, g20[0].pior], [0, 30, 0]);
  assert.match(g20[0].motivo, /contraste 1,19:1 sobre o fundo real \(mínimo 3:1 para texto grande\)/);
  assert.deepEqual(conferir({ ...d, fundos: [fundo(0, "rgb(255, 255, 255)", [10, 10, 10])] }).falhas, []);
  // Cinza #777 sobre branco dá 4,48:1: falha no pequeno (4,5), passa no grande (24 px) e no negrito de 18,66 px.
  const cinza = (fs: number, fw: number) => conferir({ ...d, fundos: [fundo(0, "rgb(119, 119, 119)", [255, 255, 255], fs, fw)] }).falhas.length;
  assert.deepEqual([cinza(16, 400), cinza(24, 400), cinza(19, 700), cinza(19, 400)], [1, 0, 0, 1]);
  // O trecho vai só da primeira à última amostra seguida que quebra: bom em 0 e 90, ruim em 30 e 60, bom em 120, ruim em 150.
  const bom: [number, number, number] = [10, 10, 10], ruim: [number, number, number] = [240, 240, 240];
  const serie = [bom, ruim, ruim, bom, bom, ruim].map((f, i) => fundo(30 * i, "rgb(255, 255, 255)", f));
  assert.deepEqual(conferir({ ...d, fundos: serie }).falhas.map((f) => [f.regra, f.de, f.ate]), [["G20", 30, 60], ["G20", 150, 150]]);
  // Sem fundo medido (sem texto legível, ou coleta sem o comando): G20 não acusa.
  assert.deepEqual(conferir(d).falhas, []);
  // Texto sem letra nem número (traço, ponto) não conta.
  assert.deepEqual(conferir({ ...d, fundos: [fundo(0, "rgb(255, 255, 255)", [250, 250, 250], 40, 400, "—")] }).falhas, []);
});

test("G20 na conferência é aviso (sobreposta no campo conferencia); no bench a K-COR-01 segue automática", () => {
  const regras = lerRegras(), e = regras["K-COR-01"];
  assert.deepEqual(e.conferencia, { codigo: "G20", situacao: "aviso" });
  assert.equal(situacaoDe(e), "automatica");
  assert.equal(situacaoNaConferencia(e), "aviso");
  const d = { comp: COMP, geometrias: [geo(0), geo(1)], rostos: ROSTOS, falas: [], fundos: [fundo(0, "rgb(255, 255, 255)", [235, 235, 235])] };
  const r = conferir(d);
  assert.deepEqual(r.falhas.filter((f) => f.regra === "G20"), []);
  const av = r.avisos.filter((a) => a.regra === "G20");
  assert.equal(av.length, 1);
  assert.match(av[0].motivo, /contraste 1,19:1 sobre o fundo real/);
  assert.equal(r.regras.find((x) => x.regra === "G20")!.situacao, "aviso");
  // A sobreposição só vale na conferência: sem ela, a mesma regra acusa falha.
  const semSobrepor = { ...regras, "K-COR-01": { ...e, conferencia: "G20" } };
  assert.equal(conferir(d, { regras: semSobrepor }).falhas.filter((f) => f.regra === "G20").length, 1);
  // E a sobreposição «desligada» tira a regra da conferência.
  const desligada = { ...regras, "K-COR-01": { ...e, conferencia: { codigo: "G20", situacao: "desligada" as const } } };
  assert.equal(conferir(d, { regras: desligada }).regras.some((x) => x.regra === "G20"), false);
});

test("situação vem da especificação: aviso vira aviso; desligada não roda", () => {
  const d: Dados = coletas()[0][1];
  assert.equal(conferir(d).falhas.filter((f) => f.regra === "G15").length, 1);
  const regras = lerRegras();
  const comAviso = { ...regras, "K-DES-08": { ...regras["K-DES-08"], aviso: "teste" } };
  const r = conferir(d, { regras: comAviso });
  assert.deepEqual(r.falhas.filter((f) => f.regra === "G15"), []);
  const av = r.avisos.filter((a) => a.regra === "G15" && /texto sobre o rosto/.test(a.motivo));
  assert.equal(av.length, 1);
  assert.deepEqual([av[0].de, av[0].ate], [1, 2]);
  const desligada = { ...regras, "K-DES-08": { ...regras["K-DES-08"], desligada: "teste" } };
  const r2 = conferir(d, { regras: desligada });
  assert.deepEqual([...r2.falhas, ...r2.avisos].filter((x) => /texto sobre o rosto/.test(x.motivo)), []);
});

test("o conjunto único: cada código da conferência uma vez, com medida conhecida; as regras só da conferência ficam fora do bench", async () => {
  const { MEDIDAS } = await import("../bench-gerador/motores.ts");
  const { lerEspecificacoes } = await import("../bench-gerador/provas.ts");
  const regras = lerRegras(), classes = lerEspecificacoes();
  const daConferencia = Object.values(regras).filter((e) => codigoNaConferencia(e));
  assert.deepEqual(daConferencia.map((e) => codigoNaConferencia(e)).sort(), ["G15", "G17", "G19", "G20", "G21", "tremor"]);
  for (const e of daConferencia) assert.ok(MEDIDAS[e.regra.medida], `${codigoNaConferencia(e)}: ${e.regra.medida}`);
  assert.deepEqual(Object.fromEntries(daConferencia.filter((e) => !("so" in e)).map((e) => [codigoNaConferencia(e), e.classe])),
    { G15: "K-DES-08", G19: "K-PLA-01", G20: "K-COR-01" });
  assert.equal(Object.keys(classes).length, 106);
  assert.ok(Object.keys(classes).every((k) => k.startsWith("K-")));
});

test("medida que quebra não vira aprovação: a conferência sai com erro", () => {
  const regras = { ...lerRegras(), G17: { ...lerRegras().G17, regra: { medida: "naoExiste", op: ">", limite: 0 } } } as any;
  assert.throws(() => conferir(coletas()[1][1], { regras }), /G17 \(naoExiste\): medida desconhecida/);
});
