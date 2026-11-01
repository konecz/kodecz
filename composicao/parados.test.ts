// P10.3: quais quadros da linha do tempo repetem o anterior (parados.ts). Rodar: node --test parados.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quadrosParados } from './parados.ts';

const faixa = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

test('a composição de cli/fixtures/linha-parada: 25 parados nos 60 quadros', () => {
  // Os quatro intervalos da fixture, em ms, a 30 qps.
  const ints = [[0, 300], [400, 500], [1000, 1300], [1500, 1700]];
  assert.deepEqual(quadrosParados(ints, 0, 60, 30), [11, ...faixa(17, 29), ...faixa(41, 44), ...faixa(53, 59)]);
});

test('o primeiro quadro do trecho é sempre desenhado, mesmo parado', () => {
  assert.deepEqual(quadrosParados([], 0, 4, 30), [1, 2, 3]);
  assert.deepEqual(quadrosParados([], 10, 3, 30), [11, 12]);
});

test('bordas contam como mudança: início ou fim exatamente num quadro', () => {
  // [100, 200] a 10 qps: quadros em 0, 100, 200, 300 ms. O 1 (entra em 100) e o 2 e o 3 (o fim em 200 é tocado
  // pelo intervalo [100, 200] e pelo [200, 300]) mudam; o 4 em diante não.
  assert.deepEqual(quadrosParados([[100, 200]], 0, 6, 10), [4, 5]);
});

test('animação sem fim (null) nunca para depois do início', () => {
  assert.deepEqual(quadrosParados([[250, null]], 0, 6, 10), [1, 2]);
});

test('fim negativo (endDelay que corta tudo): nada muda', () => {
  assert.deepEqual(quadrosParados([[0, -10]], 0, 3, 30), [1, 2]);
});

test('entrada errada não vira quadro pulado', () => {
  assert.throws(() => quadrosParados([[0, 'x']], 0, 3, 30), /intervalo/);
  assert.throws(() => quadrosParados([[Number.NaN, 10]], 0, 3, 30), /intervalo/);
  assert.throws(() => quadrosParados([], 0, 3, 0), /qps/);
});

// Integração do P10 (P10.3 × P10.5): o vídeo embutido muda o quadro sem animação. O trecho [início, fim] em quadros
// de cada vídeo marca os quadros que podem mudar: do primeiro do vídeo ao que limpa o canvas (início + quadros).
test('trecho de vídeo embutido: do primeiro quadro dele ao que limpa o canvas, nada repete', () => {
  // cli/fixtures/linha-video: vídeo do 5 ao 24 (data-quadros 20), canvas limpo no 25; sem animação.
  assert.deepEqual(quadrosParados([], 0, 40, 25, [[5, 25]]), [...faixa(1, 4), ...faixa(26, 39)]);
  // Junto com uma animação: os dois contam.
  assert.deepEqual(quadrosParados([[0, 80]], 0, 10, 25, [[6, 7]]), [4, 5, 8, 9]);
});

test('trecho de vídeo errado não vira quadro pulado', () => {
  assert.throws(() => quadrosParados([], 0, 3, 30, [[1, 'x']]), /trecho/);
  assert.throws(() => quadrosParados([], 0, 3, 30, [[3, 1]]), /trecho/);
});
