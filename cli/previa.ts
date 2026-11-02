// Prévia rápida (S07): o quadro solto em PNG e a recarga ao vivo enquanto a composição é escrita.
//
//   node cli/previa.ts <pasta> <composição> --quadro 30 [--saida x.png]       um quadro (ou 0,45,120: vários num render)
//   node cli/previa.ts <pasta> <composição> --observar [--quadro 0,45,120] [--servir [--porta N]] [--saida pasta]
//   (node cli/previa.ts --ajuda lista as opções)
//
// O quadro sai do próprio render (cli/render.ts --gravar, sem mexer no laço), então é o mesmo pixel do vídeo (R03): o
// render desenha só os quadros pedidos (o M04_ORDEM do captura/main.ts, com o N − 1 sem captura antes de cada salto,
// P10.4), grava o BGRA e a prévia o passa a PNG sem perda (cli/quadros.ts). Só a linha do tempo declarada (P10).
//
// --observar: refaz os quadros a cada mudança na pasta (fs.watch, em rajada vira um render só) e mantém um processo
// quente de reserva (`cli/render.ts --esperar --previa`, cli/abertura.ts): o primeiro render abre frio, os seguintes
// usam o navegador já aberto, e a próxima reserva abre no fim de cada render (docs/experimentos/2026-10-abertura-rapida.md,
// 4.3). Sem placa (ou com --cpu), todo render é frio. --servir sobe uma página em 127.0.0.1 com os quadros e um
// controle de N, que se atualiza sozinha a cada mudança. Ctrl+C (ou SIGTERM) para tudo: nada fica rodando nem sobra
// pasta temporária; os PNG da saída ficam.
//
// Saída: progresso no stderr; no stdout, uma linha JSON por render ({"evento":"quadros", ...} ou {"evento":"erro", ...};
// no quadro solto, só a do resultado; com --servir, antes, {"evento":"pagina","url":...}). Códigos do quadro solto: 0 ok;
// 1 o render falhou; 2 argumentos; 3 --placa sem placa; 128 + sinal se interrompido. O --observar sai com 0 ao parar. Formato em docs/formatos/previa.md.
import { type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CAMINHOS, ErroDeUso, lerDeclaracao, type Declaracao } from "./regras.ts";
import { OPCOES_PREVIA, traduzirOpcoes } from "./nomes.ts";
import { Recursos } from "./processos.ts";
import { paraPng } from "./quadros.ts";

const RENDER = new URL("./render.ts", import.meta.url).pathname;
/** Rajada de eventos do fs.watch (o editor grava em vários passos) vira um render só. */
const RAJADA_MS = 120;
const avisar = (texto: string) => process.stderr.write(`kodecz preview: ${texto}\n`);

export const USO = `usage: kodecz preview <folder> <composition> [options]
       (same as: node cli/previa.ts <folder> <composition> [options])

Frames of the composition as PNG, the same pixels as the render, without rendering the whole video.
<folder> is the composition (index.html with the id="kodecz" block); <composition>, the id declared in it.

  --frame <N | 0,45,120>  frames to make (default with --watch: the first, the middle and the last)
  --out <file.png | dir>  one frame: the PNG (default tmp/previa/<composition>/quadro-N.png); several, or
                 --watch: the folder, with quadro-N.png (default tmp/previa/<composition>)
  --watch        re-renders the frames on every change in the folder, with a warm browser; Ctrl+C stops
  --serve        with --watch: a page at http://127.0.0.1:<port>/ with the frames and a frame slider
  --port <N>     port of that page (default: a free one)
  --gpu | --cpu  render mode (default: the GPU, or the CPU when there is no NVIDIA GPU)
  --no-containment  passed to the render
  -h, --help     this help

The original Portuguese names still work (deprecated): --quadro, --saida, --observar, --servir, --porta, --placa,
--sem-contencao, --ajuda.`;

export type OpcoesPrevia = {
  pasta: string; composicao: string; declaracao: Declaracao; quadros: number[]; saida: string; arquivoUnico: boolean;
  observar: boolean; servir: boolean; porta: number; modo: "placa" | "cpu" | null; contencao: boolean;
};

/** Lê e confere os argumentos (sem o `node` e o script). Lança ErroDeUso com a correção. */
export function lerOpcoesPrevia(argv: string[]): OpcoesPrevia {
  let r;
  try {
    r = parseArgs({ args: traduzirOpcoes(argv, OPCOES_PREVIA), allowPositionals: true, strict: true, options: {
      quadro: { type: "string" }, saida: { type: "string" }, observar: { type: "boolean" }, servir: { type: "boolean" },
      porta: { type: "string" }, placa: { type: "boolean" }, cpu: { type: "boolean" }, "sem-contencao": { type: "boolean" },
      ajuda: { type: "boolean", short: "h" },
    } });
  } catch (e) {
    throw new ErroDeUso(`unknown option or missing value: ${(e as Error).message}\n\n${USO}`);
  }
  const { values: o, positionals: p } = r;
  if (o.ajuda) throw new ErroDeUso(USO, 0);
  if (p.length !== 2) throw new ErroDeUso(`expected 2 arguments (<folder> <composition>), got ${p.length}\n\n${USO}`);
  if (o.placa && o.cpu) throw new ErroDeUso("--gpu and --cpu together: pick one, or neither");
  if (o.servir && !o.observar) throw new ErroDeUso("--serve needs --watch");
  if (o.porta !== undefined && !o.servir) throw new ErroDeUso("--port needs --serve");
  const pasta = resolve(p[0]), composicao = p[1];
  const html = join(pasta, "index.html");
  if (!existsSync(html) || !statSync(pasta).isDirectory()) throw new ErroDeUso(`${pasta}: no index.html (a composition is a folder with index.html and the <script id="kodecz"> block)`);
  const declaracao = lerDeclaracao(readFileSync(html, "utf8"));
  if (!declaracao) throw new ErroDeUso(`${html} has no <script id="kodecz"> block (docs/formatos/linha-do-tempo.md)`);
  if (declaracao.id !== composicao) throw new ErroDeUso(`composition «${composicao}» not found in ${pasta}; the declared one is ${declaracao.id}`);
  let quadros: number[];
  if (o.quadro === undefined) {
    if (!o.observar) throw new ErroDeUso("missing --frame <N> (or --watch)");
    quadros = [0, Math.floor(declaracao.quadros / 2), declaracao.quadros - 1];
  } else {
    if (!/^\d+(,\d+)*$/.test(o.quadro)) throw new ErroDeUso(`--frame: a number or a comma-separated list, like 0,45,120: ${o.quadro}`);
    quadros = o.quadro.split(",").map(Number);
  }
  quadros = [...new Set(quadros)].sort((a, b) => a - b);
  const fora = quadros.filter((n) => n >= declaracao.quadros);
  if (fora.length) throw new ErroDeUso(`--frame ${fora.join(",")} is outside the composition (${declaracao.quadros} frames: 0 to ${declaracao.quadros - 1})`);
  const arquivoUnico = !o.observar && quadros.length === 1 && (o.saida ?? "").endsWith(".png");
  if (o.saida?.endsWith(".png") && !arquivoUnico) throw new ErroDeUso("--out x.png only works with one frame and without --watch; for several, give a folder");
  const saida = o.saida ? resolve(o.saida) : join(CAMINHOS.raiz, "tmp", "previa", composicao);
  if (o.observar && saida === pasta) throw new ErroDeUso("--out cannot be the watched folder itself (each PNG written would trigger another render): use a subfolder or another folder");
  let porta = 0;
  if (o.porta !== undefined) {
    porta = Number(o.porta);
    if (!/^\d+$/.test(o.porta) || porta < 1 || porta > 65535) throw new ErroDeUso(`--port must be from 1 to 65535: ${o.porta}`);
  }
  return { pasta, composicao, declaracao, quadros, saida, arquivoUnico, observar: o.observar === true, servir: o.servir === true, porta,
    modo: o.placa ? "placa" : o.cpu ? "cpu" : null, contencao: !o["sem-contencao"] };
}

/** Onde vai o PNG do quadro n. */
export const arquivoDoQuadro = (o: OpcoesPrevia, n: number, pasta = o.saida) => (o.arquivoUnico ? o.saida : join(pasta, `quadro-${n}.png`));

/** O que o cli/render.ts recebe para desenhar só `quadros` (em ordem crescente) e gravá-los em `gravar`. */
export function argumentosDoRender(o: OpcoesPrevia, quadros: number[], mp4: string, gravar: string): { argv: string[]; ordem: string | null } {
  const de = quadros[0], ate = quadros.at(-1)!;
  const argv = ["--sem-audio", "--de", String(de), "--quadros", String(ate - de + 1), "--gravar", quadros.join(","), "--gravar-pasta", gravar];
  if (o.modo) argv.push(`--${o.modo}`);
  if (!o.contencao) argv.push("--sem-contencao");
  argv.push("--", o.pasta, o.composicao, mp4);
  // Um quadro só, ou um trecho seguido: o trecho já é o pedido. Senão, a lista (sem desenhar o que fica entre eles).
  const seguido = ate - de + 1 === quadros.length;
  return { argv, ordem: seguido ? null : quadros.join(",") };
}

type Rodada = { codigo: number | null; json: any; erro: string };

/** Lê as linhas de um fluxo; `aoLer` recebe cada linha completa. */
function linhas(s: NodeJS.ReadableStream, aoLer: (l: string) => void) {
  let resto = "";
  s.on("data", (d) => { const partes = (resto + d).split("\n"); resto = partes.pop()!; partes.forEach(aoLer); });
  s.on("end", () => { if (resto) aoLer(resto); });
}

/** Espera o render acabar e junta o resultado (a última linha JSON do stdout) e o stderr. */
function colher(p: ChildProcess): Promise<Rodada> {
  return new Promise((ok) => {
    let json: any = null, erro = "";
    linhas(p.stdout!, (l) => { try { const j = JSON.parse(l); if (j && !j.evento) json = j; } catch {} });
    p.stderr!.on("data", (d) => { erro += d; if (process.env.MOTOR_DEPURAR === "1") process.stderr.write(d); });
    p.on("error", (e) => { erro += `did not start: ${e.message}\n`; });
    p.on("close", (codigo) => ok({ codigo, json, erro }));
  });
}

/**
 * Um processo quente de reserva (`cli/render.ts --esperar --previa`): abre a sonda, o weston e o navegador antes do
 * job. Atende um job e sai. Se não abrir (sem placa: sai com 3), `pronta` resolve false com o motivo.
 */
class Reserva {
  p: ChildProcess;
  pronta: Promise<boolean>;
  motivo = "";
  /** O código com que saiu antes do «pronto» (3: a placa não serve). */
  codigo: number | null = null;
  aberturaMs: Record<string, number> | null = null;
  /** O TMPDIR da reserva e dos filhos dela, apagado depois do job dela (ou na parada). */
  pasta: string;

  constructor(r: Recursos) {
    this.pasta = r.pasta("motor-previa-reserva-");
    const env = { ...process.env, TMPDIR: this.pasta };
    delete env.M04_ORDEM;
    this.p = r.iniciar(process.execPath, [RENDER, "--esperar", "--previa"], { env, stdio: ["pipe", "pipe", "pipe"] });
    let erro = "";
    const ouvirErro = (d: Buffer) => { erro += d; if (process.env.MOTOR_DEPURAR === "1") process.stderr.write(d); };
    this.p.stderr!.on("data", ouvirErro);
    this.pronta = new Promise((ok) => {
      let resto = "";
      const ler = (d: Buffer) => {
        const partes = (resto + d).split("\n"); resto = partes.pop()!;
        for (const l of partes) {
          try {
            const j = JSON.parse(l);
            if (j.evento === "pronto") { this.aberturaMs = j.ms; fim(); ok(true); return; }
          } catch {}
        }
      };
      const morreu = (c: number | null, s: string | null) => {
        fim();
        this.codigo = c;
        this.motivo = `${erro.trim().split("\n").filter((l) => l.startsWith("error:")).pop() ?? `exited with ${c ?? s}`}`;
        ok(false);
      };
      const fim = () => { this.p.stdout!.off("data", ler); this.p.off("close", morreu); this.p.stderr!.off("data", ouvirErro);
        // O render daqui em diante é colhido por quem usar a reserva (colher): parados até lá, nada se perde.
        this.p.stdout!.pause(); this.p.stderr!.pause(); };
      this.p.stdout!.on("data", ler);
      this.p.on("close", morreu);
      this.p.stdin!.on("error", () => {});
    });
  }

  /** Ainda de pé (não saiu depois do «pronto»). */
  viva(): boolean { return this.p.exitCode === null && this.p.signalCode === null; }

  /** Entrega o job e colhe o render. */
  usar(argv: string[], ordem: string | null): Promise<Rodada> {
    const rodada = colher(this.p);
    this.p.stdout!.resume(); this.p.stderr!.resume();
    this.p.stdin!.end(`${JSON.stringify({ argumentos: argv, ordem })}\n`);
    return rodada;
  }
}

export type Feito = { quadros: Record<number, string>; ms: number; quente: boolean; modo: string; largura: number; altura: number };

/** Os renders da prévia: frio pelo cli/render.ts, ou quente pela reserva, quando há. Um de cada vez. */
export class Previa {
  o: OpcoesPrevia;
  r: Recursos;
  reserva: Reserva | null = null;
  /** Por que o quente não está valendo (sem placa, --cpu, só um quadro solto). */
  semQuente: string | null;
  /** Reservas seguidas que não abriram; na terceira (ou na placa que não serve), o quente desliga. */
  falhas = 0;

  constructor(o: OpcoesPrevia, r: Recursos) {
    this.o = o;
    this.r = r;
    this.semQuente = !o.observar ? "quadro solto" : o.modo === "cpu" ? "--cpu" : null;
  }

  /** Abre a próxima reserva (fora do caminho do render: depois de cada um). */
  abrirReserva() {
    if (this.semQuente || this.reserva || this.r.liberado) return;
    this.reserva = new Reserva(this.r);
  }

  /** Renderiza `quadros` e grava os PNG em `pasta` (ou no arquivo da --saida). Lança com o motivo e o código do render. */
  async fazer(quadros: number[], pasta: string): Promise<Feito> {
    // Parando: o render que estava na fila não sobe mais nada (o liberar já passou pelos grupos vivos).
    const parando = () => { if (this.r.liberado) throw Object.assign(new Error("the preview is stopping"), { codigo: 130 }); };
    parando();
    const t0 = performance.now();
    const tmp = this.r.pasta("motor-previa-");
    // Cada render (frio ou a reserva) tem o TMPDIR dentro de uma temporária da prévia: o que a árvore dele deixar ao
    // ser parada no meio (a pasta do host do CEF, a do Chromium) some com ela.
    let usada: Reserva | null = null;
    if (process.env.MOTOR_DEPURAR === "1") avisar(`temporary folder ${tmp}`);
    try {
      const { argv, ordem } = argumentosDoRender(this.o, quadros, join(tmp, "previa.mp4"), join(tmp, "quadros"));
      let rodada: Rodada | null = null, quente = false;
      const reserva = this.reserva;
      this.reserva = null;
      usada = reserva;
      const pronta = reserva ? await reserva.pronta : false;
      parando();
      if (reserva && pronta && reserva.viva()) {
        this.falhas = 0;
        rodada = await reserva.usar(argv, ordem);
        quente = true;
      } else if (reserva && pronta) {
        avisar("the warm browser exited before the job: this render starts cold");
      } else if (reserva) {
        // Não abriu. Placa que não serve (3) desliga o quente; outra falha (placa ocupada por um instante, abertura
        // lenta) tenta de novo no próximo, até 3 seguidas.
        this.falhas++;
        if (reserva.codigo === 3 || this.falhas >= 3) {
          this.semQuente = reserva.motivo || "the warm browser did not start";
          avisar(`no warm browser (${this.semQuente}): every render starts cold`);
        } else avisar(`the warm browser did not start (${reserva.motivo}): this render starts cold`);
      }
      if (!rodada) {
        const filhos = join(tmp, "tmp");
        mkdirSync(filhos);
        const env = { ...process.env, TMPDIR: filhos };
        if (ordem) env.M04_ORDEM = ordem; else delete env.M04_ORDEM;
        rodada = await colher(this.r.iniciar(process.execPath, [RENDER, ...argv], { env, stdio: ["ignore", "pipe", "pipe"] }));
      }
      if (rodada.codigo !== 0 || !rodada.json?.ok) {
        const motivo = rodada.erro.trim().split("\n").filter((l) => !l.startsWith("kodecz: ") || /error|warning/.test(l)).slice(-12).join("\n");
        throw Object.assign(new Error(`the render failed (cli/render.ts exited with ${rodada.codigo}):\n${motivo}`), { codigo: rodada.codigo });
      }
      const c = rodada.json.composicao ?? {};
      const largura = c.largura ?? this.o.declaracao.largura, altura = c.altura ?? this.o.declaracao.altura;
      const feitos: Record<number, string> = {};
      for (const n of quadros) {
        const png = paraPng(readFileSync(join(tmp, "quadros", `motor-${n}.bgra`)), largura, altura);
        const destino = arquivoDoQuadro(this.o, n, pasta);
        mkdirSync(dirname(destino), { recursive: true });
        // Troca de uma vez: quem lê o PNG (a página, o agente) nunca pega um pela metade.
        const parcial = join(dirname(destino), `.${basename(destino)}.parcial-${process.pid}`);
        writeFileSync(parcial, png);
        renameSync(parcial, destino);
        feitos[n] = destino;
      }
      return { quadros: feitos, ms: Math.round(performance.now() - t0), quente, modo: rodada.json.modo, largura, altura };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      if (usada) rmSync(usada.pasta, { recursive: true, force: true });
    }
  }
}

/** Fila de um de cada vez: um render só usa a placa por vez, e a reserva vale para um job. */
class Fila {
  private ultima: Promise<unknown> = Promise.resolve();
  vez<T>(f: () => Promise<T>): Promise<T> {
    const p = this.ultima.then(f, f);
    this.ultima = p.catch(() => {});
    return p;
  }
}

const PAGINA = (o: OpcoesPrevia) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview ${o.composicao}</title>
<style>
  :root { color-scheme: dark; --fundo: #111; --texto: #ddd; --fraco: #888; --borda: #333; --erro: #f77; }
  body { margin: 0; padding: 16px; background: var(--fundo); color: var(--texto); font: 14px/1.4 system-ui, sans-serif; }
  header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 12px; }
  h1 { font-size: 16px; margin: 0; }
  #estado { color: var(--fraco); } #estado.erro { color: var(--erro); white-space: pre-wrap; font-family: ui-monospace, monospace; }
  .grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); gap: 12px; }
  figure { margin: 0; } img { width: 100%; height: auto; display: block; border: 1px solid var(--borda);
    background: repeating-conic-gradient(#222 0 25%, #2a2a2a 0 50%) 0 0 / 16px 16px; }
  figcaption { color: var(--fraco); margin-top: 4px; }
  .controle { display: flex; gap: 8px; align-items: center; margin: 16px 0 8px; } input[type=range] { flex: 1; }
  input[type=number] { width: 6em; }
</style></head>
<body>
<header><h1>${o.composicao}</h1><span id="estado">starting…</span></header>
<div class="grade" id="lista"></div>
<div class="controle"><label for="n">Frame</label>
  <input type="range" id="faixa" min="0" max="${o.declaracao.quadros - 1}" value="0">
  <input type="number" id="n" min="0" max="${o.declaracao.quadros - 1}" value="0"></div>
<figure><img id="solto" alt="chosen frame"><figcaption id="legenda"></figcaption></figure>
<script>
const qps = ${o.declaracao.qps}, lista = ${JSON.stringify(o.quadros)};
let versao = 0;
const seg = (n) => (n / qps).toFixed(2) + ' s';
const grade = document.getElementById('lista');
for (const n of lista) grade.insertAdjacentHTML('beforeend', '<figure><img data-n="' + n + '" alt="frame ' + n + '"><figcaption>frame ' + n + ' · ' + seg(n) + '</figcaption></figure>');
const faixa = document.getElementById('faixa'), campo = document.getElementById('n'), solto = document.getElementById('solto');
function mostrarSolto() {
  const n = Number(campo.value);
  solto.src = '/quadro/' + n + '.png?v=' + versao;
  document.getElementById('legenda').textContent = 'frame ' + n + ' · ' + seg(n);
}
faixa.addEventListener('change', () => { campo.value = faixa.value; mostrarSolto(); });
campo.addEventListener('change', () => { faixa.value = campo.value; mostrarSolto(); });
const estado = document.getElementById('estado');
const eventos = new EventSource('/eventos');
eventos.onmessage = (m) => {
  const e = JSON.parse(m.data);
  if (e.evento === 'erro') { estado.className = 'erro'; estado.textContent = e.mensagem; return; }
  estado.className = '';
  if (e.evento === 'refazendo') { estado.textContent = 'rendering…'; return; }
  versao = e.versao;
  estado.textContent = 'version ' + e.versao + ' · ' + e.ms + ' ms' + (e.quente ? ' (warm)' : ' (cold)') + ' · ' + (e.modo === 'placa' ? 'GPU' : 'CPU');
  for (const img of grade.querySelectorAll('img')) img.src = '/quadro/' + img.dataset.n + '.png?v=' + versao;
  mostrarSolto();
};
</script>
</body></html>
`;

/** O modo --observar: render a cada mudança, a reserva quente e, com --servir, a página. Resolve quando parar. */
export async function observar(o: OpcoesPrevia, r: Recursos): Promise<void> {
  const previa = new Previa(o, r);
  const fila = new Fila();
  /** Mudanças vistas na pasta; o render da lista leva a versão do começo dele. */
  let mudancas = 1, versao = 0, agendada = false, parando = false, rajada: NodeJS.Timeout | undefined;
  let ultimo: Record<string, unknown> | null = null;
  const avulsos = new Map<number, { versao: number; arquivo: string }>();
  const pastaAvulsos = r.pasta("motor-previa-avulsos-");
  const clientes = new Set<ServerResponse>();
  const publicar = (e: Record<string, unknown>) => {
    if (parando) return;
    if (e.evento !== "refazendo") process.stdout.write(`${JSON.stringify(e)}\n`);
    for (const c of clientes) c.write(`data: ${JSON.stringify(e)}\n\n`);
  };

  const refazerLista = () => {
    if (agendada) return;
    agendada = true;
    fila.vez(async () => {
      agendada = false;
      const v = mudancas;
      publicar({ evento: "refazendo", versao: v });
      try {
        const f = await previa.fazer(o.quadros, o.saida);
        versao = v;
        ultimo = { evento: "quadros", versao: v, quadros: f.quadros, ms: f.ms, quente: f.quente, modo: f.modo };
        publicar(ultimo);
        avisar(`version ${v}: ${o.quadros.length} frame(s) in ${f.ms} ms (${f.quente ? "warm" : "cold"}, ${f.modo === "placa" ? "GPU" : "CPU"})`);
      } catch (e) {
        ultimo = { evento: "erro", versao: v, mensagem: (e as Error).message };
        publicar(ultimo);
        avisar(`version ${v}: ${(e as Error).message}`);
      }
      previa.abrirReserva();
    });
  };

  /** O quadro N pedido pela página: o da lista, se já está na versão atual; senão, um render só dele. */
  const quadroAvulso = (n: number): Promise<string> => {
    if (o.quadros.includes(n) && versao === mudancas) return Promise.resolve(arquivoDoQuadro(o, n));
    const a = avulsos.get(n);
    if (a && a.versao === mudancas) return Promise.resolve(a.arquivo);
    return fila.vez(async () => {
      const v = mudancas;
      const de = avulsos.get(n);
      if (de && de.versao === v) return de.arquivo;
      if (o.quadros.includes(n) && versao === v) return arquivoDoQuadro(o, n);
      try {
        const f = await previa.fazer([n], pastaAvulsos);
        avulsos.set(n, { versao: v, arquivo: f.quadros[n] });
        avisar(`frame ${n} (version ${v}) in ${f.ms} ms (${f.quente ? "warm" : "cold"})`);
        return f.quadros[n];
      } finally { previa.abrirReserva(); }
    });
  };

  // A saída dentro da pasta observada (o padrão, não; mas pode) não dispara render.
  const ignorar = relative(o.pasta, o.saida);
  const dentro = (nome: string) => ignorar && !ignorar.startsWith("..") && (nome === ignorar || nome.startsWith(`${ignorar}/`));
  const mudou = () => {
    clearTimeout(rajada);
    rajada = setTimeout(() => { mudancas++; refazerLista(); }, RAJADA_MS);
  };
  /** Sem o inotify (limite do sistema esgotado: ENOSPC, EMFILE), olha a pasta a cada 300 ms pelo tamanho e a data. */
  const consultar = () => {
    const retrato = () => readdirSync(o.pasta, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath, e.name))
      .filter((f) => !dentro(relative(o.pasta, f)))
      .map((f) => { try { const st = statSync(f); return `${f}:${st.size}:${st.mtimeMs}`; } catch { return f; } })
      .sort().join("\n");
    let antes = retrato();
    const relogio = setInterval(() => { const agora = retrato(); if (agora !== antes) { antes = agora; mudou(); } }, 300);
    return { close: () => clearInterval(relogio) };
  };
  let observador: { close: () => void };
  try {
    // MOTOR_PREVIA_CONSULTAR=1 força a consulta (para testar o caminho sem inotify).
    if (process.env.MOTOR_PREVIA_CONSULTAR === "1") throw new Error("MOTOR_PREVIA_CONSULTAR=1");
    const w = watch(o.pasta, { recursive: true }, (_tipo, nome) => { if (!(nome && dentro(String(nome)))) mudou(); });
    w.on("error", (e) => { avisar(`fs.watch failed (${e.message}): polling the folder every 300 ms`); w.close(); observador = consultar(); });
    observador = w;
  } catch (e) {
    avisar(`fs.watch unavailable (${(e as Error).message}): polling the folder every 300 ms`);
    observador = consultar();
  }

  let servidor: Server | null = null;
  if (o.servir) {
    servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
      // Só loopback: o Host tem de ser o próprio endereço (contra DNS rebinding de uma página de fora).
      const host = req.headers.host ?? "";
      // E só do próprio endereço ou digitado: outra página aberta no navegador não põe render na fila
      // (<img src="http://127.0.0.1:…/quadro/N.png"> vai com Sec-Fetch-Site: cross-site).
      const site = req.headers["sec-fetch-site"];
      if (site !== undefined && site !== "same-origin" && site !== "none") { res.writeHead(403).end(); return; }
      const porta = (servidor!.address() as { port: number }).port;
      if (![`127.0.0.1:${porta}`, `localhost:${porta}`].includes(host) || req.method !== "GET") { res.writeHead(403).end(); return; }
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(PAGINA(o)); return; }
      if (url.pathname === "/eventos") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        clientes.add(res);
        if (ultimo) res.write(`data: ${JSON.stringify(ultimo)}\n\n`);
        req.on("close", () => clientes.delete(res));
        return;
      }
      const m = /^\/quadro\/(\d+)\.png$/.exec(url.pathname);
      if (m && Number(m[1]) < o.declaracao.quadros) {
        quadroAvulso(Number(m[1])).then(
          (arquivo) => res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" }).end(readFileSync(arquivo)),
          (e) => res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end((e as Error).message));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((ok, falha) => { servidor!.once("error", falha); servidor!.listen(o.porta, "127.0.0.1", ok); });
    const url = `http://127.0.0.1:${(servidor.address() as { port: number }).port}/`;
    process.stdout.write(`${JSON.stringify({ evento: "pagina", url })}\n`);
    avisar(`page at ${url}`);
  }

  avisar(`watching ${o.pasta} (frames ${o.quadros.join(", ")}; output ${o.saida}); Ctrl+C to stop`);
  refazerLista();

  await new Promise<void>((ok) => {
    const parar = (sinal: string) => {
      if (parando) { avisar(`${sinal} ignored: still stopping`); return; }
      parando = true;
      avisar(`${sinal}: stopping`);
      clearTimeout(rajada);
      observador.close();
      for (const c of clientes) c.end();
      clientes.clear();
      servidor?.closeAllConnections();
      servidor?.close();
      ok();
    };
    for (const s of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(s, () => parar(s));
  });
}

async function principal() {
  let o: OpcoesPrevia;
  try { o = lerOpcoesPrevia(process.argv.slice(2)); } catch (erro) {
    if (erro instanceof ErroDeUso) {
      (erro.codigo === 0 ? process.stdout : process.stderr).write(`${erro.codigo === 0 ? "" : "error: "}${erro.message}\n`);
      process.exit(erro.codigo);
    }
    throw erro;
  }
  // A espera maior que a do render: o render filho, no SIGTERM, ainda fecha os processos dele e apaga a temporária.
  const r = new Recursos({ espera: 5000, aoIniciar: process.env.MOTOR_DEPURAR === "1" ? (pid, c) => avisar(`group ${pid}: ${basename(c)}`) : null });
  if (o.observar) {
    await observar(o, r);
    await r.liberar();
    process.exit(0);
  }
  r.aoSinal();
  try {
    const f = await new Previa(o, r).fazer(o.quadros, o.saida);
    await r.liberar();
    process.stdout.write(`${JSON.stringify({ ok: true, ...f })}\n`);
    avisar(`${Object.values(f.quadros).join(", ")} in ${f.ms} ms (${f.modo === "placa" ? "GPU" : "CPU"})`);
  } catch (erro) {
    await r.liberar();
    process.stderr.write(`error: ${(erro as Error).message}\n`);
    const c = (erro as { codigo?: number }).codigo;
    process.exitCode = c === 2 || c === 3 ? c : 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await principal();
