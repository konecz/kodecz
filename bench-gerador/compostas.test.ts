// Gerador de casos (P12): as tarefas compostas. Na CPU, a regra de combinação e o manifesto; na placa, 10 compostas que
// cobrem todo componente, formato e rosto renderizam, com a solução certa o oráculo somado diz «certo», e cada
// componente errado sozinho é acusado pelo oráculo dele (os outros continuam certos). Render sob flock -s.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RAIZ } from "./catalogo.ts";
import { COMPONENTES, combinacaoValida, compostas, montarComposta, somar, type Composta } from "./compostas.ts";
import { lerManifesto } from "./expandir.ts";
import { compostaParaItem } from "./adaptador.ts";
import { coletar, renderizar } from "../bench/coletar.ts";
import { RETRATO } from "../bench/molde.ts";
import type { Dados } from "../bench/oraculos.ts";
import { lerDeclaracao } from "../cli/regras.ts";
import { readFileSync } from "node:fs";

const todas = lerManifesto().filter((c): c is Composta => c.forma === "composta");
const semPlaca = spawnSync("nvidia-smi", ["-L"]).status !== 0 || !existsSync(join(RAIZ, "nativo", "nativo.node")) || !existsSync(RETRATO.arquivo);

test("regra de combinação: zona só no 9:16 e com texto; eixo só com faixa e legenda; zoom sem faixa; uma classe por componente", () => {
  assert.ok(!combinacaoValida(["zona", "zoom", "clarao"], "9:16"), "zona sem texto");
  assert.ok(!combinacaoValida(["zona", "legenda", "zoom"], "16:9"), "zona no 16:9");
  assert.ok(combinacaoValida(["zona", "legenda", "zoom"], "9:16"));
  assert.ok(!combinacaoValida(["eixo", "faixa", "zoom"], "16:9"), "eixo sem legenda");
  assert.ok(combinacaoValida(["legenda", "eixo", "faixa"], "16:9"));
  assert.ok(!combinacaoValida(["zoom", "faixa", "legenda"], "16:9"), "zoom com faixa");
  assert.equal(new Set(COMPONENTES.map((c) => c.classe)).size, COMPONENTES.length);
});

test("o manifesto traz as compostas da regra, uma vez cada, ids pelo conteúdo, e nada fora da regra", () => {
  const geradas = compostas(() => 1);
  assert.deepEqual(new Set(todas.map((c) => c.id)), new Set(geradas.map((c) => c.id)));
  assert.equal(new Set(todas.map((c) => `${c.componentes.join("+")}|${c.eixos.formato}|${c.eixos.rosto}`)).size, todas.length);
  for (const c of todas) {
    assert.ok(c.componentes.length >= 3 && c.componentes.length <= 4, c.id);
    assert.ok(combinacaoValida(c.componentes, c.eixos.formato as "9:16"), c.id);
    assert.equal(c.classes.length, c.componentes.length);
  }
  for (let i = 1; i < todas.length; i++) assert.ok(todas[i].peso <= todas[i - 1].peso);
});

test("soma dos oráculos: um erro basta; não conferível só sem erro; certo só com todos certos", () => {
  const r = (status: "erro" | "certo" | "nao-conferivel") => ({ nome: status, r: { status, motivo: "" } });
  assert.equal(somar([r("certo"), r("erro"), r("nao-conferivel")]).status, "erro");
  assert.equal(somar([r("certo"), r("nao-conferivel")]).status, "nao-conferivel");
  assert.equal(somar([r("certo"), r("certo")]).status, "certo");
});

test("toda composta monta: pedido com um item por componente, Item do degrau 1 e nenhum caminho de máquina", () => {
  for (const c of todas) {
    const t = montarComposta(c);
    assert.equal(t.pedido.split("\n").filter((l) => /^\d+\. /.test(l)).length, c.componentes.length, c.id);
    const item = compostaParaItem(t);
    assert.equal(item.id, c.id);
    assert.doesNotMatch(t.pedido, /\/home\/|file:\/\/|localhost/);
  }
});

/** 10 compostas que cobrem todo componente, formato e rosto (cobertura gulosa, na ordem do manifesto). */
export function amostraCompostas(n = 10): Composta[] {
  const chaves = (c: Composta) => [...c.componentes.map((x) => `c=${x}`), `f=${c.eixos.formato}`, `r=${c.eixos.rosto}`];
  const falta = new Set(todas.flatMap(chaves));
  const r: Composta[] = [];
  while (falta.size) {
    const m = todas.reduce((a, b) => chaves(b).filter((k) => falta.has(k)).length > chaves(a).filter((k) => falta.has(k)).length ? b : a);
    r.push(m); chaves(m).forEach((k) => falta.delete(k));
  }
  for (const c of todas) { if (r.length >= n) break; if (!r.includes(c)) r.push(c); }
  return r;
}

async function dados(tarefa: string, mp4: string): Promise<Dados> {
  const pasta = join(tarefa, "saida");
  const r = renderizar(pasta, mp4);
  assert.ok(r.ok, `render falhou: ${r.erro}`);
  return { col: await coletar(pasta), mp4 };
}

test("10 compostas renderizam e, com a solução certa, o oráculo somado diz certo", { skip: semPlaca && "sem placa, nativo.node ou retrato", timeout: 30 * 60_000 }, async () => {
  const amostra = amostraCompostas();
  assert.ok(amostra.length >= 10);
  const raiz = mkdtempSync(join(tmpdir(), "kodecz-compostas-"));
  try {
    for (const c of amostra) {
      const t = montarComposta(c), tarefa = join(raiz, c.id);
      t.preparar(tarefa);
      assert.ok(lerDeclaracao(readFileSync(join(tarefa, "saida", "index.html"), "utf8")));
      t.resolver(tarefa, []);
      const rs = t.oraculos(await dados(tarefa, join(tarefa, "certa.mp4")));
      for (const { nome, r } of rs) assert.equal(r.status, "certo", `${c.id} (${c.componentes.join(", ")}; ${c.eixos.formato}, rosto ${c.eixos.rosto}) ${nome}: ${r.motivo}`);
    }
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test("cada componente errado sozinho é acusado pelo oráculo dele, e só por ele", { skip: semPlaca && "sem placa, nativo.node ou retrato", timeout: 30 * 60_000 }, async () => {
  const amostra = amostraCompostas();
  const raiz = mkdtempSync(join(tmpdir(), "kodecz-compostas-errada-"));
  try {
    for (const comp of COMPONENTES) {
      // A faixa e a legenda erradas também tiram o eixo do lugar (o eixo depende das duas): para elas, uma composta sem eixo.
      const serve = (x: Composta) => x.componentes.includes(comp.nome) && (comp.nome === "eixo" || !(x.componentes.includes("eixo") && ["faixa", "legenda"].includes(comp.nome)));
      const c = amostra.find(serve) ?? todas.find(serve)!;
      const t = montarComposta(c), tarefa = join(raiz, `${c.id}-${comp.nome}`);
      t.preparar(tarefa);
      t.resolver(tarefa, [comp.nome]);
      const rs = t.oraculos(await dados(tarefa, join(tarefa, "errada.mp4")));
      for (const { nome, r } of rs) assert.equal(r.status, nome === comp.nome ? "erro" : "certo", `${c.id}, ${comp.nome} errado: ${nome} ${r.status} (${r.motivo})`);
    }
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});
