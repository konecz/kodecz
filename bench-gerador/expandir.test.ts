// Gerador de casos (P12): a expansão é determinística, o id só muda com o conteúdo, não há repetição disfarçada e o
// total fica na meta. Sem placa nem navegador (segundos).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lerCatalogo, peso, porPeso, valoresNominais, type Catalogo } from "./catalogo.ts";
import { conferirRegras, efetivo, REGRAS, SEM_GRAU } from "./efetivo.ts";
import { canonico, expandir, graduavel, idDe, MANIFESTO, META, serializar, type Caso } from "./expandir.ts";

const cat = lerCatalogo();
const copia = (): Catalogo => JSON.parse(JSON.stringify(cat));
const chave = (c: Pick<Caso, "classe" | "eixos" | "grau">) => canonico({ classe: c.classe, eixos: c.eixos, grau: c.grau });

test("as regras do efetivo conferem com a base (classe, eixo e valor existem; porquê escrito)", () => {
  assert.deepEqual(conferirRegras(cat), []);
});

test("determinismo: a mesma base dá o mesmo manifesto, byte a byte, e é o casos.jsonl do repositório", () => {
  const tudo = (x: Catalogo) => { const e = expandir(x); return serializar(e.casos, e.compostas); };
  const a = tudo(cat), b = tudo(lerCatalogo());
  assert.equal(a, b);
  assert.equal(readFileSync(MANIFESTO, "utf8"), a, "casos.jsonl desatualizado: node bench-gerador/expandir.ts");
});

test("a ordem das classes na base não muda o manifesto", () => {
  const c = copia();
  c.classes.reverse();
  assert.equal(serializar(expandir(c).casos), serializar(expandir(cat).casos));
});

test("id: hash do conteúdo, único, e igual ao recalculado", () => {
  const { casos } = expandir(cat);
  assert.equal(new Set(casos.map((c) => c.id)).size, casos.length);
  for (const c of casos) assert.equal(c.id, idDe(c));
});

test("id estável: título e peso de uma classe não mudam os ids (só a ordem)", () => {
  const c = copia();
  const k = c.classes.find((x) => x.id === "K-AUD-03")!;
  k.titulo = "outro título";
  k.frequencia += 1; // peso 6 → 9: muda de lugar no manifesto
  const ids = (x: Catalogo) => new Set(expandir(x, Infinity).casos.map((y) => y.id));
  assert.deepEqual(ids(c), ids(cat));
});

test("id estável: um valor novo num eixo só acrescenta casos nas classes que usam o eixo; os outros ficam", () => {
  const c = copia();
  c.eixos.bpm.valores.push("90");
  const antes = expandir(cat, Infinity).casos, depois = expandir(c, Infinity).casos;
  const novos = new Set(depois.map((x) => x.id));
  for (const x of antes) assert.ok(novos.has(x.id), `${x.id} sumiu`);
  const usam = new Set(cat.classes.filter((x) => x.eixos.includes("bpm")).map((x) => x.id));
  for (const x of depois) if (!usam.has(x.classe)) assert.ok(antes.some((y) => y.id === x.id), `${x.id} apareceu numa classe sem bpm`);
  assert.ok(depois.length > antes.length);
});

test("sem repetição disfarçada: cada caso é um valor efetivo distinto, e os efetivos cobrem o produto nominal", () => {
  const { casos } = expandir(cat);
  assert.equal(new Set(casos.map(chave)).size, casos.length, "dois casos com os mesmos valores efetivos");
  for (const k of cat.classes) {
    // O produto nominal dos eixos da classe, levado ao efetivo, dá exatamente os casos dela (sem os excluídos).
    let tuplas: Record<string, string>[] = [{}];
    for (const e of k.eixos) tuplas = tuplas.flatMap((t) => valoresNominais(cat, k, e).map((v) => ({ ...t, [e]: v })));
    const efetivos = new Set<string>();
    for (const t of tuplas) {
      const ef: Record<string, string> = {};
      let fora = false;
      for (const e of k.eixos) { const v = efetivo(cat, k, e, t[e]); if (v === null) fora = true; else ef[e] = v; }
      if (!fora) efetivos.add(canonico(ef));
    }
    const daClasse = casos.filter((c) => c.classe === k.id && (c.grau === "unico" || c.grau === "abaixo"));
    assert.deepEqual(new Set(daClasse.map((c) => canonico(c.eixos))), efetivos, k.id);
  }
});

test("efetivo, exemplos: português e inglês juntos onde só a largura conta; RTL só com árabe; vídeo sem som com 4 casos", () => {
  const { casos } = expandir(cat);
  const de = (id: string) => casos.filter((c) => c.classe === id && c.grau !== "no" && c.grau !== "acima");
  assert.ok(de("K-DES-04").every((c) => c.eixos.escrita !== "inglês"));
  assert.ok(de("K-DES-04").some((c) => c.eixos.escrita === "português" && c.equivale?.escrita?.includes("inglês")));
  assert.ok(de("K-COD-04").some((c) => c.eixos.escrita === "inglês"), "na fonte que não chega, inglês (sem acento) é outro caso");
  assert.ok(de("K-COD-12").every((c) => c.eixos.escrita === "árabe (direita para a esquerda)"));
  assert.equal(de("K-COD-09").length, 4);
  assert.ok(de("K-EDI-09").every((c) => c.eixos.cenas !== "1"));
  assert.ok(de("K-DES-08").every((c) => c.eixos.rosto !== "sem rosto"));
});

test("contas: o produto nominal é o do #79 (3.727); o total passa da meta por menos que a última classe com grau", () => {
  assert.equal(cat.classes.reduce((s, c) => s + c.casos, 0), 3727);
  const e = expandir(cat);
  const unicos = (id: string) => e.casos.filter((c) => c.classe === id).length / (e.comGrau.includes(id) ? 3 : 1);
  assert.equal(e.base, cat.classes.reduce((s, c) => s + unicos(c.id), 0));
  assert.ok(e.casos.length >= META);
  assert.ok(e.casos.length - META < 2 * unicos(e.comGrau.at(-1)!), `${e.casos.length} passa demais de ${META}`);
});

test("graus: só em classes graduáveis, em ordem de peso; as de peso maior sem grau estão no SEM_GRAU", () => {
  const e = expandir(cat);
  const ordem = porPeso(cat.classes);
  const ultima = ordem.findIndex((c) => c.id === e.comGrau.at(-1));
  for (const c of ordem.slice(0, ultima + 1)) {
    if (e.comGrau.includes(c.id)) assert.ok(graduavel(c), c.id);
    else assert.ok(c.verificador !== "sim" || c.id in SEM_GRAU, `${c.id} devia ter grau`);
  }
  for (const c of e.casos) {
    assert.equal(c.esperado, c.grau === "unico" ? null : c.grau === "abaixo" ? "certo" : "erro");
    if (c.grau !== "unico") assert.ok(e.comGrau.includes(c.classe));
  }
});

test("ordem do manifesto: peso não cresce", () => {
  const { casos } = expandir(cat);
  for (let i = 1; i < casos.length; i++) assert.ok(casos[i].peso <= casos[i - 1].peso, `${casos[i].id} depois de ${casos[i - 1].id}`);
  const k = cat.classes.find((c) => c.id === casos[0].classe)!;
  assert.equal(casos[0].peso, peso(k));
});

test("cada regra de juntar e de excluir tira caso de verdade (nenhuma regra morta)", () => {
  const { casos } = expandir(cat, Infinity);
  for (const r of REGRAS) for (const id of r.classes) {
    const vs = new Set(casos.filter((c) => c.classe === id).map((c) => c.eixos[r.eixo]));
    for (const v of [...(r.juntar ?? []).flatMap((g) => g.slice(1)), ...(r.excluir ?? [])]) assert.ok(!vs.has(v), `${id}: ${r.eixo}=${v} ainda aparece`);
  }
});
