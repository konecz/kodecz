// Regras do comando de render (M08), sem efeito colateral além de ler o disco: os argumentos, a sonda da placa
// (com o ambiente injetável, para testar sem desligar a placa) e a escolha entre placa e CPU.
// TypeScript só com sintaxe apagável: roda direto no Node 24 (type stripping), como o identidade/.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CAMPOS, ID_BLOCO, ID_BLOCO_ANTIGO, OPCOES_RENDER, traduzirOpcoes } from "./nomes.ts";

const RAIZ = resolve(dirname(new URL(import.meta.url).pathname), "..");
/** Onde mora o código do produto (P04, adr.md seção 4): a captura (o processo que fala com o host do CEF, com os modos
 * placa e CPU), o lado da composição (áudio, mídia da linha) e o módulo nativo. */
export const CAMINHOS = {
  raiz: RAIZ,
  captura: join(RAIZ, "captura"),
  composicao: join(RAIZ, "composicao"),
  /** O Electron sem remendo, só da conferência (S04) e do teste que toca o MP4 num navegador (P01), que precisam do
   * H.264 na página (o CEF pronto não tem); o render e a checagem do DOM dos blocos vão pelo CEF. */
  electronCpu: join(RAIZ, "captura", "node_modules", "electron", "dist", "electron"),
  nativo: join(RAIZ, "nativo", "nativo.node"),
  // P02: o host da captura pelo CEF (captura/cef/montar.sh) e os ganchos que rodam o captura/main.ts sobre ele.
  hostCef: join(RAIZ, "captura", "cef", "target", "release", "motor-captura"),
  ganchosCef: join(RAIZ, "captura", "cef", "ganchos.ts"),
};

/** O ICD do Vulkan da NVIDIA: o pacote do driver põe em /usr/share; o instalador .run e o contêiner (CDI), em /etc. */
export const ICD_VULKAN_NVIDIA = ["/usr/share/vulkan/icd.d/nvidia_icd.json", "/etc/vulkan/icd.d/nvidia_icd.json"];

export const USO = `usage: kodecz render <folder> <composition> <out.mp4> [options]
       (same as: node cli/render.ts <folder> <composition> <out.mp4> [options])

  <folder>       the composition: a folder with index.html and the <script type="application/json" id="kodecz">
                 block (docs/formatos/linha-do-tempo.md)
  <composition>  the id declared in the block
  <out.mp4>      the MP4, H.264 (High profile, no B-frames, plays in every browser), with audio if the page has any

  --gpu          GPU only (texture → Vulkan → NVENC); without a usable NVIDIA GPU, exits with 3
  --cpu          CPU only (software paint, x264)
                 neither: the GPU; on a machine without an NVIDIA GPU, the CPU with a warning; with a GPU that
                 is busy right now (no NVENC session, VRAM full), exits with 3: wait, or use --cpu
  --hevc         HEVC video (smaller file, does not play in every browser); GPU only
  --alpha        transparent layer: raw HEVC with alpha (.hevc output), GPU only, no audio
  --from <N>     first frame (default 0)
  --frames <N>   how many frames (default: to the end)
  --no-audio     do not collect or mix the audio
  --save-frames <0,10,20> --save-frames-dir <dir>   also write these frames as raw BGRA
  --keep         keep the temporary folder (debugging)
  --no-containment  no nice/ionice/CPU cap (default: contained, ferramentas/contencao.mjs)
  -h, --help     this help

The original Portuguese names still work (deprecated): --placa (--gpu), --alfa (--alpha), --de (--from),
--quadros (--frames), --sem-audio, --manter, --sem-contencao, --gravar, --gravar-pasta, --ajuda.`;

/** Erro com a correção na mensagem; `codigo` é a saída do processo (2 uso, 3 placa pedida e ausente). */
export class ErroDeUso extends Error {
  codigo: number;
  constructor(mensagem: string, codigo = 2) {
    super(mensagem);
    this.codigo = codigo;
  }
}

/** P10: o bloco <script id="kodecz"> (ou o antigo id="motor-video") do index.html de uma composição em linha do tempo. */
export type Declaracao = { id: string; largura: number; altura: number; qps: number; quadros: number };
/** A entrada do render: só a composição em linha do tempo (P10); a do Remotion saiu do motor (adr.md, seção 16). */
export type Entrada = { tipo: "linha"; pasta: string; declaracao: Declaracao };
export type Pedido = "auto" | "placa" | "cpu";
/** P01: o codec do vídeo. H.264 por padrão; HEVC com --hevc e na camada com alfa (--alfa). */
export type Codec = "h264" | "hevc";
export type Argumentos = {
  entrada: Entrada; composicao: string; saida: string; modo: Pedido; de: number; quadros: number | null;
  audio: boolean; alfa: boolean; codec: Codec; gravar: number[]; gravarPasta: string | null; manter: boolean; contencao: boolean;
};

/** Para quem ainda tem composição do Remotion: o motivo e o que fazer. */
export const SEM_REMOTION = "Remotion projects are no longer accepted as input (removed on 2026-10-31, docs/adr.md, " +
  "section 16); write the composition as a timeline page: a folder with index.html and the " +
  '<script type="application/json" id="kodecz"> block (docs/formatos/linha-do-tempo.md)';

const ENTRADAS_REMOTION = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs"];
const inteiro = (texto: string | undefined, nome: string, minimo: number): number | null => {
  if (texto === undefined) return null;
  const n = Number(texto);
  if (!/^-?\d+$/.test(texto) || n < minimo) throw new ErroDeUso(`${nome} must be an integer ≥ ${minimo}: ${texto}`);
  return n;
};

function lerEntrada(caminho: string): Entrada {
  const p = resolve(caminho);
  if (!existsSync(p)) throw new ErroDeUso(`folder not found: ${p}`);
  const html = join(p, "index.html");
  // Arquivo de entrada ou pasta do projeto do Remotion (src/index.ts e companhia).
  if (statSync(p).isFile() || (!existsSync(html) && ENTRADAS_REMOTION.some((e) => existsSync(join(p, "src", e))))) {
    throw new ErroDeUso(`${p}: ${SEM_REMOTION}`);
  }
  if (!existsSync(html)) {
    throw new ErroDeUso(`${p} is not a composition: it needs an index.html with the <script id="kodecz"> block ` +
      "(docs/formatos/linha-do-tempo.md)");
  }
  const declaracao = lerDeclaracao(readFileSync(html, "utf8"));
  // index.html sem o bloco: o pacote do Remotion (remotion bundle) ou a página que esqueceu a declaração.
  if (!declaracao) throw new ErroDeUso(`${html} has no <script id="kodecz"> block; if it is a Remotion bundle: ${SEM_REMOTION}`);
  return { tipo: "linha", pasta: p, declaracao };
}

/**
 * A declaração da composição em linha do tempo (P10), ou null se o HTML não tem o bloco.
 * O bloco é o <script> cujo atributo id é kodecz (ou o antigo motor-video), com ou sem aspas, fora de comentário; sem
 * type="application/json" o navegador o executaria como código. Os campos têm os nomes em inglês (width, height, fps,
 * frames; cli/nomes.ts) ou os antigos (largura, altura, qps, quadros); os dois com valores diferentes é erro.
 * Largura ≥ 800 porque a faixa da marca tem 50 blocos de 16 px; largura e altura pares por causa do 4:2:0 e até 8192,
 * o limite do NVENC.
 */
export function lerDeclaracao(html: string): Declaracao | null {
  const atributo = (attrs: string, nome: string) =>
    new RegExp(`(?:^|\\s)${nome}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs)?.slice(1).find((x) => x !== undefined);
  const bloco = [...html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .find((m) => { const id = atributo(m[1], "id"); return id === ID_BLOCO || id === ID_BLOCO_ANTIGO; });
  if (!bloco) return null;
  const tag = `<script id="${atributo(bloco[1], "id")}">`;
  if (atributo(bloco[1], "type")?.toLowerCase() !== "application/json") {
    throw new ErroDeUso(`the ${tag} block needs type="application/json" (without it, the browser runs it as code)`);
  }
  let d: any;
  try { d = JSON.parse(bloco[2]); } catch (e) { throw new ErroDeUso(`the ${tag} block is not valid JSON: ${(e as Error).message}`); }
  if (d === null || typeof d !== "object" || Array.isArray(d)) throw new ErroDeUso(`the ${tag} block must be an object`);
  const campo = (nome: string, regra: string) => new ErroDeUso(`${tag}: «${nome}» ${regra}: ${JSON.stringify(d[nome])}`);
  if (typeof d.id !== "string" || !d.id) throw campo("id", "must be the composition name (a string)");
  // O nome que a página usou (o novo, se tem os dois ou nenhum) e o valor; os dois nomes com valores diferentes é erro.
  const ler = (novo: string): [string, any] => {
    const antigo = CAMPOS[novo];
    if (d[novo] !== undefined && d[antigo] !== undefined && d[novo] !== d[antigo]) {
      throw new ErroDeUso(`${tag}: «${novo}» (${JSON.stringify(d[novo])}) and the old name «${antigo}» (${JSON.stringify(d[antigo])}) ` +
        `disagree: keep only «${novo}»`);
    }
    const nome = d[novo] === undefined && d[antigo] !== undefined ? antigo : novo;
    return [nome, d[nome]];
  };
  const inteiro = (x: unknown, min: number) => Number.isInteger(x) && (x as number) >= min;
  const [[nl, largura], [na, altura], [nq, qps], [nf, quadros]] = ["width", "height", "fps", "frames"].map(ler);
  for (const [nome, v, min] of [[nl, largura, 800], [na, altura, 16]] as const) {
    if (!inteiro(v, min) || v % 2 || v > 8192) throw campo(nome, `must be an even integer ≥ ${min} and ≤ 8192 (px)`);
  }
  if (!inteiro(qps, 1) || qps > 240) throw campo(nq, "must be an integer from 1 to 240 (frames per second)");
  if (!inteiro(quadros, 1)) throw campo(nf, "must be an integer ≥ 1 (duration in frames)");
  return { id: d.id, largura, altura, qps, quadros };
}

/** Lê os argumentos (sem o `node` e o script). Lança ErroDeUso com a correção. */
export function lerArgumentos(argv: string[]): Argumentos {
  let r;
  try {
    r = parseArgs({ args: traduzirOpcoes(argv, OPCOES_RENDER), allowPositionals: true, strict: true, options: {
      placa: { type: "boolean" }, cpu: { type: "boolean" }, hevc: { type: "boolean" }, props: { type: "string" }, de: { type: "string" },
      quadros: { type: "string" }, public: { type: "string" }, "sem-audio": { type: "boolean" }, alfa: { type: "boolean" },
      gravar: { type: "string" }, "gravar-pasta": { type: "string" }, manter: { type: "boolean" },
      "sem-contencao": { type: "boolean" }, ajuda: { type: "boolean", short: "h" }, captura: { type: "string" },
    } });
  } catch (e) {
    throw new ErroDeUso(`unknown option or missing value: ${(e as Error).message}\n\n${USO}`);
  }
  const { values: o, positionals: p } = r;
  if (o.ajuda) throw new ErroDeUso(USO, 0);
  if (p.length < 3) throw new ErroDeUso(`missing arguments (got ${p.length} of 3): <folder> <composition> <out.mp4>\n\n${USO}`);
  if (p.length > 3) throw new ErroDeUso(`unexpected argument: ${p.slice(3).join(" ")} (options start with --)`);
  if (o.placa && o.cpu) throw new ErroDeUso("--gpu and --cpu together: pick one, or neither for the automatic choice");
  const alfa = o.alfa === true, hevc = o.hevc === true;
  if (alfa && o.cpu) throw new ErroDeUso("--alpha is GPU only (the CPU encoder, x264, has no alpha layer)");
  // P01: HEVC na CPU seria o x265, lento, e a CPU é dos sites (CLAUDE.md, «Segurança e operação»).
  if (hevc && o.cpu) throw new ErroDeUso("--hevc is GPU only (on the CPU the video is H.264): drop --cpu, or run without --hevc");
  const [caminho, composicao, saida] = p;
  if (alfa && !saida.endsWith(".hevc")) throw new ErroDeUso("with --alpha the output is .hevc (raw HEVC with the alpha layer)");
  if (!alfa && !saida.endsWith(".mp4")) throw new ErroDeUso(`the output must end in .mp4: ${saida}`);
  // As opções que eram só da entrada do Remotion e do Electron dizem por que saíram.
  if (o.props !== undefined) throw new ErroDeUso(`--props was for Remotion input; on a timeline page the values live in the page itself. ${SEM_REMOTION}`);
  if (o.public !== undefined) throw new ErroDeUso(`--public was for Remotion input; on a timeline page the files live in the composition folder. ${SEM_REMOTION}`);
  if (o.captura !== undefined) throw new ErroDeUso("--captura was removed with the Remotion input (2026-10-31): capture is always through CEF (captura/cef/)");
  const entrada = lerEntrada(caminho);
  const gravar = o.gravar === undefined ? [] : o.gravar.split(",").map((x) => {
    if (!/^\d+$/.test(x)) throw new ErroDeUso(`--save-frames: a comma-separated list of frames, like 0,10,20: ${o.gravar}`);
    return Number(x);
  });
  if (gravar.length && !o["gravar-pasta"]) throw new ErroDeUso("--save-frames needs --save-frames-dir <dir> (where the BGRA files go)");
  const de = inteiro(o.de, "--from", 0) ?? 0, quadros = inteiro(o.quadros, "--frames", 1);
  const d = entrada.declaracao;
  if (composicao !== d.id) throw new ErroDeUso(`composition «${composicao}» not found in ${entrada.pasta}; the declared one is ${d.id}`);
  if (de >= d.quadros) throw new ErroDeUso(`--from ${de} is past the end of the composition (${d.quadros} frames)`);
  if (quadros !== null && de + quadros > d.quadros) throw new ErroDeUso(`--from ${de} --frames ${quadros} goes past the end (${d.quadros} frames)`);
  return {
    entrada, composicao, saida: resolve(saida), modo: alfa || hevc || o.placa ? "placa" : o.cpu ? "cpu" : "auto",
    de, quadros,
    audio: !alfa && !o["sem-audio"], alfa, codec: alfa || hevc ? "hevc" : "h264", gravar, gravarPasta: o["gravar-pasta"] ? resolve(o["gravar-pasta"]) : null,
    manter: o.manter === true, contencao: !o["sem-contencao"],
  };
}

/** O que a sonda olha. Injetável: os testes simulam cada falta sem mexer na placa. */
export type Ambiente = {
  env: Record<string, string | undefined>;
  existe: (caminho: string) => boolean;
  /** [render node, vendor] de cada /sys/class/drm/renderD*. */
  vendors: () => [string, string][];
  noPath: (binario: string) => boolean;
  /** Abre e fecha o Vulkan e o NVENC de verdade, no codec do render (e com a camada de alfa, se pedida); null se deu
   * certo, ou o erro. */
  sondarNvenc: (renderNode: string, codificacao: { codec: Codec; alfa: boolean }) => string | null;
  /** Carrega o nativo.node e confere o que o motor usa (conferirNativo); null se serve, ou o motivo com a instrução. */
  sondarNativo: () => string | null;
};

/** O que o motor usa do nativo.node (captura/main.ts e cli/sonda-nvenc.ts); `versao` só existe desde o P04. */
export const NATIVO_FUNCOES = ["Motor", "lerMarca", "versao"];
export const NATIVO_METODOS = ["quadro", "quadroMarcado", "repetir", "fechar"];
export const COMPILAR_NATIVO = "build it with: cd nativo && cargo build --release && cp target/release/libnativo.so nativo.node (or ./instalar.sh)";

/** P04: o nativo.node carrega e expõe as funções e os métodos do motor? null se sim; senão, o motivo e como compilar. */
export function conferirNativo(carregar: () => unknown): string | null {
  let m: any;
  try { m = carregar(); } catch (e) {
    return `nativo.node does not load (${String((e as Error)?.message ?? e).split("\n")[0]}); ${COMPILAR_NATIVO}`;
  }
  const faltam = [...NATIVO_FUNCOES.filter((f) => typeof m?.[f] !== "function"),
    ...NATIVO_METODOS.filter((f) => typeof m?.Motor?.prototype?.[f] !== "function").map((f) => `Motor.${f}`)];
  if (faltam.length) return `nativo.node lacks ${faltam.join(", ")} (built from another version of the code); ${COMPILAR_NATIVO}`;
  return null;
}
/**
 * `ausente`: não há placa NVIDIA nesta máquina (nem render node, nem driver). Só aí o automático cai para a CPU; placa
 * presente que não serve agora (NVENC sem sessão, VRAM cheia, peça do motor faltando) é erro, porque a CPU é dos
 * sites (CLAUDE.md, «Segurança e operação»).
 */
export type Sonda = { ok: true; renderNode: string } | { ok: false; ausente: boolean; motivo: string };

/** A placa serve se tudo que o modo placa usa está aí e o NVENC abre. Do mais barato ao mais caro. */
export function sondarPlaca(a: Ambiente, { codec = "h264", alfa = false }: { codec?: Codec; alfa?: boolean } = {}): Sonda {
  const ausente = (motivo: string): Sonda => ({ ok: false, ausente: true, motivo });
  const naoServe = (motivo: string): Sonda => ({ ok: false, ausente: false, motivo });
  if (a.env.MOTOR_SEM_PLACA === "1") return ausente("simulated by MOTOR_SEM_PLACA=1");
  const no = a.vendors().find(([, v]) => v.trim() === "0x10de");
  if (!no) return ausente("no NVIDIA render node in /sys/class/drm");
  if (!a.existe("/dev/nvidiactl")) return ausente("no /dev/nvidiactl (NVIDIA driver missing, or the GPU is hidden)");
  if (!a.noPath("weston")) return naoServe("weston not in PATH (the virtual display of GPU mode)");
  if (!a.existe(CAMINHOS.hostCef)) return naoServe(`the CEF host is missing (${CAMINHOS.hostCef}): run ./instalar.sh`);
  if (!a.existe(CAMINHOS.nativo)) return naoServe(`nativo.node is missing (${CAMINHOS.nativo}); ${COMPILAR_NATIVO}`);
  const nativo = a.sondarNativo();
  if (nativo) return naoServe(nativo);
  const renderNode = `/dev/dri/${no[0]}`;
  const erro = a.sondarNvenc(renderNode, { codec, alfa });
  if (erro) return naoServe(`Vulkan/NVENC for ${codec === "h264" ? "H.264" : "HEVC"}${alfa ? " with the alpha layer" : ""} did not open: ${erro}`);
  return { ok: true, renderNode };
}

export type Escolha = { modo: "placa" | "cpu"; renderNode: string | null; aviso: string | null };

/**
 * --cpu não sonda; --placa sem placa falha (código 3); automático cai para CPU avisando só sem placa NVIDIA, e com a
 * placa presente que não serve agora falha (código 3).
 */
export function escolherModo(pedido: Pedido, sondar: () => Sonda): Escolha {
  if (pedido === "cpu") return { modo: "cpu", renderNode: null, aviso: null };
  const s = sondar();
  if (s.ok) return { modo: "placa", renderNode: s.renderNode, aviso: null };
  if (pedido === "placa") {
    throw new ErroDeUso(`--gpu was requested, but the GPU is not usable: ${s.motivo}. ` +
      (s.ausente ? "Use --cpu." : "Wait for the GPU to free up (it may be shared with other jobs) and run again, or use --cpu."), 3);
  }
  if (!s.ausente) {
    throw new ErroDeUso(`there is an NVIDIA GPU here, but it is not usable right now: ${s.motivo}. Not falling back to the CPU: ` +
      "wait for the GPU to free up (it may be shared with other jobs) and run again, or pass --cpu on purpose.", 3);
  }
  return { modo: "cpu", renderNode: null, aviso: `no GPU (${s.motivo}): rendering on the CPU (software paint and x264), much slower` };
}

export type ArquivoSondado = { quadros: number | null; video: string | null; audio: string | null;
  duracaoVideo: number | null; duracaoAudio: number | null };

/**
 * Confere o arquivo final (ainda o parcial, antes de ir para o lugar): os quadros de vídeo são os que o render mandou e,
 * se havia áudio para misturar, a faixa existe e dura o vídeo, com folga de um quadro. null se confere; senão, o erro.
 */
export function conferirArquivo(s: ArquivoSondado, esperado: { quadros: number; fps: number; audio: boolean }): string | null {
  if (s.quadros === null) return "no readable video stream (ffprobe)";
  if (s.quadros !== esperado.quadros) return `the file has ${s.quadros} video frames; the render sent ${esperado.quadros}`;
  if (!esperado.audio) return null;
  if (!s.audio || s.duracaoAudio === null) return "the mix had audio, but the file has no audio stream";
  const video = esperado.quadros / esperado.fps;
  if (Math.abs(s.duracaoAudio - video) > 1 / esperado.fps) {
    return `the audio lasts ${s.duracaoAudio.toFixed(3)} s and the video ${video.toFixed(3)} s (more than one frame apart)`;
  }
  return null;
}

/** O bwrap que esconde a placa no modo CPU (render e conferência): sem /dev/dri nem /dev/nvidia*. */
export const PREFIXO_SEM_PLACA = ["bwrap", "--dev-bind", "/", "/", "--dev", "/dev", "--bind", "/dev/shm", "/dev/shm", "--"];

/**
 * Modo CPU: o prefixo que esconde a placa do Chromium, e o aviso quando não dá. O bwrap é testado de verdade (o mesmo
 * prefixo com `true`): no Ubuntu 24.04+ ele existe, mas o AppArmor barra o namespace de usuário («setting up uid map:
 * Permission denied») e o render inteiro caía. Sem bwrap que funcione, roda sem esconder: o desenho continua por
 * software (--disable-gpu, CUDA_VISIBLE_DEVICES vazio). O aviso só sai quando há placa para esconder.
 * `rodar` executa o comando e diz se saiu com 0; `placa`: há /dev/nvidiactl.
 */
export function esconderPlaca(rodar: (comando: string[]) => boolean, placa: boolean): { prefixo: string[]; aviso: string | null } {
  if (!rodar(["sh", "-c", "command -v bwrap"])) {
    return { prefixo: [], aviso: placa ? "bwrap not found: the GPU stays visible to Chromium in CPU mode (painting is still done in software)" : null };
  }
  if (!rodar([...PREFIXO_SEM_PLACA, "true"])) {
    return { prefixo: [], aviso: placa ? "bwrap cannot create a user namespace (AppArmor on Ubuntu 24.04+?): the GPU stays visible to " +
      "Chromium in CPU mode (painting is still done in software); ./instalar.sh --verificar shows how to allow it" : null };
  }
  return { prefixo: PREFIXO_SEM_PLACA, aviso: null };
}

/**
 * Tempo-limite da captura, em ms: 180 s de folga (subida, fontes) mais 0,4 s por quadro na placa e 0,6 s na
 * CPU. Sem o número de quadros (--quadros ausente, antes de a composição abrir), conta 3000.
 */
export function tempoLimite(quadros: number | null, modo: "placa" | "cpu"): number {
  return Math.round((180 + (quadros ?? 3000) * (modo === "cpu" ? 0.6 : 0.4)) * 1000);
}
