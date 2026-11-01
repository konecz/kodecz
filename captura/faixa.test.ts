// M08: leitura da marca da faixa em JS (modo CPU), a mesma regra de nativo/src/marca.rs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BITS, BLOCO, BLOCOS, lerFaixa, lerMarcaEm } from './faixa.ts';

// Desenha a faixa como a moldura.html: branco, preto, os 24 bits de n e o complemento, blocos de 16 px.
function desenhar(n, largura, { alfa = 255 } = {}) {
  const linha = Buffer.alloc(largura * 4);
  for (let x = 0; x < Math.min(BLOCOS * BLOCO, largura); x++) {
    const i = Math.floor(x / BLOCO);
    const branco = i === 0 ? true : i === 1 ? false : i < 2 + BITS ? ((n >> (BITS - 1 - (i - 2))) & 1) === 1
      : ((n >> (BITS - 1 - (i - 2 - BITS))) & 1) === 0;
    const v = branco ? 255 : 0;
    linha.set([v, v, v, alfa], x * 4);
  }
  return linha;
}

test('lê N da faixa, inclusive 0 e o maior de 24 bits', () => {
  for (const n of [0, 1, 299, 4095, 2 ** 24 - 1]) assert.equal(lerFaixa(desenhar(n, 1920)), n);
});

test('faixa ausente, transparente ou curta não lê nada', () => {
  assert.equal(lerFaixa(Buffer.alloc(1920 * 4)), null);
  assert.equal(lerFaixa(desenhar(7, 1920, { alfa: 0 })), null);
  assert.equal(lerFaixa(desenhar(7, 1920).subarray(0, 100 * 4)), null);
});

test('complemento errado (quadro misturado) não lê nada', () => {
  const linha = desenhar(5, 1920);
  const x = (2 + BITS) * BLOCO; // primeiro bloco do complemento
  for (let i = 0; i < BLOCO; i++) linha.set(linha[(x + i) * 4] ? [0, 0, 0, 255] : [255, 255, 255, 255], (x + i) * 4);
  assert.equal(lerFaixa(linha), null);
});

test('lerMarcaEm lê a linha y de um quadro inteiro', () => {
  const largura = 1080, altura = 40;
  const quadro = Buffer.alloc(largura * altura * 4);
  desenhar(123, largura).copy(quadro, 30 * largura * 4);
  assert.equal(lerMarcaEm(quadro, largura, 30), 123);
  assert.equal(lerMarcaEm(quadro, largura, 10), null);
  assert.equal(lerMarcaEm(quadro, largura, altura + 5), null);
});
