// Conferência automática dos quadros (S04): confere numa composição, sem renderizar o vídeo, as regras do conjunto único
// (bench-gerador/especificacoes.json, campo `conferencia`: G15 texto fora do rosto, G17 legenda numa linha, G19 zona
// segura com destino declarado, G20 contraste sobre o fundo real, G21 zoom até o fim da frase, tremor), pelos motores do
// Kodecz Bench, e aponta o quadro, o texto e o motivo de cada quebra.
//
//   node cli/conferir.ts <entrada> <composição> [<entrada> <composição> …] [--falas arquivo.json] [--saida pasta]
//                        [--amostra 10] [--manter] [--dados] [--sem-contencao]
//   (node cli/conferir.ts --ajuda)
//
// Passos, por composição: o Electron da conferência (conferencia/coletar.ts, sempre na CPU, separado do render) abre
// a página e lê o DOM em todo quadro (texto, legenda, faixa, caixa do apresentador); as regras acham os punch-ins pela
// escala do apresentador; nos quadros amostrados, o quadro limpo (só o apresentador) vai ao YuNet (conferencia/rosto.ts);
// a cada segundo, o quadro com o texto transparente dá o fundo real de cada texto (G20); as regras
// (conferencia/conferir.ts) cruzam tudo com as falas (window.motor_falas ou --falas) e o destino (data-destino no
// <html>); por fim, uma foto por quebra, com as caixas desenhadas. Formato da saída em docs/formatos/conferencia.md.
//
// Saída: <pasta>/conferencia.json e <pasta>/<composição>-<regra>-<quadro>.png; no stdout, uma linha JSON com o resumo.
// Códigos: 0 sem falha (pode ter aviso); 1 erro; 2 argumentos; 4 regra quebrada; 128 + sinal se interrompido.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { spawnSync, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { CAMINHOS, ErroDeUso, lerDeclaracao, SEM_REMOTION, type Declaracao } from "./regras.ts";
import { OPCOES_CONFERIR, traduzirOpcoes } from "./nomes.ts";
import { Recursos } from "./processos.ts";
// @ts-ignore: módulo .mjs sem tipos
import { prefixoContencao } from "../ferramentas/contencao.mjs";
import { escalasDoApresentador, LIMITES, quadrosAmostrados, rostoRelativo, zooms, type Amostra, type Caixa, type Falha, type Fundo,
  type Geometria } from "../conferencia/regras.ts";
import { conferir, destinoDe, regrasDaConferencia } from "../conferencia/conferir.ts";
import { codigoNaConferencia, situacaoNaConferencia } from "../bench-gerador/mutacoes.ts";
import { lerFalas } from "../conferencia/falas.ts";
import { conferirModelo, Detector } from "../conferencia/rosto.ts";

const COLETAR = new URL("../conferencia/coletar.ts", import.meta.url).pathname;
const LARGURA_LIMPO = 640;
const MAX_FOTOS = 30;
const avisar = (texto: string) => process.stderr.write(`conferência: ${texto}\n`);

export const USO = `usage: kodecz check <folder> <composition> [<folder> <composition> …] [options]
       (same as: node cli/conferir.ts <folder> <composition> … [options])

Checks every frame of the page without rendering the video, with the rules marked «conferencia» in
bench-gerador/especificacoes.json: G15 (text off the face), G17 (captions on one line), G19 (safe area, only with
data-destino reels, instagram, anuncio, tiktok or shorts on <html>), G20 (contrast over the real background), G21
(zoom that ends with the sentence) and the shake warning.
<folder> is the composition (index.html with the id="kodecz" block); <composition>, its id.
Several pairs at once (G04: 16:9 and 9:16).

options:
  --speech file.json    speech timing, [{ t, ini, fim, bloco }], over the page's window.motor_falas
  --out dir             where conferencia.json and the pictures go (default tmp/conferencia)
  --sample K            look for the face every K frames with the presenter (default ${LIMITES.amostraRosto})
  --keep                keep the temporary folder (clean frames, geometry)
  --data                write <composition>-dados.json to the output (geometry, faces, speech, destination and
                        backgrounds), to calibrate the limits again without collecting (conferencia/conferir.ts)
  --no-containment      no nice/ionice/CPU cap (default: contained, ferramentas/contencao.mjs)
  -h, --help            this help

The original Portuguese names still work (deprecated): --falas, --saida, --amostra, --manter, --dados,
--sem-contencao, --ajuda.

Setup (once, online): node conferencia/preparar.ts (face model in a cache, checked by hash) and
npm ci --ignore-scripts in conferencia/. Roles in the page: data-papel="apresentador|legenda|faixa" (G41).
Exit code 0 no problem, 1 error, 2 usage, 4 a rule is broken.`;

export type ArgumentosConferir = {
  pares: { pasta: string; declaracao: Declaracao }[]; falas: string | null; saida: string; amostra: number;
  manter: boolean; dados: boolean; contencao: boolean;
};

/** Lê os argumentos (sem o `node` e o script). Lança ErroDeUso com a correção. */
export function lerArgumentosConferir(argv: string[]): ArgumentosConferir {
  let r;
  try {
    r = parseArgs({ args: traduzirOpcoes(argv, OPCOES_CONFERIR), allowPositionals: true, strict: true, options: {
      falas: { type: "string" }, saida: { type: "string" }, amostra: { type: "string" }, manter: { type: "boolean" }, dados: { type: "boolean" },
      "sem-contencao": { type: "boolean" }, ajuda: { type: "boolean", short: "h" },
    } });
  } catch (e) { throw new ErroDeUso(`${(e as Error).message}\n${USO}`); }
  const o = r.values;
  if (o.ajuda) throw new ErroDeUso(USO, 0);
  const p = r.positionals;
  if (!p.length || p.length % 2) throw new ErroDeUso(`passe pares <entrada> <composição>\n${USO}`);
  const pares = [];
  for (let i = 0; i < p.length; i += 2) {
    const pasta = resolve(p[i]), id = p[i + 1];
    const html = join(pasta, "index.html");
    if (!existsSync(html)) throw new ErroDeUso(`${pasta}: falta index.html (a conferência abre a composição em linha do tempo declarada, docs/formatos/linha-do-tempo.md)`);
    const declaracao = lerDeclaracao(readFileSync(html, "utf8"));
    if (!declaracao) throw new ErroDeUso(`${pasta}: o index.html não tem o bloco <script id="kodecz">; se é um pacote do Remotion, ${SEM_REMOTION}`);
    if (declaracao.id !== id) throw new ErroDeUso(`${pasta}: a composição é «${declaracao.id}», não «${id}»`);
    pares.push({ pasta, declaracao });
  }
  let falas: string | null = null;
  if (o.falas !== undefined) {
    falas = resolve(o.falas);
    if (!existsSync(falas)) throw new ErroDeUso(`--falas: arquivo não existe: ${falas}`);
  }
  const amostra = o.amostra === undefined ? LIMITES.amostraRosto : Number(o.amostra);
  if (!Number.isInteger(amostra) || amostra < 1) throw new ErroDeUso(`--amostra tem de ser inteiro ≥ 1: ${o.amostra}`);
  return { pares, falas, saida: resolve(o.saida ?? join("tmp", "conferencia")), amostra, manter: o.manter === true, dados: o.dados === true, contencao: !o["sem-contencao"] };
}

/** O Electron da coleta, com um canal de comandos (uma linha JSON de ida, uma «conf {…}» de volta). `extra`: scripts de
 * página a mais (conferencia/coletar.ts), usados pelo Kodecz Bench (bench/). */
export class Coleta {
  p: ChildProcess;
  respostas: ((r: any) => void)[] = [];
  log: string[] = [];
  fim: Promise<number | null>;

  constructor(r: Recursos, a: Pick<ArgumentosConferir, "contencao">, par: ArgumentosConferir["pares"][number], extra: string[] = []) {
    const env = { ...process.env as Record<string, string>, CUDA_VISIBLE_DEVICES: "",
      CONF_PEDIDO: JSON.stringify({ pasta: par.pasta, declaracao: par.declaracao, opacidadeMin: LIMITES.opacidadeMin, extra }) };
    // Como o modo CPU do render: a placa escondida (bwrap) e o desenho por software. A conferência não usa a placa.
    const flags = ["--ozone-platform=headless", "--ozone-override-screen-size=8192,8192", "--disable-gpu", "--disable-gpu-compositing",
      "--enable-unsafe-swiftshader"];
    let prefixo: string[] = [];
    if (spawnSync("sh", ["-c", "command -v bwrap"], { stdio: "ignore" }).status === 0) {
      prefixo = ["bwrap", "--dev-bind", "/", "/", "--dev", "/dev", "--bind", "/dev/shm", "/dev/shm", "--"];
    }
    if (a.contencao) prefixo = [...prefixoContencao(), ...prefixo];
    if (!existsSync(CAMINHOS.electronCpu)) throw new Error(`falta o Electron (${CAMINHOS.electronCpu}): npm ci em captura/`);
    const comando = [...prefixo, CAMINHOS.electronCpu, COLETAR, "--no-sandbox", ...flags];
    this.p = r.iniciar(comando[0], comando.slice(1), { env, stdio: ["pipe", "pipe", "pipe"] });
    createInterface({ input: this.p.stdout! }).on("line", (l) => {
      if (!l.startsWith("conf ")) { this.log.push(l); return; }
      const resposta = JSON.parse(l.slice(5));
      const quem = this.respostas.shift();
      if (quem) quem(resposta); else this.log.push(l);
    });
    createInterface({ input: this.p.stderr! }).on("line", (l) => {
      this.log.push(l);
      if (process.env.MOTOR_DEPURAR === "1") process.stderr.write(`  electron: ${l}\n`);
    });
    this.fim = new Promise((ok) => this.p.on("close", (c) => {
      ok(c);
      for (const q of this.respostas.splice(0)) q({ erro: `o Electron da conferência saiu (${c}):\n${this.log.filter((l) => !l.startsWith("[")).slice(-8).join("\n")}` });
    }));
  }

  /** A próxima resposta (a primeira é o «pronto»). */
  esperar(limiteMs = 120000): Promise<any> {
    return new Promise((ok, falha) => {
      const relogio = setTimeout(() => falha(new Error(`o Electron da conferência não respondeu em ${limiteMs / 1000} s`)), limiteMs);
      this.respostas.push((r) => { clearTimeout(relogio); if (r.erro) falha(new Error(r.erro)); else ok(r); });
    });
  }

  pedir(cmd: Record<string, unknown>, limiteMs = 600000) {
    const r = this.esperar(limiteMs);
    this.p.stdin!.write(`${JSON.stringify(cmd)}\n`);
    return r;
  }
}

type Resultado = ReturnType<typeof conferir> & { id: string; entrada: string; falas: number; origemFalas: string | null;
  quadrosComApresentador: number; amostras: { quadros: number; comRosto: number }; fotos: string[]; tempos: Record<string, number> };

async function conferirUma(a: ArgumentosConferir, par: ArgumentosConferir["pares"][number], r: Recursos, detector: Detector, tmp: string): Promise<Resultado> {
  const d = par.declaracao;
  const tempos: Record<string, number> = {};
  let t = performance.now();
  const marcar = (nome: string) => { tempos[nome] = Math.round(performance.now() - t); t = performance.now(); };
  const coleta = new Coleta(r, a, par);
  try {
    const pronto = await coleta.esperar();
    if (pronto.tamanho?.[0] !== d.largura || pronto.tamanho?.[1] !== d.altura) {
      throw new Error(`a janela da conferência ficou ${pronto.tamanho?.join("×")}, não ${d.largura}×${d.altura}`);
    }
    marcar("abrir");
    let falas, origemFalas: string | null = null;
    try {
      if (a.falas) { falas = lerFalas(JSON.parse(readFileSync(a.falas, "utf8"))); origemFalas = "arquivo"; }
      else { falas = lerFalas(pronto.falas); origemFalas = pronto.falas ? "pagina" : null; }
    } catch (e) { throw new Error(`${d.id}: ${(e as Error).message}`); }

    // 1. Geometria em todo quadro.
    const arquivo = join(tmp, `${d.id}-geometria.jsonl`);
    await coleta.pedir({ cmd: "geometria", de: 0, ate: d.quadros, arquivo });
    const geometrias: Geometria[] = readFileSync(arquivo, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    marcar("geometria");

    // 2. Rosto nos quadros limpos amostrados.
    const zs = zooms(escalasDoApresentador(geometrias));
    const amostrados = quadrosAmostrados(geometrias, zs, a.amostra);
    const rostos: Amostra[] = [];
    if (amostrados.length) {
      const pasta = join(tmp, `${d.id}-limpos`);
      mkdirSync(pasta, { recursive: true });
      const largura = Math.min(LARGURA_LIMPO, d.largura);
      const res = await coleta.pedir({ cmd: "limpos", quadros: amostrados, pasta, largura });
      marcar("limpos");
      const [l, h] = res.tamanho as [number, number];
      const ex = d.largura / l, ey = d.altura / h;
      for (const n of amostrados) {
        const px = new Uint8Array(readFileSync(join(pasta, `${n}.bgra`)));
        const achados = await detector.detectar(px, l, h, 4);
        // O apresentador é um só: o maior rosto do quadro limpo.
        const maior = achados.sort((x, y) => y.caixa[2] * y.caixa[3] - x.caixa[2] * x.caixa[3])[0];
        const ap = geometrias[n].apresentador;
        rostos.push({ n, rel: maior && ap ? rostoRelativo([maior.caixa[0] * ex, maior.caixa[1] * ey, maior.caixa[2] * ex, maior.caixa[3] * ey], ap) : null });
      }
      marcar("rosto");
    }

    // 3. Fundo real dos textos (G20), a cada segundo, se a regra de contraste roda.
    let fundos: Fundo[] | undefined;
    if (regrasDaConferencia().some((e) => e.regra.medida === "contraste" && !["desligada", "rodada"].includes(situacaoNaConferencia(e)))) {
      const quadros = Array.from({ length: Math.ceil(d.quadros / d.qps) }, (_, i) => i * d.qps).filter((n) => n < d.quadros);
      const arq = join(tmp, `${d.id}-fundos.json`);
      await coleta.pedir({ cmd: "fundos", quadros, largura: Math.min(LARGURA_LIMPO, d.largura), minimo: LIMITES.opacidadeLegivel, arquivo: arq });
      fundos = JSON.parse(readFileSync(arq, "utf8"));
      marcar("fundos");
    }

    // 4. Regras.
    const comp = { id: d.id, largura: d.largura, altura: d.altura, qps: d.qps, quadros: d.quadros };
    const destino = destinoDe(pronto.destino);
    if (a.dados) writeFileSync(join(a.saida, `${d.id}-dados.json`), JSON.stringify({ comp, geometrias, rostos, falas, destino, fundos }));
    const resultado = conferir({ comp, geometrias, rostos, falas, destino, fundos });

    // 5. Uma foto por quebra (o pior quadro, com as caixas: vermelho = texto, amarelo = rosto com a margem, azul = apresentador).
    const fotos: string[] = [];
    const itens = [];
    const vistas = new Set<string>();
    for (const f of resultado.falhas as (Falha & { imagem?: string })[]) {
      const nome = `${d.id}-${f.regra}-${f.pior}.png`;
      f.imagem = nome;
      if (vistas.has(nome) || vistas.size >= MAX_FOTOS) continue;
      vistas.add(nome);
      const marcas: { caixa: Caixa; cor: string }[] = [];
      const ap = geometrias[f.pior]?.apresentador;
      if (f.regra === "G21" && ap) marcas.push({ caixa: ap, cor: "#3c8cff" });
      if (f.caixa) marcas.push({ caixa: f.caixa, cor: "#ff2020" });
      if (f.rosto) {
        const m = LIMITES.margemRosto, [x, y, w, h] = f.rosto;
        marcas.push({ caixa: [x - w * m.lados, y - h * m.cima, w * (1 + 2 * m.lados), h * (1 + m.cima + m.baixo)], cor: "#ffd400" });
      }
      itens.push({ n: f.pior, marcas, arquivo: join(a.saida, nome) });
      fotos.push(nome);
    }
    if (itens.length) await coleta.pedir({ cmd: "fotos", itens });
    marcar("fotos");
    await coleta.pedir({ cmd: "sair" }, 10000).catch(() => {});
    return { id: d.id, entrada: par.pasta, destino, ...resultado, falas: falas.length, origemFalas,
      quadrosComApresentador: geometrias.filter((g) => g.apresentador).length,
      amostras: { quadros: amostrados.length, comRosto: rostos.filter((x) => x.rel).length }, fotos, tempos };
  } finally {
    try { coleta.p.stdin!.end(); } catch {}
  }
}

async function principal() {
  let a: ArgumentosConferir;
  try { a = lerArgumentosConferir(process.argv.slice(2)); } catch (erro) {
    if (erro instanceof ErroDeUso) {
      (erro.codigo === 0 ? process.stdout : process.stderr).write(`${erro.codigo === 0 ? "" : "erro: "}${erro.message}\n`);
      process.exit(erro.codigo);
    }
    throw erro;
  }
  const r = new Recursos({ manter: a.manter });
  r.aoSinal();
  const t0 = performance.now();
  try {
    const modelo = conferirModelo();
    if (modelo) throw new Error(modelo);
    mkdirSync(a.saida, { recursive: true });
    const tmp = r.pasta("motor-conferencia-");
    if (a.manter) avisar(`temporária ${tmp}`);
    const detector = await Detector.abrir();
    const composicoes = [];
    for (const par of a.pares) {
      avisar(`conferindo «${par.declaracao.id}» (${par.declaracao.largura}×${par.declaracao.altura}, ${par.declaracao.quadros} quadros)`);
      composicoes.push(await conferirUma(a, par, r, detector, tmp));
    }
    await detector.fechar();
    // Uma contagem por regra que acusa falha (situação automática), mesmo zerada.
    const conta = (regra: string) => composicoes.reduce((s, c) => s + c.falhas.filter((f) => f.regra === regra).length, 0);
    const codigos = [...new Set([...regrasDaConferencia().filter((e) => situacaoNaConferencia(e).startsWith("automatica")).map((e) => codigoNaConferencia(e)!),
      ...composicoes.flatMap((c) => c.falhas.map((f) => f.regra))])].sort();
    const falhas = Object.fromEntries(codigos.map((k) => [k, conta(k)]));
    const ok = Object.values(falhas).every((n) => !n);
    const relatorio = { versao: 2, ok, limites: LIMITES, composicoes, parede: Number(((performance.now() - t0) / 1000).toFixed(2)) };
    writeFileSync(join(a.saida, "conferencia.json"), `${JSON.stringify(relatorio, null, 2)}\n`);
    for (const c of composicoes) {
      for (const f of c.falhas) avisar(`${c.id}: falha ${f.regra}, quadros ${f.de}–${f.ate} (pior ${f.pior})${f.texto ? `, «${f.texto}»` : ""}: ${f.motivo}`);
      for (const v of c.avisos) avisar(`${c.id}: aviso ${v.regra}: ${v.motivo}`);
    }
    await r.liberar();
    process.stdout.write(`${JSON.stringify({ ok, falhas, avisos: composicoes.reduce((s, c) => s + c.avisos.length, 0), pasta: a.saida,
      parede: relatorio.parede })}\n`);
    process.exitCode = ok ? 0 : 4;
  } catch (erro) {
    await r.liberar();
    process.stderr.write(`erro: ${(erro as Error).message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await principal();
