// Kodecz Bench (P12): leitura do MP4 renderizado, para os oráculos que olham o pixel ou o som (clarão, tela parada,
// contraste, cores da identidade, voz). Só ffmpeg e contas simples; nada de modelo.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const LARGURA_PEQUENA = 320;

function ffmpegBruto(args: string[]): Buffer {
  const r = spawnSync("ffmpeg", ["-v", "error", ...args, "-"], { maxBuffer: 2 ** 31 });
  if (r.status !== 0) throw new Error(`ffmpeg falhou: ${r.stderr.toString()}`);
  return r.stdout;
}

export function dimensoes(mp4: string): { largura: number; altura: number; quadros: number } {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=width,height,nb_read_packets",
    "-of", "csv=p=0", mp4], { encoding: "utf8" });
  const [largura, altura, quadros] = r.stdout.trim().split(",").map(Number);
  return { largura, altura, quadros };
}

/**
 * Por quadro, com o vídeo reduzido a 320 px de largura: luma média (0–255), fração de pixels quase brancos (Y > 235),
 * diferença média para o quadro anterior e quantos pixels mudaram 12 níveis ou mais (o ruído do codificador no quadro-chave fica abaixo disso).
 */
export function lumas(mp4: string): { media: number; branco: number; dif: number; mudados: number }[] {
  const { largura, altura } = dimensoes(mp4);
  const h = Math.round((altura * LARGURA_PEQUENA) / largura / 2) * 2;
  const b = ffmpegBruto(["-i", mp4, "-vf", `scale=${LARGURA_PEQUENA}:${h}:flags=area,format=gray`, "-f", "rawvideo"]);
  const t = LARGURA_PEQUENA * h, r: { media: number; branco: number; dif: number; mudados: number }[] = [];
  for (let q = 0; (q + 1) * t <= b.length; q++) {
    let soma = 0, brancos = 0, dif = 0, mudados = 0;
    for (let i = 0; i < t; i++) {
      const v = b[q * t + i];
      soma += v;
      if (v > 235) brancos++;
      if (q > 0) { const x = Math.abs(v - b[(q - 1) * t + i]); dif += x; if (x >= 12) mudados++; }
    }
    r.push({ media: soma / t, branco: brancos / t, dif: q > 0 ? dif / t : 0, mudados });
  }
  return r;
}

/** Quadros escolhidos em RGB, no tamanho do vídeo. */
export function quadrosRgb(mp4: string, ns: number[]): Map<number, Buffer> {
  const { largura, altura } = dimensoes(mp4);
  const lista = [...new Set(ns)].sort((a, b) => a - b);
  const sel = lista.map((n) => `eq(n\\,${n})`).join("+");
  const b = ffmpegBruto(["-i", mp4, "-vf", `select='${sel}',format=rgb24`, "-fps_mode", "passthrough", "-f", "rawvideo"]);
  const t = largura * altura * 3, m = new Map<number, Buffer>();
  lista.forEach((n, i) => { if ((i + 1) * t <= b.length) m.set(n, b.subarray(i * t, (i + 1) * t)); });
  return m;
}

/** Áudio do MP4 em mono, 16 kHz, float. Vazio se não houver áudio. */
export function audio(mp4: string, taxa = 16000): Float32Array {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", mp4, "-vn", "-ac", "1", "-ar", String(taxa), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  if (r.status !== 0 || !r.stdout.length) return new Float32Array(0);
  const b = r.stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
}

/** Força do tom `freq` em janelas de `janela` s (Goertzel, normalizada pela janela): ~ (amplitude / 2)². */
export function tom(amostras: Float32Array, freq: number, taxa = 16000, janela = 0.01): number[] {
  const n = Math.round(taxa * janela), k = 2 * Math.cos((2 * Math.PI * freq) / taxa), r: number[] = [];
  for (let i = 0; i + n <= amostras.length; i += n) {
    let s1 = 0, s2 = 0;
    for (let j = 0; j < n; j++) { const s0 = amostras[i + j] + k * s1 - s2; s2 = s1; s1 = s0; }
    r.push((s1 * s1 + s2 * s2 - k * s1 * s2) / (n * n));
  }
  return r;
}

/** RMS em janelas de `janela` s. */
export function rms(amostras: Float32Array, taxa = 16000, janela = 0.01): number[] {
  const n = Math.round(taxa * janela), r: number[] = [];
  for (let i = 0; i + n <= amostras.length; i += n) {
    let s = 0;
    for (let j = 0; j < n; j++) s += amostras[i + j] ** 2;
    r.push(Math.sqrt(s / n));
  }
  return r;
}

/** O MP4 saiu do x264 (o modo só CPU do motor) e não do NVENC: o x264 deixa a assinatura dele num SEI. */
export const saiuDoX264 = (mp4: string) => readFileSync(mp4).includes("x264 - core");

/** Luminância relativa (WCAG) de um pixel sRGB. */
export function luminancia(r: number, g: number, b: number): number {
  const c = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
