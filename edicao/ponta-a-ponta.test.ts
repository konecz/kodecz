// End to end: a synthetic edit (R01: a tone as the "voice" with invented words, a testsrc video, a title, a fade, a
// count, three event sounds and the music) → `kodecz assemble` (with the blocks' DOM check) → `kodecz render --gpu`
// → the frames show what the edit says, and the music goes down under the voice (RMS in windows, the music alone
// through a low-pass: it is a 150 Hz tone, the voice a 1000 Hz one, the sounds 3000 Hz).
// Uses the GPU and the browser. Run: flock -s /tmp/motor-video-placa.lock node --test edicao/ponta-a-ponta.test.ts
// (under `./verificar.sh completo`, which holds the lock, it runs directly).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAMINHOS, sondarPlaca } from "../cli/regras.ts";
import { ambienteReal } from "../cli/render.ts";
import { BLOCOS } from "./montar.ts";

const KODECZ = new URL("../cli/kodecz.ts", import.meta.url).pathname;
const TRAVA = "/tmp/motor-video-placa.lock";
const falta = [CAMINHOS.hostCef].filter((p) => !existsSync(p));
const semRender = falta.length ? `missing ${falta.join(", ")} (captura/cef/montar.sh)` : false;
const placa = semRender ? null : sondarPlaca(ambienteReal());
const semPlaca = semRender || (placa && !placa.ok ? `no GPU: ${placa.motivo}` : false);

const tmp = mkdtempSync(join(tmpdir(), "kodecz-assemble-e2e-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const FPS = 30, L = 1920, A = 1080, DURACAO = 6;

const ffmpeg = (args: string[]) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8", maxBuffer: 256 << 20 });
  assert.equal(r.status, 0, r.stderr);
  return r;
};

// Two phrases: 0.5–2.0 s and 3.5–5.0 s; the pause between them is long (1.5 s), so the music comes back up.
const PALAVRAS = [
  { texto: "Primeira", inicio: 0.5, fim: 1.0 }, { texto: "frase,", inicio: 1.0, fim: 1.4 }, { texto: "curta.", inicio: 1.5, fim: 2.0 },
  { texto: "Segunda", inicio: 3.5, fim: 4.0 }, { texto: "frase", inicio: 4.0, fim: 4.4 }, { texto: "aqui.", inicio: 4.5, fim: 5.0 },
];

function preparar(): string {
  const p = join(tmp, "edicao");
  mkdirSync(join(p, "midia"), { recursive: true });
  writeFileSync(join(p, "falas.json"), JSON.stringify({ palavras: PALAVRAS }));
  const fala = "between(t\\,0.5\\,2.0)+between(t\\,3.5\\,5.0)";
  ffmpeg(["-f", "lavfi", "-i", `aevalsrc=0.3*sin(2*PI*1000*t)*(${fala}):s=48000:d=${DURACAO}`, join(p, "midia", "voz.wav")]);
  ffmpeg(["-f", "lavfi", "-i", `aevalsrc=0.5*sin(2*PI*150*t):s=48000:d=${DURACAO + 1}`, join(p, "midia", "trilha.wav")]);
  for (const s of ["pop", "whoosh", "ding"]) ffmpeg(["-f", "lavfi", "-i", "aevalsrc=0.5*sin(2*PI*3000*t):s=48000:d=0.3", join(p, "midia", `${s}.wav`)]);
  ffmpeg(["-f", "lavfi", "-i", `testsrc2=s=${L}x${A}:r=${FPS}:d=4`, "-pix_fmt", "yuv420p", "-c:v", "libx264", "-g", "30", join(p, "midia", "take.mp4")]);
  writeFileSync(join(p, "edicao.json"), JSON.stringify({
    composicao: { id: "EdicaoPontaAPonta", largura: L, altura: A, fps: FPS },
    marca: join(BLOCOS, "marca", "DESIGN.md"),
    falas: "falas.json",
    voz: "midia/voz.wav",
    itens: [
      { bloco: "cena", de: 0, ate: { palavra: "segunda" }, itens: [
        { bloco: "video", src: "midia/take.mp4", mudo: true },
        { bloco: "titulo-entrada", de: { palavra: "primeira" }, ate: { fimDaFrase: { palavra: "primeira" } }, titulo: "Edição como dados" },
      ] },
      { bloco: "cena", de: { palavra: "segunda" }, ate: DURACAO, transicao: { tipo: "fade", duracao: 15 }, itens: [
        { bloco: "contagem", de: { palavra: "segunda" }, ate: { palavra: "aqui" }, valor: 100, rotulo: "por cento" },
      ] },
    ],
    sons: [
      { src: "midia/pop.wav", em: { palavra: "primeira" }, volume: 0.5 },
      { src: "midia/whoosh.wav", em: { palavra: "segunda" }, antes: 0.4, volume: 0.5 },
      { src: "midia/ding.wav", em: { fimDaFrase: { palavra: "segunda" } }, fim: { segundo: 5.4 }, volume: 0.5 },
    ],
    trilha: { src: "midia/trilha.wav", volume: 0.5, abaixarSobVoz: 14, rampaSaida: 0.5 },
  }));
  return p;
}

/** One frame as RGB. */
const quadroBin = (mp4: string, n: number) => spawnSync("ffmpeg", ["-v", "error", "-i", mp4, "-vf", `select=eq(n\\,${n})`, "-frames:v", "1",
  "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 << 20 }).stdout;
const pixel = (q: Buffer, x: number, y: number) => { const i = (y * L + x) * 3; return [q[i], q[i + 1], q[i + 2]]; };
const perto = (a: number[], b: number[], t = 10) => a.every((v, i) => Math.abs(v - b[i]) <= t);

/** RMS of the audio, mono at 48 kHz after `filtro`, in [de, ate) seconds. */
function rms(mp4: string, filtro: string, de: number, ate: number): number {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", mp4, "-map", "0:a", "-af", filtro, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 256 << 20 });
  const s = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
  let soma = 0, n = 0;
  for (let k = Math.round(de * 48000); k < Math.min(s.length, Math.round(ate * 48000)); k++) { soma += s[k] ** 2; n++; }
  return Math.sqrt(soma / n);
}
const dB = (a: number, b: number) => 20 * Math.log10(a / b);

test("assemble → render --gpu: frames and the music ducked under the voice", { skip: semPlaca || false, timeout: 3_600_000 }, () => {
  const p = preparar(), saida = join(tmp, "composicao"), mp4 = join(tmp, "saida.mp4");
  const m = spawnSync(process.execPath, [KODECZ, "assemble", join(p, "edicao.json"), saida], { encoding: "utf8", timeout: 300_000 });
  assert.equal(m.status, 0, `${m.stderr}\n${m.stdout}`);
  const resumo = JSON.parse(m.stdout);
  assert.equal(resumo.quadros, 180);
  assert.equal(resumo.conferencia?.p0, 0, `the DOM check ran without P0: ${m.stdout}`);
  process.stderr.write(`assemble: ${m.stdout}`);

  const trava = process.env.MOTOR_TRAVA_PLACA_TOMADA === "1" ? [] : ["flock", "-s", TRAVA];
  const cmd = [...trava, process.execPath, KODECZ, "render", saida, "EdicaoPontaAPonta", mp4, "--gpu"];
  // No timeout of its own: the shared lock may be held for a while by an exclusive measurement.
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, r.stderr.slice(-3000));
  const j = JSON.parse(r.stdout.trim().split("\n").pop()!);
  process.stderr.write(`render: ${JSON.stringify({ ok: j.ok, quadros: j.quadros, parede: j.parede, modo: j.modo, midias: j.midias })}\n`);
  assert.equal(j.quadros, 180);

  // Frame 30: the testsrc2 video under the title (not the plain brand ground in the corner).
  const ground = [0x10, 0x18, 0x28];
  assert.ok(!perto(pixel(quadroBin(mp4, 30), 40, 1040), ground, 4), "the video is under the first scene");
  // Frame 160: the second scene (fade done at 105 + 15): brand ground at the corner, the count in the middle.
  const q160 = quadroBin(mp4, 160);
  assert.ok(perto(pixel(q160, 40, 1040), ground), `ground at frame 160: ${pixel(q160, 40, 1040)}`);
  let claros = 0;
  for (let y = 380; y < 700; y += 4) for (let x = 760; x < 1160; x += 4) if (pixel(q160, x, y).some((v, i) => Math.abs(v - ground[i]) > 60)) claros++;
  assert.ok(claros > 50, `the count is drawn at frame 160 (${claros} pixels off the ground)`);

  // Music alone (150 Hz) through a low-pass: down ~14 dB during the phrases, back up in the pause.
  const musica = "lowpass=f=300,lowpass=f=300,lowpass=f=300";
  const fala1 = rms(mp4, musica, 0.8, 1.8), pausa = rms(mp4, musica, 2.6, 3.2), fala2 = rms(mp4, musica, 3.8, 4.8);
  const antes = rms(mp4, musica, 0.05, 0.3);
  process.stderr.write(`music RMS: before ${antes.toFixed(4)}, phrase 1 ${fala1.toFixed(4)}, pause ${pausa.toFixed(4)}, phrase 2 ${fala2.toFixed(4)}; ` +
    `drop ${dB(pausa, fala1).toFixed(1)} dB and ${dB(pausa, fala2).toFixed(1)} dB\n`);
  assert.ok(Math.abs(dB(pausa, fala1) - 14) < 2.5, `phrase 1 is ${dB(pausa, fala1).toFixed(1)} dB under the pause`);
  assert.ok(Math.abs(dB(pausa, fala2) - 14) < 2.5, `phrase 2 is ${dB(pausa, fala2).toFixed(1)} dB under the pause`);
  assert.ok(Math.abs(dB(antes, pausa)) < 1.5, "before the speech and in the pause: the same level");
  // The voice (1000 Hz band) is there in the phrases and not in the pause.
  const voz = "bandpass=f=1000:width_type=h:w=200";
  assert.ok(dB(rms(mp4, voz, 0.8, 1.8), rms(mp4, voz, 2.6, 3.2)) > 20, "the voice is in the mix");
  // Event sounds (3000 Hz): the whoosh at 3.5 − 0.4 = 3.1 s; the ding from 5.15 s, cut at 5.4 s.
  const sons = "highpass=f=2500,highpass=f=2500";
  assert.ok(dB(rms(mp4, sons, 3.12, 3.35), rms(mp4, sons, 2.5, 3.0)) > 20, "the whoosh before the cut");
  assert.ok(dB(rms(mp4, sons, 5.18, 5.35), rms(mp4, sons, 5.5, 5.9)) > 20, "the ding, and nothing after its end");
});
