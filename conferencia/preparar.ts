// Preparação da conferência (S04), com rede, uma vez por máquina: baixa para o cache (~/.cache/motor-video/) o modelo
// de rosto (YuNet, MIT) e o retrato de domínio público das composições de teste, confere o SHA-256 fixado de cada um e
// põe o retrato, reduzido a 720 px de largura, como rosto.jpg (e um vídeo de 3 s dele, rosto.mp4) em cada
// conferencia/fixtures/*/ (fora do Git: *.jpg e *.mp4).
//   node conferencia/preparar.ts
// O retrato: «Neil Armstrong pose.jpg», NASA, foto S69-31741 (Apollo 11), obra do governo dos EUA, domínio público
// (https://commons.wikimedia.org/wiki/File:Neil_Armstrong_pose.jpg). Só para teste (R01: nada de cliente).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CACHE, MODELO, sha256 } from "./rosto.ts";

export const RETRATO = {
  original: join(CACHE, "teste", "Neil_Armstrong_pose.jpg"),
  reduzido: join(CACHE, "teste", "retrato-720.jpg"),
  video: join(CACHE, "teste", "retrato-720.mp4"),
  url: "https://upload.wikimedia.org/wikipedia/commons/0/0d/Neil_Armstrong_pose.jpg",
  sha256: "2acf38e1ed3f9502daedb95cecdd4f69f1626f62241e4ce42a2ba3979b93dee0",
  origem: "NASA, foto S69-31741 (Apollo 11), via Wikimedia Commons; domínio público (obra do governo dos EUA)",
};
const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;

async function baixar(url: string, arquivo: string, esperado: string) {
  if (existsSync(arquivo) && sha256(arquivo) === esperado) return false;
  mkdirSync(dirname(arquivo), { recursive: true });
  const r = await fetch(url, { headers: { "user-agent": "motor-video-conferencia/1.0" } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const parcial = `${arquivo}.parcial`;
  writeFileSync(parcial, Buffer.from(await r.arrayBuffer()));
  const h = sha256(parcial);
  if (h !== esperado) { rmSync(parcial); throw new Error(`${url}: SHA-256 ${h}, esperado ${esperado}`); }
  renameSync(parcial, arquivo);
  return true;
}

const ffmpeg = (args: string[], nome: string) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg (${nome}): ${r.stderr}`);
};

/**
 * Põe o retrato reduzido como rosto.jpg nas composições de teste, e um vídeo de 3 s feito dele, rosto.mp4 (H.264,
 * 30 qps, um recorte que anda devagar: o rosto se move dentro do take), para o apresentador em <video>.
 */
export function retratoNasFixtures() {
  if (!existsSync(RETRATO.reduzido)) ffmpeg(["-i", RETRATO.original, "-vf", "scale=720:-2", "-q:v", "3", RETRATO.reduzido], "retrato");
  if (!existsSync(RETRATO.video)) {
    ffmpeg(["-loop", "1", "-i", RETRATO.reduzido, "-t", "3", "-r", "30", "-vf", "crop=640:800:x='40*t':y='20*t',scale=720:900,format=yuv420p",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-g", "30", RETRATO.video], "vídeo do retrato");
  }
  for (const d of readdirSync(FIXTURES, { withFileTypes: true })) {
    if (!d.isDirectory() || !existsSync(join(FIXTURES, d.name, "index.html"))) continue;
    copyFileSync(RETRATO.reduzido, join(FIXTURES, d.name, "rosto.jpg"));
    copyFileSync(RETRATO.video, join(FIXTURES, d.name, "rosto.mp4"));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const modelo = await baixar(MODELO.url, MODELO.arquivo, MODELO.sha256);
  process.stderr.write(`modelo ${modelo ? "baixado" : "já no cache"}: ${MODELO.arquivo}\n`);
  const retrato = await baixar(RETRATO.url, RETRATO.original, RETRATO.sha256);
  process.stderr.write(`retrato de teste ${retrato ? "baixado" : "já no cache"}: ${RETRATO.original}\n`);
  retratoNasFixtures();
  process.stderr.write(`rosto.jpg posto nas composições de ${FIXTURES}\n`);
}
