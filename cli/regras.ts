// Regras do comando de render (M08), sem efeito colateral além de ler o disco: os argumentos, a sonda da placa
// (com o ambiente injetável, para testar sem desligar a placa) e a escolha entre placa e CPU.
// TypeScript só com sintaxe apagável: roda direto no Node 24 (type stripping), como o identidade/.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

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

export const USO = `uso: node cli/render.ts <entrada> <composição> <saída.mp4> [opções]

  <entrada>      composição em linha do tempo: pasta com index.html e o bloco <script id="motor-video">
                 (docs/formatos/linha-do-tempo.md); a entrada do Remotion saiu do motor em 2026-10-31
  <composição>   id declarado no bloco motor-video
  <saída.mp4>    MP4 final em H.264 (perfil High, sem quadros B, toca em todo navegador), com áudio se a composição tiver

  --placa        só na placa (RTX: textura → Vulkan → NVENC); sem placa, falha (saída 3)
  --cpu          só na CPU (desenho por software, x264)
  --hevc         vídeo em HEVC (arquivo menor, mas não toca em todo navegador); só na placa
                 sem nenhum dos dois: a placa; sem placa NVIDIA na máquina, CPU com aviso; placa presente
                 mas ocupada (NVENC sem sessão, VRAM cheia), sai com 3: esperar ou usar --cpu
  --de <N>       primeiro quadro (padrão 0)
  --quadros <N>  quantos quadros (padrão: até o fim)
  --sem-audio    não coleta nem mistura o áudio
  --alfa         camada com alfa para a montagem do M05: saída .hevc, só na placa, sem áudio
  --gravar <0,10,20> --gravar-pasta <pasta>   grava esses quadros em BGRA (conferência, SSIM)
  --manter       não apaga a pasta temporária (depuração)
  --sem-contencao  sem nice/ionice/teto de CPU (padrão: contido, ferramentas/contencao.mjs)
  -h, --ajuda    esta ajuda`;

/** Erro com a correção na mensagem; `codigo` é a saída do processo (2 uso, 3 placa pedida e ausente). */
export class ErroDeUso extends Error {
  codigo: number;
  constructor(mensagem: string, codigo = 2) {
    super(mensagem);
    this.codigo = codigo;
  }
}

/** P10: o bloco <script id="motor-video"> do index.html de uma composição em linha do tempo. */
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
export const SEM_REMOTION = "a entrada do Remotion saiu do motor em 2026-10-31 (docs/adr.md, seção 16: sem a licença do " +
  "Remotion e com um caminho só de captura, o CEF); escreva a composição na linha do tempo, uma pasta com index.html e o " +
  'bloco <script type="application/json" id="motor-video"> (docs/formatos/linha-do-tempo.md)';

const ENTRADAS_REMOTION = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs"];
const inteiro = (texto: string | undefined, nome: string, minimo: number): number | null => {
  if (texto === undefined) return null;
  const n = Number(texto);
  if (!/^-?\d+$/.test(texto) || n < minimo) throw new ErroDeUso(`${nome} tem de ser inteiro ≥ ${minimo}: ${texto}`);
  return n;
};

function lerEntrada(caminho: string): Entrada {
  const p = resolve(caminho);
  if (!existsSync(p)) throw new ErroDeUso(`entrada não existe: ${p}`);
  const html = join(p, "index.html");
  // Arquivo de entrada ou pasta do projeto do Remotion (src/index.ts e companhia).
  if (statSync(p).isFile() || (!existsSync(html) && ENTRADAS_REMOTION.some((e) => existsSync(join(p, "src", e))))) {
    throw new ErroDeUso(`${p}: ${SEM_REMOTION}`);
  }
  if (!existsSync(html)) {
    throw new ErroDeUso(`${p} não é uma composição da linha do tempo: falta index.html com o bloco <script id="motor-video"> ` +
      "(docs/formatos/linha-do-tempo.md)");
  }
  const declaracao = lerDeclaracao(readFileSync(html, "utf8"));
  // index.html sem o bloco: o pacote do Remotion (remotion bundle) ou a página que esqueceu a declaração.
  if (!declaracao) throw new ErroDeUso(`${html} não tem o bloco <script id="motor-video">; se é um pacote do Remotion, ${SEM_REMOTION}`);
  return { tipo: "linha", pasta: p, declaracao };
}

/**
 * A declaração da composição em linha do tempo (P10), ou null se o HTML não tem o bloco.
 * O bloco é o <script> cujo atributo id é motor-video (com ou sem aspas), fora de comentário; sem
 * type="application/json" o navegador o executaria como código. Largura ≥ 800 porque a faixa da marca tem 50 blocos
 * de 16 px; largura e altura pares por causa do 4:2:0 e até 8192, o limite do NVENC.
 */
export function lerDeclaracao(html: string): Declaracao | null {
  const atributo = (attrs: string, nome: string) =>
    new RegExp(`(?:^|\\s)${nome}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs)?.slice(1).find((x) => x !== undefined);
  const bloco = [...html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .find((m) => atributo(m[1], "id") === "motor-video");
  if (!bloco) return null;
  if (atributo(bloco[1], "type")?.toLowerCase() !== "application/json") {
    throw new ErroDeUso('o bloco <script id="motor-video"> precisa de type="application/json" (sem ele, o navegador o executa como código)');
  }
  let d: any;
  try { d = JSON.parse(bloco[2]); } catch (e) { throw new ErroDeUso(`o bloco <script id="motor-video"> não é JSON válido: ${(e as Error).message}`); }
  if (d === null || typeof d !== "object") throw new ErroDeUso('o bloco <script id="motor-video"> tem de ser um objeto');
  const campo = (nome: string, regra: string) => new ErroDeUso(`motor-video: «${nome}» ${regra}: ${JSON.stringify(d[nome])}`);
  if (typeof d.id !== "string" || !d.id) throw campo("id", "tem de ser o nome da composição (texto)");
  const inteiro = (x: unknown, min: number) => Number.isInteger(x) && (x as number) >= min;
  for (const [nome, min] of [["largura", 800], ["altura", 16]] as const) {
    if (!inteiro(d[nome], min) || d[nome] % 2 || d[nome] > 8192) throw campo(nome, `tem de ser inteiro par ≥ ${min} e ≤ 8192 (px)`);
  }
  if (!inteiro(d.qps, 1) || d.qps > 240) throw campo("qps", "tem de ser inteiro de 1 a 240");
  if (!inteiro(d.quadros, 1)) throw campo("quadros", "tem de ser inteiro ≥ 1");
  return { id: d.id, largura: d.largura, altura: d.altura, qps: d.qps, quadros: d.quadros };
}

/** Lê os argumentos (sem o `node` e o script). Lança ErroDeUso com a correção. */
export function lerArgumentos(argv: string[]): Argumentos {
  let r;
  try {
    r = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
      placa: { type: "boolean" }, cpu: { type: "boolean" }, hevc: { type: "boolean" }, props: { type: "string" }, de: { type: "string" },
      quadros: { type: "string" }, public: { type: "string" }, "sem-audio": { type: "boolean" }, alfa: { type: "boolean" },
      gravar: { type: "string" }, "gravar-pasta": { type: "string" }, manter: { type: "boolean" },
      "sem-contencao": { type: "boolean" }, ajuda: { type: "boolean", short: "h" }, captura: { type: "string" },
    } });
  } catch (e) {
    throw new ErroDeUso(`opção desconhecida ou sem valor: ${(e as Error).message}\n\n${USO}`);
  }
  const { values: o, positionals: p } = r;
  if (o.ajuda) throw new ErroDeUso(USO, 0);
  if (p.length < 3) throw new ErroDeUso(`faltam argumentos (recebi ${p.length} de 3): <entrada> <composição> <saída.mp4>\n\n${USO}`);
  if (p.length > 3) throw new ErroDeUso(`argumento a mais: ${p.slice(3).join(" ")} (as opções começam com --)`);
  if (o.placa && o.cpu) throw new ErroDeUso("--placa e --cpu juntos: escolha um, ou nenhum para a escolha automática");
  const alfa = o.alfa === true, hevc = o.hevc === true;
  if (alfa && o.cpu) throw new ErroDeUso("--alfa só existe no modo placa (o x264 da CPU não tem camada de alfa)");
  // P01: HEVC na CPU seria o x265, lento, e a CPU é dos sites (CLAUDE.md, «Segurança e operação»).
  if (hevc && o.cpu) throw new ErroDeUso("--hevc só existe no modo placa (na CPU o vídeo sai em H.264): tire o --cpu, ou rode sem --hevc");
  const [caminho, composicao, saida] = p;
  if (alfa && !saida.endsWith(".hevc")) throw new ErroDeUso("com --alfa a saída é .hevc (HEVC cru com a camada de alfa, a entrada --graficos do render-camadas.mjs)");
  if (!alfa && !saida.endsWith(".mp4")) throw new ErroDeUso(`a saída tem de terminar em .mp4: ${saida}`);
  // As opções que eram só da entrada do Remotion e do Electron dizem por que saíram.
  if (o.props !== undefined) throw new ErroDeUso(`--props era da entrada do Remotion; na linha do tempo os valores ficam na própria página. ${SEM_REMOTION}`);
  if (o.public !== undefined) throw new ErroDeUso(`--public era da entrada do Remotion; na linha do tempo os arquivos ficam na pasta da composição. ${SEM_REMOTION}`);
  if (o.captura !== undefined) throw new ErroDeUso("--captura saiu com a entrada do Remotion (2026-10-31): a captura é sempre pelo CEF (captura/cef/)");
  const entrada = lerEntrada(caminho);
  const gravar = o.gravar === undefined ? [] : o.gravar.split(",").map((x) => {
    if (!/^\d+$/.test(x)) throw new ErroDeUso(`--gravar: lista de quadros separados por vírgula, como 0,10,20: ${o.gravar}`);
    return Number(x);
  });
  if (gravar.length && !o["gravar-pasta"]) throw new ErroDeUso("--gravar pede --gravar-pasta <pasta> (onde os BGRA vão)");
  const de = inteiro(o.de, "--de", 0) ?? 0, quadros = inteiro(o.quadros, "--quadros", 1);
  const d = entrada.declaracao;
  if (composicao !== d.id) throw new ErroDeUso(`composição «${composicao}» não existe em ${entrada.pasta}; a declarada é ${d.id}`);
  if (de >= d.quadros) throw new ErroDeUso(`--de ${de} fora da composição (${d.quadros} quadros)`);
  if (quadros !== null && de + quadros > d.quadros) throw new ErroDeUso(`--de ${de} --quadros ${quadros} passa do fim (${d.quadros} quadros)`);
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
export const COMPILAR_NATIVO = "compile com: cd nativo && cargo build --release && cp target/release/libnativo.so nativo.node";

/** P04: o nativo.node carrega e expõe as funções e os métodos do motor? null se sim; senão, o motivo e como compilar. */
export function conferirNativo(carregar: () => unknown): string | null {
  let m: any;
  try { m = carregar(); } catch (e) {
    return `o nativo.node não carrega (${String((e as Error)?.message ?? e).split("\n")[0]}); ${COMPILAR_NATIVO}`;
  }
  const faltam = [...NATIVO_FUNCOES.filter((f) => typeof m?.[f] !== "function"),
    ...NATIVO_METODOS.filter((f) => typeof m?.Motor?.prototype?.[f] !== "function").map((f) => `Motor.${f}`)];
  if (faltam.length) return `o nativo.node não tem ${faltam.join(", ")} (compilado de outra versão do código); ${COMPILAR_NATIVO}`;
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
  if (a.env.MOTOR_SEM_PLACA === "1") return ausente("simulado por MOTOR_SEM_PLACA=1");
  const no = a.vendors().find(([, v]) => v.trim() === "0x10de");
  if (!no) return ausente("nenhum render node da NVIDIA em /sys/class/drm");
  if (!a.existe("/dev/nvidiactl")) return ausente("sem /dev/nvidiactl (driver da NVIDIA ausente ou placa escondida)");
  if (!a.noPath("weston")) return naoServe("weston fora do PATH (a tela virtual do modo placa)");
  if (!a.existe(CAMINHOS.hostCef)) return naoServe(`falta o host do CEF (${CAMINHOS.hostCef}): captura/cef/montar.sh`);
  if (!a.existe(CAMINHOS.nativo)) return naoServe(`falta o nativo.node (${CAMINHOS.nativo}); ${COMPILAR_NATIVO}`);
  const nativo = a.sondarNativo();
  if (nativo) return naoServe(nativo);
  const renderNode = `/dev/dri/${no[0]}`;
  const erro = a.sondarNvenc(renderNode, { codec, alfa });
  if (erro) return naoServe(`Vulkan/NVENC em ${codec === "h264" ? "H.264" : "HEVC"}${alfa ? " com a camada de alfa" : ""} não abriu: ${erro}`);
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
    throw new ErroDeUso(`--placa pedido, mas a placa não serve: ${s.motivo}. ` +
      (s.ausente ? "Use --cpu." : "Espere a placa liberar (ela é dividida com outros serviços) e rode de novo, ou use --cpu."), 3);
  }
  if (!s.ausente) {
    throw new ErroDeUso(`a placa NVIDIA está aqui, mas não serve agora: ${s.motivo}. Sem cair para a CPU (a CPU é dos sites): ` +
      "esperar a placa liberar (ela é dividida com outros serviços) e rodar de novo, ou usar --cpu de propósito.", 3);
  }
  return { modo: "cpu", renderNode: null, aviso: `sem placa (${s.motivo}): renderizando na CPU (desenho por software e x264), bem mais lento` };
}

export type ArquivoSondado = { quadros: number | null; video: string | null; audio: string | null;
  duracaoVideo: number | null; duracaoAudio: number | null };

/**
 * Confere o arquivo final (ainda o parcial, antes de ir para o lugar): os quadros de vídeo são os que o render mandou e,
 * se havia áudio para misturar, a faixa existe e dura o vídeo, com folga de um quadro. null se confere; senão, o erro.
 */
export function conferirArquivo(s: ArquivoSondado, esperado: { quadros: number; fps: number; audio: boolean }): string | null {
  if (s.quadros === null) return "sem faixa de vídeo legível (ffprobe)";
  if (s.quadros !== esperado.quadros) return `o arquivo tem ${s.quadros} quadros de vídeo; o render mandou ${esperado.quadros}`;
  if (!esperado.audio) return null;
  if (!s.audio || s.duracaoAudio === null) return "a mistura tinha áudio, mas o arquivo saiu sem a faixa de áudio";
  const video = esperado.quadros / esperado.fps;
  if (Math.abs(s.duracaoAudio - video) > 1 / esperado.fps) {
    return `o áudio dura ${s.duracaoAudio.toFixed(3)} s; o vídeo, ${video.toFixed(3)} s (diferença acima de um quadro)`;
  }
  return null;
}

/**
 * Tempo-limite da captura, em ms: 180 s de folga (subida, fontes) mais 0,4 s por quadro na placa e 0,6 s na
 * CPU. Sem o número de quadros (--quadros ausente, antes de a composição abrir), conta 3000.
 */
export function tempoLimite(quadros: number | null, modo: "placa" | "cpu"): number {
  return Math.round((180 + (quadros ?? 3000) * (modo === "cpu" ? 0.6 : 0.4)) * 1000);
}
