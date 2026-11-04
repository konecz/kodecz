// Tests of `kodecz prepare` (cli/preparar.ts): the arguments, the ffmpeg filters, how the external programs are found
// and the parsing of ffmpeg's measurements; then `voice` and `loudness` end to end on a few seconds of synthetic audio
// (ffmpeg lavfi tones and testsrc). No GPU, browser, recognizer or RIFE. Run: node --test cli/preparar.test.ts
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acharPython, acharRife, ErroPreparo, filtroLoudnorm, filtroVoz, lerArgumentosPreparar, lerEbur128, lerFps,
  lerLoudnorm, quadrosAlvo } from "./preparar.ts";
import { resolverComando } from "./kodecz.ts";
import { ErroDeUso } from "./regras.ts";

const pasta = mkdtempSync(join(tmpdir(), "preparo-"));
after(() => rmSync(pasta, { recursive: true, force: true }));
const arquivo = (nome: string, conteudo = "") => { const f = join(pasta, nome); writeFileSync(f, conteudo); return f; };
const uso = (fn: () => unknown, re: RegExp, codigo = 2) =>
  assert.throws(fn, (e: unknown) => e instanceof ErroDeUso && e.codigo === codigo && re.test(e.message));
const KODECZ = new URL("./kodecz.ts", import.meta.url).pathname;
const kodecz = (...args: string[]) => spawnSync(process.execPath, [KODECZ, ...args], { encoding: "utf8" });
const ffmpeg = (...args: string[]) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};
const duracao = (f: string) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout);

test("kodecz prepare runs cli/preparar.ts", () => {
  assert.deepEqual(resolverComando(["prepare", "voice", "a", "b"]), { script: "preparar.ts", args: ["voice", "a", "b"] });
});

test("arguments: steps, defaults and options", () => {
  const a = arquivo("a.wav"), r = arquivo("r.txt", "olá");
  assert.deepEqual(lerArgumentosPreparar(["voice", a, "o.wav"]),
    { passo: "voice", entrada: a, saida: join(process.cwd(), "o.wav"), velocidade: 1.1, pausa: 0.35, limiar: -40, bordas: false });
  const v = lerArgumentosPreparar(["voice", a, "o.wav", "--speed", "1.2", "--max-pause=0", "--threshold", "-50", "--keep-edges"]);
  assert.equal(lerArgumentosPreparar(["loudness", a, "o.mp4", "--target", "-16", "--true-peak", "-2"]).passo, "loudness");
  assert.deepEqual([v.passo === "voice" && v.velocidade, v.passo === "voice" && v.pausa, v.passo === "voice" && v.limiar, v.passo === "voice" && v.bordas], [1.2, 0, -50, true]);
  const w = lerArgumentosPreparar(["words", a, r, "f.json", "--language", "pt"]);
  assert.equal(w.passo === "words" && w.modelo, "mobiuslabsgmbh/faster-whisper-large-v3-turbo");
  assert.equal(w.passo === "words" && w.cpu, false);
  assert.equal(w.passo === "words" && w.idioma, "pt");
  const i = lerArgumentosPreparar(["interpolate", a, "q"]);
  assert.equal(i.passo === "interpolate" && i.fps, 72);
  const l = lerArgumentosPreparar(["loudness", a, "o.mp4", "--target", "-16"]);
  assert.deepEqual([l.passo === "loudness" && l.alvo, l.passo === "loudness" && l.pico], [-16, -1]);
});

test("arguments: usage errors say what to fix", () => {
  const a = arquivo("b.wav");
  uso(() => lerArgumentosPreparar([]), /usage: kodecz prepare/);
  uso(() => lerArgumentosPreparar(["--help"]), /usage: kodecz prepare/, 0);
  uso(() => lerArgumentosPreparar(["voice", "--help"]), /usage/, 0);
  uso(() => lerArgumentosPreparar(["voz", a, "o"]), /unknown step «voz»: use voice, words, interpolate, loudness/);
  uso(() => lerArgumentosPreparar(["voice", a]), /prepare voice takes <in> <out.wav>/);
  uso(() => lerArgumentosPreparar(["voice", join(pasta, "nada.wav"), "o"]), /file not found: .*nada\.wav/);
  uso(() => lerArgumentosPreparar(["voice", a, "o", "--speed", "3"]), /--speed must be between 0.5 and 2: 3/);
  uso(() => lerArgumentosPreparar(["voice", a, "o", "--fps", "3"]), /Unknown option '--fps'/);
  uso(() => lerArgumentosPreparar(["loudness", a, "o", "--target", "0"]), /--target must be a loudness in LUFS/);
  uso(() => lerArgumentosPreparar(["interpolate", a, "o", "--fps", "x"]), /--fps must be/);
});

test("voice filter: edges trimmed, pauses cut to the maximum, then atempo", () => {
  assert.equal(filtroVoz({ velocidade: 1.1, pausa: 0.35, limiar: -40, bordas: false }),
    "silenceremove=start_periods=1:start_threshold=-40dB,areverse,silenceremove=start_periods=1:start_threshold=-40dB,areverse,"
    + "silenceremove=stop_periods=-1:stop_duration=0.35:stop_threshold=-40dB:stop_silence=0,atempo=1.1");
  assert.equal(filtroVoz({ velocidade: 1.1, pausa: 0, limiar: -40, bordas: true }), "atempo=1.1");
  assert.equal(filtroVoz({ velocidade: 1, pausa: 0, limiar: -40, bordas: true }), "anull");
});

test("python: KODECZ_PYTHON or python3, and the install hint when faster-whisper is missing", () => {
  assert.equal(acharPython({}, () => true), "python3");
  assert.equal(acharPython({ KODECZ_PYTHON: "/opt/py/bin/python" }, (p) => p === "/opt/py/bin/python"), "/opt/py/bin/python");
  assert.throws(() => acharPython({}, () => false),
    (e: unknown) => e instanceof ErroPreparo && /faster-whisper not found for python3.*pip install faster-whisper.*KODECZ_PYTHON/.test(e.message));
});

test("rife: --rife, KODECZ_RIFE (binary or folder) or the PATH; the model next to the binary", () => {
  const ha = new Set(["/r/rife-ncnn-vulkan", "/r/rife-v4.6/flownet.param", "/bin2/rife-ncnn-vulkan", "/m/flownet.param"]);
  const existe = (f: string) => ha.has(f);
  assert.deepEqual(acharRife("/r", undefined, {}, existe), { binario: "/r/rife-ncnn-vulkan", modelo: "/r/rife-v4.6" });
  assert.deepEqual(acharRife(undefined, undefined, { KODECZ_RIFE: "/r/rife-ncnn-vulkan" }, existe), { binario: "/r/rife-ncnn-vulkan", modelo: "/r/rife-v4.6" });
  assert.deepEqual(acharRife(undefined, "/m", { PATH: "/usr/bin:/bin2" }, existe), { binario: "/bin2/rife-ncnn-vulkan", modelo: "/m" });
  const erro = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: unknown) => e instanceof ErroPreparo && re.test(e.message));
  erro(() => acharRife(undefined, undefined, { PATH: "/usr/bin" }, existe), /rife-ncnn-vulkan not found .*releases/);
  erro(() => acharRife("/x", undefined, {}, existe), /RIFE not found at \/x \(--rife\)/);
  erro(() => acharRife(undefined, undefined, { PATH: "/bin2" }, existe), /RIFE model not found: \/bin2\/rife-v4.6/);
});

test("frame rates and frame counts", () => {
  assert.equal(lerFps("24/1"), 24);
  assert.ok(Math.abs(lerFps("24000/1001") - 23.976) < 0.001);
  assert.equal(lerFps("30"), 30);
  assert.throws(() => lerFps("0/0"), ErroPreparo);
  assert.equal(quadrosAlvo(192, 24, 72), 576);
  assert.equal(quadrosAlvo(100, 30, 60), 200);
});

test("ffmpeg measurements: ebur128 summary and loudnorm JSON", () => {
  const ebur = "[Parsed_ebur128_0] t: 1.0 ...\n[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -23.4 LUFS\n"
    + "    Threshold: -33.5 LUFS\n\n  True peak:\n    Peak:       -5.2 dBFS\n";
  assert.deepEqual(lerEbur128(ebur), { lufs: -23.4, pico: -5.2 });
  assert.throws(() => lerEbur128("nothing"), ErroPreparo);
  const ln = 'size=...\n[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "-23.40",\n\t"input_tp" : "-5.20",\n\t"input_lra" : "1.0",\n'
    + '\t"input_thresh" : "-33.5",\n\t"target_offset" : "0.1",\n\t"normalization_type" : "linear"\n}\n';
  const m = lerLoudnorm(ln);
  assert.equal(m.input_i, "-23.40");
  assert.equal(filtroLoudnorm(-14, -1), "loudnorm=I=-14:TP=-1:LRA=11:print_format=json");
  assert.equal(filtroLoudnorm(-14, -1, m), "loudnorm=I=-14:TP=-1:LRA=11:print_format=json:measured_I=-23.40:measured_TP=-5.20"
    + ":measured_LRA=1.0:measured_thresh=-33.5:offset=0.1:linear=true");
});

test("prepare voice: a synthetic voice with a long pause comes out shorter, 48 kHz PCM", () => {
  // 1 s tone, 1.5 s silence, 1 s tone, 0.5 s silence: 4 s. Edges trimmed, the pause cut to 0.35 s (± one 20 ms
  // window), then 1.1×: (1 + 0.35 + 1) / 1.1 ≈ 2.14 s.
  const ent = join(pasta, "voz.wav");
  ffmpeg("-f", "lavfi", "-i", "sine=f=220:d=1", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=1.5", "-f", "lavfi", "-i", "sine=f=330:d=1",
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=0.5", "-filter_complex", "[0][1][2][3]concat=n=4:v=0:a=1", ent);
  const sai = join(pasta, "voz-1.1x.wav");
  const r = kodecz("prepare", "voice", ent, sai);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true);
  assert.ok(Math.abs(j.duracao.antes - 4) < 0.05, `before ${j.duracao.antes}`);
  assert.ok(Math.abs(j.duracao.depois - 2.35 / 1.1) < 0.1, `after ${j.duracao.depois}`);
  const s = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,sample_rate", "-of", "csv=p=0", sai], { encoding: "utf8" });
  assert.equal(s.stdout.trim(), "pcm_s16le,48000");
});

test("prepare loudness: a quiet tone reaches −14 LUFS; the video is copied, not re-encoded", () => {
  const ent = join(pasta, "baixo.mp4");
  ffmpeg("-f", "lavfi", "-i", "testsrc=size=160x90:rate=30:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4,volume=-30dB",
    "-c:v", "mpeg4", "-q:v", "5", "-c:a", "aac", "-shortest", ent);
  const sai = join(pasta, "nivelado.mp4");
  const r = kodecz("prepare", "loudness", ent, sai);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.ok(j.antes.lufs < -30, `before ${j.antes.lufs}`);
  assert.ok(Math.abs(j.depois.lufs - -14) < 1, `after ${j.depois.lufs}`);
  assert.ok(j.depois.pico <= -0.5, `peak ${j.depois.pico}`);
  const v = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=codec_name", "-of", "csv=p=0", sai], { encoding: "utf8" });
  assert.equal(v.stdout.trim(), "mpeg4", "video stream copied");
  assert.ok(Math.abs(duracao(sai) - 4) < 0.1);
});

test("errors: prefixed on stderr, JSON only on success, exit codes", () => {
  const sem = join(pasta, "mudo.mp4");
  ffmpeg("-f", "lavfi", "-i", "testsrc=size=64x64:rate=10:d=1", "-c:v", "mpeg4", sem);
  const r = kodecz("prepare", "loudness", sem, join(pasta, "x.mp4"));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^error: .*has no audio/m);
  assert.equal(r.stdout, "");
  const u = kodecz("prepare", "voice");
  assert.equal(u.status, 2);
  assert.match(u.stderr, /^error: prepare voice takes/);
  // words without the recognizer: the install hint, before any work.
  const a = arquivo("w.wav"), t = arquivo("w.txt", "olá");
  const w = spawnSync(process.execPath, [KODECZ, "prepare", "words", a, t, join(pasta, "w.json")],
    { encoding: "utf8", env: { ...process.env, KODECZ_PYTHON: join(pasta, "sem-python") } });
  assert.equal(w.status, 1);
  assert.match(w.stderr, /^error: faster-whisper not found for KODECZ_PYTHON=.*pip install faster-whisper/m);
  // interpolate into a folder that is not empty: refused.
  mkdirSync(join(pasta, "cheia"));
  writeFileSync(join(pasta, "cheia", "0001.jpg"), "");
  const i = spawnSync(process.execPath, [KODECZ, "prepare", "interpolate", sem, join(pasta, "cheia"), "--rife", pasta, "--model", pasta],
    { encoding: "utf8" });
  assert.equal(i.status, 1);
  assert.match(i.stderr, /^error: RIFE not found at .*\(--rife\)/m);
});
