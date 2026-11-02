// Prints the comparison table from a comparar.sh work folder: per case and side, the median CPU and wall time over
// the measured rounds (round 0 is the warm-up and is left out) with every round in parentheses, the peak memory, the
// size of the round-1 file and the SSIM against HyperFrames' and Remotion's round-1 renders (mean of the per-round
// means / lowest frame of any round).
// A side measured in more than one series (two runs of comparar.sh on the same work folder) shows all its rounds.
// Usage: node resumir.mjs <work folder> <case...>
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [w, ...casos] = process.argv.slice(2);
const mediana = (v) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const f = (x, c = 1) => x.toFixed(c);

for (const caso of casos) {
  const o = join(w, caso, "saidas");
  const linhas = readFileSync(join(o, "medidas.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const lados = {};
  for (const m of linhas) {
    const [, lado, n] = /^(.*)-(\d+)$/.exec(m.rotulo);
    if (n === "0") continue;
    (lados[lado] ??= []).push({ ...m, n: Number(n) });
  }
  const ssim = (ref, lado) => {
    const arq = readdirSync(o).filter((a) => a.startsWith(`ssim-${ref}-${lado}-`) && /-\d+\.json$/.test(a))
      .map((a) => JSON.parse(readFileSync(join(o, a), "utf8")).ssim);
    if (!arq.length) return "—";
    const media = arq.reduce((t, s) => t + s.media, 0) / arq.length;
    return `${f(media, 4)} / ${f(Math.min(...arq.map((s) => s.min)), 4)}`;
  };
  console.log(`\n### ${caso}\n`);
  console.log("| Side | CPU (s), median (rounds) | Wall (s), median (rounds) | Peak memory (GB) | Size (MB) | SSIM vs. HyperFrames | SSIM vs. Remotion |");
  console.log("|---|---|---|---|---|---|---|");
  for (const [lado, ms] of Object.entries(lados)) {
    ms.sort((a, b) => a.n - b.n);
    const mp4 = join(o, `${lado}-1.mp4`);
    const tam = existsSync(mp4) ? f(readFileSync(mp4).length / 1e6, 2) : "—";
    console.log(`| ${lado} | **${f(mediana(ms.map((m) => m.cpu)))}** (${ms.map((m) => f(m.cpu)).join(" / ")}) | ` +
      `**${f(mediana(ms.map((m) => m.parede)))}** (${ms.map((m) => f(m.parede)).join(" / ")}) | ` +
      `${f(Math.max(...ms.map((m) => m.memGB)), 2)} | ${tam} | ${ssim("hyperframes", lado)} | ${ssim("remotion", lado)} |`);
  }
  console.log(`\nLoad average before each render: ${linhas.filter((m) => !m.rotulo.endsWith("-0")).map((m) => m.carga.split(" ")[0]).join(", ")}`);
}
