// M08: o codificador do modo CPU (quadro BGRA cru ao x264 por pipe, como o M06), sem placa.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodificadorCpu } from './codificador-cpu.ts';

const pasta = mkdtempSync(join(tmpdir(), 'm08-cod-'));
after(() => rmSync(pasta, { recursive: true, force: true }));
const quadro = (l, a, v) => Buffer.alloc(l * a * 4, v);

test('codifica N quadros em H.264 cru, com contrapressão', async () => {
  const saida = join(pasta, 'a.h264');
  const c = new CodificadorCpu({ largura: 64, altura: 48, fps: 30, saida });
  for (let i = 0; i < 12; i++) await c.escrever(quadro(64, 48, i * 20));
  const r = await c.fechar();
  assert.equal(r.quadros, 12);
  assert.equal(r.codigo, 0);
  const sonda = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries',
    'stream=nb_read_frames,codec_name,width,height', '-of', 'csv=p=0', saida], { encoding: 'utf8' });
  assert.equal(sonda.stdout.trim(), 'h264,64,48,12');
});

test('quadro de tamanho errado é recusado com a mensagem', async () => {
  const c = new CodificadorCpu({ largura: 64, altura: 48, fps: 30, saida: join(pasta, 'b.h264') });
  await assert.rejects(c.escrever(quadro(32, 48, 0)), /quadro com 6144 bytes, esperado 12288/);
  await c.fechar().catch(() => {});
});

test('ffmpeg ausente falha com a mensagem, sem pendurar', async () => {
  const c = new CodificadorCpu({ largura: 64, altura: 48, fps: 30, saida: join(pasta, 'c.h264'), ffmpeg: join(pasta, 'nao-existe') });
  await assert.rejects(async () => { for (let i = 0; i < 50; i++) await c.escrever(quadro(64, 48, 0)); await c.fechar(); },
    /ffmpeg do modo CPU/);
});

test('ffmpeg que morre no meio derruba o render (não fica esperando o drain)', async () => {
  // Um «ffmpeg» que lê ~2 quadros e sai com 3 (o ffmpeg 8 com -frames:v continua lendo até o fim da entrada).
  const falso = join(pasta, 'ffmpeg-morre');
  writeFileSync(falso, '#!/bin/sh\nhead -c 30000 > /dev/null\nexit 3\n');
  chmodSync(falso, 0o755);
  const c = new CodificadorCpu({ largura: 64, altura: 48, fps: 30, saida: join(pasta, 'd.h264'), ffmpeg: falso });
  await assert.rejects(async () => {
    for (let i = 0; i < 2000; i++) await c.escrever(quadro(64, 48, 0));
    await c.fechar();
  }, /ffmpeg do modo CPU/);
});

test('matar() termina o ffmpeg e apaga a saída parcial', async () => {
  const saida = join(pasta, 'e.h264');
  const c = new CodificadorCpu({ largura: 64, altura: 48, fps: 30, saida });
  await c.escrever(quadro(64, 48, 0));
  await c.matar();
  assert.equal(c.vivo, false);
  assert.equal(existsSync(saida), false);
});
