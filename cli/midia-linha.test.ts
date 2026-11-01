// P10.5: as regras do vídeo e do áudio embutidos na linha do tempo (composicao/midia-linha.ts), sem Electron: a leitura
// dos atributos, o quadro do vídeo em cada N, a duração em quadros, a cor, os assets de áudio e o leitor do ffmpeg
// (com um vídeo sintético minúsculo, sem perda, em que o quadro i tem luma 20 × i). O render de ponta a ponta fica no
// render.test.ts. Rodar: node --test "cli/*.test.ts"
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as M from "../composicao/midia-linha.ts";

const pasta = mkdtempSync(join(tmpdir(), "p10-5-midia-"));
after(() => rmSync(pasta, { recursive: true, force: true }));
const crua = (x: Record<string, unknown>) => ({ tipo: "video", src: "http://127.0.0.1:1/v.mp4", inicio: null, recorte: null,
  quadros: null, volume: null, mudo: false, velocidade: null, ...x });

test("atributos: padrões, inteiros em quadros e volume de 0 a 10, com a correção na mensagem", () => {
  const [m] = M.lerMidias([crua({})], { quadros: 100 });
  assert.deepEqual({ ...m }, { tipo: "video", src: "http://127.0.0.1:1/v.mp4", inicio: 0, recorte: 0, quadros: null, volume: 1, mudo: false, velocidade: 1 });
  const [a] = M.lerMidias([crua({ tipo: "audio", inicio: "30", recorte: "4", quadros: "10", volume: "0.25", mudo: true })], { quadros: 100 });
  assert.deepEqual([a.inicio, a.recorte, a.quadros, a.volume, a.mudo], [30, 4, 10, 0.25, true]);
  const falha = (x: Record<string, unknown>, re: RegExp) => assert.throws(() => M.lerMidias([crua(x)], { quadros: 100 }), re);
  falha({ inicio: "1.5" }, /<video src=".*v\.mp4">: data-inicio tem de ser inteiro ≥ 0 \(em quadros da composição\): 1\.5/);
  falha({ recorte: "-2" }, /data-recorte tem de ser inteiro ≥ 0/);
  falha({ quadros: "0" }, /data-quadros tem de ser ≥ 1/);
  falha({ inicio: "100" }, /data-inicio 100 fora da composição \(100 quadros\)/);
  falha({ volume: "alto" }, /data-volume tem de ser número de 0 a 10: alto/);
  falha({ volume: "11" }, /data-volume tem de ser número de 0 a 10/);
  falha({ src: "" }, /sem o atributo src/);
});

test("volume variável (C02): pontos quadro:volume, em ordem, com a correção na mensagem", () => {
  const [a] = M.lerMidias([crua({ tipo: "audio", quadros: "40", volume: "0:0 6:1, 20:1 40:0" })], { quadros: 100 });
  assert.deepEqual(a.volume, [[0, 0], [6, 1], [20, 1], [40, 0]]);
  const [b] = M.lerMidias([crua({ tipo: "audio", volume: " 0:0.25 " })], { quadros: 100 });
  assert.deepEqual(b.volume, [[0, 0.25]]);
  const falha = (volume: string, re: RegExp) => assert.throws(() => M.lerMidias([crua({ volume })], { quadros: 100 }), re);
  falha("0:0 6", /data-volume: «6» não é quadro:volume/);
  falha("0:0 6:11", /data-volume: volume 11 fora de 0 a 10/);
  falha("0:0 1.5:1", /data-volume: «1\.5:1» não é quadro:volume/);
  falha("6:1 6:0", /data-volume: os quadros têm de crescer \(6 depois de 6\)/);
  falha("6:1 2:0", /data-volume: os quadros têm de crescer \(2 depois de 6\)/);
});

test("volume variável (C02): linear entre os pontos, preso nas pontas, e o quadro com volume 0 fica de fora", () => {
  const base = "http://127.0.0.1:9/";
  // A rampa do Remotion: interpolate(f, [0, 6, 20, 24], [0, 1, 1, 0]), com f contado do início da mídia.
  const m = { k: 0, tipo: "audio", src: `${base}t.mp3`, inicio: 10, recorte: 3, quadros: 24, volume: [[0, 0], [6, 1], [20, 1], [24, 0]], mudo: false };
  const vol = (n: number) => M.assetsDoQuadro([m], n, base).map((x: any) => [x.mediaFrame, x.volume]);
  assert.deepEqual(vol(10), []);
  assert.deepEqual(vol(11), [[4, 1 / 6]]);
  assert.deepEqual(vol(13), [[6, 0.5]]);
  assert.deepEqual(vol(16), [[9, 1]]);
  assert.deepEqual(vol(32), [[25, 0.5]]);
  assert.deepEqual(vol(33), [[26, 0.25]]);
  assert.deepEqual(vol(34), []);
  // Antes do primeiro ponto e depois do último, o volume da ponta.
  const n = { ...m, volume: [[2, 0.5], [4, 1]] };
  assert.deepEqual(M.assetsDoQuadro([n], 10, base).map((x: any) => x.volume), [0.5]);
  assert.deepEqual(M.assetsDoQuadro([n], 30, base).map((x: any) => x.volume), [1]);
  assert.equal(M.volumeNoQuadro(n, 3), 0.75);
  assert.equal(M.volumeNoQuadro({ volume: 0.4 }, 3), 0.4);
});

// Vídeo de quadros no passo dado (em ticks da base 1/den), como a sonda devolve: ticks a partir do primeiro e a base.
const videoDe = (quadros: number, passo: number, den: number, num = 1) => ({ ticks: Array.from({ length: quadros }, (_, i) => i * passo), base: [num, den] });

test("quadro do vídeo: o último com pts ≤ t, só de N (mesmo qps, qps maior e menor que o do vídeo)", () => {
  const v25 = videoDe(50, 512, 12800); // 25 qps, base de tempo do MP4
  const m = { inicio: 5, recorte: 7 };
  for (const n of [5, 6, 20, 47]) assert.equal(M.indiceNoVideo(v25, M.tempoNoVideo(m, n, 25)), n - 5 + 7);
  // Composição a 50 qps: cada quadro do vídeo aparece duas vezes; a 10 qps, pula de 2,5 em 2,5 (para baixo).
  assert.deepEqual([0, 1, 2, 3].map((n) => M.indiceNoVideo(v25, n / 50)), [0, 0, 1, 1]);
  assert.deepEqual([0, 1, 2, 3].map((n) => M.indiceNoVideo(v25, n / 10)), [0, 2, 5, 7]);
  // Pts de 30 qps em base 1/15360 (com o arredondamento do ponto flutuante) caem no quadro certo.
  const v30 = videoDe(90, 512, 15360);
  for (let n = 0; n < 90; n++) assert.equal(M.indiceNoVideo(v30, n / 30), n);
  // Depois do fim, o último; antes do primeiro, o primeiro.
  assert.equal(M.indiceNoVideo(v25, 99), 49);
  assert.equal(M.indiceNoVideo({ ticks: [6400, 6912], base: [1, 12800] }, 0), 0);
});

// Regressão: a folga de 0,1 ms antecipava o quadro quando o pts dele passava de t por menos que isso. Com 29,97 qps
// numa composição a 30, o quadro k do vídeo começa k × 33,3 µs depois do quadro k da composição: nos quadros 1 a 3 o
// motor mostrava o k e o Remotion mostra o k − 1 (medido no Remotion 4.0.536, <OffthreadVideo>). A regra do
// compositor do Remotion (opened_stream.rs, calc_position; frame_cache.rs, get_item_id): t vira o tick mais próximo
// da base de tempo do vídeo, e o quadro é o último com pts ≤ esse tick.
test("quadro do vídeo: t no tick mais próximo da base do vídeo, sem folga (29,97 em 30, 24 e 25 em 30, 30 em 60)", () => {
  const v2997 = videoDe(120, 1001, 30000);
  assert.deepEqual(Array.from({ length: 8 }, (_, n) => M.indiceNoVideo(v2997, n / 30)), [0, 0, 1, 2, 3, 4, 5, 6]);
  for (let n = 1; n < 120; n++) assert.equal(M.indiceNoVideo(v2997, n / 30), n - 1, `29,97 em 30, quadro ${n}`);
  // As sequências que o Remotion 4.0.536 mostrou com os vídeos sintéticos (24, 25 e 30 qps, com e sem corte).
  const v24 = videoDe(96, 512, 12288), v25 = videoDe(100, 512, 12800), v30 = videoDe(120, 512, 15360);
  const seq = (v: any, qps: number, inicio: number, recorte: number, de: number, ate: number) =>
    Array.from({ length: ate - de }, (_, i) => M.indiceNoVideo(v, M.tempoNoVideo({ inicio, recorte }, de + i, qps)));
  assert.deepEqual(seq(v24, 30, 0, 0, 0, 12), [0, 0, 1, 2, 3, 4, 4, 5, 6, 7, 8, 8]);
  assert.deepEqual(seq(v25, 30, 0, 0, 0, 14), [0, 0, 1, 2, 3, 4, 5, 5, 6, 7, 8, 9, 10, 10]);
  assert.deepEqual(seq(v30, 60, 0, 0, 0, 6), [0, 0, 1, 1, 2, 2]);
  assert.deepEqual(seq(v25, 30, 7, 11, 7, 15), [9, 10, 10, 11, 12, 13, 14, 15]);
  assert.deepEqual(seq(v24, 30, 3, 5, 3, 10), [4, 4, 5, 6, 7, 8, 8]);
  assert.deepEqual(seq(v30, 60, 4, 7, 4, 10), [3, 4, 4, 5, 5, 6]);
  // Pts que cai no meio de dois ticks do t: o arredondamento do tick decide, como no Remotion.
  assert.equal(M.indiceNoVideo({ ticks: [0, 1000, 2001], base: [1, 30000] }, 2000.4 / 30000), 1);
  assert.equal(M.indiceNoVideo({ ticks: [0, 1000, 2001], base: [1, 30000] }, 2000.6 / 30000), 2);
});

test("duração em quadros: data-quadros conferido, ou até o fim da mídia ou da composição", () => {
  const m = (x: Record<string, unknown>) => ({ tipo: "video", src: "v.mp4", inicio: 0, recorte: 0, quadros: null, ...x });
  assert.equal(M.quadrosDaMidia(m({}), { duracao: 11.96, qps: 25, total: 400 }), 299);
  assert.equal(M.quadrosDaMidia(m({ recorte: 9 }), { duracao: 11.96, qps: 25, total: 400 }), 290);
  assert.equal(M.quadrosDaMidia(m({ inicio: 200 }), { duracao: 11.96, qps: 25, total: 400 }), 200);
  assert.equal(M.quadrosDaMidia(m({ quadros: 20, inicio: 5 }), { duracao: 2, qps: 25, total: 40 }), 20);
  assert.throws(() => M.quadrosDaMidia(m({ quadros: 36, inicio: 5 }), { duracao: 2, qps: 25, total: 40 }), /passa do fim da composição \(40 quadros\)/);
  assert.throws(() => M.quadrosDaMidia(m({ recorte: 50 }), { duracao: 2, qps: 25, total: 40 }), /data-recorte 50 passa do fim da mídia/);
});

test("velocidade (C02): data-velocidade de 0,1 a 10, padrão 1, com a correção na mensagem", () => {
  const [m] = M.lerMidias([crua({})], { quadros: 100 });
  assert.equal(m.velocidade, 1);
  const [v, a] = M.lerMidias([crua({ velocidade: "1.1" }), crua({ tipo: "audio", velocidade: " 2 " })], { quadros: 100 });
  assert.deepEqual([v.velocidade, a.velocidade], [1.1, 2]);
  const falha = (velocidade: string, re: RegExp) => assert.throws(() => M.lerMidias([crua({ velocidade })], { quadros: 100 }), re);
  for (const x of ["0", "-1", "0.05", "11", "rápido", "1,5", "Infinity", "1e1"]) falha(x, /data-velocidade tem de ser número de 0,1 a 10/);
});

test("velocidade (C02): o quadro do vídeo no tempo (N − inicio) × velocidade / qps + recorte / qps", () => {
  const pts25 = videoDe(200, 512, 12800);
  const pts30 = videoDe(200, 512, 15360);
  // Velocidade 1: a conta de antes, exata.
  for (const n of [5, 6, 20, 47]) assert.equal(M.indiceNoVideo(pts25, M.tempoNoVideo({ inicio: 5, recorte: 7, velocidade: 1 }, n, 25)), n - 5 + 7);
  // Velocidade 2: um quadro do vídeo sim, outro não.
  for (let n = 5; n < 60; n++) assert.equal(M.indiceNoVideo(pts25, M.tempoNoVideo({ inicio: 5, recorte: 7, velocidade: 2 }, n, 25)), 2 * (n - 5) + 7, `vel 2, n ${n}`);
  // Velocidade 1,1: o piso de 1,1 × (N − inicio), em inteiros (11k / 10), mais o recorte; também com o vídeo a 30 qps.
  for (let n = 5; n < 120; n++) {
    const k = n - 5;
    assert.equal(M.indiceNoVideo(pts25, M.tempoNoVideo({ inicio: 5, recorte: 7, velocidade: 1.1 }, n, 25)), Math.floor((11 * k) / 10) + 7, `vel 1,1, n ${n}`);
    // Composição a 30 qps e vídeo a 30 qps.
    assert.equal(M.indiceNoVideo(pts30, M.tempoNoVideo({ inicio: 5, recorte: 0, velocidade: 1.1 }, n, 30)), Math.floor((11 * k) / 10), `vel 1,1 a 30, n ${n}`);
  }
  // Sem velocidade no objeto (chamada antiga): 1.
  assert.equal(M.tempoNoVideo({ inicio: 0, recorte: 3 }, 2, 25), 5 / 25);
});

// Velocidade com qps diferentes e recorte: as sequências que o Remotion 4.0.536 mostrou (<OffthreadVideo> com
// playbackRate e trimBefore, vídeos sintéticos numerados; docs/experimentos/2026-10-quadro-do-video-entre-qps.md).
// A conta em ticks da base do vídeo vale também com a velocidade.
test("velocidade (C02) com 25 e 24 qps numa composição a 30 e recorte: o quadro do Remotion", () => {
  const v25 = videoDe(100, 512, 12800), v24 = videoDe(96, 512, 12288);
  const seq = (v: any, m: any, de: number, ate: number) => Array.from({ length: ate - de }, (_, i) => M.indiceNoVideo(v, M.tempoNoVideo(m, de + i, 30)));
  assert.deepEqual(seq(v25, { inicio: 7, recorte: 11, velocidade: 1.5 }, 7, 22), [9, 10, 11, 12, 14, 15, 16, 17, 19, 20, 21, 22, 24, 25, 26]);
  assert.deepEqual(seq(v25, { inicio: 3, recorte: 5, velocidade: 0.5 }, 3, 15), [4, 4, 5, 5, 5, 6, 6, 7, 7, 7, 8, 8]);
  assert.deepEqual(seq(v24, { inicio: 2, recorte: 4, velocidade: 1.1 }, 2, 14), [3, 4, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12]);
});

test("velocidade (C02): sem data-quadros, a mídia ocupa (duração × qps − recorte) / velocidade", () => {
  const m = (x: Record<string, unknown>) => ({ tipo: "video", src: "v.mp4", inicio: 0, recorte: 0, quadros: null, velocidade: 1, ...x });
  // 299 quadros a 1; a 2, 149,5 → 150 (o quadro 149 está em 11,92 s, o 150 em 12 s, depois do fim).
  assert.equal(M.quadrosDaMidia(m({ velocidade: 2 }), { duracao: 11.96, qps: 25, total: 400 }), 150);
  assert.equal(M.quadrosDaMidia(m({ velocidade: 2 }), { duracao: 12, qps: 25, total: 400 }), 150);
  assert.equal(M.quadrosDaMidia(m({ velocidade: 1.1, recorte: 9 }), { duracao: 11.96, qps: 25, total: 400 }), 264);
  assert.equal(M.quadrosDaMidia(m({ velocidade: 0.5 }), { duracao: 2, qps: 25, total: 400 }), 100);
  // Presa no fim da composição; data-quadros dado vale como está.
  assert.equal(M.quadrosDaMidia(m({ velocidade: 0.5, inicio: 350 }), { duracao: 2, qps: 25, total: 400 }), 50);
  assert.equal(M.quadrosDaMidia(m({ velocidade: 2, quadros: 30 }), { duracao: 2, qps: 25, total: 400 }), 30);
  // O último quadro ocupado ainda está dentro da mídia; o seguinte, não.
  for (const [vel, rec] of [[2, 0], [1.1, 9], [0.5, 3], [3, 1]]) {
    const q = M.quadrosDaMidia(m({ velocidade: vel, recorte: rec }), { duracao: 11.96, qps: 25, total: 10000 });
    assert.ok(M.tempoNoVideo({ inicio: 0, recorte: rec, velocidade: vel }, q - 1, 25) < 11.96, `vel ${vel}: o último dentro`);
    assert.ok(M.tempoNoVideo({ inicio: 0, recorte: rec, velocidade: vel }, q, 25) >= 11.96 - 1e-4, `vel ${vel}: o seguinte fora`);
  }
  assert.throws(() => M.quadrosDaMidia(m({ velocidade: 2, recorte: 50 }), { duracao: 2, qps: 25, total: 40 }), /data-recorte 50 passa do fim da mídia/);
});

test("velocidade (C02): os assets levam a velocidade e o recorte como início na mídia; o atempo encadeia fora de 0,5 a 2", async () => {
  const base = "http://127.0.0.1:9/";
  const m = { k: 0, tipo: "audio", src: `${base}t.wav`, inicio: 10, recorte: 4, quadros: 20, volume: 1, mudo: false, velocidade: 2 };
  assert.deepEqual(M.assetsDoQuadro([m], 10, base), [{ type: "audio", src: `${base}t.wav`, id: "motor-midia-0", volume: 1,
    mediaFrame: 4, playbackRate: 2, toneFrequency: 1, audioStartFrame: 4, audioStreamIndex: 0 }]);
  assert.deepEqual(M.assetsDoQuadro([m], 13, base).map((a: any) => a.mediaFrame), [7]);
  // Velocidade 1: o asset de antes (audioStartFrame 0).
  assert.equal(M.assetsDoQuadro([{ ...m, velocidade: 1 }], 10, base)[0].audioStartFrame, 0);
  // No filtro do áudio (audio.ts): o trecho (20 quadros, 0,8 s) começa em recorte / (qps × velocidade) = 0,08 s do áudio
  // acelerado (o quadro 4 da mídia), e, começando
  // 3 quadros depois, 3 / 25 s adiante no tempo acelerado. O atempo de 3 vira duas raízes (0,5 a 2 cada).
  const { trechos, filtroTrilha, atempo } = await import("../composicao/audio.ts");
  const filtro = (de: number) => {
    const quadros = Array.from({ length: 30 - de }, (_, i) => M.assetsDoQuadro([m], de + i, base));
    const [t] = trechos(quadros);
    return filtroTrilha({ trecho: t, fps: 25, duracaoVideo: (30 - de) / 25, taxa: 48000, canais: 2, duracaoMidia: 10, inicioMidia: 0, entrada: "1:a", saida: "a0" });
  };
  assert.match(filtro(0), /atempo=2\.00000,atrim=80000us:880000us/);
  assert.match(filtro(13), /atempo=2\.00000,atrim=200000us:880000us/);
  assert.equal(atempo(3), "atempo=1.73205,atempo=1.73205");
  assert.equal(atempo(0.25), "atempo=0.50000,atempo=0.50000");
});

test("cor: sem tag, a regra do Remotion (bt709 com 720 linhas ou mais, faixa TV); com tag, a marcada", () => {
  assert.deepEqual(M.corDoVideo({ color_space: "unknown", height: 1080, pix_fmt: "yuv420p" }), { matrix: "bt709", fullRange: false });
  assert.deepEqual(M.corDoVideo({ height: 480, pix_fmt: "yuv420p" }), { matrix: "smpte170m", fullRange: false });
  assert.deepEqual(M.corDoVideo({ color_space: "bt470bg", color_range: "pc", height: 1080, pix_fmt: "yuv420p" }), { matrix: "bt470bg", fullRange: true });
  assert.deepEqual(M.corDoVideo({ height: 1080, pix_fmt: "yuvj420p" }), { matrix: "smpte170m", fullRange: true });
  assert.throws(() => M.corDoVideo({ color_space: "gbr", height: 1080, pix_fmt: "yuv420p" }), /matriz de cor gbr não é tratada/);
});

test("áudio: assets do quadro no formato do collect-assets (vídeo e áudio, mudo e volume 0 de fora)", () => {
  const base = "http://127.0.0.1:9/";
  const midias = [
    { k: 0, tipo: "video", src: `${base}v.mp4`, inicio: 5, recorte: 7, quadros: 20, volume: 1, mudo: false },
    { k: 1, tipo: "audio", src: `${base}b.wav`, inicio: 30, recorte: 0, quadros: 10, volume: 0.8, mudo: false },
    { k: 2, tipo: "video", src: `${base}m.mp4`, inicio: 0, recorte: 0, quadros: 40, volume: 1, mudo: true },
    { k: 3, tipo: "audio", src: `${base}z.wav`, inicio: 0, recorte: 0, quadros: 40, volume: 0, mudo: false },
  ];
  assert.deepEqual(M.assetsDoQuadro(midias, 4, base), []);
  assert.deepEqual(M.assetsDoQuadro(midias, 5, base), [{ type: "video", src: `${base}v.mp4`, id: "motor-midia-0", volume: 1,
    mediaFrame: 7, playbackRate: 1, toneFrequency: 1, audioStartFrame: 0, audioStreamIndex: 0 }]);
  assert.deepEqual(M.assetsDoQuadro(midias, 24, base).map((a: any) => a.mediaFrame), [26]);
  assert.deepEqual(M.assetsDoQuadro(midias, 25, base), []);
  assert.deepEqual(M.assetsDoQuadro(midias, 31, base).map((a: any) => [a.type, a.id, a.mediaFrame, a.volume]), [["audio", "motor-midia-1", 1, 0.8]]);
});

test("leitor: quadro i exato em I420, para a frente num ffmpeg só, e para trás reabrindo", async () => {
  const video = join(pasta, "degraus.mp4");
  const g = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i",
    "color=black:size=64x48:rate=25:duration=0.4,format=yuv420p,geq=lum='N*20':cb=128:cr=128", "-c:v", "libx264", "-qp", "0",
    "-pix_fmt", "yuv420p", "-bf", "2", video], { encoding: "utf8" });
  assert.equal(g.status, 0, g.stderr);
  const s = M.sondarVideo(video);
  assert.deepEqual([s.largura, s.altura, s.formato, s.pts.length], [64, 48, "yuv420p", 10]);
  assert.deepEqual(s.cor, { matrix: "smpte170m", fullRange: false });
  assert.ok(Math.abs(s.pts[3] - 0.12) < 1e-9, `pts ${s.pts}`);
  // Os pts também em ticks inteiros da base do vídeo (a regra do quadro conta neles, como o Remotion).
  assert.deepEqual([s.base, s.ticks.slice(0, 4)], [[1, 12800], [0, 512, 1024, 1536]]);
  const l = new M.LeitorDeVideo({ arquivo: video, largura: 64, altura: 48, formato: "yuv420p" });
  try {
    for (const i of [0, 1, 4, 4, 9]) {
      const q = await l.quadro(i);
      assert.equal(q.length, 64 * 48 * 1.5);
      assert.equal(q[0], i * 20, `quadro ${i}`);
      assert.equal(q[64 * 48], 128); // croma
    }
    assert.equal(l.reaberturas, 0);
    assert.equal((await l.quadro(2))[0], 40);
    assert.equal(l.reaberturas, 1);
    await assert.rejects(l.quadro(10), /o vídeo acabou no quadro 9, pedido o 10/);
  } finally { l.fechar(); }
});

// P13 (CPU por página): o leitor com os pts da sonda começa no quadro pedido com -ss (o ffmpeg vai ao quadro-chave de
// antes e descarta o resto sem mandar ao Node), em vez de decodificar e copiar desde o 0 o que a página que começa no
// meio não usa. Tem de dar os mesmos bytes que a leitura desde o 0, inclusive com o vídeo começando depois do áudio
// (o -ss conta do início do arquivo, não da faixa de vídeo).
test("leitor: com os pts, começa no quadro i pelo -ss, com os mesmos bytes da leitura desde o 0", async () => {
  const casos = [
    { nome: "gop4.mp4", args: [] as string[] },
    // Vídeo 0,48 s depois do áudio: o início do arquivo é o do áudio (deslocamento da faixa de vídeo ≠ 0).
    { nome: "atrasado.mp4", args: ["-itsoffset", "0.48"] },
    // Revisão: quadros B em pirâmide (o DTS bem antes do PTS), abrindo em cada quadro, inclusive no logo antes de cada
    // quadro-chave (o caso em que uma busca pelo DTS cairia no quadro-chave seguinte).
    { nome: "piramide.mp4", args: [], codec: ["-c:v", "libx264", "-qp", "0", "-g", "4", "-bf", "3", "-x264-params", "b-pyramid=normal"] },
  ];
  for (const c of casos) {
    const video = join(pasta, c.nome);
    const g = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...c.args, "-f", "lavfi", "-i",
      "color=black:size=64x48:rate=25:duration=0.8,format=yuv420p,geq=lum='N*10':cb=128:cr=128", "-f", "lavfi", "-i",
      "sine=frequency=440:sample_rate=48000:duration=1.4", ...(c.codec ?? ["-c:v", "libx264", "-qp", "0", "-g", "4", "-bf", "2"]),
      "-pix_fmt", "yuv420p", "-c:a", "aac", video], { encoding: "utf8" });
    assert.equal(g.status, 0, g.stderr);
    const s = M.sondarVideo(video);
    assert.equal(s.pts.length, 20, c.nome);
    assert.equal(s.buscaExata, true, c.nome);
    if (c.nome === "atrasado.mp4") assert.ok(Math.abs(s.deslocamento - 0.48) < 0.03, `deslocamento ${s.deslocamento}`);
    const desde0 = new M.LeitorDeVideo({ arquivo: video, largura: 64, altura: 48, formato: "yuv420p" });
    const pulando = new M.LeitorDeVideo({ arquivo: video, largura: 64, altura: 48, formato: "yuv420p", pts: s.pts, deslocamento: s.deslocamento });
    try {
      const esperado = [];
      for (let i = 0; i < 20; i++) esperado.push(Buffer.from(await desde0.quadro(i)));
      // Começo no meio de um GOP (13), em frente (14, 15), para trás (5, reabre), um quadro-chave (8) e o último.
      for (const i of [13, 14, 15, 5, 8, 19]) {
        const q = await pulando.quadro(i);
        assert.equal(q[0], i * 10, `${c.nome}: quadro ${i}`);
        assert.ok(q.equals(esperado[i]), `${c.nome}: quadro ${i} difere da leitura desde o 0`);
      }
      // Só vêm ao Node os quadros pedidos e os do caminho em frente (para a frente, o ffmpeg aberto segue): 13, 14, 15;
      // 5 a 8; 9 a 19. Só a volta para trás reabre.
      assert.equal(pulando.decodificados, 3 + 4 + 11, c.nome);
      assert.equal(pulando.reaberturas, 1, c.nome);
      // Um leitor novo para cada i: o primeiro quadro entregue depois do -ss é sempre o pedido.
      for (let i = 1; i < 20; i++) {
        const l = new M.LeitorDeVideo({ arquivo: video, largura: 64, altura: 48, formato: "yuv420p", pts: s.pts, deslocamento: s.deslocamento });
        try { assert.ok((await l.quadro(i)).equals(esperado[i]), `${c.nome}: aberto no quadro ${i}`); } finally { l.fechar(); }
      }
    } finally { desde0.fechar(); pulando.fechar(); }
  }
});

// Regressão da revisão: no HEVC com quadros B, o leitor aberto pelo -ss no quadro 6 deu outro quadro. Fora do H.264
// em MP4/MOV, a sonda não libera a busca e o leitor abre do 0.
test("sonda: HEVC ou fora do MP4/MOV, sem busca exata (o leitor abre do 0)", () => {
  const casos: [string, string[]][] = [
    ["fora.mkv", ["-c:v", "libx264"]],
    ["hevc.mp4", ["-c:v", "libx265", "-x265-params", "keyint=4:min-keyint=4:bframes=4:log-level=error", "-tag:v", "hvc1"]],
  ];
  for (const [nome, codec] of casos) {
    const video = join(pasta, nome);
    const g = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", "color=gray:size=64x48:rate=25:duration=0.4",
      ...codec, "-pix_fmt", "yuv420p", video], { encoding: "utf8" });
    assert.equal(g.status, 0, g.stderr);
    assert.equal(M.sondarVideo(video).buscaExata, false, nome);
  }
});

// Regressão: com o stream acabado, o read(tamanho) do Node devolve o resto, menor que um quadro; saía como quadro.
test("leitor: quadro incompleto no fim do stream é erro, não quadro", async () => {
  const falso = join(pasta, "ffmpeg-falso.sh");
  writeFileSync(falso, "#!/bin/sh\nhead -c 6000 /dev/zero\n"); // 4608 bytes por quadro de 64x48: 1 quadro e 1392 bytes
  chmodSync(falso, 0o755);
  const l = new M.LeitorDeVideo({ arquivo: "falso.mp4", largura: 64, altura: 48, formato: "yuv420p", ffmpeg: falso });
  try {
    assert.equal((await l.quadro(0)).length, 4608);
    await assert.rejects(l.quadro(1), /quadro incompleto no fim \(1392 de 4608 bytes\)/);
  } finally { l.fechar(); }
});

test("sonda: recusa o que a conversão de cor não cobre (10 bits), com o formato na mensagem", () => {
  const video = join(pasta, "dez.mp4");
  const g = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", "color=gray:size=64x48:rate=25:duration=0.2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p10le", video], { encoding: "utf8" });
  assert.equal(g.status, 0, g.stderr);
  assert.throws(() => M.sondarVideo(video), /formato yuv420p10le; o motor aceita vídeo 4:2:0 de 8 bits/);
});
