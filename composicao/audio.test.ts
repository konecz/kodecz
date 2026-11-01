// Testes do audio.ts (M07). Cada regra é conferida contra a saída da função do próprio @remotion/renderer 4.0.536 que
// ela reproduz, guardada em fixtures/audio-remotion.json (gravada em 2026-10-31 com as mesmas entradas, antes de o
// Remotion sair do motor), mais a liberação de recursos. Uso: node --test audio.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atempo, ColetorDeAudio, entradaDoVideo, expressaoVolume, filtroTrilha, lerSonda, montarMistura, origemDoAsset, rotuloEntrada, trechos } from './audio.ts';

// A régua do Remotion: as saídas do calculateAssetPositions (com o flattenVolumeArray), do ffmpegVolumeExpression, do
// calculateATempo e do stringifyFfmpegFilter para as entradas abaixo, na mesma ordem.
const REGUA = JSON.parse(readFileSync(new URL('./fixtures/audio-remotion.json', import.meta.url), 'utf8'));

// Gerador fixo (sem Math.random: o teste tem de repetir igual).
const aleatorio = (semente) => () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };

const asset = (id, quadro, extra = {}) => ({ type: 'audio', src: `http://127.0.0.1:1/public/${id}.wav`, id, frame: quadro,
  volume: 1, mediaFrame: quadro, playbackRate: 1, toneFrequency: 1, audioStartFrame: 0, audioStreamIndex: 0, ...extra });

// Linha do tempo fabricada: a presente em 2..9 com volume em rampa, b em 0..3 e de novo em 6..11 (dois trechos),
// c duplicada no mesmo quadro (o Remotion deduplica por id) e um asset de outro tipo (ignorado).
function linhaDoTempo() {
  const quadros = [];
  for (let n = 0; n < 12; n++) {
    const q = [];
    if (n >= 2 && n <= 9) q.push(asset('a', n, { volume: Math.min(1, (n - 2) / 4), mediaFrame: 5 + (n - 2) * 1.5, playbackRate: 1.5, audioStartFrame: 5 }));
    if (n <= 3 || n >= 6) q.push(asset('b', n, { volume: 0.4 }));
    if (n === 5) q.push(asset('c', n), asset('c', n));
    q.push({ type: 'artifact', id: 'x', frame: n });
    quadros.push(q);
  }
  return quadros;
}

test('trechos: iguais ao calculateAssetPositions do Remotion', () => {
  const nossos = trechos(linhaDoTempo());
  // O Remotion recebe só os de áudio e vídeo (onlyAudioAndVideoAssets, em render-frame-with-option-to-reject.ts).
  assert.equal(nossos.length, 4);
  assert.deepEqual(nossos, REGUA.trechos);
});

test('trechos: lista vazia e quadros sem áudio dão nenhum trecho', () => {
  assert.deepEqual(trechos([]), []);
  assert.deepEqual(trechos([[], [], []]), []);
});

test('expressão de volume: igual à do Remotion (fixo, rampa, muitos valores, trimLeft)', () => {
  const sorte = aleatorio(7);
  const casos = [
    [1, 30, 0], [0.5, 25, 1.2], [[0.3, 0.3, 0.3], 30, 0], [[0, 0.25, 0.5, 0.75, 1, 1, 1], 30, 0.4],
    [Array.from({ length: 300 }, () => sorte()), 30, 2.5], [Array.from({ length: 90 }, (_, i) => i / 89), 24, 0],
  ];
  assert.equal(REGUA.volume.length, casos.length);
  casos.forEach(([volume, fps, trimLeft], i) => assert.deepEqual(expressaoVolume(volume, fps, trimLeft), REGUA.volume[i]));
});

test('atempo: igual ao do Remotion, inclusive fora de 0,5 a 2 (encadeado)', () => {
  [1, 0.5, 0.75, 1.25, 2, 3, 0.25, 4.5].forEach((v, i) => assert.equal(atempo(v), REGUA.atempo[i]));
});

test('filtro por trilha: o mesmo filtro do Remotion e os mesmos adelay e apad da mistura', () => {
  const fps = 30, duracaoVideo = 12 / fps;
  const casos = [
    { canais: 1, duracaoMidia: 6, inicioMidia: 0 },
    { canais: 2, duracaoMidia: 6, inicioMidia: 0.025057 },  // MP3 com start_time
    { canais: 2, duracaoMidia: null, inicioMidia: 0 },
    { canais: 6, duracaoMidia: 0.1, inicioMidia: 0 },        // corte maior que a mídia
  ];
  let k = 0;
  for (const t of trechos(linhaDoTempo())) {
    for (const c of casos) {
      const deles = REGUA.filtros[k++];
      const nosso = filtroTrilha({ trecho: t, fps, duracaoVideo, taxa: 48000, entrada: '3:a', saida: 't3', ...c });
      if (deles === null) { assert.equal(nosso, null); continue; }
      const corpo = deles.filter.replace(/^\[0:a\]/, '').replace(/\[a0\]$/, '');
      const pads = [deles.pad_start, deles.pad_end].filter(Boolean).map((p) => `,${p}`).join('');
      // Depois do filtro do Remotion: a saída estéreo s16 (o -ac 2 -c:a pcm_s16le dele) e o pts zerado (o WAV dele).
      assert.equal(nosso, `[3:a]${corpo},aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS${pads}[t3]`);
    }
  }
  assert.equal(k, REGUA.filtros.length);
});

test('filtro por trilha: sem canais não entra na mistura', () => {
  const [t] = trechos(linhaDoTempo());
  assert.equal(filtroTrilha({ trecho: t, fps: 30, duracaoVideo: 1, taxa: 48000, canais: 0, duracaoMidia: 1, inicioMidia: 0, entrada: '1:a', saida: 't1' }), null);
});

test('mistura: um único grafo, amix sem normalizar e duração exata', () => {
  const m = montarMistura({
    trilhas: [{ arquivo: '/x/a.wav', filtro: (e, s) => `[${e}]acopy[${s}]` }, { arquivo: '/x/b.mp3', filtro: (e, s) => `[${e}]acopy[${s}]` }],
    totalAmostras: 48000,
  });
  assert.deepEqual(m.entradas, ['/x/a.wav', '/x/b.mp3']);
  assert.equal(m.filtro, '[1:a]acopy[t0];\n[2:a]acopy[t1];\n[t0][t1]amix=inputs=2:dropout_transition=0:normalize=0,aformat=sample_fmts=s16,apad=whole_len=48000,atrim=end_sample=48000[audio]');
  assert.equal(montarMistura({ trilhas: [], totalAmostras: 100 }), null);
});

test('origem do asset: arquivo do pacote, data: e recusa de rede e de fuga da pasta', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'm07-origem-'));
  const base = 'http://127.0.0.1:4321/';
  assert.equal(origemDoAsset('http://127.0.0.1:4321/public/voz%20a.mp3', { base, pacote: '/p', pasta }), '/p/public/voz a.mp3');
  const dados = origemDoAsset(`data:audio/wav;base64,${Buffer.from('RIFF1234').toString('base64')}`, { base, pacote: '/p', pasta });
  assert.equal(readFileSync(dados, 'utf8'), 'RIFF1234');
  assert.equal(origemDoAsset(`data:audio/wav;base64,${Buffer.from('RIFF1234').toString('base64')}`, { base, pacote: '/p', pasta }), dados);
  assert.throws(() => origemDoAsset('https://example.com/a.mp3', { base, pacote: '/p', pasta }), /fora do pacote/);
  // O parser de URL já resolve o «..» literal: fica dentro do pacote, como no servidor do motor.
  assert.equal(origemDoAsset('http://127.0.0.1:4321/../../etc/passwd', { base, pacote: '/p', pasta }), '/p/etc/passwd');
  assert.throws(() => origemDoAsset('http://127.0.0.1:4321/a%2F..%2F..%2F..%2Fetc%2Fpasswd', { base, pacote: '/p', pasta }), /fora do pacote/);
});

// Regressão (2026-10-29): no grafo único, o atrim mantinha o pts do corte e o amix levava esse início para a saída:
// o áudio do MP4 começava em 7,5 s (start_time) num trecho do caso real. No Remotion o WAV intermediário zera o pts.
test('MP4 final: áudio e vídeo começam em 0 mesmo com a primeira trilha cortada no início', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'm07-mp4-'));
  const ff = (args) => assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]).status, 0);
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=30:d=2', '-c:v', 'libx265', '-x265-params', 'log-level=none', '-f', 'hevc', join(pasta, 'v.hevc')]);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', join(pasta, 'tom.wav')]);
  const c = new ColetorDeAudio({ pasta: join(pasta, 'trabalho'), fps: 30, primeiro: 0, base: 'http://127.0.0.1:9/', pacote: pasta });
  for (let n = 0; n < 60; n++) {
    c.quadro(n, [asset('tom', n, { src: 'http://127.0.0.1:9/tom.wav', mediaFrame: 150 + n, volume: n / 60 })], 60);
  }
  const r = await c.misturar({ video: join(pasta, 'v.hevc'), saida: join(pasta, 'f.mp4'), totalQuadros: 60 });
  assert.equal(r.trilhas, 1);
  const sonda = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,start_time', '-of', 'json', join(pasta, 'f.mp4')], { encoding: 'utf8' });
  const inicios = JSON.parse(sonda.stdout).streams.map((s) => [s.codec_type, Number(s.start_time)]);
  assert.deepEqual(inicios, [['video', 0], ['audio', 0]]);
  assert.equal(existsSync(join(pasta, 'trabalho')), false);
});

// P13: páginas em paralelo. Cada página (com o seu servidor e a sua porta) exporta os assets do seu trecho, e o coletor
// que junta tem de ficar igual ao de uma página só que renderizou tudo (os mesmos quadros, com a src na base dele).
test('exportar e importar: trechos de páginas com bases diferentes juntam igual ao render de uma página só', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'p13-assets-'));
  writeFileSync(join(pasta, 'tom.wav'), '');
  const dados = 'data:audio/wav;base64,AAAA';
  const doQuadro = (base, n) => (n % 7 === 3 ? [] : [asset('tom', n, { src: `${base}tom.wav`, mediaFrame: n + 4 }),
    ...(n >= 10 ? [asset('d', n, { src: dados, mediaFrame: n - 10 })] : [])]);
  const coletor = (base, primeiro) => new ColetorDeAudio({ pasta: join(pasta, `c-${primeiro}-${base.length}`), fps: 30, primeiro, base, pacote: pasta });
  const uma = coletor('http://127.0.0.1:9/', 0);
  for (let n = 0; n < 40; n++) uma.quadro(n, doQuadro('http://127.0.0.1:9/', n), 40);
  const trechos = [[0, 15, 'http://127.0.0.1:41001/'], [15, 25, 'http://127.0.0.1:41002/']].map(([de, q, base]) => {
    const c = coletor(base, de);
    for (let n = de; n < de + q; n++) c.quadro(n, doQuadro(base, n), q);
    const e = JSON.parse(JSON.stringify(c.exportar()));
    c.limpar();
    return e;
  });
  assert.equal(trechos[1].primeiro, 15);
  assert.equal(trechos[1].quadros[0][0].src, 'tom.wav', 'src relativa à base da página');
  assert.equal(trechos[1].quadros[0][1].src, dados, 'data: fica como está');
  const junto = coletor('http://127.0.0.1:9/', 0);
  for (const t of trechos) junto.importar(t);
  assert.deepEqual(junto.quadros, uma.quadros);
  assert.equal(junto.assets, uma.assets);
  uma.limpar(); junto.limpar();
});

test('importar: trecho de outro qps ou antes do primeiro quadro do coletor é recusado', () => {
  const c = new ColetorDeAudio({ pasta: mkdtempSync(join(tmpdir(), 'p13-imp-')), fps: 30, primeiro: 10, base: 'http://127.0.0.1:9/', pacote: '/p' });
  assert.throws(() => c.importar({ fps: 25, primeiro: 10, quadros: [[]] }), /25 qps num coletor de 30/);
  assert.throws(() => c.importar({ fps: 30, primeiro: 5, quadros: [[]] }), /antes do primeiro quadro/);
  c.importar({ fps: 30, primeiro: 12, quadros: [[]] });
  assert.deepEqual(c.quadros[2], []);
  c.limpar();
});

// ---------- achados da revisão (2026-10-29) ----------

test('sonda: start_time como a regex do Remotion (negativo, N/A e MP3 viram 0)', () => {
  const t = (linhas) => lerSonda(linhas.join('\n'));
  assert.deepEqual(t(['channels=2', 'start_time=0.025057', 'duration=6.000000', 'format_name=wav']), { canais: 2, duracaoMidia: 6, inicioMidia: 0.025057 });
  assert.deepEqual(t(['channels=2', 'start_time=0.025057', 'duration=6.000000', 'format_name=mp3']), { canais: 2, duracaoMidia: 6, inicioMidia: 0 });
  assert.deepEqual(t(['channels=1', 'start_time=-0.021000', 'duration=3.5', 'format_name=mov,mp4,m4a,3gp,3g2,mj2']), { canais: 1, duracaoMidia: 3.5, inicioMidia: 0 });
  assert.deepEqual(t(['channels=2', 'start_time=N/A', 'duration=N/A', 'format_name=matroska,webm']), { canais: 2, duracaoMidia: null, inicioMidia: 0 });
  assert.deepEqual(t(['format_name=wav']), { canais: 0, duracaoMidia: null, inicioMidia: 0 });
});

test('entrada do grafo: a faixa só entra no rótulo quando não é a 0 (como o -map do Remotion)', () => {
  assert.equal(rotuloEntrada(1, 0), '1:a');
  assert.equal(rotuloEntrada(3, 2), '3:a:2');
});

test('falha cedo: fonte de rede recusada já no primeiro quadro em que aparece', () => {
  const c = new ColetorDeAudio({ pasta: mkdtempSync(join(tmpdir(), 'm07-cedo-')), fps: 30, primeiro: 0, base: 'http://127.0.0.1:9/', pacote: '/p' });
  c.quadro(0, [], 10);
  assert.throws(() => c.quadro(1, [asset('a', 1, { src: 'https://example.com/a.mp3' })], 10), /fora do pacote/);
  c.limpar();
});

// ffmpeg falso que não termina sozinho (exec: o pid é o do sleep).
function ffmpegLento() {
  const arq = join(mkdtempSync(join(tmpdir(), 'm07-lento-')), 'ffmpeg');
  writeFileSync(arq, '#!/bin/sh\nexec sleep 30\n');
  chmodSync(arq, 0o755);
  return arq;
}
const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
// Um WAV estéreo de 1600 amostras em data: (o ffprobe de verdade o lê; a fonte em data: cria a pasta de trabalho).
const cabecalhoWav = (bytes) => { const b = Buffer.alloc(44); b.write('RIFF', 0); b.writeUInt32LE(36 + bytes, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(48000, 24); b.writeUInt32LE(48000 * 4, 28);
  b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(bytes, 40); return b; };
const dadosWav = `data:audio/wav;base64,${Buffer.concat([cabecalhoWav(6400), Buffer.alloc(6400, 1)]).toString('base64')}`;
const somDados = asset('som', 0, { src: dadosWav, mediaFrame: 0 });

test('tempo-limite: ffmpeg preso é morto, a mistura falha com a mensagem e a pasta some', async () => {
  const base = mkdtempSync(join(tmpdir(), 'm07-limite-'));
  const c = new ColetorDeAudio({ pasta: join(base, 'trabalho'), fps: 30, primeiro: 0, base: 'http://127.0.0.1:9/', pacote: base });
  c.quadro(0, [somDados], 1);
  const t0 = performance.now();
  await assert.rejects(c.misturar({ video: join(base, 'v.hevc'), saida: join(base, 'f.mp4'), totalQuadros: 1, ffmpeg: ffmpegLento(), tempoLimite: 300 }), /tempo-limite/);
  assert.ok(performance.now() - t0 < 5000);
  assert.equal(existsSync(join(base, 'trabalho')), false);
});

test('SIGTERM no meio da mistura: o ffmpeg morre junto, a pasta de trabalho some e o processo sai com 143', async () => {
  const base = mkdtempSync(join(tmpdir(), 'm07-term-'));
  mkdirSync(join(base, 'p'));
  const modulo = new URL('./audio.ts', import.meta.url).href;
  const roteiro = `
    import { ColetorDeAudio, aoTerminar, filhosAtivos } from ${JSON.stringify(modulo)};
    const c = new ColetorDeAudio({ pasta: ${JSON.stringify(join(base, 'trabalho'))}, fps: 30, primeiro: 0, base: 'http://127.0.0.1:9/', pacote: ${JSON.stringify(join(base, 'p'))} });
    aoTerminar(() => c.limpar());
    c.quadro(0, [${JSON.stringify(somDados)}], 1);
    c.misturar({ video: 'v.hevc', saida: ${JSON.stringify(join(base, 'f.mp4'))}, totalQuadros: 1, ffmpeg: ${JSON.stringify(ffmpegLento())} });
    const olhar = () => { const [f] = filhosAtivos(); if (f) console.log('filho', f.pid); else setTimeout(olhar, 20); };
    olhar();`;
  const p = spawn(process.execPath, ['--input-type=module', '-e', roteiro], { stdio: ['ignore', 'pipe', 'inherit'] });
  const pid = await new Promise((ok) => p.stdout.on('data', (d) => { const m = /filho (\d+)/.exec(String(d)); if (m) ok(Number(m[1])); }));
  assert.equal(vivo(pid), true);
  assert.equal(existsSync(join(base, 'trabalho')), true);
  const codigo = new Promise((ok) => p.on('exit', (c, s) => ok(c ?? s)));
  p.kill('SIGTERM');
  assert.equal(await codigo, 143);
  await new Promise((ok) => setTimeout(ok, 100));
  assert.equal(vivo(pid), false);
  assert.equal(existsSync(join(base, 'trabalho')), false);
});

// Regressão (C02, 2026-10-31): com -framerate, o ffmpeg dava ao fluxo cru tempos em microssegundos truncados
// (33333 µs a 30 qps), e o MP4 andava 1/3 µs por quadro para trás: 270 ticks de 90 kHz (3 ms) em 9000 quadros. O SSIM
// do ffmpeg, que casa os quadros pelo tempo, comparava o quadro N com o N − 1 da referência a partir do 17 (e o take do
// apresentador parecia 1 quadro adiantado). O MP4 montado tem de trazer o quadro n em n × 90000 / qps, exato.
test('MP4 montado do fluxo cru: o quadro n no tempo n / qps exato, sem deriva (24, 25, 30 e 60 qps)', (t) => {
  const pasta = mkdtempSync(join(tmpdir(), 'motor-tempos-'));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  for (const fps of [24, 25, 30, 60]) {
    const cru = join(pasta, `v${fps}.h264`), mp4 = join(pasta, `v${fps}.mp4`), quadros = 40 * fps;
    const g = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=gray:size=64x48:rate=${fps}:duration=40`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '0', '-f', 'h264', cru], { encoding: 'utf8' });
    assert.equal(g.status, 0, g.stderr);
    const v = entradaDoVideo(cru, fps);
    const m = spawnSync('ffmpeg', ['-v', 'error', '-y', ...v.entrada, '-c:v', 'copy', ...v.filtro, '-video_track_timescale', '90000',
      '-movflags', '+faststart', '-f', 'mp4', mp4], { encoding: 'utf8' });
    assert.equal(m.status, 0, m.stderr);
    const pts = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts', '-of', 'csv=p=0', mp4],
      { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout.trim().split('\n').map(Number).sort((a, b) => a - b);
    assert.equal(pts.length, quadros);
    const fora = pts.map((p, n) => [n, p]).filter(([n, p]) => p !== (n * 90000) / fps);
    assert.deepEqual(fora.slice(0, 3), [], `${fps} qps: ${fora.length} quadros fora do tempo`);
    const d = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate,duration', '-of', 'csv=p=0', mp4],
      { encoding: 'utf8' }).stdout.trim();
    assert.equal(d, `${fps}/1,${(quadros / fps).toFixed(6)}`, `${fps} qps`);
  }
});
