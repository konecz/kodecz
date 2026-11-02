// Compares a render with a reference, frame by frame: SSIM (All) of every frame in YUV 4:2:0 (ffmpeg's ssim filter),
// frames matched by number (timestamps rebuilt as N / fps, so a slightly off container rate never pairs N with N±1),
// plus frame count, duration, codec, audio and file size of both.
// Usage: node conferir.mjs <reference.mp4> <render.mp4>   → one JSON document on stdout.
import { execFileSync, spawnSync } from "node:child_process";
import { statSync } from "node:fs";

const [ref, alvo] = process.argv.slice(2);
if (!alvo) {
  console.error("usage: node conferir.mjs <reference.mp4> <render.mp4>");
  process.exit(2);
}

const probe = (f) => {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_packets", "-show_entries",
    "stream=codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,nb_read_packets:format=duration", "-of", "json", f]));
  const v = j.streams.find((s) => s.codec_type === "video"), a = j.streams.find((s) => s.codec_type === "audio");
  return { arquivo: f, bytes: statSync(f).size, codec: `${v.codec_name} ${v.profile ?? ""}`.trim(), pix: v.pix_fmt,
    tamanho: `${v.width}x${v.height}`, qps: v.r_frame_rate, quadros: Number(v.nb_read_packets),
    duracao: Number(j.format.duration), audio: a ? a.codec_name : null };
};

const a = probe(ref), b = probe(alvo);
const [num, den] = a.qps.split("/").map(Number);
const fps = num / (den || 1);
const r = spawnSync("ffmpeg", ["-v", "error", "-i", ref, "-i", alvo, "-lavfi",
  `[0:v]setpts=N/TB/${fps},format=yuv420p[a];[1:v]setpts=N/TB/${fps},format=yuv420p[b];[a][b]ssim=stats_file=-`,
  "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
if (r.status !== 0) throw new Error(`ssim: ${r.stderr}`);
const v = r.stdout.trim().split("\n").map((l) => Number(/All:([\d.]+)/.exec(l)?.[1])).filter((x) => !Number.isNaN(x));
const ord = v.map((s, n) => [s, n]).sort((x, y) => x[0] - y[0]);
console.log(JSON.stringify({
  referencia: a, render: b,
  ssim: { comparados: v.length, media: +(v.reduce((t, s) => t + s, 0) / v.length).toFixed(4), min: +ord[0][0].toFixed(4),
    abaixo099: v.filter((s) => s < 0.99).length, piores: ord.slice(0, 5).map(([s, n]) => ({ quadro: n, ssim: +s.toFixed(4) })) },
}, null, 1));
