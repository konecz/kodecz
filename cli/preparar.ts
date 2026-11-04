// `kodecz prepare voice|words|interpolate|loudness` (docs/formatos/preparo.md): the steps before and after a render
// that every video repeats, each one a command that prints one JSON line with its result on stdout.
//   voice        faster speech without changing the pitch, long pauses shortened (ffmpeg atempo, silenceremove)
//   words        word timings from faster-whisper on CUDA, aligned to the script (cli/alinhar.ts): the speech file
//   interpolate  in-between frames from RIFE (rife-ncnn-vulkan) on the NVIDIA GPU, as a numbered JPEG sequence
//   loudness     the audio to an integrated loudness target (loudnorm, two passes), the video copied as is
// The external programs are the user's: ffmpeg on the PATH, the Python with faster-whisper (KODECZ_PYTHON) and the
// RIFE binary (KODECZ_RIFE). Nothing of them is in this repository. A caller that shares the GPU holds the GPU lock
// around the command, as with the render.
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { alinhar, fimDaVoz, palavrasDoRoteiro } from "./alinhar.ts";
import { ErroDeUso, ICD_VULKAN_NVIDIA } from "./regras.ts";

export const USO = `usage: kodecz prepare <step> [arguments] [options]

  voice <in> <out.wav> [--speed 1.1] [--max-pause 0.35] [--threshold -40] [--keep-edges]
      faster speech without changing the pitch (atempo); silence trimmed at both ends and every pause longer than
      --max-pause seconds shortened to it (0: pauses kept). Output: PCM WAV, 48 kHz.
  words <audio> <script.txt> <out.json> [--language pt] [--model <name|dir>] [--cpu]
      word timings: faster-whisper large-v3-turbo on CUDA (float16), aligned to the script. The text is the
      script's (accents, punctuation); the recognizer only gives the times. The audio is cut at the end of the voice
      + 0.2 s. Without CUDA it fails (exit 3) unless --cpu. Python: KODECZ_PYTHON, or python3 with faster-whisper.
  interpolate <video> <out-dir> [--fps 72] [--rife <binary|dir>] [--model <dir>]
      in-between frames by RIFE (rife-ncnn-vulkan) on the NVIDIA GPU: <out-dir>/0001.jpg… at --fps.
      RIFE: --rife, KODECZ_RIFE or rife-ncnn-vulkan on the PATH; the model defaults to rife-v4.6 next to it.
  loudness <in.mp4> <out.mp4> [--target -14] [--true-peak -1]
      the audio to the integrated loudness target (LUFS) with loudnorm in two passes, true peak capped; the video
      stream copied without re-encoding.

  -h, --help   this help

Each step prints one JSON line with its result on stdout; errors go to stderr as «error: …». Exit codes: 0 ok,
1 failure, 2 usage error, 3 GPU or CUDA not usable. Format and details: docs/formatos/preparo.md.`;

const CORTE_MARGEM = 0.2;
const MODELO_WHISPER = "mobiuslabsgmbh/faster-whisper-large-v3-turbo";
const INSTALAR_WHISPER = "install it with: python3 -m venv ~/.venvs/kodecz && ~/.venvs/kodecz/bin/pip install faster-whisper "
  + "nvidia-cublas-cu12 nvidia-cudnn-cu12, then export KODECZ_PYTHON=~/.venvs/kodecz/bin/python";
const INSTALAR_RIFE = "download rife-ncnn-vulkan (MIT) from https://github.com/nihui/rife-ncnn-vulkan/releases, unzip it "
  + "and pass --rife <folder>, or export KODECZ_RIFE=<folder>";

/** A failure while running a step: the message and the exit code (1, or 3 when the GPU or CUDA is not usable). */
export class ErroPreparo extends Error {
  codigo: number;
  constructor(mensagem: string, codigo = 1) { super(mensagem); this.codigo = codigo; }
}

export type Pedido =
  | { passo: "voice"; entrada: string; saida: string; velocidade: number; pausa: number; limiar: number; bordas: boolean }
  | { passo: "words"; audio: string; roteiro: string; saida: string; idioma?: string; modelo: string; cpu: boolean }
  | { passo: "interpolate"; video: string; pasta: string; fps: number; rife?: string; modelo?: string }
  | { passo: "loudness"; entrada: string; saida: string; alvo: number; pico: number };

const numero = (nome: string, valor: string | undefined, padrao: number, ok: (x: number) => boolean, faixa: string) => {
  if (valor === undefined) return padrao;
  const x = Number(valor);
  if (!Number.isFinite(x) || !ok(x)) throw new ErroDeUso(`${nome} must be ${faixa}: ${valor}`);
  return x;
};

/** Reads the arguments (without `node` and the script). Throws ErroDeUso with the fix. */
export function lerArgumentosPreparar(argv: string[]): Pedido {
  const [passo, ...brutos] = argv;
  // `--target -14`: parseArgs takes «-14» for an option; a negative number after an option is its value.
  const resto = brutos.flatMap((a, i) => /^-\d/.test(brutos[i + 1] ?? "") && /^--[a-z-]+$/.test(a) ? [] :
    /^-\d/.test(a) && /^--[a-z-]+$/.test(brutos[i - 1] ?? "") ? [`${brutos[i - 1]}=${a}`] : [a]);
  if (passo === undefined) throw new ErroDeUso(USO);
  if (passo === "-h" || passo === "--help" || passo === "help") throw new ErroDeUso(USO, 0);
  const opcoes = {
    voice: { speed: { type: "string" }, "max-pause": { type: "string" }, threshold: { type: "string" }, "keep-edges": { type: "boolean" } },
    words: { language: { type: "string" }, model: { type: "string" }, cpu: { type: "boolean" } },
    interpolate: { fps: { type: "string" }, rife: { type: "string" }, model: { type: "string" } },
    loudness: { target: { type: "string" }, "true-peak": { type: "string" } },
  } as const;
  if (!Object.hasOwn(opcoes, passo)) throw new ErroDeUso(`unknown step «${passo}»: use voice, words, interpolate, loudness\n\n${USO}`);
  const p = passo as keyof typeof opcoes;
  let lido;
  try {
    lido = parseArgs({ args: resto, allowPositionals: true, strict: true,
      options: { ...opcoes[p], help: { type: "boolean", short: "h" } } as Record<string, { type: "string" | "boolean"; short?: string }> });
  } catch (e) { throw new ErroDeUso(`${(e as Error).message}\n\n${USO}`); }
  const o = lido.values as Record<string, string | boolean | undefined>;
  const s = (k: string) => o[k] as string | undefined;
  if (o.help) throw new ErroDeUso(USO, 0);
  const pos = lido.positionals;
  const quer = { voice: 2, words: 3, interpolate: 2, loudness: 2 }[p];
  if (pos.length !== quer) {
    const nomes = { voice: "<in> <out.wav>", words: "<audio> <script.txt> <out.json>", interpolate: "<video> <out-dir>", loudness: "<in.mp4> <out.mp4>" }[p];
    throw new ErroDeUso(`prepare ${p} takes ${nomes}\n\n${USO}`);
  }
  const existe = (f: string) => { if (!existsSync(f) || !statSync(f).isFile()) throw new ErroDeUso(`file not found: ${f}`); return resolve(f); };
  switch (p) {
    case "voice":
      return { passo: p, entrada: existe(pos[0]), saida: resolve(pos[1]),
        velocidade: numero("--speed", s("speed"), 1.1, (x) => x >= 0.5 && x <= 2, "between 0.5 and 2"),
        pausa: numero("--max-pause", s("max-pause"), 0.35, (x) => x >= 0 && x <= 10, "between 0 and 10 seconds"),
        limiar: numero("--threshold", s("threshold"), -40, (x) => x < 0 && x >= -90, "a level in dB between -90 and 0"),
        bordas: o["keep-edges"] === true };
    case "words":
      return { passo: p, audio: existe(pos[0]), roteiro: existe(pos[1]), saida: resolve(pos[2]), idioma: s("language"),
        modelo: s("model") ?? MODELO_WHISPER, cpu: o.cpu === true };
    case "interpolate":
      return { passo: p, video: existe(pos[0]), pasta: resolve(pos[1]),
        fps: numero("--fps", s("fps"), 72, (x) => x > 0 && x <= 1000, "a frame rate above 0"),
        rife: s("rife"), modelo: s("model") };
    case "loudness":
      return { passo: p, entrada: existe(pos[0]), saida: resolve(pos[1]),
        alvo: numero("--target", s("target"), -14, (x) => x >= -70 && x <= -5, "a loudness in LUFS between -70 and -5"),
        pico: numero("--true-peak", s("true-peak"), -1, (x) => x >= -9 && x <= 0, "a level in dBTP between -9 and 0") };
  }
}

/**
 * The ffmpeg audio filter of `prepare voice`: silence trimmed at the start and at the end (unless the edges are kept),
 * every pause longer than `pausa` cut down to it, then atempo (tempo without pitch change).
 */
export function filtroVoz(p: { velocidade: number; pausa: number; limiar: number; bordas: boolean }): string {
  const db = `${p.limiar}dB`;
  const f: string[] = [];
  if (!p.bordas) {
    const inicio = `silenceremove=start_periods=1:start_threshold=${db}`;
    f.push(inicio, "areverse", inicio, "areverse");
  }
  // ffmpeg 6.1+ keeps stop_duration + stop_silence of each long pause: stop_silence=0 keeps `pausa` (± one 20 ms window).
  if (p.pausa > 0) f.push(`silenceremove=stop_periods=-1:stop_duration=${p.pausa}:stop_threshold=${db}:stop_silence=0`);
  if (p.velocidade !== 1) f.push(`atempo=${p.velocidade}`);
  return f.length ? f.join(",") : "anull";
}

/** The Python with faster-whisper: KODECZ_PYTHON, or python3. `temModulo` runs the import (injectable for tests). */
export function acharPython(env: NodeJS.ProcessEnv, temModulo: (python: string) => boolean): string {
  const python = env.KODECZ_PYTHON || "python3";
  if (!temModulo(python)) {
    const qual = env.KODECZ_PYTHON ? `KODECZ_PYTHON=${env.KODECZ_PYTHON}` : "python3 (set KODECZ_PYTHON to use another Python)";
    throw new ErroPreparo(`faster-whisper not found for ${qual}: ${INSTALAR_WHISPER}`);
  }
  return python;
}

/**
 * The RIFE binary and model: --rife, KODECZ_RIFE or rife-ncnn-vulkan on the PATH (a binary, or the folder that holds
 * it); the model is --model or rife-v4.6 next to the binary (a v4 model: any frame count).
 */
export function acharRife(opcao: string | undefined, modelo: string | undefined, env: NodeJS.ProcessEnv,
  existe: (f: string) => boolean = (f) => existsSync(f) && statSync(f).isFile()): { binario: string; modelo: string } {
  const BIN = "rife-ncnn-vulkan";
  const deCaminho = (c: string) => existe(join(c, BIN)) ? join(c, BIN) : c;
  let binario: string | undefined;
  const pedido = opcao ?? env.KODECZ_RIFE;
  if (pedido) {
    binario = deCaminho(resolve(pedido));
    if (!existe(binario)) throw new ErroPreparo(`RIFE not found at ${binario} (${opcao ? "--rife" : "KODECZ_RIFE"}): ${INSTALAR_RIFE}`);
  } else {
    binario = (env.PATH ?? "").split(delimiter).filter(Boolean).map((d) => join(d, BIN)).find(existe);
    if (!binario) throw new ErroPreparo(`${BIN} not found (no --rife, no KODECZ_RIFE, not on the PATH): ${INSTALAR_RIFE}`);
  }
  const m = modelo ? resolve(modelo) : join(dirname(binario), "rife-v4.6");
  if (!existe(join(m, "flownet.param"))) {
    throw new ErroPreparo(`RIFE model not found: ${m} (no flownet.param); pass --model <dir> with a rife-v4 model from the rife-ncnn-vulkan release`);
  }
  return { binario, modelo: m };
}

/** A frame rate from ffprobe («24000/1001», «30/1», «25»). */
export function lerFps(texto: string): number {
  const [a, b = "1"] = texto.trim().split("/");
  const fps = Number(a) / Number(b);
  if (!Number.isFinite(fps) || fps <= 0) throw new ErroPreparo(`unreadable frame rate: «${texto}»`);
  return fps;
}

/** How many frames RIFE makes from `n` frames at `de` fps to `para` fps (the same duration). */
export function quadrosAlvo(n: number, de: number, para: number): number {
  return Math.round(n * para / de);
}

/** The integrated loudness and true peak of the ebur128 summary (ffmpeg stderr with `ebur128=peak=true`). */
export function lerEbur128(texto: string): { lufs: number; pico: number } {
  const resumo = texto.slice(texto.lastIndexOf("Summary:"));
  const i = /I:\s+(-?[\d.]+|-inf) LUFS/.exec(resumo), pk = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(resumo);
  if (texto.lastIndexOf("Summary:") < 0 || !i) throw new ErroPreparo("ffmpeg ebur128 gave no summary");
  const n = (x: string) => x === "-inf" ? -Infinity : Number(x);
  return { lufs: n(i[1]), pico: pk ? n(pk[1]) : NaN };
}

/** The JSON that loudnorm prints at the end (print_format=json). */
export function lerLoudnorm(texto: string): Record<string, string> {
  const fim = texto.lastIndexOf("}"), ini = texto.lastIndexOf("{", fim);
  if (ini < 0 || fim < 0) throw new ErroPreparo("ffmpeg loudnorm gave no measurement");
  return JSON.parse(texto.slice(ini, fim + 1));
}

/** The loudnorm filter: the first pass measures; the second, with the measurement, applies (linear when it can). */
export function filtroLoudnorm(alvo: number, pico: number, medido?: Record<string, string>): string {
  const base = `loudnorm=I=${alvo}:TP=${pico}:LRA=11:print_format=json`;
  if (!medido) return base;
  return `${base}:measured_I=${medido.input_i}:measured_TP=${medido.input_tp}:measured_LRA=${medido.input_lra}`
    + `:measured_thresh=${medido.input_thresh}:offset=${medido.target_offset}:linear=true`;
}

// ---------------------------------------------------------------------------------------------------------------
// Running the steps.

function rodar(cmd: string, args: string[], extra: { env?: NodeJS.ProcessEnv } = {}): SpawnSyncReturns<string> {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: extra.env ?? process.env });
  if (r.error) {
    const e = r.error as NodeJS.ErrnoException;
    throw new ErroPreparo(e.code === "ENOENT" ? `${cmd} not found on the PATH` : `${cmd}: ${e.message}`);
  }
  return r;
}

function ffmpeg(args: string[]): string {
  const r = rodar("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args]);
  if (r.status !== 0) throw new ErroPreparo(`ffmpeg failed: ${r.stderr.trim().split("\n").slice(-4).join(" | ")}`);
  return r.stderr;
}

function duracao(arquivo: string): number {
  const r = rodar("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", arquivo]);
  const d = Number(r.stdout.trim());
  if (r.status !== 0 || !Number.isFinite(d)) throw new ErroPreparo(`ffprobe could not read ${arquivo}: ${r.stderr.trim()}`);
  return d;
}

const arred = (x: number, casas = 3) => Number(x.toFixed(casas));

function medirVolume(arquivo: string): { lufs: number; pico: number } {
  const m = lerEbur128(ffmpeg(["-nostats", "-i", arquivo, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]));
  return { lufs: arred(m.lufs, 2), pico: arred(m.pico, 2) };
}

function prepararVoz(p: Extract<Pedido, { passo: "voice" }>) {
  mkdirSync(dirname(p.saida), { recursive: true });
  const antes = duracao(p.entrada);
  ffmpeg(["-v", "error", "-i", p.entrada, "-vn", "-af", filtroVoz(p), "-c:a", "pcm_s16le", "-ar", "48000", p.saida]);
  const depois = duracao(p.saida);
  return { ok: true, passo: "voice", saida: p.saida, velocidade: p.velocidade, pausaMaxima: p.pausa,
    duracao: { antes: arred(antes), depois: arred(depois) } };
}

function prepararPalavras(p: Extract<Pedido, { passo: "words" }>, tmp: string) {
  const roteiro = palavrasDoRoteiro(readFileSync(p.roteiro, "utf8"));
  if (!roteiro.length) throw new ErroPreparo(`${p.roteiro}: the script has no words`);
  const python = acharPython(process.env, (py) => {
    const r = spawnSync(py, ["-I", "-c", "import faster_whisper, numpy"], { stdio: "ignore" });
    return !r.error && r.status === 0;
  });
  const bruto = join(tmp, "audio.f32");
  ffmpeg(["-v", "error", "-i", p.audio, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", bruto]);
  const b = readFileSync(bruto);
  const amostras = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
  const duracaoAudio = amostras.length / 16000;
  const fimVoz = fimDaVoz(amostras, 16000);
  // The recognizer only hears up to the end of the voice + 0.2 s: in the silence after it, it makes words up.
  const corte = Math.min(duracaoAudio, arred(fimVoz + CORTE_MARGEM));
  const cortado = join(tmp, "cortado.f32");
  writeFileSync(cortado, amostras.subarray(0, Math.round(corte * 16000)));
  const script = new URL("./whisper-palavras.py", import.meta.url).pathname;
  const args = ["-I", script, "--audio", cortado, "--model", p.modelo, ...(p.idioma ? ["--language", p.idioma] : []), ...(p.cpu ? ["--cpu"] : [])];
  const r = rodar(python, args);
  if (r.status !== 0) {
    const msg = r.stderr.trim().split("\n").slice(-3).join(" | ");
    throw new ErroPreparo(`faster-whisper failed: ${msg}`, r.status === 3 ? 3 : 1);
  }
  const reconhecido = JSON.parse(r.stdout) as { palavras: { texto: string; inicio: number; fim: number }[]; idioma: string; dispositivo: string };
  const a = alinhar(roteiro, reconhecido.palavras, corte);
  mkdirSync(dirname(p.saida), { recursive: true });
  // One word per line: easy to read and to diff.
  writeFileSync(p.saida, `{ "palavras": [\n${a.palavras.map((w) => `  ${JSON.stringify(w)}`).join(",\n")}\n] }\n`);
  for (const t of a.trocas) process.stderr.write(`kodecz: script «${t.roteiro}» ← heard «${t.falado}»\n`);
  if (a.semPar.length) process.stderr.write(`warning: not heard, placed between their neighbours: ${a.semPar.join(" ")}\n`);
  if (a.semelhanca < 0.8) process.stderr.write(`warning: the audio matches the script poorly (${a.semelhanca}); is it the right script?\n`);
  return { ok: true, passo: "words", saida: p.saida, palavras: a.palavras.length, reconhecidas: reconhecido.palavras.length,
    iguais: a.iguais, trocas: a.trocas.length, semPar: a.semPar.length, extras: a.extras.length, semelhanca: a.semelhanca,
    duracao: arred(duracaoAudio), fimVoz, corte, idioma: reconhecido.idioma, dispositivo: reconhecido.dispositivo, modelo: p.modelo };
}

function interpolar(p: Extract<Pedido, { passo: "interpolate" }>, tmp: string) {
  const rife = acharRife(p.rife, p.modelo, process.env);
  if (existsSync(p.pasta) && readdirSync(p.pasta).length) throw new ErroPreparo(`${p.pasta} is not empty: pass a new or empty folder`);
  const sonda = rodar("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate,r_frame_rate", "-of", "csv=p=0", p.video]);
  if (sonda.status !== 0 || !sonda.stdout.trim()) throw new ErroPreparo(`ffprobe found no video in ${p.video}`);
  const [media, base] = sonda.stdout.trim().split("\n")[0].split(",");
  const fpsEntrada = lerFps(media && media !== "0/0" ? media : base);
  if (p.fps <= fpsEntrada) throw new ErroPreparo(`--fps ${p.fps} must be above the video's ${arred(fpsEntrada)} fps`);
  const ent = join(tmp, "ent"), sai = join(tmp, "sai");
  mkdirSync(ent); mkdirSync(sai);
  // JPEG in and out of RIFE: with PNG, writing and reading the frames made the CPU the bottleneck.
  // Decoded by NVDEC when it can; ffmpeg falls back to the CPU for what NVDEC does not read (H.264 4:4:4).
  const extrair = (hw: string[]) => ffmpeg(["-v", "error", ...hw, "-i", p.video, "-an", "-q:v", "2", join(ent, "%08d.jpg")]);
  try { extrair(["-hwaccel", "cuda"]); } catch { rmSync(ent, { recursive: true, force: true }); mkdirSync(ent); extrair([]); }
  const n = readdirSync(ent).length;
  if (!n) throw new ErroPreparo(`no frames decoded from ${p.video}`);
  const quer = quadrosAlvo(n, fpsEntrada, p.fps);
  // Only the NVIDIA GPU visible to Vulkan: otherwise RIFE may pick an integrated GPU.
  const icd = ICD_VULKAN_NVIDIA.find((f) => existsSync(f));
  if (!icd) process.stderr.write("warning: no NVIDIA Vulkan ICD found (nvidia_icd.json); RIFE picks the Vulkan device itself\n");
  const env = icd ? { ...process.env, VK_DRIVER_FILES: icd, VK_ICD_FILENAMES: icd } : process.env;
  const t0 = performance.now();
  const r = rodar(rife.binario, ["-g", "0", "-m", rife.modelo, "-i", ent, "-o", sai, "-n", String(quer), "-f", "%08d.jpg"], { env });
  const segundos = arred((performance.now() - t0) / 1000, 2);
  const feitos = readdirSync(sai).length;
  if (r.status !== 0 || feitos !== quer) {
    const log = (r.stderr || "").trim().split("\n").slice(-4).join(" | ");
    throw new ErroPreparo(`RIFE made ${feitos} of ${quer} frames (exit ${r.status}): ${log}`, /vulkan|gpu/i.test(log) && feitos === 0 ? 3 : 1);
  }
  // RIFE's JPEGs come out larger: one more ffmpeg pass at -q:v 2, which also numbers them %04d.jpg.
  mkdirSync(p.pasta, { recursive: true });
  ffmpeg(["-v", "error", "-i", join(sai, "%08d.jpg"), "-q:v", "2", join(p.pasta, "%04d.jpg")]);
  const saida = readdirSync(p.pasta).filter((f) => f.endsWith(".jpg")).length;
  if (saida !== quer) throw new ErroPreparo(`wrote ${saida} of ${quer} frames to ${p.pasta}`);
  // RIFE names the Vulkan device it ran on («[0 NVIDIA GeForce …]»): reported, and a warning when it is not NVIDIA.
  const placa = /^\[0 ([^\]]+)\]/m.exec(r.stderr || "")?.[1] ?? null;
  if (placa && !/nvidia/i.test(placa)) process.stderr.write(`warning: RIFE ran on «${placa}», not on an NVIDIA GPU\n`);
  return { ok: true, passo: "interpolate", pasta: p.pasta, padrao: "%04d.jpg", entrada: { quadros: n, fps: arred(fpsEntrada) },
    saida: { quadros: saida, fps: p.fps }, rife: { modelo: rife.modelo, placa, segundos } };
}

function nivelar(p: Extract<Pedido, { passo: "loudness" }>) {
  const audio = rodar("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", p.entrada]);
  if (!audio.stdout.trim()) throw new ErroPreparo(`${p.entrada} has no audio`);
  const antes = medirVolume(p.entrada);
  const medido = lerLoudnorm(ffmpeg(["-nostats", "-i", p.entrada, "-vn", "-af", filtroLoudnorm(p.alvo, p.pico), "-f", "null", "-"]));
  mkdirSync(dirname(p.saida), { recursive: true });
  const aplicado = lerLoudnorm(ffmpeg(["-nostats", "-i", p.entrada, "-map", "0:v?", "-map", "0:a:0", "-c:v", "copy",
    "-af", filtroLoudnorm(p.alvo, p.pico, medido), "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", p.saida]));
  const depois = medirVolume(p.saida);
  // loudnorm falls back to dynamic mode when the linear gain would pass the true-peak cap.
  if (aplicado.normalization_type && aplicado.normalization_type !== "linear") {
    process.stderr.write(`warning: loudnorm used ${aplicado.normalization_type} mode (a linear gain would pass ${p.pico} dBTP)\n`);
  }
  return { ok: true, passo: "loudness", saida: p.saida, alvo: p.alvo, picoMaximo: p.pico, antes, depois,
    modo: aplicado.normalization_type ?? null };
}

async function principal() {
  let p: Pedido;
  try { p = lerArgumentosPreparar(process.argv.slice(2)); } catch (erro) {
    if (erro instanceof ErroDeUso) {
      (erro.codigo === 0 ? process.stdout : process.stderr).write(`${erro.codigo === 0 ? "" : "error: "}${erro.message}\n`);
      process.exit(erro.codigo);
    }
    throw erro;
  }
  const tmp = mkdtempSync(join(tmpdir(), "kodecz-preparo-"));
  const limpar = () => rmSync(tmp, { recursive: true, force: true });
  for (const s of ["SIGINT", "SIGTERM"] as const) process.once(s, () => { limpar(); process.exit(130); });
  const t0 = performance.now();
  try {
    const r = p.passo === "voice" ? prepararVoz(p) : p.passo === "words" ? prepararPalavras(p, tmp)
      : p.passo === "interpolate" ? interpolar(p, tmp) : nivelar(p);
    process.stdout.write(`${JSON.stringify({ ...r, parede: arred((performance.now() - t0) / 1000, 2) })}\n`);
  } catch (erro) {
    process.stderr.write(`error: ${(erro as Error).message}\n`);
    process.exitCode = erro instanceof ErroPreparo ? erro.codigo : 1;
  } finally {
    limpar();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await principal();
