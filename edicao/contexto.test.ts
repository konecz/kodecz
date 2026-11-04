// Tests of the assembly context (edicao/contexto.ts): frames, word triggers, end of sentence. No GPU, no browser.
// Run: node --test edicao/contexto.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarContexto, normalizarPalavra, FOLGA_FRASE } from "./contexto.ts";
import type { Palavra } from "./tipos.ts";

// Invented speech (R01): two sentences, a comma in the first, an accent and a repeated word.
const P: Palavra[] = [
  { texto: "A", inicio: 0.5, fim: 0.6 },
  { texto: "água,", inicio: 0.6, fim: 1.0 },
  { texto: "clara", inicio: 1.1, fim: 1.5 },
  { texto: "e", inicio: 1.5, fim: 1.6 },
  { texto: "fria.", inicio: 1.6, fim: 2.0 },
  { texto: "Água", inicio: 3.0, fim: 3.4 },
  { texto: "\"nova\"!", inicio: 3.4, fim: 3.9 },
  { texto: "Fim…", inicio: 4.5, fim: 5.0 },
];
const ctx = criarContexto({ fps: 30, largura: 1080, altura: 1920, palavras: P });

test("q: round(seconds × fps), with the half going up despite floating point", () => {
  assert.equal(ctx.q(1.23), 37);
  assert.equal(ctx.q(1.05), 32); // 1.05 × 30 = 31.499999…
  assert.equal(ctx.q(0), 0);
  assert.equal(criarContexto({ fps: 24, largura: 2, altura: 2, palavras: [] }).q(1), 24);
});

test("normalizarPalavra: no accents, punctuation or case", () => {
  assert.equal(normalizarPalavra("Água,"), "agua");
  assert.equal(normalizarPalavra("\"nova\"!"), "nova");
  assert.equal(normalizarPalavra("Fim…"), "fim");
  assert.equal(normalizarPalavra("R$ 2,50"), "r250");
});

test("quando: ignores accents, punctuation and case; counts occurrences from 1", () => {
  assert.equal(ctx.quando("agua").inicio, 0.6);
  assert.equal(ctx.quando("ÁGUA", 2).inicio, 3.0);
  assert.equal(ctx.quando("nova").fim, 3.9);
  assert.equal(ctx.quando("fria.").inicio, 1.6);
});

test("quando: a missing word or occurrence throws with the closest words", () => {
  assert.throws(() => ctx.quando("agula"), (e: Error) => /«agula».*not in the speech/.test(e.message) && /água/.test(e.message));
  assert.throws(() => ctx.quando("agua", 3), (e: Error) => /occurrence 3.*2 time/.test(e.message));
  assert.throws(() => ctx.quando(""), /empty/);
});

test("fimDaFrase: a comma does not close the sentence, a period does; plus the 0.15 s slack", () => {
  assert.equal(FOLGA_FRASE, 0.15);
  assert.equal(ctx.fimDaFrase(0.6), 2.0 + 0.15); // «água,» → the sentence goes on to «fria.»
  assert.equal(ctx.fimDaFrase(1.6), 2.0 + 0.15);
  assert.equal(ctx.fimDaFrase(3.0), 3.9 + 0.15); // ! after a closing quote
  assert.equal(ctx.fimDaFrase(4.6), 5.0 + 0.15); // …
  assert.equal(ctx.fimDaFrase(0), 2.0 + 0.15); // before the first word: the first sentence
  assert.equal(ctx.fimDaFrase(2.5), 2.0 + 0.15); // in the pause after a sentence: that sentence (the last word started)
});

test("fimDaFrase: speech without a closing mark ends at the last word", () => {
  const c = criarContexto({ fps: 30, largura: 2, altura: 2, palavras: [{ texto: "sem", inicio: 0, fim: 0.3 }, { texto: "ponto", inicio: 0.3, fim: 0.7 }] });
  assert.ok(Math.abs(c.fimDaFrase(0) - 0.85) < 1e-9);
  assert.throws(() => criarContexto({ fps: 30, largura: 2, altura: 2, palavras: [] }).fimDaFrase(0), /no words/);
});

test("tempo: number, segundo, palavra with border and offset, fimDaFrase nested", () => {
  assert.equal(ctx.tempo(1.5), 1.5);
  assert.equal(ctx.tempo({ segundo: 2 }), 2);
  assert.equal(ctx.tempo({ palavra: "clara" }), 1.1);
  assert.equal(ctx.tempo({ palavra: "clara", borda: "fim" }), 1.5);
  assert.ok(Math.abs(ctx.tempo({ palavra: "agua", ocorrencia: 2, deslocamento: -0.4 }) - 2.6) < 1e-9);
  assert.equal(ctx.tempo({ fimDaFrase: { palavra: "agua" } }), 2.15);
  assert.equal(ctx.tempo({ fimDaFrase: 3.2 }), 4.05);
});

test("tempo: an invalid trigger throws with what was given", () => {
  assert.throws(() => ctx.tempo({ quadro: 3 } as never), /invalid trigger.*quadro/);
  assert.throws(() => ctx.tempo(-1), /negative|≥ 0/);
  assert.throws(() => ctx.tempo({ palavra: "clara", borda: "meio" } as never), /borda/);
  assert.throws(() => ctx.tempo(Number.NaN), /invalid trigger/);
});
