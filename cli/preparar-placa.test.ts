// `kodecz prepare interpolate` and `kodecz prepare words` end to end on the GPU, with synthetic material (ffmpeg
// testsrc and a tone). Each test is skipped when its external program is not installed: RIFE (KODECZ_RIFE or
// rife-ncnn-vulkan on the PATH) and the Python with faster-whisper (KODECZ_PYTHON, set explicitly: the first run
// downloads the model). Part of `./verificar.sh completo`, which holds the GPU lock.
// Run alone: flock -s /tmp/motor-video-placa.lock node --test cli/preparar-placa.test.ts
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acharRife } from "./preparar.ts";

const pasta = mkdtempSync(join(tmpdir(), "preparo-placa-"));
after(() => rmSync(pasta, { recursive: true, force: true }));
const KODECZ = new URL("./kodecz.ts", import.meta.url).pathname;
const ffmpeg = (...args: string[]) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};
const semRife = (() => { try { acharRife(undefined, undefined, process.env); return false; } catch (e) { return (e as Error).message; } })();
const python = process.env.KODECZ_PYTHON;
const semWhisper = !python ? "KODECZ_PYTHON not set"
  : spawnSync(python, ["-I", "-c", "import faster_whisper"]).status !== 0 ? `no faster-whisper in ${python}` : false;

test("prepare interpolate: 2 s at 24 fps become 144 JPEG frames at 72 fps on the NVIDIA GPU", { skip: semRife }, () => {
  const video = join(pasta, "fonte.mp4");
  ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x180:rate=24:d=2", "-pix_fmt", "yuv420p", "-c:v", "mpeg4", "-q:v", "3", video);
  const saida = join(pasta, "quadros");
  const r = spawnSync(process.execPath, [KODECZ, "prepare", "interpolate", video, saida, "--fps", "72"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual([j.entrada.quadros, j.entrada.fps, j.saida.quadros, j.saida.fps], [48, 24, 144, 72]);
  assert.match(j.rife.placa, /NVIDIA/);
  const nomes = readdirSync(saida).sort();
  assert.equal(nomes.length, 144);
  assert.deepEqual([nomes[0], nomes.at(-1)], ["0001.jpg", "0144.jpg"]);
});

test("prepare words: faster-whisper runs on CUDA and the file has the script's words", { skip: semWhisper }, () => {
  const audio = join(pasta, "tom.wav"), roteiro = join(pasta, "roteiro.txt"), saida = join(pasta, "falas.json");
  ffmpeg("-f", "lavfi", "-i", "sine=f=300:d=1.5", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=2",
    "-filter_complex", "[0][1]concat=n=2:v=0:a=1", audio);
  writeFileSync(roteiro, "Um, dois — três.");
  const r = spawnSync(process.execPath, [KODECZ, "prepare", "words", audio, roteiro, saida], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.dispositivo, "cuda");
  assert.equal(j.fimVoz, 1.5);
  assert.equal(j.corte, 1.7);
  const f = JSON.parse(readFileSync(saida, "utf8"));
  assert.deepEqual(f.palavras.map((p: { texto: string }) => p.texto), ["Um,", "dois —", "três."]);
  for (const p of f.palavras) assert.ok(p.inicio <= p.fim && p.fim <= 1.7);
});
