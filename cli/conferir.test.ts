// Testes do comando de conferência (S04): argumentos (sem Electron) e a conferência das composições sintéticas de
// conferencia/fixtures/ (Electron na CPU, YuNet): duas que passam (apresentador em <img> e em <video>) e uma por regra
// que falha, cada uma pela regra certa.
// A integração é pulada, com o motivo, sem o Electron de captura/, o modelo ou o retrato de teste (node conferencia/preparar.ts).
// Rodar: node --test "cli/conferir.test.ts"
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAMINHOS, ErroDeUso } from "./regras.ts";
import { lerArgumentosConferir } from "./conferir.ts";
import { conferirModelo } from "../conferencia/rosto.ts";
import { RETRATO, retratoNasFixtures } from "../conferencia/preparar.ts";

const CLI = new URL("./conferir.ts", import.meta.url).pathname;
const FIX = new URL("../conferencia/fixtures/", import.meta.url).pathname;
const pasta = mkdtempSync(join(tmpdir(), "s04-teste-"));
after(() => rmSync(pasta, { recursive: true, force: true }));

const falha = (re: RegExp, ...a: string[]) =>
  assert.throws(() => lerArgumentosConferir(a), (e: unknown) => e instanceof ErroDeUso && e.codigo === 2 && re.test(e.message));

test("argumentos: pares de entrada e composição, opções e recusas", () => {
  const a = lerArgumentosConferir([join(FIX, "passa"), "ConfPassa", join(FIX, "zoom-cedo"), "ConfZoomCedo", "--amostra", "5"]);
  assert.deepEqual(a.pares.map((p) => p.declaracao.id), ["ConfPassa", "ConfZoomCedo"]);
  assert.equal(a.amostra, 5);
  assert.equal(a.contencao, true);
  assert.equal(a.dados, false);
  assert.match(a.saida, /tmp\/conferencia$/);
  assert.equal(lerArgumentosConferir([join(FIX, "passa"), "ConfPassa", "--dados"]).dados, true);
  falha(/pairs/, join(FIX, "passa"));
  falha(/is «ConfPassa», not «Outra»/, join(FIX, "passa"), "Outra");
  falha(/no index\.html/, pasta, "X");
  falha(/--sample/, join(FIX, "passa"), "ConfPassa", "--amostra", "0");
  falha(/--speech: file not found/, join(FIX, "passa"), "ConfPassa", "--falas", join(pasta, "nada.json"));
  const pacote = join(pasta, "pacote");
  spawnSync("mkdir", [pacote]);
  writeFileSync(join(pacote, "index.html"), "<!doctype html>");
  falha(/Remotion projects are no longer accepted/, pacote, "X");
  assert.throws(() => lerArgumentosConferir(["--ajuda"]), (e: unknown) => e instanceof ErroDeUso && e.codigo === 0);
});

const motivo = !existsSync(CAMINHOS.electronCpu) ? `falta o Electron (${CAMINHOS.electronCpu})`
  : conferirModelo() ?? (existsSync(RETRATO.reduzido) ? null : "falta o retrato de teste: node conferencia/preparar.ts");
if (!motivo) retratoNasFixtures();

const temporarias = () => readdirSync(tmpdir()).filter((n) => n.startsWith("motor-conferencia-"));
function rodar(...args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--sem-contencao"], { encoding: "utf8", timeout: 180000 });
  const linhas = r.stdout.trim().split("\n");
  return { codigo: r.status, resumo: linhas.length && linhas.at(-1) ? JSON.parse(linhas.at(-1)!) : null, stderr: r.stderr };
}

test("integração: uma que passa e uma por regra que falha, cada uma só pela regra dela", { skip: motivo ?? false }, () => {
  const antes = temporarias();
  const saida = join(pasta, "todas");
  const r = rodar(join(FIX, "passa"), "ConfPassa", join(FIX, "rosto-no-zoom"), "ConfRostoNoZoom", join(FIX, "duas-linhas"), "ConfDuasLinhas",
    join(FIX, "zoom-cedo"), "ConfZoomCedo", join(FIX, "video-passa"), "ConfVideoPassa", "--saida", saida);
  assert.equal(r.codigo, 4, r.stderr);
  assert.deepEqual(r.resumo.falhas, { G15: 1, G17: 1, G19: 0, G21: 1 });
  assert.equal(r.resumo.avisos, 0, r.stderr);
  const rel = JSON.parse(readFileSync(join(saida, "conferencia.json"), "utf8"));
  assert.equal(rel.versao, 2);
  assert.deepEqual(rel.composicoes[0].regras.map((x: any) => [x.regra, x.classe, x.situacao]), [["G15", "K-DES-08", "automatica"],
    ["G17", "G17", "automatica"], ["G19", "K-PLA-01", "automatica"], ["G20", "K-COR-01", "aviso"], ["G21", "G21", "automatica"], ["tremor", "tremor", "aviso"]]);
  const c = Object.fromEntries(rel.composicoes.map((x: any) => [x.id, x]));

  // Passa: 0 falhas, 0 avisos; o punch-in foi visto e o rosto achado em todas as amostras.
  assert.deepEqual(c.ConfPassa.falhas, []);
  assert.deepEqual(c.ConfPassa.avisos, []);
  assert.equal(c.ConfPassa.zooms.length, 1);
  assert.equal(c.ConfPassa.amostras.comRosto, c.ConfPassa.amostras.quadros);
  assert.equal(c.ConfPassa.origemFalas, "pagina");
  assert.equal(c.ConfPassa.quadrosComApresentador, 90);

  // Apresentador em <video> (P10.5), só nos quadros 10 a 79, com o rosto andando no take: passa, rosto em toda amostra.
  assert.deepEqual(c.ConfVideoPassa.falhas, []);
  assert.deepEqual(c.ConfVideoPassa.avisos, []);
  assert.equal(c.ConfVideoPassa.quadrosComApresentador, 70);
  assert.ok(c.ConfVideoPassa.amostras.quadros >= 7);
  assert.equal(c.ConfVideoPassa.amostras.comRosto, c.ConfVideoPassa.amostras.quadros);

  // G15: o chip cai no rosto só no zoom (quadros 31 a 65 do punch-in; em repouso, fica ao lado).
  const g15 = c.ConfRostoNoZoom.falhas;
  assert.deepEqual(g15.map((f: any) => [f.regra, f.texto, f.papel]), [["G15", "Novo", null]]);
  const z = c.ConfRostoNoZoom.zooms[0];
  assert.ok(g15[0].de > z.entrada && g15[0].ate < z.saida + 6, JSON.stringify([g15[0].de, g15[0].ate, z]));
  assert.ok(existsSync(join(saida, g15[0].imagem)));

  // G17: a legenda quebra em duas linhas enquanto está na tela (quadros 20 a 69).
  assert.deepEqual(c.ConfDuasLinhas.falhas.map((f: any) => [f.regra, f.de, f.ate, f.motivo]), [["G17", 20, 69, "caption on 2 lines"]]);

  // G21: o zoom volta por duração fixa, 567 ms antes do fim da frase.
  const g21 = c.ConfZoomCedo.falhas;
  assert.equal(g21.length, 1);
  assert.equal(g21[0].regra, "G21");
  assert.match(g21[0].motivo, /zoom returns 567 ms before the end of the sentence «Isto muda tudo, de verdade\.»/);

  // Nada sobra: nem pasta temporária, nem processo (o grupo do Electron morre na liberação).
  assert.deepEqual(temporarias().filter((n) => !antes.includes(n)), []);
});

test("integração: destino Reels no <html> liga a zona segura (G19); contraste sobre o fundo real (G20)", { skip: motivo ?? false }, () => {
  const saida = join(pasta, "destino");
  const r = rodar(join(FIX, "destino-contraste"), "ConfDestinoContraste", "--saida", saida);
  assert.equal(r.codigo, 4, r.stderr);
  assert.deepEqual(r.resumo.falhas, { G15: 0, G17: 0, G19: 1, G21: 0 });
  const c = JSON.parse(readFileSync(join(saida, "conferencia.json"), "utf8")).composicoes[0];
  assert.equal(c.destino, "reels");
  const g19 = c.falhas.find((f: any) => f.regra === "G19"), g20 = c.avisos.filter((f: any) => f.regra === "G20");
  assert.deepEqual([g19.de, g19.ate, g19.texto], [0, 59, "Rodapé embaixo da interface"]);
  // G20 é aviso na conferência; só o texto claro na placa: o tapado e o que fica sob a camada semitransparente, não.
  assert.deepEqual(g20.map((a: any) => [a.de, a.ate, a.texto]), [[0, 30, "Texto claro demais"]]);
  assert.match(g20[0].motivo, /contraste 1,9\d:1 sobre o fundo real \(mínimo 3:1 para texto grande\)/);
});

test("integração: só a que passa sai com 0; --falas por cima da página muda o fim da frase", { skip: motivo ?? false }, () => {
  const ok = rodar(join(FIX, "passa"), "ConfPassa", "--saida", join(pasta, "passa"));
  assert.equal(ok.codigo, 0, ok.stderr);
  assert.equal(ok.resumo.ok, true);
  // A mesma composição do zoom cedo, com a frase acabando em 1,9 s (antes da saída em 58/30 s): passa.
  const falas = join(pasta, "falas.json");
  writeFileSync(falas, JSON.stringify([{ t: "Isto", ini: 0.5, fim: 0.8, bloco: 1 }, { t: "muda", ini: 0.8, fim: 1.2, bloco: 1 },
    { t: "tudo.", ini: 1.2, fim: 1.9, bloco: 1 }, { t: "Veja.", ini: 3.2, fim: 3.6, bloco: 2 }]));
  const outra = rodar(join(FIX, "zoom-cedo"), "ConfZoomCedo", "--falas", falas, "--saida", join(pasta, "falas"));
  assert.equal(outra.codigo, 0, outra.stderr);
  const rel = JSON.parse(readFileSync(join(pasta, "falas", "conferencia.json"), "utf8"));
  assert.equal(rel.composicoes[0].origemFalas, "arquivo");
  // Falas inválidas derrubam com a palavra e o campo.
  writeFileSync(falas, JSON.stringify([{ t: "", ini: 0, fim: 1, bloco: 1 }]));
  const ruim = rodar(join(FIX, "zoom-cedo"), "ConfZoomCedo", "--falas", falas, "--saida", join(pasta, "ruim"));
  assert.equal(ruim.codigo, 1);
  assert.match(ruim.stderr, /word 0.*«t» is empty/);
});
