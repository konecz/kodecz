// Testes da prévia (S07, cli/previa.ts): os argumentos; na placa, o PNG do quadro N igual ao quadro N do render
// (régua do R03), no frio e no quente; a mudança na pasta refaz os quadros; a página só no loopback; e, ao parar,
// nenhum processo nem pasta temporária sobra. Composição sintética (R01): cli/fixtures/linha-sintetica.
// Rodar: node --test "cli/*.test.ts" (os da placa sob flock /tmp/motor-video-placa.lock)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argumentosDoRender, lerOpcoesPrevia } from "./previa.ts";
import { lerJob } from "./abertura.ts";
import { dePng, dentroDaRegua, diferenca, REGUA_R03, ssim } from "./quadros.ts";
import { CAMINHOS, ErroDeUso, sondarPlaca } from "./regras.ts";
import { ambienteReal } from "./render.ts";

const PREVIA = new URL("./previa.ts", import.meta.url).pathname;
const RENDER = new URL("./render.ts", import.meta.url).pathname;
const SINTETICA = new URL("./fixtures/linha-sintetica", import.meta.url).pathname;
const ID = "LinhaSintetica";

test("opções: quadro, lista, saída, observar e servir; erros com a correção", () => {
  const o = lerOpcoesPrevia([SINTETICA, ID, "--quadro", "30", "--saida", "/tmp/x.png"]);
  assert.deepEqual(o.quadros, [30]);
  assert.equal(o.arquivoUnico, true);
  assert.equal(o.saida, "/tmp/x.png");
  const v = lerOpcoesPrevia([SINTETICA, ID, "--quadro", "45,0,45,59"]);
  assert.deepEqual(v.quadros, [0, 45, 59], "sem repetidos, em ordem");
  assert.equal(v.arquivoUnico, false);
  assert.equal(v.saida, join(CAMINHOS.raiz, "tmp", "previa", ID));
  const ob = lerOpcoesPrevia([SINTETICA, ID, "--observar", "--servir", "--porta", "8199"]);
  assert.deepEqual(ob.quadros, [0, 30, 59], "padrão: o primeiro, o do meio e o último");
  assert.equal(ob.porta, 8199);
  for (const [argv, re] of [
    [[SINTETICA, ID], /--quadro/],
    [[SINTETICA, ID, "--quadro", "60"], /fora da composição/],
    [[SINTETICA, ID, "--quadro", "1;2"], /vírgula/],
    [[SINTETICA, "Outra", "--quadro", "1"], /declarada é LinhaSintetica/],
    [[join(SINTETICA, ".."), "Sintetica", "--quadro", "1"], /linha do tempo|index.html/],
    [[SINTETICA, ID, "--quadro", "1,2", "--saida", "x.png"], /só com um quadro/],
    [[SINTETICA, ID, "--quadro", "1", "--servir"], /só com --observar/],
    [[SINTETICA, ID, "--observar", "--servir", "--porta", "0"], /porta/],
    [[SINTETICA, ID, "--quadro", "1", "--placa", "--cpu"], /juntos/],
    [[SINTETICA, ID, "--observar", "--saida", SINTETICA], /própria pasta observada/],
  ] as const) {
    assert.throws(() => lerOpcoesPrevia([...argv]), (e: unknown) => e instanceof ErroDeUso && re.test(e.message), argv.join(" "));
  }
});

test("argumentos do render: trecho seguido sem ordem; lista com saltos pela ordem (M04_ORDEM)", () => {
  const o = lerOpcoesPrevia([SINTETICA, ID, "--quadro", "0,45,59", "--placa", "--sem-contencao"]);
  const a = argumentosDoRender(o, [0, 45, 59], "/t/p.mp4", "/t/q");
  assert.equal(a.ordem, "0,45,59");
  assert.deepEqual(a.argv, ["--sem-audio", "--de", "0", "--quadros", "60", "--gravar", "0,45,59", "--gravar-pasta", "/t/q", "--placa",
    "--sem-contencao", "--", SINTETICA, ID, "/t/p.mp4"]);
  const um = argumentosDoRender(o, [30], "/t/p.mp4", "/t/q");
  assert.equal(um.ordem, null);
  assert.deepEqual(um.argv.slice(0, 7), ["--sem-audio", "--de", "30", "--quadros", "1", "--gravar", "30"]);
  assert.equal(argumentosDoRender(o, [3, 4, 5], "/t/p.mp4", "/t/q").ordem, null);
});

test("job da prévia: --gravar e «ordem» só com --previa; ordem conferida", () => {
  const job = (j: object) => JSON.stringify(j);
  const argumentos = ["--placa", "--gravar", "1,5", "--gravar-pasta", "/tmp/g", "--", SINTETICA, ID, "/tmp/x.mp4"];
  const a = lerJob(job({ argumentos, ordem: "1,5" }), { previa: true });
  assert.deepEqual(a.gravar, [1, 5]);
  assert.equal(a.ordem, "1,5");
  assert.equal(lerJob(job({ argumentos: ["--placa", SINTETICA, ID, "/tmp/x.mp4"] })).ordem, null);
  for (const [linha, previa, re] of [
    [job({ argumentos }), false, /--gravar/],
    [job({ argumentos: ["--placa", SINTETICA, ID, "/tmp/x.mp4"], ordem: "1" }), false, /só na prévia/],
    [job({ argumentos, ordem: "1,60" }), true, /ordem/],
    [job({ argumentos, ordem: "1;2" }), true, /ordem/],
    [job({ argumentos: ["--placa", "--manter", SINTETICA, ID, "/tmp/x.mp4"] }), true, /--manter/],
  ] as const) {
    assert.throws(() => lerJob(linha, { previa }), (e: unknown) => e instanceof ErroDeUso && re.test(e.message), linha);
  }
});

const sonda = existsSync(CAMINHOS.hostCef) ? sondarPlaca(ambienteReal()) : null;
const semPlaca = !sonda ? "sem o host do CEF (captura/cef/montar.sh)" : !sonda.ok ? `placa não serve: ${sonda.motivo}` : false;

/** Processos com a marca no ambiente (a prévia, os renders, a reserva, o weston, o navegador e os filhos herdam). */
function marcados(marca: string): number[] {
  const achados: number[] = [];
  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try { if (readFileSync(`/proc/${pid}/environ`, "latin1").split("\0").includes(`MOTOR_TESTE_PREVIA=${marca}`)) achados.push(Number(pid)); } catch {}
  }
  return achados;
}

/** Os quadros `quadros` do render inteiro (0 a 59, em ordem), em BGRA: a régua da prévia. */
function quadrosDoRender(pasta: string, quadros: number[]): Map<number, Buffer> {
  const g = join(pasta, "render-q");
  const r = spawnSync(process.execPath, [RENDER, SINTETICA, ID, join(pasta, "render.mp4"), "--placa", "--sem-audio", "--sem-contencao",
    "--gravar", quadros.join(","), "--gravar-pasta", g], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return new Map(quadros.map((n) => [n, readFileSync(join(g, `motor-${n}.bgra`))]));
}

/** O PNG da prévia confere com o BGRA do render pela régua do R03 (e diz se é igual bit a bit). */
function confere(png: string, bgra: Buffer, como: string): boolean {
  const p = dePng(readFileSync(png));
  const d = diferenca(p.bgra, bgra), s = ssim(p.bgra, bgra, p.largura, p.altura);
  assert.ok(dentroDaRegua({ nivel: d.nivel, ssim: s }, REGUA_R03), `${como}: ${d.nivel} níveis em ${d.pixels} pixels, SSIM ${s}`);
  return d.nivel === 0;
}

test("quadro solto: o PNG do quadro N é o quadro N do render (R03), um e vários", { skip: semPlaca }, () => {
  const pasta = mkdtempSync(join(tmpdir(), "previa-teste-"));
  try {
    const render = quadrosDoRender(pasta, [0, 30, 45, 59]);
    const t0 = performance.now();
    const um = spawnSync(process.execPath, [PREVIA, SINTETICA, ID, "--quadro", "30", "--placa", "--sem-contencao", "--saida", join(pasta, "q30.png")], { encoding: "utf8" });
    const msUm = Math.round(performance.now() - t0);
    assert.equal(um.status, 0, um.stderr);
    const j = JSON.parse(um.stdout.trim().split("\n").pop()!);
    assert.equal(j.ok, true);
    assert.equal(j.quadros["30"], join(pasta, "q30.png"));
    const iguais = [confere(join(pasta, "q30.png"), render.get(30)!, "quadro 30 solto")];
    const t1 = performance.now();
    const varios = spawnSync(process.execPath, [PREVIA, SINTETICA, ID, "--quadro", "59,0,45", "--placa", "--sem-contencao", "--saida", join(pasta, "v")], { encoding: "utf8" });
    const msVarios = Math.round(performance.now() - t1);
    assert.equal(varios.status, 0, varios.stderr);
    for (const n of [0, 45, 59]) iguais.push(confere(join(pasta, "v", `quadro-${n}.png`), render.get(n)!, `quadro ${n} da lista`));
    process.stderr.write(`prévia, quadro solto: 1 quadro ${msUm} ms, 3 quadros ${msVarios} ms (frio, comando inteiro); iguais bit a bit: ${iguais.join(", ")}\n`);
  } finally { rmSync(pasta, { recursive: true, force: true }); }
});

type Evento = Record<string, any>;
/** A prévia em --observar: junta as linhas JSON do stdout e deixa esperar pelo próximo evento que satisfaz `f`. */
function observar(argv: string[], env: Record<string, string>) {
  const p = spawn(process.execPath, [PREVIA, ...argv], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
  const eventos: Evento[] = [];
  let erro = "", resto = "";
  const esperando: { f: (e: Evento) => boolean; ok: (e: Evento) => void; desde: number }[] = [];
  p.stderr.on("data", (d) => { erro += d; });
  p.stdout.on("data", (d) => {
    const partes = (resto + d).split("\n"); resto = partes.pop()!;
    for (const l of partes) {
      const e = JSON.parse(l);
      eventos.push(e);
      for (const w of [...esperando]) if (w.f(e)) { esperando.splice(esperando.indexOf(w), 1); w.ok(e); }
    }
  });
  const fim = new Promise<number | null>((ok) => p.on("close", (c) => ok(c)));
  const proximo = (f: (e: Evento) => boolean, ms = 60000) => new Promise<Evento>((ok, falha) => {
    const relogio = setTimeout(() => falha(new Error(`evento não chegou em ${ms} ms; stderr:\n${erro.slice(-2000)}`)), ms);
    esperando.push({ f, ok: (e) => { clearTimeout(relogio); ok(e); }, desde: eventos.length });
  });
  return { p: p as ChildProcess, eventos, proximo, fim, erro: () => erro };
}

function pedir(url: string, host?: string, extra: Record<string, string> = {}): Promise<{ status: number; corpo: Buffer; tipo: string }> {
  return new Promise((ok, falha) => {
    const u = new URL(url);
    const req = request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { ...(host ? { host } : {}), ...extra } }, (res) => {
      const partes: Buffer[] = [];
      res.on("data", (d) => partes.push(d));
      res.on("end", () => ok({ status: res.statusCode!, corpo: Buffer.concat(partes), tipo: String(res.headers["content-type"]) }));
    });
    req.on("error", falha);
    req.end();
  });
}
const hash = (arquivo: string) => createHash("sha256").update(readFileSync(arquivo)).digest("hex");

test("--observar: refaz na mudança (quente depois do primeiro), página no loopback, R03 e nada sobra ao parar", { skip: semPlaca }, async () => {
  const pasta = mkdtempSync(join(tmpdir(), "previa-teste-"));
  // TMPDIR só deste teste: os outros arquivos de teste renderizam em paralelo e criam motor-* no /tmp comum.
  const tmp = mkdtempSync(join(tmpdir(), "previa-tmp-"));
  const marca = randomUUID();
  const comp = join(pasta, "comp"), saida = join(pasta, "saida");
  cpSync(SINTETICA, comp, { recursive: true });
  let o: ReturnType<typeof observar> | null = null;
  try {
    const render = quadrosDoRender(pasta, [10, 30, 45]);
    o = observar([comp, ID, "--observar", "--quadro", "30,45", "--servir", "--placa", "--sem-contencao", "--saida", saida],
      { TMPDIR: tmp, MOTOR_TESTE_PREVIA: marca });
    const { url } = await o.proximo((e) => e.evento === "pagina");
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const v1 = await o.proximo((e) => e.evento === "quadros" || e.evento === "erro");
    assert.equal(v1.evento, "quadros", JSON.stringify(v1));
    assert.equal(v1.versao, 1);
    assert.equal(v1.quente, false, "o primeiro abre frio");
    const iguais = [confere(join(saida, "quadro-30.png"), render.get(30)!, "frio, quadro 30"), confere(join(saida, "quadro-45.png"), render.get(45)!, "frio, quadro 45")];
    const h1 = hash(join(saida, "quadro-30.png"));

    // A página: só GET e só com o Host do loopback.
    const pagina = await pedir(url);
    assert.equal(pagina.status, 200);
    assert.match(pagina.corpo.toString(), /EventSource\('\/eventos'\)/);
    assert.equal((await pedir(url, "example.com")).status, 403, "Host de fora");
    assert.equal((await pedir(`${url}quadro/5.png`, undefined, { "sec-fetch-site": "cross-site" })).status, 403, "pedido de outra página");
    const q = await pedir(`${url}quadro/30.png`);
    assert.equal(q.status, 200);
    assert.equal(q.tipo, "image/png");
    assert.deepEqual(q.corpo, readFileSync(join(saida, "quadro-30.png")), "o quadro da lista vem do arquivo, sem render");

    // Mudança sem efeito na imagem (um comentário): refaz, agora quente, com o mesmo quadro (R03 quente × frio).
    writeFileSync(join(comp, "index.html"), `${readFileSync(join(comp, "index.html"), "utf8")}\n<!-- mudança -->\n`);
    const v2 = await o.proximo((e) => e.evento === "quadros" && e.versao >= 2);
    assert.equal(v2.quente, true, `o segundo usa a reserva quente: ${o.erro().slice(-1500)}`);
    iguais.push(confere(join(saida, "quadro-30.png"), render.get(30)!, "quente, quadro 30"));
    // O quadro avulso da página (fora da lista), também pela reserva. Antes, o tempo de a reserva seguinte abrir
    // (~1,2 s): mede o quente assentado, o caso de quem edita e olha, não o de duas mudanças coladas.
    await new Promise((ok) => setTimeout(ok, 2500));
    const t0 = performance.now();
    const avulso = await pedir(`${url}quadro/10.png?v=${v2.versao}`);
    const msAvulso = Math.round(performance.now() - t0);
    assert.equal(avulso.status, 200);
    const pa = join(pasta, "avulso-10.png");
    writeFileSync(pa, avulso.corpo);
    iguais.push(confere(pa, render.get(10)!, "avulso, quadro 10"));

    // Mudança de verdade (o fundo): o quadro muda.
    writeFileSync(join(comp, "index.html"), readFileSync(join(comp, "index.html"), "utf8").replace("background: #10163a", "background: #3a1610"));
    const v3 = await o.proximo((e) => e.evento === "quadros" && e.versao > v2.versao);
    assert.notEqual(hash(join(saida, "quadro-30.png")), h1, "o fundo mudou e o quadro não");
    const f = dePng(readFileSync(join(saida, "quadro-30.png")));
    const i = (300 * f.largura + 900) * 4;
    assert.deepEqual([...f.bgra.subarray(i, i + 3)], [0x10, 0x16, 0x3a], "fundo novo (BGR) num canto sem animação");
    process.stderr.write(`prévia --observar: frio ${v1.ms} ms, quente ${v2.ms} ms e ${v3.ms} ms (2 quadros), avulso quente ${msAvulso} ms (pela página); iguais bit a bit: ${iguais.join(", ")}\n`);

    // Parar no meio de um render, com outro na fila: sai com 0, o da fila não sobe e não sobra processo nem temporária.
    const html = join(comp, "index.html");
    writeFileSync(html, `${readFileSync(html, "utf8")}\n<!-- 1 -->\n`);
    await new Promise((ok) => setTimeout(ok, 500));
    writeFileSync(html, `${readFileSync(html, "utf8")}\n<!-- 2 -->\n`);
    await new Promise((ok) => setTimeout(ok, 250));
    o.p.kill("SIGTERM");
    assert.equal(await o.fim, 0, o.erro().slice(-1500));
    assert.deepEqual(marcados(marca), [], "processo que sobrou da prévia");
    assert.deepEqual(readdirSync(tmp), [], "pasta temporária que sobrou");
    assert.deepEqual(readdirSync(saida).sort(), ["quadro-30.png", "quadro-45.png"], "a saída fica, sem parcial");
    o = null;
  } finally {
    if (o) { o.p.kill("SIGKILL"); await o.fim; }
    for (const pid of marcados(marca)) { try { process.kill(pid, "SIGKILL"); } catch {} }
    rmSync(pasta, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
});
