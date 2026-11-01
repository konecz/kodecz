// P13 (experimento): com a batida externa (M04_BATIDA=externa, o compositor do CEF só faz quadro quando o motor bate),
// o vídeo sai igual, quadro a quadro decodificado, ao do caminho de sempre (as batidas do M04_QPS por segundo). Na
// placa, com a linha sintética e a linha com vídeo embutido (R01): o render inteiro e dois trechos rodando ao mesmo
// tempo (como as páginas do paralelo, --de no meio, com o aquecimento do R03), cada um contra o mesmo render sem a
// batida externa. Sem a placa, pula.
// Rodar: node --test cli/batida-externa.test.ts
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAMINHOS, sondarPlaca } from "./regras.ts";
import { ambienteReal } from "./render.ts";

const CLI = new URL("./render.ts", import.meta.url).pathname;
const saidas = mkdtempSync(join(tmpdir(), "p13-batida-"));
after(() => rmSync(saidas, { recursive: true, force: true }));
const semPlaca = !existsSync(CAMINHOS.hostCef) ? "falta o host do CEF (captura/cef/montar.sh)"
  : !sondarPlaca(ambienteReal()).ok ? "sem placa" : false;

/** Hash do YUV de cada quadro decodificado. */
const md5s = (mp4: string) => execFileSync("ffmpeg", ["-v", "error", "-i", mp4, "-map", "0:v", "-f", "framemd5", "-"], { encoding: "utf8" })
  .split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").pop()!.trim());

function render(pasta: string, id: string, saida: string, extra: string[], batida: boolean): Promise<any> {
  return new Promise((ok, falha) => {
    const env = { ...process.env };
    if (batida) env.M04_BATIDA = "externa"; else delete env.M04_BATIDA;
    const p = spawn(process.execPath, [CLI, pasta, id, saida, "--placa", ...extra], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (codigo) => {
      if (codigo !== 0) return falha(new Error(`render ${id} ${extra.join(" ")} saiu ${codigo}: ${err.slice(-2000)}`));
      ok(JSON.parse(out.trim().split("\n").pop()!));
    });
  });
}

function linhaVideo() {
  const pasta = join(saidas, "linha-video");
  mkdirSync(pasta);
  copyFileSync(new URL("./fixtures/linha-video/index.html", import.meta.url).pathname, join(pasta, "index.html"));
  const midia = join(saidas, "midia-video");
  const g = spawnSync(join(CAMINHOS.raiz, "docs", "experimentos", "2026-10-m04-video-embutido", "gerar-midia.sh"), [],
    { encoding: "utf8", env: { ...process.env, VE_MIDIA: midia, VE_DURACAO: "2" } });
  assert.equal(g.status, 0, g.stderr);
  renameSync(join(midia, "sintetico.mp4"), join(pasta, "video.mp4"));
  const b = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=0.3",
    "-af", "volume=4", "-ac", "2", "-c:a", "pcm_s16le", join(pasta, "bipe.wav")], { encoding: "utf8" });
  assert.equal(b.status, 0, b.stderr);
  return pasta;
}

const casos = [
  { nome: "linha sintética", pasta: () => new URL("./fixtures/linha-sintetica", import.meta.url).pathname, id: "LinhaSintetica", quadros: 60 },
  { nome: "linha com vídeo embutido", pasta: linhaVideo, id: "LinhaVideo", quadros: 40 },
];

for (const c of casos) {
  test(`batida externa: ${c.nome} sai igual, quadro a quadro, inteira e em dois trechos ao mesmo tempo`, { skip: semPlaca }, async () => {
    const pasta = c.pasta();
    const base = join(saidas, `${c.id}-base.mp4`), externa = join(saidas, `${c.id}-externa.mp4`);
    await render(pasta, c.id, base, [], false);
    const r = await render(pasta, c.id, externa, [], true);
    assert.equal(r.quadros, c.quadros);
    // A batida externa vigorou: o motor bateu no laço (sem ela, o campo não aparece).
    assert.ok(r.batidasLaco > 0, `sem batidas do motor no laço: ${JSON.stringify(r.batidasLaco)}`);
    const esperado = md5s(base);
    assert.equal(esperado.length, c.quadros);
    assert.deepEqual(md5s(externa), esperado, "inteira: a batida externa mudou algum quadro");
    // Dois trechos ao mesmo tempo, o segundo começando no meio (o aquecimento do R03 roda com as batidas), contra os
    // mesmos trechos sem a batida externa. O trecho não é comparado com o render inteiro: o controle de taxa do NVENC
    // recomeça no corte (a diferença nas bordas aceita no P13). O corte cai no GOP (30), como no paralelo.
    const corte = 30;
    const trechos = async (rotulo: string, batida: boolean) => {
      const t = [join(saidas, `${c.id}-${rotulo}-t0.mp4`), join(saidas, `${c.id}-${rotulo}-t1.mp4`)];
      await Promise.all([render(pasta, c.id, t[0], ["--de", "0", "--quadros", String(corte)], batida),
        render(pasta, c.id, t[1], ["--de", String(corte), "--quadros", String(c.quadros - corte)], batida)]);
      return [...md5s(t[0]), ...md5s(t[1])];
    };
    const sem = await trechos("sem", false);
    assert.equal(sem.length, c.quadros);
    assert.deepEqual(await trechos("externa", true), sem, "trechos: a batida externa mudou algum quadro");
  });
}
