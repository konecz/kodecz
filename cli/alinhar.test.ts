// Tests of the script ↔ recognizer alignment of `kodecz prepare words` (cli/alinhar.ts), with synthetic word lists:
// no recognizer, GPU or browser. Run: node --test cli/alinhar.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { alinhar, chave, fimDaVoz, palavrasDoRoteiro, type Reconhecida } from "./alinhar.ts";

/** Recognized words, one every 0.5 s, 0.4 s long, with the leading space the recognizer puts. */
const falado = (texto: string, ini = 0): Reconhecida[] =>
  texto.split(" ").map((w, i) => ({ texto: ` ${w}`, inicio: ini + i * 0.5, fim: ini + i * 0.5 + 0.4 }));

test("chave: lowercase, no accents, letters and digits only", () => {
  assert.equal(chave("Ação!"), "acao");
  assert.equal(chave(" 2.000,"), "2000");
  assert.equal(chave("«Olá»"), "ola");
  assert.equal(chave("—"), "");
});

test("roteiro: split on whitespace; punctuation alone joins the word before (or the next, at the start)", () => {
  assert.deepEqual(palavrasDoRoteiro("Um balde — dois.\n\nTrês…"), ["Um", "balde —", "dois.", "Três…"]);
  assert.deepEqual(palavrasDoRoteiro("— Olá, mundo"), ["— Olá,", "mundo"]);
  assert.deepEqual(palavrasDoRoteiro("  "), []);
});

test("equal words: the text of the script (accents and punctuation) with the times of the recognizer", () => {
  const r = alinhar(palavrasDoRoteiro("Olá, mundo! Tudo bem?"), falado("ola mundo tudo bem"));
  assert.deepEqual(r.palavras, [
    { texto: "Olá,", inicio: 0, fim: 0.4 }, { texto: "mundo!", inicio: 0.5, fim: 0.9 },
    { texto: "Tudo", inicio: 1, fim: 1.4 }, { texto: "bem?", inicio: 1.5, fim: 1.9 },
  ]);
  assert.equal(r.iguais, 4);
  assert.equal(r.semelhanca, 1);
  assert.deepEqual(r.trocas, []);
});

test("a word recognized wrong takes the time of the word in its place", () => {
  const r = alinhar(palavrasDoRoteiro("o Kodecz renderiza"), falado("o codex renderiza"));
  assert.deepEqual(r.palavras[1], { texto: "Kodecz", inicio: 0.5, fim: 0.9 });
  assert.deepEqual(r.trocas, [{ roteiro: "Kodecz", falado: "codex" }]);
  assert.equal(r.iguais, 2);
});

test("a number written in digits and spoken in words: the number spans the spoken words", () => {
  const r = alinhar(palavrasDoRoteiro("são 2.000 litros"), falado("são dois mil litros"));
  assert.deepEqual(r.palavras.map((p) => p.texto), ["são", "2.000", "litros"]);
  assert.deepEqual(r.palavras[1], { texto: "2.000", inicio: 0.5, fim: 1.4 });
  assert.deepEqual(r.palavras[2], { texto: "litros", inicio: 1.5, fim: 1.9 });
  assert.deepEqual(r.trocas, [{ roteiro: "2.000", falado: "dois mil" }]);
});

test("words spelled out in the script and digits in the audio: the time is shared by length", () => {
  const r = alinhar(palavrasDoRoteiro("vinte e quatro horas"), [
    { texto: " 24", inicio: 0, fim: 0.9 }, { texto: " horas", inicio: 1, fim: 1.4 },
  ]);
  const [a, b, c] = r.palavras;
  assert.equal(a.inicio, 0);
  assert.equal(c.fim, 0.9);
  assert.ok(a.fim > b.fim - b.inicio, "«vinte» is longer than «e»");
  assert.ok(a.fim <= b.inicio && b.fim <= c.inicio);
  assert.deepEqual(r.palavras[3], { texto: "horas", inicio: 1, fim: 1.4 });
});

test("a script word the recognizer skipped sits in the gap between its neighbours", () => {
  const r = alinhar(palavrasDoRoteiro("um dois três"), [
    { texto: " um", inicio: 0, fim: 0.4 }, { texto: " três", inicio: 1, fim: 1.4 },
  ]);
  assert.deepEqual(r.palavras[1], { texto: "dois", inicio: 0.4, fim: 1 });
  assert.deepEqual(r.semPar, ["dois"]);
});

test("recognized words that are not in the script are ignored and listed", () => {
  const r = alinhar(palavrasDoRoteiro("um dois"), falado("um é dois"));
  assert.deepEqual(r.palavras, [{ texto: "um", inicio: 0, fim: 0.4 }, { texto: "dois", inicio: 1, fim: 1.4 }]);
  assert.deepEqual(r.extras, ["é"]);
});

test("punctuation tokens from the recognizer match nothing; the cut caps every time", () => {
  const rec = [...falado("um dois"), { texto: " -", inicio: 1, fim: 1.1 }, { texto: " três", inicio: 1.2, fim: 2.5 }];
  const r = alinhar(palavrasDoRoteiro("um dois três"), rec, 2);
  assert.equal(r.iguais, 3);
  assert.deepEqual(r.palavras[2], { texto: "três", inicio: 1.2, fim: 2 });
  assert.deepEqual(r.extras, []);
});

test("times never go back, even when the recognizer overlaps words", () => {
  const r = alinhar(["a", "b"], [{ texto: "a", inicio: 0, fim: 1 }, { texto: "b", inicio: 0.8, fim: 0.7 }]);
  assert.deepEqual(r.palavras[1], { texto: "b", inicio: 0.8, fim: 0.8 });
});

test("nothing recognized: the words stay at zero and are all listed without a pair", () => {
  const r = alinhar(["a", "b"], []);
  assert.deepEqual(r.semPar, ["a", "b"]);
  assert.equal(r.semelhanca, 0);
});

test("fim da voz: the end of the last window above −45 dBFS", () => {
  const taxa = 16000;
  const a = new Float32Array(taxa * 2); // 1 s of tone, 1 s of silence
  for (let i = 0; i < taxa; i++) a[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / taxa);
  assert.equal(fimDaVoz(a, taxa), 1);
  assert.equal(fimDaVoz(new Float32Array(taxa), taxa), 1, "silence only: the whole length");
});
