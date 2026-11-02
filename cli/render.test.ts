// Testes do comando de render (M08) de ponta a ponta, com as composições sintéticas da linha do tempo em
// cli/fixtures/ (R01). A falta da placa é simulada por MOTOR_SEM_PLACA=1, sem desligar a placa. Precisa do host do CEF
// (captura/cef/montar.sh) e, para o teste que toca o MP4 num navegador (P01), do Electron sem remendo de captura/;
// sem eles, os testes de render são pulados com o motivo. O de placa só roda se a sonda achar a placa.
// Rodar: node --test "cli/*.test.ts"
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAMINHOS, sondarPlaca } from "./regras.ts";
import { grupoVivo } from "./processos.ts";
import { ambienteReal } from "./render.ts";
import { lerMarcaEm } from "../captura/faixa.ts";
import { lerMarcaVideo } from "../captura/marca-video.ts";

const CLI = new URL("./render.ts", import.meta.url).pathname;
// A composição dos testes gerais do comando (a «Sintetica» do Remotion até 2026-10-31): círculo semitransparente que
// anda, 1920×1080 a 30 qps (cli/fixtures/linha-rastro).
const RASTRO = new URL("./fixtures/linha-rastro", import.meta.url).pathname;
const saidas = mkdtempSync(join(tmpdir(), "m08-render-"));
after(() => rmSync(saidas, { recursive: true, force: true }));
const falta = [CAMINHOS.hostCef].filter((p) => !existsSync(p));
const semRender = falta.length ? `falta ${falta.join(", ")} (captura/cef/montar.sh)` : false;
// Só o P01 (tocar o MP4 num navegador com H.264) precisa do Electron sem remendo.
const semTocar = existsSync(CAMINHOS.electronCpu) ? false : `falta ${CAMINHOS.electronCpu} (npm ci em captura/)`;

type Rodada = { codigo: number | null; sinal: string | null; saida: string; erro: string; json: any };
function rodar(args: string[], env: Record<string, string> = {}, aoErro?: (texto: string, p: ReturnType<typeof spawn>) => void): Promise<Rodada> {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let saida = "", erro = "";
    p.stdout.on("data", (d) => { saida += d; });
    p.stderr.on("data", (d) => { erro += d; aoErro?.(erro, p); });
    p.on("close", (codigo, sinal) => {
      let json = null;
      try { json = JSON.parse(saida.trim().split("\n").pop() ?? ""); } catch {}
      ok({ codigo, sinal, saida, erro, json });
    });
  });
}
const grupos = (erro: string) => [...erro.matchAll(/group (\d+):/g)].map((m) => Number(m[1]));
const temporaria = (erro: string) => /temporary folder (\S+)/.exec(erro)?.[1] ?? "";
/** Nada sobrou: a temporária foi anunciada e sumiu; houve ao menos `minimo` grupos e todos morreram. */
function semSobras(erro: string, minimo = 1) {
  const t = temporaria(erro);
  assert.ok(t, `sem a linha «temporária» no stderr:\n${erro}`);
  assert.equal(existsSync(t), false, `temporária ${t} ficou`);
  const gs = grupos(erro);
  assert.ok(gs.length >= minimo, `${gs.length} grupos no stderr, esperado ≥ ${minimo}`);
  for (const g of gs) assert.equal(grupoVivo(g), false, `grupo ${g} vivo`);
}
const sondar = (arquivo: string) => JSON.parse(spawnSync("ffprobe", ["-v", "error", "-count_packets", "-show_entries",
  "stream=codec_type,codec_name,nb_read_packets,r_frame_rate:format=duration", "-of", "json", arquivo], { encoding: "utf8" }).stdout);

/**
 * P01: o cabeçalho do vídeo do MP4. A etiqueta (avc1), o perfil, quadros B (has_b_frames), o formato do pixel, o qps
 * do MP4 e o do VUI do fluxo (time_scale ÷ num_units_in_tick, lido pelo trace_headers) e se o moov vem antes do
 * mdat (faststart: o navegador começa a tocar sem baixar o arquivo inteiro).
 */
function cabecalho(arquivo: string) {
  const v = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=codec_name,codec_tag_string,profile,has_b_frames,pix_fmt,r_frame_rate", "-of", "json", arquivo], { encoding: "utf8" }).stdout).streams[0];
  const t = spawnSync("ffmpeg", ["-v", "trace", "-hide_banner", "-i", arquivo, "-map", "0:v", "-c", "copy", "-bsf:v", "trace_headers",
    "-frames:v", "1", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 }).stderr;
  const campo = (nome: string) => Number(new RegExp(` (?:vui_)?${nome} +.*= +(\\d+)`).exec(t)?.[1]); // HEVC: vui_time_scale
  const b = readFileSync(arquivo);
  const caixas: string[] = [];
  for (let i = 0; i + 8 <= b.length && caixas.length < 8;) {
    let tamanho = b.readUInt32BE(i);
    if (tamanho === 1) tamanho = Number(b.readBigUInt64BE(i + 8));
    caixas.push(b.toString("latin1", i + 4, i + 8));
    if (tamanho < 8) break;
    i += tamanho;
  }
  return { codec: v.codec_name, etiqueta: v.codec_tag_string, perfil: v.profile, quadrosB: v.has_b_frames, pixel: v.pix_fmt,
    // No H.264 o tick é meio quadro (time_scale ÷ 2); no HEVC, um quadro.
    qps: v.r_frame_rate, qpsVui: campo("time_scale") / (v.codec_name === "h264" ? 2 : 1) / campo("num_units_in_tick"),
    faststart: caixas.indexOf("moov") >= 0 && caixas.indexOf("moov") < caixas.indexOf("mdat") };
}
/** O H.264 que toca em todo navegador (P01), com o qps da composição no MP4 e no VUI. */
function conferirH264(arquivo: string, qps: number) {
  assert.deepEqual(cabecalho(arquivo), { codec: "h264", etiqueta: "avc1", perfil: "High", quadrosB: 0, pixel: "yuv420p",
    qps: `${qps}/1`, qpsVui: qps, faststart: true });
}

/**
 * P01: abre o MP4 num <video> do Electron sem remendo (cli/fixtures/tocar), como um navegador com o H.264 (o CEF pronto
 * não tem o decodificador), e devolve o que ele
 * decodificou: o canPlayType, o tamanho e o primeiro quadro apresentado ao tocar, com os pixels nos pontos.
 */
function tocarNoChromium(arquivo: string, pontos: [number, number][]) {
  const r = spawnSync(CAMINHOS.electronCpu, ["--no-sandbox", "--ozone-platform=headless", "--disable-gpu",
    new URL("./fixtures/tocar/main.cjs", import.meta.url).pathname, arquivo, JSON.stringify(pontos)], { encoding: "utf8", timeout: 60000 });
  const linha = r.stdout.split("\n").filter((l) => l.startsWith("tocar ")).pop();
  assert.ok(linha, `o Electron não respondeu (saiu com ${r.status}):\n${r.stderr.slice(-800)}`);
  return JSON.parse(linha.slice(6));
}
/** RGB do quadro `n` do arquivo nos pontos, decodificado pelo ffmpeg. */
function pixelsDoFfmpeg(arquivo: string, n: number, largura: number, pontos: [number, number][]) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", arquivo, "-vf", `select=eq(n\\,${n})`, "-frames:v", "1", "-f", "rawvideo",
    "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 26 });
  return pontos.map(([x, y]) => [...r.stdout.subarray((y * largura + x) * 3, (y * largura + x) * 3 + 3)]);
}

test("argumento inválido: sai com 2 e diz o que corrigir, sem subir nada", async () => {
  const r = await rodar([RASTRO, "LinhaRastro"]);
  assert.equal(r.codigo, 2);
  assert.match(r.erro, /^error: missing arguments/);
  assert.match(r.erro, /usage: kodecz render/);
  const s = await rodar([RASTRO, "LinhaRastro", join(saidas, "x.mov")]);
  assert.equal(s.codigo, 2);
  assert.match(s.erro, /the output must end in \.mp4/);
});

test("--placa sem placa (simulada): sai com 3 e sugere --cpu", async () => {
  const r = await rodar([RASTRO, "LinhaRastro", join(saidas, "x.mp4"), "--placa"], { MOTOR_SEM_PLACA: "1" });
  assert.equal(r.codigo, 3);
  assert.match(r.erro, /--gpu was requested, but the GPU is not usable: simulated by MOTOR_SEM_PLACA=1.*--cpu/);
  assert.equal(existsSync(join(saidas, "x.mp4")), false);
});

test("sem placa (simulada), sem opção: cai para CPU avisando e entrega o MP4", { skip: semRender }, async () => {
  const saida = join(saidas, "auto-cpu.mp4");
  const r = await rodar([RASTRO, "LinhaRastro", saida, "--quadros", "12", "--de", "40"], { MOTOR_SEM_PLACA: "1", MOTOR_DEPURAR: "1" });
  assert.equal(r.codigo, 0, r.erro);
  assert.match(r.erro, /warning: no GPU \(simulated by MOTOR_SEM_PLACA=1\): rendering on the CPU/);
  assert.equal(r.json.modo, "cpu");
  assert.equal(r.json.caiuParaCpu, true);
  const s = sondar(saida);
  const v = s.streams.find((x: any) => x.codec_type === "video");
  assert.deepEqual([v.codec_name, Number(v.nb_read_packets), v.r_frame_rate], ["h264", 12, "30/1"]);
  assert.ok(Math.abs(Number(s.format.duration) - 12 / 30) < 0.002, `duração ${s.format.duration}`);
  // Nada sobrou: processos, temporária e o parcial da saída.
  semSobras(r.erro); // a captura (o Node com o host do CEF)
  assert.deepEqual(readdirSync(saidas).filter((f) => f.includes("parcial")), []);
});

test("--cpu com áudio e quadros gravados: MP4 com H.264 e AAC, tempo-limite refeito pela duração", { skip: semRender }, async () => {
  const pasta = prepararLinhaVideo();
  const saida = join(saidas, "cpu-audio.mp4");
  const gravados = join(saidas, "gravados");
  const r = await rodar([pasta, "LinhaVideo", saida, "--cpu", "--gravar", "0,39", "--gravar-pasta", gravados], { MOTOR_DEPURAR: "1" });
  assert.equal(r.codigo, 0, r.erro);
  assert.deepEqual(readdirSync(gravados).sort(), ["motor-0.bgra", "motor-39.bgra"]);
  assert.equal(r.json.quadros, 40);
  // Sem --quadros, o tempo-limite é refeito com a duração real da composição (40 quadros na CPU: 204 s).
  assert.match(r.erro, /timeout reset: 204 s \(40 frames\)/);
  const s = sondar(saida);
  const tipos = s.streams.map((x: any) => `${x.codec_type}:${x.codec_name}`).sort();
  assert.deepEqual(tipos, ["audio:aac", "video:h264"]);
  assert.ok(Math.abs(Number(s.format.duration) - 40 / 25) < 0.03, `duração ${s.format.duration}`);
});

test("regressão: na CPU, o semitransparente que se move não deixa rastro (fundo preto opaco)", { skip: semRender }, async () => {
  // LinhaRastro: círculo rgba(0, 90, 255, 0.5) de 140 px em top 520, andando de x = 100 (quadro 0) a 1600 (299). Com a
  // janela transparente, o compositor por software acumulava o círculo de todos os quadros (SSIM 0,76–0,80).
  const gravados = join(saidas, "rastro");
  const r = await rodar([RASTRO, "LinhaRastro", join(saidas, "rastro.mp4"), "--cpu", "--quadros", "101", "--gravar", "100",
    "--gravar-pasta", gravados]);
  assert.equal(r.codigo, 0, r.erro);
  const q = readFileSync(join(gravados, "motor-100.bgra"));
  const px = (x: number, y: number) => [...q.subarray((y * 1920 + x) * 4, (y * 1920 + x) * 4 + 4)];
  const x100 = Math.round(100 + (1500 * 100) / 299);
  assert.deepEqual(px(170, 590), [0, 0, 0, 255], "rastro do círculo onde ele passou nos primeiros quadros");
  const [b, g, , a] = px(x100 + 70, 590);
  assert.ok(Math.abs(b - 128) <= 2 && Math.abs(g - 45) <= 2 && a === 255, `círculo sobre preto: ${px(x100 + 70, 590)}`);
});

test("composição que não existe: sai com 2, diz a declarada e não sobe nada", async () => {
  const saida = join(saidas, "nao-existe.mp4");
  const r = await rodar([RASTRO, "NaoExiste", saida, "--cpu"], { MOTOR_DEPURAR: "1" });
  assert.equal(r.codigo, 2);
  assert.match(r.erro, /error: composition «NaoExiste» not found in .*linha-rastro; the declared one is LinhaRastro/);
  assert.doesNotMatch(r.erro, /group \d+:/, "não subiu processo");
  assert.equal(existsSync(saida), false);
});

// A entrada do Remotion saiu do motor (2026-10-31): o pacote, o projeto e o arquivo de entrada são recusados antes de
// subir qualquer coisa, com o motivo e o caminho da linha do tempo.
test("entrada do Remotion: recusada com o motivo e o que fazer, sem subir nada", async () => {
  const pacote = mkdtempSync(join(saidas, "pacote-remotion-"));
  writeFileSync(join(pacote, "index.html"), "<!doctype html><script src=\"bundle.js\"></script>");
  const projeto = mkdtempSync(join(saidas, "projeto-remotion-"));
  mkdirSync(join(projeto, "src"));
  writeFileSync(join(projeto, "src", "index.ts"), "");
  for (const entrada of [pacote, projeto, join(projeto, "src", "index.ts")]) {
    const r = await rodar([entrada, "Sintetica", join(saidas, "remotion.mp4"), "--cpu"], { MOTOR_DEPURAR: "1" });
    assert.equal(r.codigo, 2, r.erro);
    assert.match(r.erro, /Remotion projects are no longer accepted as input \(removed on 2026-10-31, docs\/adr\.md, section 16.*docs\/formatos\/linha-do-tempo\.md/);
    assert.doesNotMatch(r.erro, /group \d+:/, "não subiu processo");
  }
  assert.equal(existsSync(join(saidas, "remotion.mp4")), false);
});

test("SIGTERM no meio do render: sai com 143, sem processo vivo, temporária nem saída", { skip: semRender }, async () => {
  const saida = join(saidas, "sigterm.mp4");
  let mandou = false;
  const r = await rodar([RASTRO, "LinhaRastro", saida, "--cpu"], { MOTOR_DEPURAR: "1" }, (texto, p) => {
    // Espera a captura estar renderizando (a composição já aberta) e mais um pouco.
    if (!mandou && /composition \{/.test(texto)) { mandou = true; setTimeout(() => p.kill("SIGTERM"), 1500); }
  });
  assert.equal(mandou, true, r.erro);
  assert.equal(r.codigo, 143, r.erro);
  assert.match(r.erro, /SIGTERM received/);
  semSobras(r.erro);
  assert.equal(existsSync(saida), false);
  assert.deepEqual(readdirSync(saidas).filter((f) => f.includes("parcial")), []);
});

const placa = semRender ? null : sondarPlaca(ambienteReal());
const semPlaca = semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false);
// P01: sem opção, H.264 (o HEVC não toca em todo navegador). LinhaRastro: 30 qps, círculo azul semitransparente
// andando sobre o fundo; os pontos pegam o fundo e o círculo no começo.
const PONTOS: [number, number][] = [[10, 10], [960, 300], [170, 590], [1900, 1070]];
test("na placa, sem opção: H.264 High em MP4 (avc1, sem quadros B, qps 30 no cabeçalho, faststart) que toca no Chromium", { skip: semPlaca || semTocar }, async () => {
  const saida = join(saidas, "placa.mp4");
  const r = await rodar([RASTRO, "LinhaRastro", saida, "--placa", "--quadros", "10"], { MOTOR_DEPURAR: "1" });
  assert.equal(r.codigo, 0, r.erro);
  assert.equal(r.json.modo, "placa");
  // O codec do arquivo vai no «codec»; o «video» da linha do tempo é o resumo do vídeo embutido (null sem vídeo).
  assert.deepEqual([r.json.codec, r.json.video], ["h264", null]);
  const v = sondar(saida).streams.find((x: any) => x.codec_type === "video");
  assert.deepEqual([v.codec_name, Number(v.nb_read_packets)], ["h264", 10]);
  conferirH264(saida, 30);
  semSobras(r.erro, 3); // weston, a captura e o ffmpeg do MP4
  const t = tocarNoChromium(saida, PONTOS);
  assert.equal(t.erro, undefined, `o Chromium não tocou: ${t.erro}`);
  assert.equal(t.tipos.h264, "probably");
  assert.deepEqual([t.largura, t.altura], [1920, 1080]);
  assert.ok(Math.abs(t.duracao - 10 / 30) < 0.002, `duração no Chromium: ${t.duracao}`);
  assert.equal(t.quadro.erro, undefined, t.quadro.erro);
  assert.ok(t.quadro.apresentados >= 1, JSON.stringify(t.quadro));
  // O quadro que o Chromium decodificou é o do arquivo: os pixels batem com os do ffmpeg (a conversão de cor difere
  // em poucos níveis).
  const n = Math.round(t.quadro.tempo * 30);
  const ffmpeg = pixelsDoFfmpeg(saida, n, 1920, PONTOS);
  t.quadro.pixels.forEach((p: number[], i: number) => assert.ok(p.every((c, k) => Math.abs(c - ffmpeg[i][k]) <= 6),
    `quadro ${n}, ponto ${PONTOS[i]}: Chromium ${p}, ffmpeg ${ffmpeg[i]}`));
  assert.ok(new Set(t.quadro.pixels.map(String)).size > 1, `quadro sem conteúdo: ${JSON.stringify(t.quadro.pixels)}`);
});

test("--hevc: HEVC em MP4 na placa (o Chromium sem decodificador de HEVC não toca: o motivo do P01)", { skip: semPlaca || semTocar }, async () => {
  const saida = join(saidas, "placa-hevc.mp4");
  const r = await rodar([RASTRO, "LinhaRastro", saida, "--hevc", "--quadros", "10"], { MOTOR_DEPURAR: "1" });
  assert.equal(r.codigo, 0, r.erro);
  assert.deepEqual([r.json.modo, r.json.codec], ["placa", "hevc"]);
  const c = cabecalho(saida);
  assert.deepEqual([c.codec, c.quadrosB, c.qps, c.faststart], ["hevc", 0, "30/1", true]);
  semSobras(r.erro, 3);
  const t = tocarNoChromium(saida, PONTOS);
  console.log(`# HEVC no Chromium do Electron: canPlayType «${t.tipos?.hevc}», ${t.erro ?? "tocou"}`);
  // Regressão do P10.5, agora sem reescrever o VUI na montagem: a composição de 25 qps sai com 25 no VUI do HEVC e no
  // MP4, com a duração certa (cópia da linha-parada a 25 qps).
  const pasta = join(saidas, "parada-25");
  mkdirSync(pasta);
  writeFileSync(join(pasta, "index.html"), readFileSync(new URL("./fixtures/linha-parada/index.html", import.meta.url), "utf8")
    .replace('"qps": 30', '"qps": 25'));
  const s25 = join(saidas, "parada-25-hevc.mp4");
  const r25 = await rodar([pasta, "LinhaParada", s25, "--hevc"], { MOTOR_DEPURAR: "1" });
  assert.equal(r25.codigo, 0, r25.erro);
  const c25 = cabecalho(s25);
  assert.deepEqual([c25.codec, c25.qps, c25.qpsVui], ["hevc", "25/1", 25]);
  assert.ok(Math.abs(Number(sondar(s25).format.duration) - 60 / 25) < 0.001, `duração ${sondar(s25).format.duration}`);
});

test("--alfa continua HEVC com a camada de alfa (camada do M05)", { skip: semPlaca }, async () => {
  const saida = join(saidas, "camada.hevc");
  const r = await rodar([RASTRO, "LinhaRastro", saida, "--alfa", "--quadros", "5"], { MOTOR_DEPURAR: "1" });
  assert.equal(r.codigo, 0, r.erro);
  const v = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-f", "hevc", "-count_packets", "-show_entries", "stream=codec_name,nb_read_packets",
    "-of", "json", saida], { encoding: "utf8" }).stdout).streams[0];
  assert.deepEqual([v.codec_name, Number(v.nb_read_packets)], ["hevc", 5]);
  // A camada de alfa do NVENC: o fluxo tem duas camadas (nuh_layer_id 1 nos NAL do alfa).
  const t = spawnSync("ffmpeg", ["-v", "trace", "-hide_banner", "-f", "hevc", "-i", saida, "-c", "copy", "-bsf:v", "trace_headers",
    "-frames:v", "1", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 }).stderr;
  assert.match(t, /nuh_layer_id +\S+ += +1/);
});

test("SIGTERM no meio do render na placa: weston e captura morrem, nada sobra", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const saida = join(saidas, "sigterm-placa.mp4");
  let mandou = false;
  const r = await rodar([RASTRO, "LinhaRastro", saida, "--placa"], { MOTOR_DEPURAR: "1" }, (texto, p) => {
    if (!mandou && /composition \{/.test(texto)) { mandou = true; setTimeout(() => p.kill("SIGTERM"), 1000); }
  });
  assert.equal(mandou, true, r.erro);
  assert.equal(r.codigo, 143, r.erro);
  assert.match(r.erro, /group \d+: weston/);
  semSobras(r.erro, 2); // weston e a captura
  assert.equal(existsSync(saida), false);
  assert.deepEqual(readdirSync(saidas).filter((f) => f.includes("parcial")), []);
});

test("arquivo divergente (quadro a menos, injetado): sai com 1 e não deixa a saída no lugar", { skip: semRender }, async () => {
  const saida = join(saidas, "divergente.mp4");
  const r = await rodar([RASTRO, "LinhaRastro", saida, "--cpu", "--quadros", "10"], { MOTOR_DEPURAR: "1", MOTOR_TESTE_DIVERGIR: "quadro" });
  assert.equal(r.codigo, 1, r.erro);
  assert.match(r.erro, /error: the final file does not check out: .*9 video frames; the render sent 10/);
  assert.equal(existsSync(saida), false);
  assert.deepEqual(readdirSync(saidas).filter((f) => f.includes("parcial")), []);
  semSobras(r.erro);
});

// P10: a composição em linha do tempo declarada (cli/fixtures/linha-sintetica), sem o Remotion. Cada quadro gravado
// tem de trazer N nas três tarjas (element.animate, CSS @keyframes e o canvas do motor_quadro): os três caminhos
// chegam ao quadro N junto com a marca. Na placa, dois renders dão o mesmo hash em todos os quadros (R03).
const LINHA = new URL("./fixtures/linha-sintetica", import.meta.url).pathname;
const TARJAS = [524, 508, 492];
/** [r, g, b] do pixel (x, y) de um quadro BGRA de 960 de largura. */
const pixel = (p: Buffer, x: number, y: number) => { const i = (y * 960 + x) * 4; return [p[i + 2], p[i + 1], p[i]]; };
const perto = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 8);
const FUNDO = [0x10, 0x16, 0x3a];
async function renderLinha(nome: string, modo: string) {
  const saida = join(saidas, `${nome}.mp4`), pasta = join(saidas, `${nome}-q`);
  const r = await rodar([LINHA, "LinhaSintetica", saida, modo, "--gravar", Array.from({ length: 60 }, (_, n) => n).join(","),
    "--gravar-pasta", pasta], { MOTOR_DEPURAR: "1" });
  assert.equal(r.codigo, 0, r.erro);
  assert.equal(r.json.quadros, 60);
  assert.equal(r.json.composicao.formato, "linha");
  // Uma transição (a do quadro 30), contada uma vez; nenhuma animação fora da linha do tempo.
  assert.deepEqual([r.json.transicoesAoFim, r.json.animacoesSoltas], [1, 0]);
  // P10.3: com o gancho kodecz_frame (o nome em inglês do motor_quadro), o motor não sabe o que muda e desenha todos.
  assert.deepEqual([r.json.repetidos, r.json.repetirNao], [0, modo === "--cpu" ? null : "kodecz_frame"]);
  const v = sondar(saida).streams.find((x: any) => x.codec_type === "video");
  assert.equal(Number(v.nb_read_packets), 60);
  semSobras(r.erro);
  const hashes: string[] = [];
  for (let n = 0; n < 60; n++) {
    const p = readFileSync(join(pasta, `motor-${n}.bgra`));
    assert.deepEqual(TARJAS.map((y) => lerMarcaEm(p, 960, y + 8)), [n, n, n], `quadro ${n} (${modo})`);
    // Animação de 30 ms sem fill: só o quadro 0, mesmo que a página tenha levado mais que isso para ficar pronta.
    assert.ok(perto(pixel(p, 16, 16), n === 0 ? [255, 0, 0] : FUNDO), `pulso no quadro ${n}: ${pixel(p, 16, 16)}`);
    assert.ok(perto(pixel(p, 56, 16), [0, 255, 0]), `<img> no quadro ${n}: ${pixel(p, 56, 16)}`);
    assert.ok(perto(pixel(p, 96, 16), n >= 30 ? [0, 0, 255] : FUNDO), `transição no quadro ${n}: ${pixel(p, 96, 16)}`);
    hashes.push(createHash("sha256").update(p).digest("hex"));
  }
  return { r, v, hashes };
}

test("linha do tempo na placa: quadro N nos três caminhos e dois renders iguais (R03)", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const a = await renderLinha("linha-placa-1", "--placa");
  assert.equal(a.v.codec_name, "h264");
  const b = await renderLinha("linha-placa-2", "--placa");
  assert.deepEqual(b.hashes, a.hashes);
});

// Brilho por quadro medido na placa (cli/brilho.ts, nativo/src/brilho.rs; decisão de 2026-11-01): a piscada de um quadro
// acusa, no quadro certo; o clarão de dois quadros e o corte seco, não. A série vai ao arquivo ao lado do MP4.
test("brilho por quadro na placa: a piscada de um quadro acusa e o clarão de dois quadros e o corte seco, não", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const brilho = async (pasta: string, id: string) => {
    const saida = join(saidas, `${id}.mp4`);
    const r = await rodar([new URL(`./fixtures/${pasta}`, import.meta.url).pathname, id, saida, "--placa"]);
    assert.equal(r.codigo, 0, r.erro);
    const b = r.json.brilho;
    assert.equal(b.arquivo, join(saidas, `${id}.brilho.json`));
    const j = JSON.parse(readFileSync(b.arquivo, "utf8"));
    assert.equal(j.formato, 1);
    assert.equal(j.brilho.length, 30);
    assert.equal(j.mudanca.length, 30);
    assert.deepEqual(j.piscadas, b.piscadas);
    return { r, b, j };
  };
  const com = await brilho("linha-piscada", "LinhaPiscada");
  assert.deepEqual(com.b.piscadas.map((p: any) => p.quadro), [12]);
  // O fundo #1a1d2e e o branco na escala do Y do MP4 (16 a 235): o pico é quase a faixa inteira.
  assert.ok(com.b.piscadas[0].pico > 180, `pico ${com.b.piscadas[0].pico}`);
  assert.ok(Math.abs(com.j.brilho[12] - 235) < 0.5, `clarão ${com.j.brilho[12]}`);
  assert.match(com.r.erro, /warning: flash at frame 12 /);
  const sem = await brilho("linha-sem-piscada", "LinhaSemPiscada");
  assert.deepEqual(sem.b.piscadas, []);
  assert.doesNotMatch(sem.r.erro, /piscada/);
  // O clarão de dois quadros e o corte estão na série (a medida viu), só não são piscada.
  assert.ok(sem.j.brilho[12] > 230 && sem.j.brilho[13] > 230 && sem.j.brilho[11] < 60, `clarão ${sem.j.brilho.slice(11, 15)}`);
  assert.ok(sem.j.brilho[20] - sem.j.brilho[19] > 150 && sem.j.mudanca[20] > 150, `corte ${sem.j.brilho.slice(19, 21)}`);
  // --de: o número do quadro é o da composição.
  const saida = join(saidas, "piscada-de.mp4");
  const de = await rodar([new URL("./fixtures/linha-piscada", import.meta.url).pathname, "LinhaPiscada", saida, "--placa", "--de", "8"]);
  assert.equal(de.codigo, 0, de.erro);
  assert.deepEqual(de.json.brilho.piscadas.map((p: any) => p.quadro), [12]);
});

// Fonte embutida nas fixtures (cli/fixtures/fonte-padrao): o quadro não pode depender das fontes da máquina. Antes, o
// `sans-serif` virava Noto aqui e DejaVu num contêiner, e os quadros com texto mudavam de uma máquina para outra (P14).
// Duas configurações do fontconfig com famílias diferentes (só DejaVu, só Noto) têm de dar o mesmo hash por quadro.
const DIRS_FONTES = { dejavu: "/usr/share/fonts/truetype/dejavu", noto: "/usr/share/fonts/truetype/noto" };
const semDuasFontes = Object.values(DIRS_FONTES).every((d) => existsSync(d)) ? false : "faltam as fontes DejaVu e Noto do sistema";
test("linha do tempo na CPU: o mesmo quadro com fontes diferentes na máquina (fonte embutida)", { skip: semRender || semDuasFontes }, async () => {
  const hashes = [];
  for (const [nome, dir] of Object.entries(DIRS_FONTES)) {
    const conf = join(saidas, `fontes-${nome}`);
    mkdirSync(conf, { recursive: true });
    writeFileSync(join(conf, "fonts.conf"), `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig><dir>${dir}</dir>` +
      `<cachedir>${join(conf, "cache")}</cachedir></fontconfig>\n`);
    const saida = join(saidas, `linha-fontes-${nome}.mp4`), pasta = join(saidas, `linha-fontes-${nome}-q`);
    const r = await rodar([LINHA, "LinhaSintetica", saida, "--cpu", "--gravar", Array.from({ length: 60 }, (_, n) => n).join(","),
      "--gravar-pasta", pasta], { MOTOR_DEPURAR: "1", FONTCONFIG_FILE: join(conf, "fonts.conf") });
    assert.equal(r.codigo, 0, r.erro);
    hashes.push(Array.from({ length: 60 }, (_, n) => createHash("sha256").update(readFileSync(join(pasta, `motor-${n}.bgra`))).digest("hex")));
  }
  const diferentes = hashes[0].flatMap((h, n) => (h === hashes[1][n] ? [] : [n]));
  assert.deepEqual(diferentes, [], "quadros que mudaram com as fontes da máquina");
});

/** Hash de cada quadro gravado (todos os do trecho), por N. M04_ORDEM (só de teste) muda a ordem do render. */
async function hashesLinha(nome: string, args: string[], quadros: number[], env: Record<string, string> = {}) {
  const saida = join(saidas, `${nome}.mp4`), pasta = join(saidas, `${nome}-q`);
  const r = await rodar([LINHA, "LinhaSintetica", saida, "--placa", ...args, "--gravar", quadros.join(","), "--gravar-pasta", pasta],
    { MOTOR_DEPURAR: "1", ...env });
  assert.equal(r.codigo, 0, r.erro);
  assert.equal(r.json.quadros, quadros.length);
  assert.doesNotMatch(r.erro, /warning/, "nenhum aviso ao começar no meio");
  return new Map(quadros.map((n) => [n, createHash("sha256").update(readFileSync(join(pasta, `motor-${n}.bgra`))).digest("hex")]));
}

// P10.4 (R03): o quadro N depende só da composição e de N, também começando no meio (--de) e fora de ordem. Na
// fixture, a caixa gira e cresce; fora de ordem, ela volta a uma escala menor (o compositor desenhava com a geometria
// da escala anterior, até 60 níveis na borda), e o quadro 0 volta depois de a animação de 30 ms sem fill ter saído
// do getAnimations. Exige o mesmo hash, quadro a quadro, que o render inteiro em ordem.
test("linha do tempo na placa: começar no meio e fora de ordem dá o mesmo quadro (R03, P10.4)", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const todos = Array.from({ length: 60 }, (_, n) => n);
  const inteiro = await hashesLinha("linha-r03-inteiro", [], todos);
  const confere = (outro: Map<number, string>, como: string) => {
    for (const [n, h] of outro) assert.equal(h, inteiro.get(n), `quadro ${n} ${como} difere do render inteiro`);
  };
  confere(await hashesLinha("linha-r03-de", ["--de", "25", "--quadros", "20"], todos.slice(25, 45)), "começando no 25");
  confere(await hashesLinha("linha-r03-embaralhado", [], todos, { M04_ORDEM: "embaralhada" }), "fora de ordem");
  // Saltos para trás, sobre a caixa que encolhe de volta (12 → 2) e o pulso do quadro 0 depois do fim dele.
  confere(await hashesLinha("linha-r03-saltos", [], [40, 12, 2, 59, 0, 30], { M04_ORDEM: "40,12,2,59,0,30" }), "depois de saltos");
});

// R03 com will-change (achado no P13): com a dica de transform no will-change, o Chromium guardava a rasterização da
// camada na posição subpixel em que ela apareceu primeiro, e começar no meio dava até 98 níveis na borda do texto até
// o fim da cena (cli/fixtures/linha-will-change). O motor troca a dica (captura/main.ts, conferirLista). Exige o mesmo
// hash, quadro a quadro, que o render inteiro em ordem, começando no meio e fora de ordem; e o que a dica dava mantido:
// o bloco de contenção do título, o vidro (backdrop-filter) que borra a página atrás, e a troca desfeita quando a
// classe tira a dica (o ponto do marco volta a x 10 depois do 19).
const LINHA_WC = new URL("./fixtures/linha-will-change", import.meta.url).pathname;
async function hashesWillChange(nome: string, args: string[], quadros: number[], env: Record<string, string> = {}) {
  const saida = join(saidas, `${nome}.mp4`), pasta = join(saidas, `${nome}-q`);
  const r = await rodar([LINHA_WC, "LinhaWillChange", saida, "--placa", ...args, "--gravar", quadros.join(","), "--gravar-pasta", pasta],
    { MOTOR_DEPURAR: "1", ...env });
  assert.equal(r.codigo, 0, r.erro);
  assert.equal(r.json.quadros, quadros.length);
  return { r, pasta, hashes: new Map(quadros.map((n) => [n, createHash("sha256").update(readFileSync(join(pasta, `motor-${n}.bgra`))).digest("hex")])) };
}
/** Pixels [r, g, b] de uma linha (y) de um quadro BGRA de 960, de x0 a x1. */
const linhaRgb = (p: Buffer, y: number, x0: number, x1: number) =>
  Array.from({ length: x1 - x0 }, (_, k) => { const i = (y * 960 + x0 + k) * 4; return [p[i + 2], p[i + 1], p[i]]; });

test("linha do tempo na placa: com will-change, começar no meio e fora de ordem dá o mesmo quadro (R03)", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const todos = Array.from({ length: 60 }, (_, n) => n);
  const inteiro = await hashesWillChange("wc-inteiro", [], todos);
  const confere = (outro: Map<number, string>, como: string) => {
    for (const [n, h] of outro) assert.equal(h, inteiro.hashes.get(n), `quadro ${n} ${como} difere do render inteiro`);
  };
  // 25: os cartões parados (o último ainda entrando); antes da correção, do 25 ao 56 diferiam.
  confere((await hashesWillChange("wc-de", ["--de", "25", "--quadros", "35"], todos.slice(25))).hashes, "começando no 25");
  confere((await hashesWillChange("wc-embaralhado", [], todos, { M04_ORDEM: "embaralhada" })).hashes, "fora de ordem");
  const quadro = (n: number) => readFileSync(join(inteiro.pasta, `motor-${n}.bgra`));
  // Bloco de contenção: no quadro 30, o título (branco) começa em x 100, não em 60.
  let x0 = Infinity;
  for (let y = 60; y < 140; y++) {
    const x = linhaRgb(quadro(30), y, 0, 400).findIndex(([r, g, b]) => r > 200 && g > 200 && b > 200);
    if (x >= 0) x0 = Math.min(x0, x);
  }
  assert.ok(x0 >= 100 && x0 < 110, `título começa em x ${x0}, não no bloco (x 100)`);
  // Vidro: dentro do painel (x 520 a 780), as listras de 8 px saem borradas; fora, puras.
  const varia = (px: number[][]) => Math.max(...px.map((c) => c[0])) - Math.min(...px.map((c) => c[0]));
  assert.ok(varia(linhaRgb(quadro(30), 480, 560, 740)) < 60, `vidro sem borrar: ${varia(linhaRgb(quadro(30), 480, 560, 740))}`);
  assert.ok(varia(linhaRgb(quadro(30), 480, 100, 300)) > 150, "listras fora do vidro");
  // Marco: o ponto verde em x 310 do 10 ao 19 (com a dica, o marco é o bloco de contenção) e em x 10 fora disso.
  const verde = (n: number, x: number) => { const [r, g, b] = linhaRgb(quadro(n), 426, x, x + 1)[0]; return g > 200 && r < 100 && b < 100; };
  for (const [n, x] of [[5, 16], [15, 316], [25, 16]]) assert.ok(verde(n, x), `ponto do marco fora de x ${x} no quadro ${n}`);
  // No fim (quadro 59): o bloco, o título, os quatro cartões, o painel e o selo; o marco já sem a classe.
  assert.equal(inteiro.r.json.camadasNeutras, 8);
});

// R03 depois de escala 0 (achado no P10.5 embaralhado): a camada de uma barra em scaleX(0) não é desenhada, então o
// cc não limpa os ladrilhos dela (só limpa os que a última AppendQuads não usou), e o N − 1 do aquecimento, ainda em
// escala 0, não a alcança. Fora de ordem, depois de um quadro posterior (barra cheia), o primeiro quadro visível (11,
// 15, 19) saía com os ladrilhos daquele quadro: até 82 níveis na ponta da barra nesta fixture (112 no P10.5). O
// motor desenha o próprio N, sem captura e sem vídeo, antes do N − 1. Exige o mesmo hash do render em ordem.
const LINHA_EZ = new URL("./fixtures/linha-escala-zero", import.meta.url).pathname;
test("linha do tempo na placa: fora de ordem, o primeiro quadro depois de escala 0 dá o mesmo quadro (R03)", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const hashes = async (nome: string, quadros: number[], env: Record<string, string> = {}) => {
    const saida = join(saidas, `${nome}.mp4`), pasta = join(saidas, `${nome}-q`);
    const r = await rodar([LINHA_EZ, "LinhaEscalaZero", saida, "--placa", "--gravar", quadros.join(","), "--gravar-pasta", pasta], env);
    assert.equal(r.codigo, 0, r.erro);
    return { r, hashes: new Map(quadros.map((n) => [n, createHash("sha256").update(readFileSync(join(pasta, `motor-${n}.bgra`))).digest("hex")])) };
  };
  const todos = Array.from({ length: 48 }, (_, n) => n);
  const emOrdem = await hashes("ez-ordem", todos);
  assert.deepEqual([emOrdem.r.json.aquecidos, emOrdem.r.json.limpos], [0, 0]);
  // As barras crescem mesmo (o 11 não é o 10), para o teste não passar com a tela parada.
  assert.notEqual(emOrdem.hashes.get(11), emOrdem.hashes.get(10));
  const confere = (outro: Map<number, string>, como: string) => {
    for (const [n, h] of outro) assert.equal(h, emOrdem.hashes.get(n), `quadro ${n} ${como} difere do render em ordem`);
  };
  const saltos = [40, 11, 41, 15, 42, 19];
  const s = await hashes("ez-saltos", saltos, { M04_ORDEM: saltos.join(",") });
  confere(s.hashes, "depois de um quadro posterior");
  assert.deepEqual([s.r.json.aquecidos, s.r.json.limpos], [6, 6]);
  confere((await hashes("ez-embaralhado", todos, { M04_ORDEM: "embaralhada" })).hashes, "fora de ordem");
});

test("linha do tempo na CPU: quadro N nos três caminhos", { skip: semRender }, async () => {
  const { v } = await renderLinha("linha-cpu", "--cpu");
  assert.equal(v.codec_name, "h264");
});

// Achado do P07: fonte do Google fora do cache derrubava o render. O comando baixa a que faltar (uma vez, para o
// cache) e o render segue; com M04_FONTES=cache, falha cedo dizendo a URL. Cache numa pasta vazia do teste.
const LINHA_FONTE = new URL("./fixtures/linha-fonte", import.meta.url).pathname;
// Sem await no topo: o node:test fecharia a raiz (e o after apagaria as saídas) antes destes testes.
const semRede = semRender ? semRender : spawnSync("curl", ["-sf", "-o", "/dev/null", "--max-time", "5", "https://fonts.googleapis.com/css2?family=Roboto:wght@700"]).status === 0
  ? false : "sem rede para fonts.googleapis.com (curl)";
test("fonte do Google fora do cache: o render a baixa uma vez e a segunda vez sai do cache, sem rede (P07)", { skip: semRede }, async () => {
  const cache = join(saidas, "fontes-baixar");
  mkdirSync(cache);
  const a = await rodar([LINHA_FONTE, "LinhaFonte", join(saidas, "fonte-a.mp4"), "--cpu"], { M04_FONTES_CACHE: cache });
  assert.equal(a.codigo, 0, a.erro);
  assert.equal(a.json?.quadros, 2);
  const baixadas = readdirSync(cache).filter((f) => f.endsWith(".corpo")).length;
  assert.ok(baixadas >= 2, `o CSS e o arquivo da fonte no cache: ${readdirSync(cache).join(", ")}`);
  // A segunda vez, no modo estrito (só o cache): passa, então nada mais faltava.
  const b = await rodar([LINHA_FONTE, "LinhaFonte", join(saidas, "fonte-b.mp4"), "--cpu"], { M04_FONTES_CACHE: cache, M04_FONTES: "cache" });
  assert.equal(b.codigo, 0, b.erro);
  assert.equal(readdirSync(cache).filter((f) => f.endsWith(".corpo")).length, baixadas);
});

test("fonte do Google fora do cache com M04_FONTES=cache: sai com 1, com a URL, sem gravar no cache", { skip: semRender }, async () => {
  const cache = join(saidas, "fontes-estrito");
  mkdirSync(cache);
  const r = await rodar([LINHA_FONTE, "LinhaFonte", join(saidas, "fonte-estrito.mp4"), "--cpu"], { M04_FONTES_CACHE: cache, M04_FONTES: "cache" });
  assert.equal(r.codigo, 1, r.erro);
  assert.match(r.erro, /fonte fora do cache .*https:\/\/fonts\.googleapis\.com\/css2\?family=Roboto/);
  assert.deepEqual(readdirSync(cache), []);
  assert.equal(existsSync(join(saidas, "fonte-estrito.mp4")), false);
});

// P10.5: vídeo e áudio embutidos na linha do tempo (cli/fixtures/linha-video), com a mídia sintética gerada na hora
// numa cópia da pasta: o vídeo do M09 (marca do quadro do vídeo na faixa de baixo, seno de 440 Hz) e um bipe de 1 kHz.
// O quadro N tem de trazer o quadro N − 5 + 7 do vídeo (data-inicio 5, data-recorte 7) do 5 ao 24 e o fundo fora
// disso; o som do vídeo de 0,2 s a 1,0 s e o bipe a partir de 1,2 s, com atraso abaixo de 1 ms (critério do M07).
let LINHA_VIDEO = "";
function prepararLinhaVideo() {
  if (LINHA_VIDEO) return LINHA_VIDEO;
  const pasta = join(saidas, "linha-video");
  mkdirSync(pasta);
  copyFileSync(new URL("./fixtures/linha-video/index.html", import.meta.url).pathname, join(pasta, "index.html"));
  const midia = join(saidas, "midia-video");
  const g = spawnSync(new URL("./fixtures/video-marcado.sh", import.meta.url).pathname, [],
    { encoding: "utf8", env: { ...process.env, VE_MIDIA: midia, VE_DURACAO: "2" } });
  assert.equal(g.status, 0, g.stderr);
  renameSync(join(midia, "sintetico.mp4"), join(pasta, "video.mp4"));
  const b = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=0.3",
    "-af", "volume=4", "-ac", "2", "-c:a", "pcm_s16le", join(pasta, "bipe.wav")], { encoding: "utf8" });
  assert.equal(b.status, 0, b.stderr);
  return (LINHA_VIDEO = pasta);
}
const FUNDO_VIDEO = [0x10, 0x16, 0x3a];
/** [r, g, b] do pixel (x, y) de um quadro BGRA de 1920 de largura. */
const pixel1920 = (p: Buffer, x: number, y: number) => { const i = (y * 1920 + x) * 4; return [p[i + 2], p[i + 1], p[i]]; };
/** Trechos com som (|amostra| > 1000) do áudio do MP4, em segundos: [início, fim]. */
function trechosComSom(arquivo: string) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", arquivo, "-map", "0:a", "-ac", "1", "-ar", "48000", "-f", "s16le", "-"], { maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, String(r.stderr));
  const a = new Int16Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 2);
  const trechos: [number, number][] = [];
  let inicio = -1, ultimo = -1;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]) <= 1000) continue;
    // Silêncio de mais de 10 ms fecha o trecho (o seno passa por zero a cada ~1 ms).
    if (inicio < 0 || i - ultimo > 480) { if (inicio >= 0) trechos.push([inicio / 48000, ultimo / 48000]); inicio = i; }
    ultimo = i;
  }
  if (inicio >= 0) trechos.push([inicio / 48000, ultimo / 48000]);
  return { trechos, duracao: a.length / 48000 };
}
// Estes testes são do caminho do canvas (o motor decodifica na CPU e a página desenha, P10.5), que fica como reserva do
// S08: MOTOR_TAKE_PLACA=0 por padrão aqui. Os do S08 (vídeo montado na placa) vêm depois e comparam com este.
async function renderVideo(nome: string, modo: string, quadros: number[], extra: string[] = [], env: Record<string, string> = {}) {
  const pasta = prepararLinhaVideo();
  const saida = join(saidas, `${nome}.mp4`), gravados = join(saidas, `${nome}-q`);
  const r = await rodar([pasta, "LinhaVideo", saida, modo, "--gravar", quadros.join(","), "--gravar-pasta", gravados, ...extra],
    { MOTOR_DEPURAR: "1", MOTOR_TAKE_PLACA: "0", ...env });
  assert.equal(r.codigo, 0, r.erro);
  // Em ordem, o leitor do vídeo nunca volta; fora de ordem (M04_ORDEM), volta e reabre.
  assert.deepEqual(r.json.midias, { videos: 1, audios: 1, decodificados: r.json.midias.decodificados,
    reaberturas: env.M04_ORDEM ? r.json.midias.reaberturas : 0 });
  // Cada quadro do vídeo desenhado (entregue ao quadro gravado ou ao aquecimento do P10.4) passou pela conversão de
  // cor do motor (cor-limpa.js), nenhum pelo Chromium.
  assert.equal(r.json.video.cor.convertidos, r.json.video.entregues + r.json.video.aquecimento);
  assert.equal(r.json.video.cor.passados, 0);
  semSobras(r.erro);
  // Regressão: o HEVC do NVENC vem com 30 qps no VUI; a composição de 25 qps saía com 30 no MP4 (duração errada).
  const s = sondar(saida), v = s.streams.find((x: any) => x.codec_type === "video");
  const lista = env.M04_ORDEM && env.M04_ORDEM !== "embaralhada" ? env.M04_ORDEM.split(",").length : 0;
  const total = extra.includes("--quadros") ? Number(extra[extra.indexOf("--quadros") + 1]) : lista || 40;
  assert.equal(v.r_frame_rate, "25/1", `qps do MP4 (${modo})`);
  // P01: H.264 nos dois modos, com os 25 qps também no VUI.
  conferirH264(saida, 25);
  assert.ok(Math.abs(Number(s.format.duration) - total / 25) < 0.001, `duração ${s.format.duration} (${modo}), esperado ${total / 25}`);
  const hashes: string[] = [];
  for (const n of quadros) {
    const p = readFileSync(join(gravados, `motor-${n}.bgra`));
    if (n >= 5 && n < 25) assert.equal(lerMarcaVideo(p, 1920), n - 5 + 7, `quadro ${n} (${modo}): marca do vídeo`);
    else for (const [x, y] of [[960, 540], [60, 1060]]) {
      assert.ok(perto(pixel1920(p, x, y), FUNDO_VIDEO), `quadro ${n} (${modo}), fora do vídeo: ${pixel1920(p, x, y)} em ${x},${y}`);
    }
    hashes.push(createHash("sha256").update(p).digest("hex"));
  }
  return { r, saida, hashes };
}
const TODOS_VIDEO = [0, 4, 5, 6, 12, 23, 24, 25, 39];
function conferirSom(saida: string) {
  const { trechos, duracao } = trechosComSom(saida);
  assert.ok(Math.abs(duracao - 1.6) < 0.001, `áudio de ${duracao} s`);
  assert.equal(trechos.length, 2, `trechos com som: ${JSON.stringify(trechos)}`);
  const esperado = [[0.2, 1.0], [1.2, 1.5]];
  trechos.forEach(([i, f], k) => {
    assert.ok(Math.abs(i - esperado[k][0]) < 0.001, `trecho ${k} começa em ${i.toFixed(5)} s, esperado ${esperado[k][0]}`);
    assert.ok(Math.abs(f - esperado[k][1]) < 0.002, `trecho ${k} acaba em ${f.toFixed(5)} s, esperado ${esperado[k][1]}`);
  });
  return trechos;
}

test("linha do tempo com vídeo e áudio na placa: quadro exato do vídeo, som no tempo e dois renders iguais (R03)", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const a = await renderVideo("video-placa-1", "--placa", TODOS_VIDEO);
  assert.deepEqual([a.r.json.video.entregues, a.r.json.video.repetidos], [20, 0]);
  assert.equal(a.r.json.audio, "aac");
  console.log(`# som na placa: ${JSON.stringify(conferirSom(a.saida))}`);
  const b = await renderVideo("video-placa-2", "--placa", TODOS_VIDEO);
  assert.deepEqual(b.hashes, a.hashes);
  // Começando no meio do vídeo (--de 10): o leitor anda até o quadro 12 do vídeo sem voltar.
  const c = await renderVideo("video-placa-de", "--placa", [10, 11, 24, 25, 29], ["--de", "10", "--quadros", "20"]);
  assert.equal(c.r.json.video.entregues, 15);
});

// Integração do P10, aquecimento × vídeo (P10.4 × P10.5): o quadro N − 1 desenhado sem captura antes de uma
// descontinuidade traz o quadro certo do vídeo, não entra na mistura de áudio nem conta como entregue. Começando no
// meio e fora de ordem, todo quadro traz a marca certa do vídeo (renderVideo confere) e o mesmo hash do render em
// ordem; o som do render embaralhado sai no tempo, como o em ordem.
test("linha do tempo com vídeo na placa: começar no meio e fora de ordem dá o mesmo quadro do vídeo (R03, P10.4 × P10.5)", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const todos = Array.from({ length: 40 }, (_, n) => n);
  const emOrdem = await renderVideo("video-r03-ordem", "--placa", todos, [], { MOTOR_REPETIR: "0" });
  assert.deepEqual([emOrdem.r.json.aquecidos, emOrdem.r.json.video.aquecimento], [0, 0]);
  const porN = new Map(todos.map((n, i) => [n, emOrdem.hashes[i]]));
  const confere = (quadros: number[], hashes: string[], como: string) =>
    quadros.forEach((n, i) => assert.equal(hashes[i], porN.get(n), `quadro ${n} ${como} difere do render em ordem`));
  // --de 10: aquece o 9 (dentro do trecho do vídeo) antes do 10.
  const de = Array.from({ length: 20 }, (_, i) => 10 + i);
  const c = await renderVideo("video-r03-de", "--placa", de, ["--de", "10", "--quadros", "20"], { MOTOR_REPETIR: "0" });
  // A limpeza (R03 depois de escala 0) desenha o 10 sem pedir o vídeo: o aquecimento do vídeo continua 1.
  assert.deepEqual([c.r.json.aquecidos, c.r.json.limpos, c.r.json.video.aquecimento, c.r.json.video.entregues], [1, 1, 1, 15]);
  confere(de, c.hashes, "começando no 10");
  const e = await renderVideo("video-r03-embaralhado", "--placa", todos, [], { M04_ORDEM: "embaralhada" });
  assert.ok(e.r.json.aquecidos > 10, `${e.r.json.aquecidos} aquecidos`);
  confere(todos, e.hashes, "fora de ordem");
  console.log(`# som embaralhado: ${JSON.stringify(conferirSom(e.saida))}`);
  // Saltos que limpam o canvas no meio: o 10, o 30 (fora do vídeo) e o 11, que aquece o 10 de novo (o mesmo quadro do
  // vídeo já entregue, mas o canvas está vazio).
  const s = await renderVideo("video-r03-saltos", "--placa", [10, 30, 11, 5, 24, 25, 4], [], { M04_ORDEM: "10,30,11,5,24,25,4" });
  confere([10, 30, 11, 5, 24, 25, 4], s.hashes, "depois de saltos");
});

// Integração do P10, quadro repetido × vídeo e áudio embutidos (P10.3 × P10.5): o vídeo muda o quadro sem animação;
// os quadros do trecho dele (e o que limpa o canvas) não repetem, os de fora sim. O som dos repetidos vai à mistura
// (o bipe começa num quadro repetido). Tem de sair igual ao render que desenha todos.
test("linha do tempo com vídeo na placa: quadro repetido fora do trecho do vídeo, igual ao desenhado, com o som no tempo (P10.3 × P10.5)", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const todos = Array.from({ length: 40 }, (_, n) => n);
  const desenhado = await renderVideo("video-repetir-0", "--placa", todos, [], { MOTOR_REPETIR: "0" });
  const repetido = await renderVideo("video-repetir-1", "--placa", todos, []);
  // Sem animação: parados o 1 a 4 (antes do vídeo) e o 26 a 39 (o 25 limpa o canvas). No GOP de 30, o 30 é IDR e o
  // NVENC o codifica; os outros 17 são P pulados (C01).
  assert.deepEqual([repetido.r.json.repetidos, repetido.r.json.repetirNao], [18, null]);
  assert.deepEqual([repetido.r.json.pulados, repetido.r.json.puladoDesligado], [17, null]);
  assert.deepEqual(repetido.hashes, desenhado.hashes);
  conferirContraDesenhado(repetido.saida, desenhado.saida, 17);
  console.log(`# som com repetido: ${JSON.stringify(conferirSom(repetido.saida))}`);
});

// S08: o vídeo decodificado no NVDEC e montado por baixo da página na placa (o padrão na placa). O quadro tem de sair
// igual ao do caminho do canvas, pixel a pixel (a mesma conta de cor, o mesmo quadro do vídeo pelo pts), em ordem,
// começando no meio e fora de ordem (R03); e nenhum quadro do vídeo decodificado na CPU.
test("S08: vídeo montado na placa sai igual ao do canvas, com o quadro certo do vídeo (R03)", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const canvas = await renderVideo("take-canvas", "--placa", TODOS_VIDEO);
  const take = await renderVideo("take-placa", "--placa", TODOS_VIDEO, [], { MOTOR_TAKE_PLACA: "1" });
  assert.deepEqual(take.hashes, canvas.hashes);
  const t = take.r.json.take;
  assert.equal(t.ligado, true);
  assert.deepEqual([t.quadros.placa, t.quadros.canvas], [20, 0]);
  assert.equal(take.r.json.video.entregues, 0, "nenhum quadro do vídeo pela CPU");
  assert.equal(t.nvdec.reaberturas, 0);
  // Começando no meio e embaralhado (P10.4): a marca do vídeo confere em todo quadro (renderVideo) e o hash é o do canvas.
  const porN = new Map(TODOS_VIDEO.map((n, i) => [n, canvas.hashes[i]]));
  const de = await renderVideo("take-de", "--placa", [12, 23, 24, 25], ["--de", "10", "--quadros", "20"], { MOTOR_TAKE_PLACA: "1" });
  assert.deepEqual(de.hashes, [12, 23, 24, 25].map((n) => porN.get(n)));
  const emb = await renderVideo("take-embaralhado", "--placa", TODOS_VIDEO, [], { MOTOR_TAKE_PLACA: "1", M04_ORDEM: "embaralhada" });
  assert.deepEqual(emb.hashes, canvas.hashes);
  // Saltos para trás pelas bordas do vídeo (o NVDEC reabre) e o som no tempo; e dois renders iguais.
  const lista = [10, 30, 11, 5, 24, 25, 4];
  const saltos = await renderVideo("take-saltos", "--placa", lista, [], { MOTOR_TAKE_PLACA: "1", M04_ORDEM: lista.join(",") });
  for (const [i, n] of lista.entries()) if (porN.has(n)) assert.equal(saltos.hashes[i], porN.get(n), `quadro ${n} com saltos`);
  assert.ok(saltos.r.json.take.nvdec.reaberturas >= 1, "voltar para trás reabre o NVDEC");
  console.log(`# som com o take: ${JSON.stringify(conferirSom(take.saida))}`);
  const outro = await renderVideo("take-placa-2", "--placa", TODOS_VIDEO, [], { MOTOR_TAKE_PLACA: "1" });
  assert.deepEqual(outro.hashes, take.hashes);
});

// S08 na cli/fixtures/linha-take: palco com fundo (vira o fundo da montagem), coluna recortada com fundo preto que o
// vídeo cobre, vídeo deslocado, tarja semitransparente e texto por cima. A entrada da coluna (opacidade e
// deslocamento, quadros 0 a 5) vai pelo canvas; o resto pela placa. Todo quadro igual ao do caminho do canvas.
test("S08: palco, recorte e sobreposições na placa iguais ao canvas; a entrada animada cai para o canvas", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const pasta = join(saidas, "linha-take");
  mkdirSync(pasta);
  copyFileSync(new URL("./fixtures/linha-take/index.html", import.meta.url).pathname, join(pasta, "index.html"));
  copyFileSync(join(prepararLinhaVideo(), "video.mp4"), join(pasta, "video.mp4"));
  const todos = Array.from({ length: 30 }, (_, n) => n);
  const render = async (nome: string, env: Record<string, string>) => {
    const saida = join(saidas, `${nome}.mp4`), gravados = join(saidas, `${nome}-q`);
    const r = await rodar([pasta, "LinhaTake", saida, "--placa", "--gravar", todos.join(","), "--gravar-pasta", gravados], { MOTOR_DEPURAR: "1", ...env });
    assert.equal(r.codigo, 0, r.erro);
    semSobras(r.erro);
    const pixels = todos.map((n) => readFileSync(join(gravados, `motor-${n}.bgra`)));
    return { r, pixels, decodificados: quadrosDecodificados(saida) };
  };
  const canvas = await render("take-palco-canvas", { MOTOR_TAKE_PLACA: "0" });
  const take = await render("take-palco-placa", {});
  const t = take.r.json.take;
  assert.equal(t.ligado, true);
  assert.equal(t.quadros.placa + t.quadros.canvas, 25);
  assert.ok(t.quadros.placa >= 18, `quadros na placa: ${JSON.stringify(t.quadros)}`);
  assert.ok(t.quadros.canvas >= 1, "a entrada animada vai pelo canvas");
  for (const n of todos) {
    // Na coluna, o vídeo (não o preto da coluna nem o palco) enquanto ele dura.
    if (n >= 6 && n < 25) assert.notDeepEqual(pixel1920(take.pixels[n], 1500, 500), [0, 0, 0], `quadro ${n}: coluna sem o vídeo`);
    // A régua do R03 (até 2 níveis): no CEF, o texto pode sair 1 nível diferente fora do vídeo (registro do S08, 4.3).
    let max = 0;
    for (let i = 0; i < take.pixels[n].length; i++) if ((i & 3) !== 3) max = Math.max(max, Math.abs(take.pixels[n][i] - canvas.pixels[n][i]));
    assert.ok(max <= 2, `quadro ${n}: placa ${max} níveis longe do canvas`);
    // No vídeo, igual: a mesma conta de cor e o mesmo quadro (dentro da coluna, longe da tarja e da borda).
    if (n >= 6 && n < 25) for (const [x, y] of [[1500, 300], [1100, 100], [1900, 1000]]) {
      assert.deepEqual(pixel1920(take.pixels[n], x, y), pixel1920(canvas.pixels[n], x, y), `quadro ${n}: vídeo em ${x},${y}`);
    }
  }
});

// S08, escala ≠ 1, na cli/fixtures/linha-zoom: vídeo ampliado pelo CSS e por transform, zoom animado num recorte,
// reduzido, tamanho e posição fracionários; o núcleo amostra bilinear como o Chromium desenha o canvas escalado. Todo
// quadro dentro da régua do R03 contra o caminho do canvas (até 2 níveis, poucos pixels com 1); o quadro com a borda
// visível fora do pixel vai pelo canvas. Começando no meio e embaralhado, os mesmos pixels do render em ordem.
test("S08: vídeo ampliado, reduzido e com zoom animado na placa, dentro da régua do canvas (R03)", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const pasta = join(saidas, "linha-zoom");
  mkdirSync(pasta);
  copyFileSync(new URL("./fixtures/linha-zoom/index.html", import.meta.url).pathname, join(pasta, "index.html"));
  // Vídeo sintético com bordas, gradientes e texto (R01): o que a amostragem bilinear mexe.
  const g = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=25:duration=1.92",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "20", "-g", "12", join(pasta, "video.mp4")], { encoding: "utf8" });
  assert.equal(g.status, 0, g.stderr);
  const todos = Array.from({ length: 48 }, (_, n) => n);
  const render = async (nome: string, env: Record<string, string>, quadros = todos, extra: string[] = []) => {
    const saida = join(saidas, `${nome}.mp4`), gravados = join(saidas, `${nome}-q`);
    const r = await rodar([pasta, "LinhaZoom", saida, "--placa", "--gravar", quadros.join(","), "--gravar-pasta", gravados, ...extra], { MOTOR_DEPURAR: "1", ...env });
    assert.equal(r.codigo, 0, r.erro);
    semSobras(r.erro);
    return { r, pixels: new Map(quadros.map((n) => [n, readFileSync(join(gravados, `motor-${n}.bgra`))])) };
  };
  const canvas = await render("zoom-canvas", { MOTOR_TAKE_PLACA: "0" });
  const take = await render("zoom-placa", {});
  const t = take.r.json.take;
  assert.equal(t.ligado, true);
  // Regressão da revisão: escala num ancestral e meia translação no vídeo não podem ir pela placa.
  assert.deepEqual(t.quadros, { placa: 36, canvas: 12, motivos: { "borda do vídeo visível fora do pixel": 4,
    "escala, rotação ou zoom num ancestral do vídeo": 4, "posição fora do pixel": 4 } });
  for (const n of todos) {
    const a = take.pixels.get(n)!, b = canvas.pixels.get(n)!;
    let max = 0, diferentes = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (d) { diferentes++; max = Math.max(max, d); }
    }
    assert.ok(max <= 2, `quadro ${n}: placa ${max} níveis longe do canvas`);
    assert.ok(diferentes / (a.length / 4) < 0.02, `quadro ${n}: ${diferentes} pixels diferentes do canvas`);
    // Sem escala (F, o texel direto) e pelo canvas (G, H, I): iguais.
    if (n >= 30) assert.equal(diferentes, 0, `quadro ${n}: ${diferentes} pixels diferentes do canvas`);
    // O vídeo aparece (não o palco) no meio do quadro.
    if (n < 36) assert.notDeepEqual(pixel1920(a, 1000, 400), [0x0b, 0x12, 0x20], `quadro ${n}: sem o vídeo`);
  }
  // R03: começando no meio do zoom e embaralhado, os mesmos pixels do render em ordem.
  const de = await render("zoom-de", {}, [14, 15, 20, 37], ["--de", "14", "--quadros", "34"]);
  for (const [n, p] of de.pixels) assert.ok(p.equals(take.pixels.get(n)!), `quadro ${n} começando no 14`);
  const emb = await render("zoom-embaralhado", { M04_ORDEM: "embaralhada" });
  for (const n of todos) assert.ok(emb.pixels.get(n)!.equals(take.pixels.get(n)!), `quadro ${n} embaralhado`);
});

// P13 (experimento das páginas em paralelo): duas páginas renderizam os trechos 0–29 e 30–39 ao mesmo tempo, cada uma
// exporta os assets de áudio sem misturar (M04_AUDIO_ASSETS), e um coletor só mistura o som do vídeo inteiro sobre o
// H.264 dos dois trechos concatenado sem recodificar: o som sai no tempo, como no render de uma página só.
test("linha do tempo com vídeo na placa: duas páginas em trechos, áudio exportado e misturado uma vez (P13)", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const pasta = prepararLinhaVideo();
  const trechos = [[0, 30], [30, 10]];
  const rs = await Promise.all(trechos.map(([de, q], k) => rodar([pasta, "LinhaVideo", join(saidas, `p13-t${k}.mp4`), "--placa", "--de", String(de), "--quadros", String(q)],
    { M04_AUDIO_ASSETS: join(saidas, `p13-t${k}.json`) })));
  const cru = join(saidas, "p13-junto.h264");
  writeFileSync(cru, "");
  rs.forEach((r, k) => {
    assert.equal(r.codigo, 0, r.erro);
    // A página não misturou: o MP4 do trecho saiu só com vídeo, e os assets ficaram no arquivo.
    assert.equal(r.json.audio, null);
    assert.equal(r.json.mistura.exportado, join(saidas, `p13-t${k}.json`));
    const t = join(saidas, `p13-t${k}.h264`);
    assert.equal(spawnSync("ffmpeg", ["-v", "error", "-y", "-i", join(saidas, `p13-t${k}.mp4`), "-map", "0:v", "-c", "copy", "-bsf:v", "h264_mp4toannexb", "-f", "h264", t]).status, 0);
    writeFileSync(cru, readFileSync(t), { flag: "a" });
  });
  const exportados = trechos.map((_, k) => JSON.parse(readFileSync(join(saidas, `p13-t${k}.json`), "utf8")));
  assert.deepEqual(exportados.map((e) => [e.primeiro, e.quadros.length]), [[0, 30], [30, 10]]);
  // src relativa à base da página; o quadro 12 traz o quadro 12 − 5 + 7 do vídeo, e o 30, o bipe.
  assert.deepEqual(exportados[0].quadros[12].map((a: any) => [a.src, a.mediaFrame]), [["video.mp4", 14]]);
  assert.deepEqual(exportados[1].quadros[0].map((a: any) => [a.src, a.mediaFrame]), [["bipe.wav", 0]]);
  const { ColetorDeAudio } = await import("../composicao/audio.ts");
  const c = new ColetorDeAudio({ pasta: join(saidas, "p13-audio"), fps: exportados[0].fps, primeiro: 0, base: "http://motor.p13/", pacote: pasta });
  exportados.forEach((e) => c.importar(e));
  const final = join(saidas, "p13-final.mp4");
  const m = await c.misturar({ video: cru, saida: final, totalQuadros: 40 });
  assert.equal(m.trilhas, 2);
  const v = sondar(final).streams.find((x: any) => x.codec_type === "video");
  assert.equal(Number(v.nb_read_packets ?? v.nb_frames), 40);
  conferirSom(final);
});

// S08, recorte arredondado, na cli/fixtures/linha-cartao: o vídeo num cartão de canto arredondado (overflow: hidden e
// border-radius, com sombra e contorno, como o cartão da apresentadora do C02), reduzido, no texel direto e com zoom
// animado; o núcleo cobre o canto como o Skia e, na faixa do canto, põe a página por baixo do vídeo. Todo quadro dentro
// da régua do R03 contra o caminho do canvas; tarja por cima do canto, cantos elípticos e cartão fora do pixel vão pelo
// canvas; o fundo de uma legenda quase opaca cobrindo um canto vai pela placa, também com o texto dela no canto (a
// exceção do R03 de 2026-11-01: até 3 níveis em até 2 pixels por quadro, só no quadrado do canto coberto, quadros
// 44 a 47); com outra tarja no mesmo canto ou com o contorno de dentro no cartão, pelo canvas.
// Começando no meio e embaralhado, os mesmos pixels do render em ordem.
test("S08: vídeo num cartão de canto arredondado, com sombra e contorno, na placa e dentro da régua do canvas (R03)", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const pasta = join(saidas, "linha-cartao");
  mkdirSync(pasta);
  copyFileSync(new URL("./fixtures/linha-cartao/index.html", import.meta.url).pathname, join(pasta, "index.html"));
  const g = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=25:duration=1.6",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "20", "-g", "12", join(pasta, "video.mp4")], { encoding: "utf8" });
  assert.equal(g.status, 0, g.stderr);
  const todos = Array.from({ length: 68 }, (_, n) => n);
  const render = async (nome: string, env: Record<string, string>, quadros = todos, extra: string[] = []) => {
    const saida = join(saidas, `${nome}.mp4`), gravados = join(saidas, `${nome}-q`);
    const r = await rodar([pasta, "LinhaCartao", saida, "--placa", "--gravar", quadros.join(","), "--gravar-pasta", gravados, ...extra], { MOTOR_DEPURAR: "1", ...env });
    assert.equal(r.codigo, 0, r.erro);
    semSobras(r.erro);
    return { r, pixels: new Map(quadros.map((n) => [n, readFileSync(join(gravados, `motor-${n}.bgra`))])) };
  };
  const canvas = await render("cartao-canvas", { MOTOR_TAKE_PLACA: "0" });
  const take = await render("cartao-placa", {});
  const t = take.r.json.take;
  assert.equal(t.ligado, true);
  // K e L (56 a 63): o cursor com drop-shadow e a tarja no quadrado do canto, longe da faixa, vão pela placa; M (64 a
  // 67), a sombra do contêiner que chega à faixa, pelo canvas.
  assert.deepEqual(t.quadros, { placa: 46, canvas: 22, motivos: { "algo por cima do canto arredondado": 12, "borda ou sombra num ancestral": 4,
    "recorte arredondado com cantos diferentes ou elípticos": 4, "recorte arredondado fora do pixel": 2 } });
  assert.equal(take.r.json.video.entregues, 22, "só os quadros do canvas decodificados na CPU");
  // O cursor do caso K está no quadro (o caso não ficou vazio); a tarja do L, opaca, no lugar do vídeo.
  assert.ok(pixel1920(take.pixels.get(57)!, 742, 954).every((v) => v < 30), `cursor do caso K: ${pixel1920(take.pixels.get(57)!, 742, 954)}`);
  assert.deepEqual(pixel1920(take.pixels.get(61)!, 735, 935), pixel1920(canvas.pixels.get(61)!, 735, 935), "tarja do caso L");
  // A exceção do R03 (domain.md, decisão do responsável de 2026-11-01): no canto do cartão coberto pela legenda com
  // texto (caso H, quadros 44 a 47; o canto de baixo à direita, [757, 967, 790, 1000)), até 3 níveis em até 2 pixels.
  const comTextoNoCanto = (n: number) => n >= 44 && n < 48;
  const noCanto = (p: number) => { const x = p % 1920, y = Math.floor(p / 1920); return x >= 757 && x < 790 && y >= 967 && y < 1000; };
  for (const n of todos) {
    const a = take.pixels.get(n)!, b = canvas.pixels.get(n)!;
    let max = 0, diferentes = 0, acima = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (!d) continue;
      diferentes++;
      if (d > 2 && comTextoNoCanto(n) && noCanto(i / 4)) { acima++; assert.ok(d <= 3, `quadro ${n}: ${d} níveis no canto com texto`); continue; }
      max = Math.max(max, d);
    }
    assert.ok(max <= 2, `quadro ${n}: placa ${max} níveis longe do canvas`);
    assert.ok(acima <= 2, `quadro ${n}: ${acima} pixels com 3 níveis no canto com texto`);
    assert.ok(diferentes / (a.length / 4) < 0.02, `quadro ${n}: ${diferentes} pixels diferentes do canvas`);
    // O vídeo aparece no meio do cartão (não o fundo).
    assert.notDeepEqual(pixel1920(a, 430, 500), [0xf3, 0xee, 0xe4], `quadro ${n}: cartão sem o vídeo`);
  }
  // R03: começando no meio do zoom e embaralhado, os mesmos pixels do render em ordem.
  const de = await render("cartao-de", {}, [24, 25, 31, 35, 41], ["--de", "24", "--quadros", "32"]);
  for (const [n, p] of de.pixels) assert.ok(p.equals(take.pixels.get(n)!), `quadro ${n} começando no 24`);
  const emb = await render("cartao-embaralhado", { M04_ORDEM: "embaralhada" });
  for (const n of todos) assert.ok(emb.pixels.get(n)!.equals(take.pixels.get(n)!), `quadro ${n} embaralhado`);
});

test("linha do tempo com vídeo e áudio na CPU: quadro exato do vídeo e som no tempo", { skip: semRender }, async () => {
  const a = await renderVideo("video-cpu", "--cpu", TODOS_VIDEO);
  assert.equal(a.r.json.audio, "aac");
  console.log(`# som na CPU: ${JSON.stringify(conferirSom(a.saida))}`);
});

// C02: volume variável (data-volume com pontos quadro:volume), de ponta a ponta. Um seno constante com a rampa
// 0 → 1 (quadros 0 a 10), 1 até o 30 e 1 → 0 até o 39: o volume de cada quadro é a reta entre os pontos, e o quadro 0,
// com volume 0, fica sem som. Como no Remotion (mesma expressão do ffmpeg, audio.test.ts), o filtro volume avalia a
// expressão por bloco de amostras (~21 ms), não por amostra: o degrau cai até um bloco depois da virada do quadro, e o
// miolo do quadro q fica entre os volumes de q − 1 e q + 1.
test("linha do tempo com volume variável: a rampa de cada quadro chega ao MP4 (C02)", { skip: semRender }, async () => {
  const pasta = join(saidas, "linha-volume");
  mkdirSync(pasta);
  writeFileSync(join(pasta, "index.html"), `<!doctype html><meta charset="utf-8">
<script type="application/json" id="motor-video">{ "id": "LinhaVolume", "largura": 800, "altura": 64, "qps": 25, "quadros": 40 }</script>
<style>html, body { margin: 0; background: #10163a; }</style>
<audio src="tom.wav" data-volume="0:0 10:1 30:1 39:0"></audio>`);
  const g = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=500:sample_rate=48000:duration=2",
    "-af", "volume=4", "-ac", "2", "-c:a", "pcm_s16le", join(pasta, "tom.wav")], { encoding: "utf8" });
  assert.equal(g.status, 0, g.stderr);
  const saida = join(saidas, "linha-volume.mp4");
  const r = await rodar([pasta, "LinhaVolume", saida, "--cpu"]);
  assert.equal(r.codigo, 0, r.erro);
  const d = spawnSync("ffmpeg", ["-v", "error", "-i", saida, "-map", "0:a", "-ac", "1", "-ar", "48000", "-f", "s16le", "-"], { maxBuffer: 1 << 26 });
  const a = new Int16Array(d.stdout.buffer, d.stdout.byteOffset, d.stdout.length / 2);
  // RMS do miolo de cada quadro (1920 amostras; 300 de folga nas pontas, onde o AAC espalha o degrau).
  const rms = (q: number) => { let s = 0, n = 0; for (let i = q * 1920 + 300; i < (q + 1) * 1920 - 300; i++) { s += a[i] * a[i]; n++; } return Math.sqrt(s / n); };
  const cheio = rms(20);
  assert.ok(cheio > 3000, `sem som no trecho cheio: ${cheio}`);
  assert.ok(rms(0) < 30, `quadro 0 (volume 0) com som: ${rms(0)}`);
  assert.ok(rms(39) < 30, `quadro 39 (volume 0) com som: ${rms(39)}`);
  const v = (q: number) => (q <= 10 ? q / 10 : q <= 30 ? 1 : 1 - (q - 30) / 9);
  for (let q = 1; q < 39; q++) {
    const medido = rms(q) / cheio, faixa = [v(q - 1), v(q), v(q + 1)];
    assert.ok(medido >= Math.min(...faixa) - 0.03 && medido <= Math.max(...faixa) + 0.03,
      `quadro ${q}: ${medido.toFixed(3)}, esperado entre ${Math.min(...faixa).toFixed(3)} e ${Math.max(...faixa).toFixed(3)}`);
  }
  for (let q = 12; q < 30; q++) assert.ok(Math.abs(rms(q) / cheio - 1) < 0.01, `quadro ${q} (volume 1): ${rms(q) / cheio}`);
});

// C02: velocidade de mídia (data-velocidade) na cli/fixtures/linha-velocidade, com a mídia sintética gerada na hora: o
// quadro N traz o quadro do vídeo no tempo (N − inicio) × velocidade / qps + recorte / qps (a 2, a 1,1 e a 1), pelo
// NVDEC (S08, o padrão na placa) e pelo canvas; sem data-quadros, a mídia ocupa a duração dividida pela velocidade; o
// áudio acelerado pelo atempo (encadeado a 3) dura a duração / velocidade e continua em 440 Hz (o tom não muda).
test("linha do tempo com velocidade de mídia: quadro do vídeo, duração e áudio sem mudar o tom (C02)", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const pasta = join(saidas, "linha-velocidade");
  mkdirSync(pasta);
  copyFileSync(new URL("./fixtures/linha-velocidade/index.html", import.meta.url).pathname, join(pasta, "index.html"));
  copyFileSync(join(prepararLinhaVideo(), "video.mp4"), join(pasta, "video.mp4"));
  for (const [nome, d] of [["tom1.wav", 1], ["tom2.wav", 1.2]] as const) {
    const g = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${d}`,
      "-af", "volume=4", "-ac", "2", "-c:a", "pcm_s16le", join(pasta, nome)], { encoding: "utf8" });
    assert.equal(g.status, 0, g.stderr);
  }
  const { sondarVideo } = await import("../composicao/midia-linha.ts");
  const duracao = sondarVideo(join(pasta, "video.mp4")).duracao;
  const ocupaA = Math.ceil((duracao * 25) / 2 - 0.0001);
  assert.ok(ocupaA >= 24 && ocupaA <= 26, `o vídeo a 2 ocupa ${ocupaA} quadros (duração ${duracao} s)`);
  const quadros = [0, 1, 7, 12, ocupaA - 1, ocupaA, 29, 30, 31, 39, 40, 45, 49, 50, 59];
  const esperado = (n: number) => (n < ocupaA ? 2 * n : n < 30 ? null : n < 50 ? Math.floor((11 * (n - 30)) / 10) + 3 : n - 50);
  const render = async (nome: string, env: Record<string, string>, lista = quadros, extra: string[] = []) => {
    const saida = join(saidas, `${nome}.mp4`), gravados = join(saidas, `${nome}-q`);
    const r = await rodar([pasta, "LinhaVelocidade", saida, "--placa", "--gravar", lista.join(","), "--gravar-pasta", gravados, ...extra], { MOTOR_DEPURAR: "1", ...env });
    assert.equal(r.codigo, 0, r.erro);
    semSobras(r.erro);
    for (const n of lista) {
      const p = readFileSync(join(gravados, `motor-${n}.bgra`));
      const e = esperado(n);
      if (e === null) assert.ok(perto(pixel1920(p, 960, 540), FUNDO_VIDEO), `${nome}, quadro ${n}: o vídeo a 2 já devia ter acabado`);
      else assert.equal(lerMarcaVideo(p, 1920), e, `${nome}, quadro ${n}: marca do vídeo`);
    }
    return { r, saida };
  };
  const take = await render("velocidade-placa", {});
  assert.ok(take.r.json.take.quadros.placa >= 50, `pelo NVDEC: ${JSON.stringify(take.r.json.take.quadros)}`);
  const canvas = await render("velocidade-canvas", { MOTOR_TAKE_PLACA: "0" });
  assert.equal(canvas.r.json.take, undefined);
  // R03: começando no meio do vídeo a 1,1 e embaralhado, o mesmo quadro do vídeo (a marca confere no render()).
  await render("velocidade-de", {}, [31, 39, 40, 45, 49, 50, 59], ["--de", "31", "--quadros", "29"]);
  await render("velocidade-embaralhado", { M04_ORDEM: "embaralhada" });
  // Áudio: tom1 a 2 (1 s → 0 a 0,5 s) e tom2 a 3 (1,2 s → 1,4 a 1,8 s), ainda em 440 Hz.
  const { trechos } = trechosComSom(take.saida);
  assert.equal(trechos.length, 2, `trechos com som: ${JSON.stringify(trechos)}`);
  for (const [k, [i, f]] of [[0, 0.5], [1.4, 1.8]].entries()) {
    assert.ok(Math.abs(trechos[k][0] - i) < 0.005 && Math.abs(trechos[k][1] - f) < 0.005, `trecho ${k}: ${trechos[k]}, esperado ${i}–${f}`);
  }
  const d = spawnSync("ffmpeg", ["-v", "error", "-i", take.saida, "-map", "0:a", "-ac", "1", "-ar", "48000", "-f", "s16le", "-"], { maxBuffer: 1 << 26 });
  const a = new Int16Array(d.stdout.buffer, d.stdout.byteOffset, d.stdout.length / 2);
  // Frequência pelas passagens por zero subindo, no miolo de cada trecho.
  const freq = (de: number, ate: number) => {
    let n = 0, primeira = -1, ultima = -1;
    for (let j = Math.round(de * 48000) + 1; j < ate * 48000; j++) if (a[j - 1] < 0 && a[j] >= 0) { n++; if (primeira < 0) primeira = j; ultima = j; }
    return ((n - 1) * 48000) / (ultima - primeira);
  };
  for (const [de, ate] of [[0.05, 0.45], [1.45, 1.75]]) {
    const f = freq(de, ate);
    assert.ok(Math.abs(f - 440) < 2, `tom de ${de} a ${ate} s: ${f.toFixed(2)} Hz, esperado 440`);
  }
  console.log(`# velocidade: ${JSON.stringify({ quadros: take.r.json.take.quadros, trechos, tons: [freq(0.05, 0.45), freq(1.45, 1.75)] })}`);
});

// P10.3: a cli/fixtures/linha-parada, sem motor_quadro, tem 25 quadros parados em 60 (composicao/parados.test.ts). Com o
// quadro repetido, eles vão ao NVENC sem página nem cópia; o resultado tem de ser o mesmo do render que desenha todos:
// os pixels gravados de cada quadro (o que o NVENC leu), o vídeo decodificado quadro a quadro e o número de quadros.
const PARADA = new URL("./fixtures/linha-parada", import.meta.url).pathname;
/** MD5 de cada quadro decodificado do vídeo. */
const quadrosDecodificados = (arquivo: string) => spawnSync("ffmpeg", ["-v", "error", "-i", arquivo, "-map", "0:v", "-f", "framemd5", "-"],
  { encoding: "utf8" }).stdout.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").pop()!.trim());
async function renderParada(nome: string, env: Record<string, string>, quadros = Array.from({ length: 60 }, (_, n) => n), extra: string[] = []) {
  const saida = join(saidas, `${nome}.mp4`), pasta = join(saidas, `${nome}-q`);
  const r = await rodar([PARADA, "LinhaParada", saida, "--placa", ...extra, "--gravar", quadros.join(","),
    "--gravar-pasta", pasta], { MOTOR_DEPURAR: "1", ...env });
  assert.equal(r.codigo, 0, r.erro);
  assert.equal(r.json.quadros, quadros.length);
  const v = sondar(saida).streams.find((x: any) => x.codec_type === "video");
  assert.equal(Number(v.nb_read_packets), quadros.length);
  // P01: H.264 por padrão (o repetido sai como P pulado nele também, C01); --hevc pede HEVC.
  assert.equal(v.codec_name, extra.includes("--hevc") ? "hevc" : "h264");
  semSobras(r.erro);
  const hashes = quadros.map((n) => createHash("sha256").update(readFileSync(join(pasta, `motor-${n}.bgra`))).digest("hex"));
  return { r, saida, hashes, decodificados: quadrosDecodificados(saida) };
}

// C01: o repetido é um P pulado escrito pelo motor (nativo/src/pulado.rs), sem NVENC. O vídeo decodificado deixa de
// ser igual, byte a byte, ao do render que desenha todos: lá o NVENC codifica de novo o mesmo quadro e a reconstrução
// muda um pouco (e, com ela, as referências dos quadros seguintes). O que vale agora: até o primeiro repetido, o mesmo
// vídeo; cada pulado igual ao anterior; sem os pulados, os quadros do NVENC decodificam iguais (as referências batem,
// conferir-pulado.sh); NVDEC igual ao software; e o vídeo perto do desenhado (PSNR Y ≥ 45 dB em todo quadro).
const CONFERIR_PULADO = join(CAMINHOS.raiz, "nativo", "conferir-pulado.sh");
function conferirPulado(arquivo: string, pulados: number) {
  const r = spawnSync("bash", [CONFERIR_PULADO, arquivo], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(` ${pulados} pulados iguais ao anterior; sem eles, `), r.stdout);
}
/** MD5 de cada quadro decodificado pelo NVDEC (na placa), em yuv420p como o do software. */
const quadrosNvdec = (arquivo: string) => spawnSync("ffmpeg", ["-v", "error", "-xerror", "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
  "-i", arquivo, "-map", "0:v", "-vf", "hwdownload,format=nv12,format=yuv420p", "-f", "framemd5", "-"], { encoding: "utf8" })
  .stdout.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").pop()!.trim());
const quadrosSoftware = (arquivo: string) => spawnSync("ffmpeg", ["-v", "error", "-xerror", "-i", arquivo, "-map", "0:v", "-pix_fmt", "yuv420p",
  "-f", "framemd5", "-"], { encoding: "utf8" }).stdout.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").pop()!.trim());
/** Menor PSNR do Y entre dois vídeos, quadro a quadro (quadro igual conta como infinito). */
function menorPsnr(a: string, b: string) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", a, "-i", b, "-lavfi", "[0:v][1:v]psnr=stats_file=-", "-f", "null", "-"], { encoding: "utf8" });
  const ys = [...r.stdout.matchAll(/psnr_y:(\S+)/g)].map((m) => (m[1] === "inf" ? Infinity : Number(m[1])));
  assert.ok(ys.length > 0, r.stderr);
  return Math.min(...ys);
}
/** Toca o MP4 até o fim num <video> do Electron (headless) e devolve erro, quadros decodificados e corrompidos. */
function tocarAteOFim(arquivo: string) {
  const r = spawnSync(CAMINHOS.electronCpu, ["--no-sandbox", "--ozone-platform=headless", "--disable-gpu",
    new URL("./fixtures/tocar-ate-o-fim", import.meta.url).pathname, arquivo], { encoding: "utf8", timeout: 60000 });
  const linha = r.stdout.split("\n").filter((l) => l.startsWith("{")).pop();
  assert.ok(linha, `o Electron não respondeu (saiu com ${r.status}):\n${r.stderr.slice(-800)}`);
  return JSON.parse(linha);
}
function conferirContraDesenhado(pulado: string, desenhado: string, pulados: number) {
  conferirPulado(pulado, pulados);
  const a = quadrosDecodificados(pulado), b = quadrosDecodificados(desenhado);
  assert.equal(a.length, b.length);
  const primeiro = a.findIndex((h, i) => i > 0 && h === a[i - 1]);
  assert.ok(primeiro > 0, "nenhum quadro igual ao anterior");
  assert.deepEqual(a.slice(0, primeiro), b.slice(0, primeiro), "antes do primeiro repetido o vídeo é o mesmo");
  assert.deepEqual(quadrosNvdec(pulado), quadrosSoftware(pulado), "NVDEC e software decodificam diferente");
  const psnr = menorPsnr(pulado, desenhado);
  assert.ok(psnr >= 45, `PSNR Y mínimo ${psnr} dB contra o desenhado`);
}

test("linha do tempo na placa: quadro repetido sem página, cópia nem NVENC sai igual ao anterior (P10.3, C01)", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const todos = await renderParada("parada-todos", { MOTOR_REPETIR: "0" });
  assert.equal(todos.r.json.repetidos, 0);
  const pulo = await renderParada("parada-pulo", {});
  assert.deepEqual([pulo.r.json.repetidos, pulo.r.json.repetirNao], [25, null]);
  // Nenhum repetido cai no começo do GOP (0 e 30) na parada: todos são pulados.
  assert.deepEqual([pulo.r.json.pulados, pulo.r.json.puladoDesligado], [25, null]);
  assert.deepEqual(pulo.hashes, todos.hashes);
  assert.equal(pulo.decodificados.length, 60);
  conferirContraDesenhado(pulo.saida, todos.saida, 25);
  // Sem o pulado (MOTOR_PULADO=0), o NVENC codifica o repetido de novo e o vídeo sai igual ao desenhado (P10.3).
  const nvenc = await renderParada("parada-nvenc", { MOTOR_PULADO: "0" });
  assert.deepEqual([nvenc.r.json.repetidos, nvenc.r.json.pulados], [25, 0]);
  assert.deepEqual(nvenc.decodificados, todos.decodificados);
  // O padrão é H.264 (P01), em que o pulado reescreve o frame_num dos quadros do NVENC. O Chromium toca até o fim, com
  // todos os quadros decodificados e nenhum corrompido.
  const t = tocarAteOFim(pulo.saida);
  assert.deepEqual([t.erro, t.decodificados, t.corrompidos], [null, 60, 0], JSON.stringify(t));
  // HEVC (--hevc): o mesmo pulado, com o POC e o RPS dados pelo motor.
  const hevc = await renderParada("parada-hevc", {}, undefined, ["--hevc"]);
  assert.deepEqual([hevc.r.json.pulados, hevc.r.json.puladoDesligado], [25, null]);
  assert.deepEqual(hevc.hashes, todos.hashes);
  conferirPulado(hevc.saida, 25);
  assert.deepEqual(quadrosNvdec(hevc.saida), quadrosSoftware(hevc.saida), "HEVC: NVDEC e software decodificam diferente");
  // A composição não é toda parada: o teste não passa por acaso com 60 quadros iguais.
  assert.ok(new Set(todos.hashes).size > 20, `${new Set(todos.hashes).size} quadros distintos`);
});

// O quadro repetido sai congelado se a página muda por meio que o motor não vê: SVG SMIL (cli/fixtures/linha-smil)
// desliga a repetição, com o motivo. A fixture tem um <audio> em data:; com --manter, a temporária fica, mas a pasta
// render-dados (a mídia em data: decodificada) é apagada no fim.
test("linha do tempo na placa: SVG SMIL desliga o quadro repetido e a mídia em data: não fica na temporária", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const saida = join(saidas, "smil.mp4");
  const r = await rodar([new URL("./fixtures/linha-smil", import.meta.url).pathname, "LinhaSmil", saida, "--placa", "--manter"], { MOTOR_DEPURAR: "1" });
  assert.equal(r.codigo, 0, r.erro);
  assert.deepEqual([r.json.repetidos, r.json.repetirNao], [0, "SVG SMIL"]);
  const t = temporaria(r.erro);
  assert.ok(t && existsSync(t), `temporária ${t} não ficou com --manter`);
  try { assert.equal(existsSync(join(t, "render-dados")), false, `render-dados ficou em ${t}: ${readdirSync(t)}`); }
  finally { rmSync(t, { recursive: true, force: true }); }
});

// Integração do P10, quadro repetido × aquecimento (P10.3 × P10.4): depois de quadros repetidos, a página ficou no
// último desenhado (M), mas os intervalos garantem que nada mudou de M a N − 1; então o N desenhado em seguida não é
// descontinuidade e não aquece. Fora de ordem, só repete o que vem logo depois do anterior. Em ordem, começando no
// meio e embaralhado, com repetido, dá o mesmo hash por quadro que o render que desenha todos.
test("linha do tempo na placa: quadro repetido com começo no meio e fora de ordem dá o mesmo quadro (P10.3 × P10.4)", { skip: semRender || (placa && !placa.ok ? `sem placa: ${placa.motivo}` : false) }, async () => {
  const todos = Array.from({ length: 60 }, (_, n) => n);
  const base = await renderParada("parada-r03-todos", { MOTOR_REPETIR: "0" });
  const porN = new Map(todos.map((n, i) => [n, base.hashes[i]]));
  const confere = (quadros: number[], hashes: string[], como: string) =>
    quadros.forEach((n, i) => assert.equal(hashes[i], porN.get(n), `quadro ${n} ${como} difere do render que desenha todos`));
  const emOrdem = await renderParada("parada-r03-ordem", {});
  assert.deepEqual([emOrdem.r.json.repetidos, emOrdem.r.json.aquecidos], [25, 0]);
  confere(todos, emOrdem.hashes, "em ordem com repetido");
  // --de 20 --quadros 30: aquece o 19; repete o 21 a 29 e o 41 a 44.
  const de = todos.slice(20, 50);
  const d = await renderParada("parada-r03-de", {}, de, ["--de", "20", "--quadros", "30"]);
  assert.deepEqual([d.r.json.repetidos, d.r.json.aquecidos, d.r.json.limpos], [13, 1, 1]);
  confere(de, d.hashes, "começando no 20 com repetido");
  const e = await renderParada("parada-r03-embaralhado", { M04_ORDEM: "embaralhada" });
  confere(todos, e.hashes, "fora de ordem com repetido");
  // Saltos entre parados: o 17 e o 18 vêm logo depois do anterior (repetem); o 11, parado, vem depois do 18 (desenha,
  // aquecendo o 10); o 44 depois do 43 (repete); o 0 volta ao começo.
  const lista = [16, 17, 18, 11, 12, 20, 43, 44, 0, 1];
  const s = await renderParada("parada-r03-saltos", { M04_ORDEM: lista.join(",") }, lista);
  assert.deepEqual(s.r.json.repetidos, 3);
  confere(lista, s.hashes, "depois de saltos com repetido");
});
