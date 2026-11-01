// Gerador de casos (P12): o mundo, as mutações e o encaixe no rodador. Na CPU: todo caso do manifesto monta (base e,
// com especificação, a errada e os graus), é determinístico, a página da errada não cita a classe nem a mutação, os
// bloqueados são só os da largura do motor, e o rodador acha os casos e tira a amostra estratificada com semente.
// Na placa (sob flock -s): uma classe de cada motor nos dois sentidos (a regra acusa a errada e passa a base).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { RAIZ } from "./catalogo.ts";
import { deClasse, lerManifesto } from "./expandir.ts";
import { paraHtml } from "./mundo.ts";
import { cinza, valor } from "./mutacoes.ts";
import { cenaDe, chaveDaMidia, chaveDaPagina, ESPERADO, evidenciaDe, lerEspecificacoes, pairwise, semIdentidade } from "./provas.ts";
import { avaliarRegra, MEDIDAS, precisaDe } from "./motores.ts";
import { paraItem } from "./adaptador.ts";
import { assinatura, mesmice } from "./mesmice.ts";
import { casosDoGerador } from "../bench/rodar.ts";
import { casosDe } from "./provar.ts";
import { RETRATO } from "../bench/molde.ts";

const casos = deClasse(lerManifesto());
const es = lerEspecificacoes();
const semPlaca = spawnSync("nvidia-smi", ["-L"]).status !== 0 || !existsSync(join(RAIZ, "nativo", "nativo.node")) || !existsSync(RETRATO.arquivo);

test("contas das especificações: «=conta», «{=conta}» e o cinza de contraste dado", () => {
  assert.equal(valor("=g*S", { g: 0.5, S: 100 }), 50);
  assert.equal(valor("{=g*S}px", { g: 0.5, S: 100 }), "50px");
  assert.equal(valor("setTimeout(() => { x(); }, 3)", {}), "setTimeout(() => { x(); }, 3)");
  assert.throws(() => valor("=process.exit()", {}));
  assert.throws(() => valor("=Math.constructor", {}));
  assert.throws(() => valor("=Math.random()", {}));
  assert.throws(() => valor("=(Math.round = 1)", {}));
  assert.equal(cinza(0, 21), "#ffffff");
});

test("toda especificação usa medida conhecida e todo caso do manifesto monta a base e as variantes, sem citar a classe", () => {
  let bloqueados = 0;
  for (const e of Object.values(es)) if (!e.rodada) assert.ok(MEDIDAS[e.regra.medida], `${e.classe}: ${e.regra.medida}`);
  for (const c of casos) {
    const e = es[c.classe];
    if (!e) continue;
    const base = cenaDe(c, e, "base");
    if (base.tarefa.bloqueio) { bloqueados++; assert.match(base.tarefa.bloqueio, /800/); }
    if (e.rodada) continue;
    const errada = cenaDe(c, e, "errada");
    assert.ok(semIdentidade(errada, e), c.id);
    assert.notEqual(paraHtml(errada) + JSON.stringify(errada.entrega ?? null) + JSON.stringify(errada.ativos), paraHtml(base) + JSON.stringify(base.ativos), `${c.id}: a errada é igual à base`);
    const g = c.grau as "abaixo" | "no" | "acima";
    if (c.grau !== "unico" && e.graus?.[g] !== undefined) cenaDe(c, e, g);
  }
  // Só os da largura mínima do motor (720p em vertical, 1:1 e 4:5), 128 casos em 2026-11-01.
  assert.ok(bloqueados > 0 && bloqueados <= 128, `${bloqueados} bloqueados`);
});

test("a cena é determinística: o mesmo caso dá a mesma página", () => {
  const c = casos.find((x) => es[x.classe] && !es[x.classe].rodada)!;
  assert.equal(paraHtml(cenaDe(c, es[c.classe], "errada")), paraHtml(cenaDe(c, es[c.classe], "errada")));
});

test("a base usa só fonte embutida (@font-face com o arquivo junto); da máquina, só a família do árabe e do japonês", () => {
  const DA_MAQUINA = new Set(["Noto Sans Arabic", "Droid Sans Fallback"]);
  for (const c of casos) {
    if (!es[c.classe] || es[c.classe].rodada) continue;
    const base = cenaDe(c, es[c.classe], "base"), html = paraHtml(base);
    const faces = [...html.matchAll(/@font-face \{ font-family: "([^"]+)"; src: url\("([^"]+)"\)[^}]*font-weight: ([^;]+);/g)];
    const declaradas = new Set(faces.map((m) => m[1]));
    for (const [, familia, arq] of faces) assert.ok(base.ativos[arq], `${c.id}: ${familia} sem o arquivo ${arq}`);
    // Regular e negrito nas embutidas: um peso sem face cairia no outro e a errada que muda o peso não mudaria o quadro.
    for (const familia of ["Teste Sans", "Teste Serif"])
      assert.deepEqual(faces.filter((m) => m[1] === familia).map((m) => m[3]).sort(), ["400", "700"], `${c.id}: pesos da ${familia}`);
    for (const [, familia] of html.replace(/@font-face[^}]*\}/g, "").matchAll(/["']([^"']+)["'],\s*(?:sans-serif|serif)/g))
      assert.ok(declaradas.has(familia) || DA_MAQUINA.has(familia), `${c.id}: a família «${familia}» vem da máquina`);
  }
});

test("a chave da página e da mídia vale pelo conteúdo: a cópia do mesmo arquivo noutra pasta (outra worktree) dá a mesma", () => {
  const c = casos.find((x) => es[x.classe] && !es[x.classe].rodada)!;
  const base = cenaDe(c, es[c.classe], "base");
  const tmp = mkdtempSync(join(tmpdir(), "chave-"));
  try {
    const comLogo = (de: string) => ({ ...base, ativos: { ...base.ativos, "midia/logo.svg": { tipo: "copia" as const, de } } });
    for (const d of ["a", "b"]) { mkdirSync(join(tmp, d)); writeFileSync(join(tmp, d, "logo.svg"), "<svg/>"); }
    writeFileSync(join(tmp, "outro.svg"), "<svg></svg>");
    const [a, b, outro] = [join(tmp, "a", "logo.svg"), join(tmp, "b", "logo.svg"), join(tmp, "outro.svg")];
    assert.equal(chaveDaPagina(comLogo(a)), chaveDaPagina(comLogo(b)));
    assert.notEqual(chaveDaPagina(comLogo(a)), chaveDaPagina(comLogo(outro)));
    assert.equal(chaveDaMidia({ tipo: "copia", de: a }), chaveDaMidia({ tipo: "copia", de: b }));
    assert.notEqual(chaveDaMidia({ tipo: "copia", de: a }), chaveDaMidia({ tipo: "copia", de: outro }));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("todo caso vira Item do degrau 1 com o oráculo da especificação (ou o motivo de não ter)", () => {
  for (const c of casos) {
    const item = paraItem(c, es);
    assert.equal(item.id, c.id);
    // Sem oráculo por caso: sem especificação, métrica da rodada (K-IA-09) ou desligada pelos rótulos do responsável.
    if (es[c.classe] && !es[c.classe].rodada && !es[c.classe].desligada) { assert.ok(item.avaliarProprio, c.id); assert.ok(item.pedido.length > 20, c.id); }
    else assert.ok(item.semOraculo, c.id);
  }
});

test("rodador: filtro por classe, grau e forma; amostra estratificada e repetível pela semente", () => {
  const a = casosDoGerador({ classe: ["K-DES-07"], grau: ["unico"] });
  assert.ok(a.length > 0 && a.every((c) => c.forma === "classe" && c.classe === "K-DES-07" && c.grau === "unico"));
  const s1 = casosDoGerador({ amostra: 60, semente: 7 }), s2 = casosDoGerador({ amostra: 60, semente: 7 }), s3 = casosDoGerador({ amostra: 60, semente: 8 });
  assert.deepEqual(s1.map((c) => c.id), s2.map((c) => c.id));
  assert.notDeepEqual(s1.map((c) => c.id), s3.map((c) => c.id));
  assert.ok(new Set(s1.map((c) => c.forma === "classe" ? c.classe : "composta")).size >= 55, "60 casos de classes diferentes");
  assert.equal(casosDoGerador({ forma: "composta" }).length, 255);
});

test("pairwise cobre todo par de valores com menos casos que o produto", () => {
  const cs = casos.filter((c) => c.classe === "K-DES-08" && c.grau === "unico");
  const p = pairwise(cs, 100);
  const pares = (l: typeof cs) => new Set(l.flatMap((c) => { const k = Object.keys(c.eixos); return k.flatMap((a, i) => k.slice(i + 1).map((b) => `${a}=${c.eixos[a]}|${b}=${c.eixos[b]}`)); }));
  assert.deepEqual(pares(p), pares(cs));
  assert.ok(p.length < cs.length);
});

test("mesmice (K-IA-09): a mesma página é 1; páginas de casos diferentes ficam abaixo", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const d = mkdtempSync(join(tmpdir(), "kodecz-mesmice-"));
  try {
    const c1 = casos.find((c) => c.classe === "K-DES-07")!, c2 = casos.find((c) => c.classe === "K-IA-01")!;
    const a = paraHtml(cenaDe(c1, es[c1.classe], "base")), b = paraHtml(cenaDe(c2, es[c2.classe], "errada"));
    assert.ok(assinatura(a).size > 10);
    writeFileSync(join(d, "a.html"), a); writeFileSync(join(d, "a2.html"), a); writeFileSync(join(d, "b.html"), b);
    assert.equal(mesmice([join(d, "a.html"), join(d, "a2.html")]), 1);
    assert.ok(mesmice([join(d, "a.html"), join(d, "b.html")])! < 1);
    assert.equal(mesmice([join(d, "a.html")]), null);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

const AMOSTRA = ["K-DES-07", "K-EDI-01", "K-AUD-01", "K-COD-01", "K-DES-08", "K-COR-01"];
test("na placa: uma classe por motor, nos dois sentidos (base certa, errada acusada)", { skip: semPlaca && "sem placa, nativo ou retrato" }, async () => {
  for (const k of AMOSTRA.filter((x) => es[x])) {
    const e = es[k], c = casosDe(k, 1)[0];
    const base = await evidenciaDe(cenaDe(c, e, "base"), { render: precisaDe(e.regra).render });
    const errada = await evidenciaDe(cenaDe(c, e, "errada"), { antes: base, render: precisaDe(e.regra).render });
    assert.equal(avaliarRegra(e.regra, base).status, ESPERADO.base, `${k} base: ${avaliarRegra(e.regra, base).motivo}`);
    assert.equal(avaliarRegra(e.regra, errada).status, ESPERADO.errada, `${k} errada: ${avaliarRegra(e.regra, errada).motivo}`);
  }
});

test("na placa: o caminho do rodador (Item → preparar → solução à mão → avaliar) acusa a errada e passa a certa", { skip: semPlaca && "sem placa, nativo ou retrato" }, async () => {
  const { avaliar } = await import("../bench/avaliar.ts");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const c = pairwise(casos.filter((x) => x.classe === "K-DES-08" && x.grau === "unico"), 1)[0];
  const item = paraItem(c, es);
  const t = mkdtempSync(join(tmpdir(), "kodecz-item-"));
  try {
    item.preparar(t);
    item.errada(t);
    assert.equal((await avaliar(item, t)).status, "erro");
    item.certa(t);
    assert.equal((await avaliar(item, t)).status, "certo");
  } finally { rmSync(t, { recursive: true, force: true }); }
});
