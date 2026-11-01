// Testes da marca do vídeo sintético (R03: o quadro do vídeo é o do instante N). Uso: node --test marca-video.test.ts
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conferirVideo, lerMarcaVideo } from './marca-video.ts';

const L = 1920, A = 1080;
// Quadro BGRA com a marca de gerar-midia.sh: 12 blocos de 120 px em y 1040–1079, bit 0 à esquerda.
const quadro = (v, { nivel = 235 } = {}) => {
  const px = Buffer.alloc(L * A * 4);
  for (let y = 1040; y < 1080; y++) for (let b = 0; b < 12; b++) {
    if (!(v & (1 << b))) continue;
    for (let x = b * 120; x < (b + 1) * 120; x++) px.fill(nivel, (y * L + x) * 4, (y * L + x) * 4 + 3);
  }
  return px;
};

test('lê 0, 1, 299 e 4095', () => {
  for (const v of [0, 1, 299, 4095]) assert.equal(lerMarcaVideo(quadro(v), L), v);
});
test('branco do vídeo comprimido (~200) ainda é 1; ruído escuro (~60) é 0', () => {
  assert.equal(lerMarcaVideo(quadro(5, { nivel: 200 }), L), 5);
  assert.equal(lerMarcaVideo(quadro(5, { nivel: 60 }), L), 0);
});
test('tamanho errado do quadro derruba', () => assert.throws(() => lerMarcaVideo(Buffer.alloc(16), L)));

const q = (n, video) => ({ n, video });
test('todos certos: sem erro', () => {
  const r = conferirVideo([q(0, 0), q(1, 1), q(2, 2)], { total: 3 });
  assert.deepEqual(r, { conferidos: 3, errados: [], faltando: 0 });
});
test('um quadro velho é pego', () => {
  const r = conferirVideo([q(0, 0), q(1, 0), q(2, 2)], { total: 3 });
  assert.deepEqual(r.errados, [{ n: 1, video: 0, esperado: 1 }]);
});
test('deslocamento: o vídeo começa k quadros depois (corte do início)', () => {
  assert.equal(conferirVideo([q(0, 7), q(1, 8)], { deslocamento: 7, total: 2 }).errados.length, 0);
  assert.equal(conferirVideo([q(0, 7), q(1, 8)], { total: 2 }).errados.length, 2);
});
test('quadro sem marca lida ou faltando conta como faltando', () => {
  assert.equal(conferirVideo([q(0, 0), { n: 1 }], { total: 2 }).faltando, 1);
  assert.equal(conferirVideo([q(0, 0)], { total: 2 }).faltando, 1);
});

const CLI = new URL('../docs/experimentos/2026-10-m04-composicoes-remotion/conferir-video.mjs', import.meta.url).pathname;
const base = mkdtempSync(join(tmpdir(), 'm09-marca-'));
after(() => rmSync(base, { recursive: true, force: true }));
const cli = (nome, resumo, quadros, ...args) => {
  const arq = join(base, `${nome}.json`);
  writeFileSync(arq, JSON.stringify({ resumo, quadros }));
  return spawnSync('node', [CLI, arq, ...args], { encoding: 'utf8' }).status;
};
const ok = { motivo: 'ok', pedidos: 2 }; // pedidos: quadros que o render pediu (resumo do main.ts)
test('CLI: certo 0, errado 1, faltando ou render que falhou 2', () => {
  assert.equal(cli('a', ok, [q(0, 0), q(1, 1)]), 0);
  assert.equal(cli('b', ok, [q(0, 0), q(1, 0)]), 1);
  assert.equal(cli('c', ok, [q(0, 3), q(1, 4)], '--deslocamento', '3'), 0);
  assert.equal(cli('d', ok, [q(0, 0)]), 2);
  assert.equal(cli('e', { ...ok, motivo: 'erro' }, [q(0, 0), q(1, 1)]), 2);
});
