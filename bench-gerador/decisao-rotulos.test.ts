// Kodecz Bench (P12): a rodada de rótulos do responsável (2026-11-01, 50 pares) decidiu as 19 classes «a calibrar».
// As que ele confirmou viram automáticas; as que ele achou «tanto faz» viram aviso (medidas e somadas na rodada, sem
// tirar nota); as em que ele preferiu a versão «com defeito» saem da nota até a regra ser reescrita. Sem placa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lerManifesto, type Caso } from "./expandir.ts";
import { paraItem } from "./adaptador.ts";

const CONFIRMADAS = ["K-ANI-03", "K-DES-01", "K-DES-11", "K-IA-05", "K-IA-12"];
const AVISO = ["K-DES-05", "K-DES-10", "K-EDI-04", "K-EDI-07", "K-IA-01", "K-IA-04", "K-IA-06", "K-IA-07", "K-IA-08", "K-IA-11"];
const DESLIGADAS = ["K-DES-03", "K-IA-02", "K-IA-03", "K-IA-10", "K-IA-13"];

const casos = lerManifesto().filter((c): c is Caso => c.forma === "classe");
const umDe = (classe: string) => casos.find((c) => c.classe === classe && c.grau === "unico")!;

test("nenhuma classe fica «a calibrar» depois dos rótulos", () => {
  assert.deepEqual([...new Set(casos.filter((c) => c.verificador.situacao === "automatica-a-calibrar").map((c) => c.classe))], []);
});

test("confirmadas pelo responsável: automáticas, com o item avaliado normalmente", () => {
  for (const k of CONFIRMADAS) {
    assert.equal(umDe(k).verificador.situacao, "automatica", k);
    const it = paraItem(umDe(k));
    assert.equal(it.semOraculo, undefined, k);
    assert.equal(it.aviso, undefined, k);
  }
});

test("«tanto faz» para o responsável: aviso, avaliado mas fora da nota", () => {
  for (const k of AVISO) {
    assert.equal(umDe(k).verificador.situacao, "aviso", k);
    const it = paraItem(umDe(k));
    assert.equal(it.semOraculo, undefined, k);
    assert.match(it.aviso ?? "", /rótulos do responsável/, k);
  }
});

test("o responsável preferiu a versão «com defeito»: desligada, o rodador pula com o motivo", () => {
  for (const k of DESLIGADAS) {
    assert.equal(umDe(k).verificador.situacao, "desligada", k);
    assert.match(paraItem(umDe(k)).semOraculo ?? "", /desligada/, k);
  }
});
