// S02: a demonstração dos blocos (blocos/index.html) renderizada pelo cli/render.ts, na placa e na CPU, com o
// apresentador sintético gerado na hora numa cópia da pasta (R01: nada de cliente; *.mp4 fora do git).
// Confere: 720 quadros em H.264 com o áudio, o quadro N certo (o motor só aceita o paint com a marca N, M03; com
// --gravar, ele confere a marca de cada quadro), cores dos blocos em quadros conhecidos, o quadro repetido ligado (sem
// motor_quadro, SMIL nem imagem animada) e dois renders na placa iguais quadro a quadro (R03).
// Rodar (renders longos, placa dividida): flock /tmp/motor-video-placa.lock node --test blocos/demonstracao.test.ts
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAMINHOS, sondarPlaca } from "../cli/regras.ts";
import { ambienteReal } from "../cli/render.ts";
import { BLOCOS } from "./conferir-dom.ts";

const CLI = new URL("../cli/render.ts", import.meta.url).pathname;
const falta = [CAMINHOS.hostCef].filter((p) => !existsSync(p));
const semRender = falta.length ? `falta ${falta.join(", ")} (captura/cef/montar.sh)` : false;
const placa = semRender ? null : sondarPlaca(ambienteReal());
const semPlaca = semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false);

const tmp = mkdtempSync(join(tmpdir(), "s02-demo-"));
const PASTA = join(tmp, "blocos");
before(() => {
  cpSync(BLOCOS, PASTA, { recursive: true, filter: (de) => !de.includes("/midia") });
  const g = spawnSync(join(PASTA, "gerar-midia.sh"), [PASTA], { encoding: "utf8" });
  assert.equal(g.status, 0, g.stderr);
});
after(() => rmSync(tmp, { recursive: true, force: true }));

const QUADROS = 720, QPS = 30;
const GRAVAR = [0, 50, 150, 210, 360, 500, 640, 719];
const COR = { ground: [0x10, 0x18, 0x28], accent: [0xff, 0xb6, 0x48], muted: [0x9f, 0xb0, 0xd8] };
// [quadro, x, y, cor esperada]: cartela aberta, fundo antes dela, barras de jan (muted) e jun (destaque), fundos.
const PONTOS: [number, number, number, number[]][] = [
  [0, 960, 540, COR.ground], [50, 200, 200, COR.accent], [360, 220, 800, COR.muted], [360, 1700, 800, COR.accent],
  [360, 40, 1040, COR.ground], [500, 40, 1040, COR.ground], [640, 100, 100, COR.ground], [719, 100, 100, COR.ground],
];
const pixel = (p: Buffer, x: number, y: number) => { const i = (y * 1920 + x) * 4; return [p[i + 2], p[i + 1], p[i]]; };
const perto = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 8);

type Rodada = { codigo: number | null; erro: string; json: any };
function rodar(args: string[]): Promise<Rodada> {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let saida = "", erro = "";
    p.stdout.on("data", (d) => { saida += d; });
    p.stderr.on("data", (d) => { erro += d; });
    p.on("close", (codigo) => {
      let json = null;
      try { json = JSON.parse(saida.trim().split("\n").pop() ?? ""); } catch {}
      ok({ codigo, erro, json });
    });
  });
}
const sondar = (arquivo: string) => JSON.parse(spawnSync("ffprobe", ["-v", "error", "-count_packets", "-show_entries",
  "stream=codec_type,codec_name,nb_read_packets,r_frame_rate,duration", "-of", "json", arquivo], { encoding: "utf8" }).stdout);
const framemd5 = (arquivo: string) => spawnSync("ffmpeg", ["-v", "error", "-i", arquivo, "-map", "0:v", "-f", "framemd5", "-"],
  { encoding: "utf8", maxBuffer: 64 << 20 }).stdout.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").pop()!.trim());

async function renderizar(nome: string, modo: string) {
  const saida = join(tmp, `${nome}.mp4`), gravados = join(tmp, `${nome}-q`);
  const t0 = performance.now();
  const r = await rodar([PASTA, "Demonstracao", saida, modo, "--gravar", GRAVAR.join(","), "--gravar-pasta", gravados]);
  const parede = (performance.now() - t0) / 1000;
  assert.equal(r.codigo, 0, r.erro.slice(-2000));
  assert.equal(r.json.quadros, QUADROS);
  assert.equal(r.json.composicao.formato, "linha");
  // Nenhuma animação fora da linha do tempo do documento nem transição de CSS: tudo declarado.
  assert.deepEqual([r.json.animacoesSoltas, r.json.transicoesAoFim], [0, 0]);
  // O apresentador: 195 quadros. Na CPU, todos decodificados pelo ffmpeg; na placa (S08), cada um vai pelo NVDEC ou,
  // quando a geometria não se reproduz, pelo canvas.
  if (modo === "--cpu") assert.deepEqual([r.json.midias.videos, r.json.midias.decodificados], [1, 195], "o apresentador: 195 quadros");
  else {
    assert.equal(r.json.midias.videos, 1);
    assert.equal(r.json.take.quadros.placa + r.json.take.quadros.canvas, 195, `o apresentador: ${JSON.stringify(r.json.take.quadros)}`);
  }
  const s = sondar(saida), v = s.streams.find((x: any) => x.codec_type === "video"), a = s.streams.find((x: any) => x.codec_type === "audio");
  assert.deepEqual([v.codec_name, Number(v.nb_read_packets), v.r_frame_rate], ["h264", QUADROS, `${QPS}/1`]);
  assert.equal(a?.codec_name, "aac", "o som do apresentador");
  assert.ok(Math.abs(Number(a.duration) - QUADROS / QPS) < 0.05, `áudio de ${a.duration} s`);
  const hashes = new Map<number, string>();
  for (const n of GRAVAR) {
    const p = readFileSync(join(gravados, `motor-${n}.bgra`));
    assert.equal(p.length, 1920 * 1080 * 4);
    hashes.set(n, createHash("sha256").update(p).digest("hex"));
    for (const [q, x, y, cor] of PONTOS) if (q === n) assert.ok(perto(pixel(p, x, y), cor), `quadro ${n} (${modo}) em ${x},${y}: ${pixel(p, x, y)}, esperado ${cor}`);
    // No trecho do apresentador (90 a 284), o vídeo aparece no canto de cima (não é o fundo).
    if (n >= 105 && n < 270) assert.ok(!perto(pixel(p, 1500, 150), COR.ground), `quadro ${n} (${modo}): sem o vídeo`);
  }
  return { r, saida, hashes, parede };
}

test("demonstração na placa: 720 quadros, cores dos blocos, quadro repetido ligado e dois renders iguais (R03)", { skip: semPlaca }, async () => {
  const a = await renderizar("placa-1", "--placa");
  // Sem motor_quadro, SMIL nem imagem animada, o motor repete os quadros parados (P10.3); o trecho do vídeo desenha
  // todos (195 quadros), a regressiva também (o pulso anda os 90 quadros dela) e cada borda de animação. Foram 189 em
  // 2026-10-30; o piso pega a volta de uma animação que dure o trecho inteiro (a cena sozinha derrubava para 0).
  assert.equal(a.r.json.repetirNao, null);
  assert.ok(a.r.json.repetidos >= 150, `${a.r.json.repetidos} quadros repetidos`);
  const b = await renderizar("placa-2", "--placa");
  assert.deepEqual([...b.hashes], [...a.hashes], "quadros gravados iguais nos dois renders");
  const da = framemd5(a.saida), db = framemd5(b.saida);
  assert.equal(da.length, QUADROS);
  assert.deepEqual(db, da, "os 720 quadros decodificados iguais nos dois renders");
  assert.ok(new Set(da).size > 200, `${new Set(da).size} quadros distintos: a demonstração anda`);
  process.stdout.write(`# placa: ${a.parede.toFixed(1)} s e ${b.parede.toFixed(1)} s de parede (indicativo), ${a.r.json.repetidos} repetidos\n`);
});

test("demonstração na CPU: 720 quadros e as mesmas cores dos blocos", { skip: semRender }, async () => {
  const c = await renderizar("cpu", "--cpu");
  process.stdout.write(`# cpu: ${c.parede.toFixed(1)} s de parede (indicativo)\n`);
});
