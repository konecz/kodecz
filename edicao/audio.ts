// The sound of an edit, as <audio> elements of the declared timeline (docs/formatos/linha-do-tempo.md, "Video and
// audio"): event sounds (`sons`) placed on triggers, and the music (`trilha`) with `data-volume` points that duck it
// under the voice. Pure: the files are only named here; normalizing them is a preparation step.
import type { ContextoMontagem, Gatilho, Palavra } from "./tipos.ts";

/** An event sound with an end falls to zero in this many frames. */
export const QUADROS_FIM_SOM = 3;
/** A pause between words longer than this (seconds) lets the music come back up. */
export const PAUSA_LONGA = 0.6;
/** The music starts going down this long before a phrase (seconds) and is fully down at its first word. */
export const ATAQUE = 0.15;
/** After the last word of a phrase, the music takes this long to come back up (seconds). */
export const SOLTURA = 0.4;
/** Default fade-out of the music at the end of the video (seconds). */
export const RAMPA_SAIDA = 1;

export interface Som { src: string; em: Gatilho; volume?: number; antes?: number; fim?: Gatilho; recorte?: number }
export interface Trilha {
  src: string; volume?: number; abaixarSobVoz?: number; atraso?: number;
  rampaEntrada?: number; rampaSaida?: number; recorte?: number;
}
/** One <audio> of the composition: frames and the `data-volume` text (a number or `frame:volume` points). */
export interface Audio { src: string; inicio: number; quadros?: number; recorte?: number; volume: string }

const numero = (x: number) => String(Math.round(x * 10000) / 10000);

function conferirVolume(v: unknown, onde: string): number {
  if (v === undefined) return 1;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 10) throw new Error(`${onde}: volume must be a number from 0 to 10, got ${JSON.stringify(v)}`);
  return v;
}

function conferirSegundos(v: unknown, campo: string, onde: string): number {
  if (v === undefined) return 0;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`${onde}: «${campo}» must be seconds ≥ 0, got ${JSON.stringify(v)}`);
  return v;
}

function conferirSrc(src: unknown, onde: string): string {
  if (typeof src !== "string" || !src.trim()) throw new Error(`${onde}: «src» (the audio file) is missing`);
  return src;
}

/** Phrases of the speech for ducking: consecutive words joined while the pause between them is ≤ PAUSA_LONGA. */
export function envelopeDaFala(palavras: Palavra[], pausa = PAUSA_LONGA): { inicio: number; fim: number }[] {
  const frases: { inicio: number; fim: number }[] = [];
  for (const p of [...palavras].sort((a, b) => a.inicio - b.inicio)) {
    const ultima = frases.at(-1);
    if (ultima && p.inicio - ultima.fim <= pausa + 1e-9) ultima.fim = Math.max(ultima.fim, p.fim);
    else frases.push({ inicio: p.inicio, fim: p.fim });
  }
  return frases;
}

/** An event sound: starts `antes` seconds before the trigger; with `fim`, it stops there after a 3-frame fade. */
export function montarSom(s: Som, ctx: ContextoMontagem, onde = "sound"): Audio {
  const src = conferirSrc(s.src, onde);
  const volume = conferirVolume(s.volume, onde);
  const antes = conferirSegundos(s.antes, "antes", onde);
  if (s.em === undefined) throw new Error(`${onde}: «em» (when it plays) is missing`);
  const inicio = Math.max(0, ctx.q(ctx.tempo(s.em) - antes));
  const recorte = s.recorte === undefined ? undefined : ctx.q(conferirSegundos(s.recorte, "recorte", onde));
  if (s.fim === undefined) return { src, inicio, recorte, volume: numero(volume) };
  const quadros = ctx.q(ctx.tempo(s.fim)) - inicio;
  if (quadros < 1) throw new Error(`${onde}: it ends (frame ${inicio + quadros}) before it starts (frame ${inicio}); «fim» must come after «em»`);
  const queda = Math.min(QUADROS_FIM_SOM, quadros);
  const pontos = queda < quadros ? `0:${numero(volume)} ${quadros - queda}:${numero(volume)} ${quadros}:0` : `0:${numero(volume)} ${quadros}:0`;
  return { src, inicio, quadros, recorte, volume: pontos };
}

/** The `frame:volume` points of a `data-volume` text. */
export function lerPontos(texto: string): [number, number][] {
  return texto.trim().split(/\s+/).map((p) => p.split(":").map(Number) as [number, number]);
}

/** The volume of the points at a frame, as Kodecz mixes it (a straight line between points, the ends held). */
export function valorNoQuadro(pontos: [number, number][], f: number): number {
  if (f <= pontos[0][0]) return pontos[0][1];
  for (let k = 1; k < pontos.length; k++) {
    const [f1, v1] = pontos[k];
    if (f <= f1) { const [f0, v0] = pontos[k - 1]; return v0 + ((v1 - v0) * (f - f0)) / (f1 - f0); }
  }
  return pontos.at(-1)![1];
}

/** A piecewise-linear curve over frames, from [frame, value] points with growing frames. */
type Curva = [number, number][];

/**
 * The music: starts at frame `atraso` and lasts to the end of the composition (`total` frames); volume × the fade-in
 * and fade-out × the ducking under the voice (`abaixarSobVoz` dB during each phrase of the speech, back up in pauses
 * longer than PAUSA_LONGA). The points are counted from the start of the music, as `data-volume` wants.
 */
export function montarTrilha(t: Trilha, ctx: ContextoMontagem, total: number, onde = "trilha"): Audio {
  const src = conferirSrc(t.src, onde);
  const volume = conferirVolume(t.volume, onde);
  const db = t.abaixarSobVoz ?? 0;
  if (typeof db !== "number" || !Number.isFinite(db) || db < 0 || db > 60) throw new Error(`${onde}: «abaixarSobVoz» is the drop in dB under the voice, from 0 to 60, got ${JSON.stringify(t.abaixarSobVoz)}`);
  const atraso = t.atraso ?? 0;
  if (!Number.isInteger(atraso) || atraso < 0 || atraso >= total) throw new Error(`${onde}: «atraso» is in frames, an integer from 0 to ${total - 1}, got ${JSON.stringify(t.atraso)}`);
  const entrada = ctx.q(conferirSegundos(t.rampaEntrada, "rampaEntrada", onde));
  const saida = ctx.q(t.rampaSaida === undefined ? RAMPA_SAIDA : conferirSegundos(t.rampaSaida, "rampaSaida", onde));
  const recorte = t.recorte === undefined ? undefined : ctx.q(conferirSegundos(t.recorte, "recorte", onde));
  const quadros = total - atraso;

  // Fade in and out, in frames of the music.
  const base: Curva = [[0, entrada > 0 ? 0 : 1]];
  if (entrada > 0) base.push([Math.min(entrada, quadros), 1]);
  if (saida > 0 && quadros - saida > (base.at(-1)![0])) base.push([quadros - saida, 1]);
  if (saida > 0) base.push([quadros, 0]);
  else if (base.at(-1)![0] < quadros) base.push([quadros, 1]);

  // Ducking: 1 outside the phrases, 10^(−dB/20) inside, with ATAQUE before and SOLTURA after.
  const baixo = 10 ** (-db / 20);
  // Each phrase is [a, b, c, d] in frames of the music: going down from a, down from b to c, back up at d. A phrase
  // that starts going down before the previous one is back up joins it (the music stays down).
  const trechos: [number, number, number, number][] = [];
  if (db > 0) {
    for (const fr of envelopeDaFala(ctx.palavras)) {
      const b = ctx.q(fr.inicio) - atraso, c = Math.max(b, ctx.q(fr.fim) - atraso);
      const a = Math.min(b - 1, ctx.q(fr.inicio - ATAQUE) - atraso), d = Math.max(c + 1, ctx.q(fr.fim + SOLTURA) - atraso);
      const anterior = trechos.at(-1);
      if (anterior && a <= anterior[3]) { anterior[2] = c; anterior[3] = d; } else trechos.push([a, b, c, d]);
    }
  }
  const abaixar: Curva = [[Math.min(0, trechos[0]?.[0] ?? 0), 1]];
  for (const [a, b, c, d] of trechos) abaixar.push([a, 1], [b, baixo], [c, baixo], [d, 1]);
  const semRepetir = abaixar.filter((p, k) => k === 0 || p[0] > abaixar[k - 1][0]);
  abaixar.splice(0, abaixar.length, ...semRepetir);

  // The product, sampled at the frames of both curves (a straight line between them is close enough for short ramps).
  const quadrosChave = [...new Set([...base, ...abaixar].map(([f]) => f).filter((f) => f >= 0 && f <= quadros).concat([0, quadros]))].sort((x, y) => x - y);
  let pontos: Curva = quadrosChave.map((f) => [f, volume * valorNoQuadro(base, f) * valorNoQuadro(abaixar, f)]);
  // Drop points on the line between their neighbours.
  pontos = pontos.filter((p, k) => {
    if (k === 0 || k === pontos.length - 1) return true;
    const [f0, v0] = pontos[k - 1], [f2, v2] = pontos[k + 1];
    return Math.abs(v0 + ((v2 - v0) * (p[0] - f0)) / (f2 - f0) - p[1]) > 1e-6;
  });
  const texto = pontos.length === 2 && pontos[0][1] === pontos[1][1] ? numero(pontos[0][1]) : pontos.map(([f, v]) => `${f}:${numero(v)}`).join(" ");
  return { src, inicio: atraso, quadros, recorte, volume: texto };
}
