// P05, sala limpa: teste de caixa-preta da conversão de cor do motor (cor-limpa.js), pela interface de
// docs/formatos/conversao-de-cor.md. O oráculo é o ffmpeg do sistema chamado como binário: a mesma imagem YUV 4:2:0
// sintética convertida por ele e pelo módulo tem de sair igual, bit a bit. Nenhuma constante da conversão aqui:
// só as entradas, a regra de escolha (comportamento) e a saída do ffmpeg.
//
// Uso: node --test cor-limpa.test.ts        (precisa do ffmpeg no PATH; a varredura completa leva alguns segundos
//      por matriz e faixa). COR_LIMPA_MODULO=<caminho> troca o arquivo testado (só para conferir o próprio oráculo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ARQUIVO = process.env.COR_LIMPA_MODULO ?? new URL('./cor-limpa.js', import.meta.url);
let carregado;
// O módulo é um script clássico (vai injetado na página); fora da página não instala nada e expõe `corLimpa`.
function modulo() {
  if (!carregado) {
    const ctx = {};
    vm.runInNewContext(readFileSync(ARQUIVO, 'utf8'), ctx);
    carregado = ctx.corLimpa;
    assert.ok(carregado, 'o script não definiu globalThis.corLimpa');
  }
  return carregado;
}

const MATRIZES = ['bt601', 'bt709', 'smpte240m', 'bt2020'];
const FAIXAS = ['tv', 'cheia'];

// Quadro I420 compacto { largura, altura, dados, planos } a partir dos três planos.
function quadroCompacto(largura, altura, Y, U, V) {
  const n = largura * altura, c = n / 4;
  const dados = new Uint8Array(n + 2 * c);
  dados.set(Y, 0); dados.set(U, n); dados.set(V, n + c);
  return { largura, altura, dados, planos: [{ offset: 0, stride: largura }, { offset: n, stride: largura / 2 }, { offset: n + c, stride: largura / 2 }] };
}

// O ffmpeg como o pipeline de referência: yuv420p → BGR24 do mesmo tamanho, flags bilinear, matriz e faixa dadas,
// saída em faixa cheia. Devolve BGR24.
function oraculo(q, { matriz, faixa }) {
  const filtro = `scale=${q.largura}:${q.altura}:flags=bilinear:in_color_matrix=${matriz}:in_range=${faixa === 'tv' ? 'tv' : 'pc'}:out_range=pc`;
  return execFileSync('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${q.largura}x${q.altura}`, '-i', '-',
    '-vf', filtro, '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], { input: q.dados, maxBuffer: 1 << 30 });
}

// Compara a saída RGBA do módulo com o BGR24 do oráculo; devolve o número de amostras diferentes e o primeiro caso.
function comparar(q, escolha) {
  const ref = oraculo(q, escolha);
  const rgba = modulo().quadro(q, escolha);
  const n = q.largura * q.altura;
  assert.equal(rgba.length, n * 4, 'saída RGBA com o tamanho do quadro');
  let dif = 0, primeiro = null;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3];
    const R = ref[i * 3 + 2], G = ref[i * 3 + 1], B = ref[i * 3];
    const d = (r !== R) + (g !== G) + (b !== B) + (a !== 255);
    if (d) {
      dif += d;
      if (!primeiro) {
        const x = i % q.largura, y = (i / q.largura) | 0;
        const p = q.planos;
        primeiro = { x, y, Y: q.dados[p[0].offset + y * p[0].stride + x], U: q.dados[p[1].offset + (y >> 1) * p[1].stride + (x >> 1)],
          V: q.dados[p[2].offset + (y >> 1) * p[2].stride + (x >> 1)], obtido: [r, g, b, a], esperado: [R, G, B, 255] };
      }
    }
  }
  return { dif, primeiro };
}

// ---------------------------------------------------------------------------------------------------------------
test('interface: corLimpa.escolha, corLimpa.quadro e corLimpa.instalar; fora da página não instala nada', () => {
  const m = modulo();
  for (const f of ['escolha', 'quadro', 'instalar']) assert.equal(typeof m[f], 'function', f);
  const ctx = {};
  vm.runInNewContext(readFileSync(ARQUIVO, 'utf8'), ctx);
  assert.equal(ctx.motor_cor, undefined);
  assert.equal(ctx.motor_corAutoteste, undefined);
});

// Regra de escolha de matriz e faixa (comportamento observado na régua do Remotion; especificação, seção 5).
const CASOS_ESCOLHA = [
  // [colorSpace, altura, esperado]
  [{ matrix: 'bt709', fullRange: false }, 1080, { matriz: 'bt709', faixa: 'tv' }],
  [{ matrix: 'bt709', fullRange: false }, 480, { matriz: 'bt709', faixa: 'tv' }],
  [{ matrix: 'bt709', fullRange: true }, 1080, { matriz: 'bt709', faixa: 'cheia' }],
  [{ matrix: 'smpte170m', fullRange: false }, 1080, { matriz: 'bt601', faixa: 'tv' }],
  [{ matrix: 'bt470bg', fullRange: false }, 480, { matriz: 'bt601', faixa: 'tv' }],
  [{ matrix: 'smpte170m', fullRange: true }, 480, { matriz: 'bt601', faixa: 'cheia' }],
  [{ matrix: 'smpte240m', fullRange: false }, 1080, { matriz: 'smpte240m', faixa: 'tv' }],
  [{ matrix: 'bt2020-ncl', fullRange: false }, 2160, { matriz: 'bt2020', faixa: 'tv' }],
  [{ matrix: 'bt2020-ncl', fullRange: true }, 2160, { matriz: 'bt2020', faixa: 'cheia' }],
  // Sem marca de matriz: faixa TV (ou sem marca de faixa) decide pela altura; faixa cheia fica com bt601.
  [{ matrix: null, fullRange: null }, 720, { matriz: 'bt709', faixa: 'tv' }],
  [{ matrix: null, fullRange: null }, 719, { matriz: 'bt601', faixa: 'tv' }],
  [{ matrix: null, fullRange: false }, 1080, { matriz: 'bt709', faixa: 'tv' }],
  [{ matrix: null, fullRange: false }, 480, { matriz: 'bt601', faixa: 'tv' }],
  [{ matrix: null, fullRange: true }, 1080, { matriz: 'bt601', faixa: 'cheia' }],
  [{ matrix: null, fullRange: true }, 480, { matriz: 'bt601', faixa: 'cheia' }],
  [{}, 1080, { matriz: 'bt709', faixa: 'tv' }],
  [null, 480, { matriz: 'bt601', faixa: 'tv' }],
  [undefined, 1080, { matriz: 'bt709', faixa: 'tv' }],
  // Fora da conversão: matriz que não é YUV ou desconhecida.
  [{ matrix: 'rgb', fullRange: false }, 1080, null],
  [{ matrix: 'rgb', fullRange: true }, 1080, null],
  [{ matrix: 'xyz', fullRange: false }, 1080, null],
];
test('escolha de matriz e faixa pelo colorSpace e pela altura', () => {
  for (const [cs, altura, esperado] of CASOS_ESCOLHA) {
    const obtido = modulo().escolha(cs, altura);
    assert.deepEqual(obtido === null ? null : { matriz: obtido.matriz, faixa: obtido.faixa }, esperado, `${JSON.stringify(cs)} com ${altura} linhas`);
  }
});

test('valores conhecidos: preto e branco de vídeo (TV) e extremos da faixa cheia, croma neutro, em toda matriz', () => {
  for (const matriz of MATRIZES) {
    const px = (Y, faixa) => [...modulo().quadro(quadroCompacto(2, 2, [Y, Y, Y, Y], [128], [128]), { matriz, faixa }).slice(0, 4)];
    assert.deepEqual(px(16, 'tv'), [0, 0, 0, 255], `${matriz} preto TV`);
    assert.deepEqual(px(235, 'tv'), [255, 255, 255, 255], `${matriz} branco TV`);
    assert.deepEqual(px(0, 'cheia'), [0, 0, 0, 255], `${matriz} preto cheia`);
    assert.deepEqual(px(255, 'cheia'), [255, 255, 255, 255], `${matriz} branco cheia`);
  }
});

test('saída RGBA opaca, linha 0 no topo, croma vizinho (uma amostra para cada bloco 2×2)', () => {
  // 4×4 com Y em degrau e croma diferente em cada bloco; o pixel (x, y) usa o croma (x>>1, y>>1).
  const Y = Array.from({ length: 16 }, (_, i) => 30 + i * 12);
  const q = quadroCompacto(4, 4, Y, [60, 200, 128, 90], [220, 40, 128, 170]);
  for (const faixa of FAIXAS) {
    const { dif, primeiro } = comparar(q, { matriz: 'bt709', faixa });
    assert.equal(dif, 0, JSON.stringify(primeiro));
  }
});

test('stride com folga e planos fora de ordem dão o mesmo resultado do quadro compacto', () => {
  const L = 16, A = 8;
  let s = 11;
  const r = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) >> 16 & 255;
  const Y = Array.from({ length: L * A }, r), U = Array.from({ length: L * A / 4 }, r), V = Array.from({ length: L * A / 4 }, r);
  const compacto = quadroCompacto(L, A, Y, U, V);
  // Folga: stride maior que a largura, lixo nas colunas de sobra, V antes de U no buffer e um deslocamento inicial.
  const sY = L + 13, sC = L / 2 + 5, oV = 7, oU = oV + sC * A / 2 + 3, oY = oU + sC * A / 2 + 2;
  const dados = new Uint8Array(oY + sY * A).fill(77);
  for (let y = 0; y < A; y++) for (let x = 0; x < L; x++) dados[oY + y * sY + x] = Y[y * L + x];
  for (let y = 0; y < A / 2; y++) for (let x = 0; x < L / 2; x++) {
    dados[oU + y * sC + x] = U[y * L / 2 + x];
    dados[oV + y * sC + x] = V[y * L / 2 + x];
  }
  const folga = { largura: L, altura: A, dados, planos: [{ offset: oY, stride: sY }, { offset: oU, stride: sC }, { offset: oV, stride: sC }] };
  for (const matriz of MATRIZES) for (const faixa of FAIXAS) {
    const a = modulo().quadro(compacto, { matriz, faixa }), b = modulo().quadro(folga, { matriz, faixa });
    assert.deepEqual([...b], [...a], `${matriz} ${faixa}`);
  }
});

// Imagem pseudoaleatória 64×32 contra o ffmpeg, em cada matriz e faixa (casos do teste anterior, mais os que faltavam).
test('igual ao ffmpeg, bit a bit: imagem pseudoaleatória 64×32, toda matriz e faixa', () => {
  const L = 64, A = 32;
  let s = 3;
  const r = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) >> 16 & 255;
  const q = quadroCompacto(L, A, Array.from({ length: L * A }, r), Array.from({ length: L * A / 4 }, r), Array.from({ length: L * A / 4 }, r));
  for (const matriz of MATRIZES) for (const faixa of FAIXAS) {
    const { dif, primeiro } = comparar(q, { matriz, faixa });
    assert.equal(dif, 0, `${matriz} ${faixa}: ${JSON.stringify(primeiro)}`);
  }
});

// Varredura completa: todas as 256³ combinações de Y, U e V numa imagem 4096×4096. Cada bloco 2×2 de luma divide um
// par (U, V); 64 blocos seguidos com o mesmo par levam Y de 0 a 255.
function varredura() {
  const L = 4096, A = 4096, LC = L / 2;
  const Y = new Uint8Array(L * A), U = new Uint8Array(L * A / 4), V = new Uint8Array(L * A / 4);
  for (let cy = 0; cy < A / 2; cy++) for (let cx = 0; cx < LC; cx++) {
    const b = cy * LC + cx, par = b >> 6, k = b & 63;
    U[b] = par & 255; V[b] = par >> 8;
    for (let j = 0; j < 4; j++) Y[(2 * cy + (j >> 1)) * L + 2 * cx + (j & 1)] = k * 4 + j;
  }
  return quadroCompacto(L, A, Y, U, V);
}
let imagemVarredura;
for (const matriz of MATRIZES) for (const faixa of FAIXAS) {
  test(`igual ao ffmpeg, bit a bit: varredura de Y, U e V nos 256 valores, ${matriz} ${faixa}`, () => {
    imagemVarredura ??= varredura();
    const { dif, primeiro } = comparar(imagemVarredura, { matriz, faixa });
    assert.equal(dif, 0, `${dif} amostras diferentes; primeira: ${JSON.stringify(primeiro)}`);
  });
}
