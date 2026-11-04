// Tests of the sound of an edit (edicao/audio.ts): event sounds and the music ducked under the voice. No GPU.
// Run: node --test edicao/audio.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarContexto } from "./contexto.ts";
import { envelopeDaFala, lerPontos, montarSom, montarTrilha, valorNoQuadro, QUADROS_FIM_SOM } from "./audio.ts";
import type { Palavra } from "./tipos.ts";

const P: Palavra[] = [
  { texto: "Um", inicio: 1.0, fim: 1.4 },
  { texto: "dois.", inicio: 1.5, fim: 2.0 }, // gap 0.1 s: same phrase
  { texto: "Três", inicio: 2.4, fim: 2.8 }, // gap 0.4 s (≤ 0.6): still ducked
  { texto: "quatro.", inicio: 4.0, fim: 4.5 }, // gap 1.2 s: the music comes back up in between
];
const ctx = criarContexto({ fps: 30, largura: 1920, altura: 1080, palavras: P });

test("envelopeDaFala: words joined across short pauses, split at pauses longer than 0.6 s", () => {
  assert.deepEqual(envelopeDaFala(P), [{ inicio: 1.0, fim: 2.8 }, { inicio: 4.0, fim: 4.5 }]);
  assert.deepEqual(envelopeDaFala([]), []);
});

test("montarSom: start at the trigger minus «antes», fixed volume without an end", () => {
  const s = montarSom({ src: "whoosh.wav", em: { palavra: "tres" }, volume: 0.3, antes: 0.4 }, ctx);
  assert.equal(s.inicio, 60); // (2.4 − 0.4) × 30
  assert.equal(s.volume, "0.3");
  assert.equal(s.quadros, undefined);
  assert.equal(montarSom({ src: "a.wav", em: 0.1, antes: 1 }, ctx).inicio, 0); // never before frame 0
});

test("montarSom: with «fim», the sound falls to zero in 3 frames and stops there", () => {
  assert.equal(QUADROS_FIM_SOM, 3);
  const s = montarSom({ src: "enchendo.wav", em: 1, fim: 2, volume: 0.8 }, ctx);
  assert.equal(s.inicio, 30);
  assert.equal(s.quadros, 30);
  assert.equal(s.volume, "0:0.8 27:0.8 30:0");
  const curto = montarSom({ src: "a.wav", em: 1, fim: 1.05 }, ctx);
  assert.equal(curto.volume, "0:1 2:0");
  assert.throws(() => montarSom({ src: "a.wav", em: 2, fim: 1 }, ctx), /ends.*before it starts|after/);
  assert.throws(() => montarSom({ src: "", em: 1 } as never, ctx), /src/);
  assert.throws(() => montarSom({ src: "a.wav", em: 1, volume: 11 }, ctx), /volume/);
});

test("montarTrilha: ducks by the given dB during each phrase and comes back up in long pauses", () => {
  const t = montarTrilha({ src: "trilha.wav", volume: 0.5, abaixarSobVoz: 14 }, ctx, 180);
  assert.equal(t.inicio, 0);
  assert.equal(t.quadros, 180);
  const pts = lerPontos(t.volume);
  const baixo = 0.5 * 10 ** (-14 / 20);
  const v = (f: number) => valorNoQuadro(pts, f);
  assert.ok(Math.abs(v(10) - 0.5) < 1e-3, "before the speech: full");
  assert.ok(Math.abs(v(45) - baixo) < 1e-3, "inside the first phrase: ducked");
  assert.ok(Math.abs(v(75) - baixo) < 1e-3, "in the 0.4 s pause: still ducked");
  assert.ok(Math.abs(v(105) - 0.5) < 1e-3, "in the 1.2 s pause: back up");
  assert.ok(Math.abs(v(128) - baixo) < 1e-3, "second phrase: ducked");
  assert.equal(v(180), 0, "the default 1 s fade-out ends at zero");
  assert.ok(Math.abs(v(165) - 0.25) < 1e-3, "halfway through the fade-out");
  for (let k = 1; k < pts.length; k++) assert.ok(pts[k][0] > pts[k - 1][0], "frames grow");
  // Smooth: no jump larger than the full drop within one frame.
  for (let f = 1; f < 180; f++) assert.ok(Math.abs(v(f) - v(f - 1)) < (0.5 - baixo) / 2, `jump at ${f}`);
});

test("montarTrilha: «atraso» shifts the music and its envelope; ramps in and out", () => {
  const t = montarTrilha({ src: "trilha.wav", volume: 1, abaixarSobVoz: 0, atraso: 4, rampaEntrada: 0.5, rampaSaida: 0.5 }, ctx, 100);
  assert.equal(t.inicio, 4);
  assert.equal(t.quadros, 96);
  assert.equal(t.volume, "0:0 15:1 81:1 96:0");
  const d = montarTrilha({ src: "trilha.wav", volume: 1, abaixarSobVoz: 20, atraso: 4 }, ctx, 180);
  const pts = lerPontos(d.volume);
  // the first phrase starts at composition frame 30 = media frame 26: fully ducked there
  assert.ok(Math.abs(valorNoQuadro(pts, 26) - 0.1) < 1e-3);
  assert.throws(() => montarTrilha({ src: "t.wav", abaixarSobVoz: -3 }, ctx, 100), /abaixarSobVoz/);
  assert.throws(() => montarTrilha({ src: "t.wav", atraso: 100 }, ctx, 100), /atraso/);
});
