// Comando de render do motor (M08): uma composição em linha do tempo declarada (P10) até o MP4 final, com vídeo e
// áudio, na placa ou na CPU. A entrada do Remotion saiu do motor em 2026-10-31 (docs/adr.md, seção 16).
//
//   node cli/render.ts <entrada> <composição> <saída.mp4> [--placa | --cpu] [--hevc] [--de N --quadros N] ...
//   (node cli/render.ts --ajuda lista as opções)
//
// Passos: lê e confere os argumentos (cli/regras.ts); escolhe o modo (--placa, --cpu ou automático, que sonda a placa e
// cai para CPU avisando); sobe o weston headless (só na placa) e a captura pelo CEF (o captura/main.ts no Node, com o
// host de captura/cef/: textura → NVENC, ou bitmap → x264); o áudio sai da mesma passada (audio.ts, M07); por fim, o
// MP4, em H.264 por padrão (P01; HEVC com
// --hevc ou --alfa, só na placa). Tudo numa pasta temporária, apagada no
// fim, no erro e no sinal, com os processos (cli/processos.ts).
//
// Saída: progresso e avisos no stderr; no stdout, uma linha JSON com o resultado. Códigos: 0 ok; 1 render falhou;
// 2 argumentos; 3 --placa sem placa; 128 + sinal se interrompido.
// Variáveis: MOTOR_SEM_PLACA=1 simula a falta da placa (a sonda falha sem abrir o NVENC); MOTOR_DEPURAR=1 mostra o
// log da captura; MOTOR_REPETIR=0 desenha todos os quadros da linha do tempo, sem o quadro repetido (P10.3; para
// medir e conferir); MOTOR_PULADO=0 faz o NVENC codificar o quadro repetido em vez do P pulado escrito pelo motor (C01;
// para medir e conferir). Fontes do Google (captura/fontes.ts): a que faltar no cache é baixada uma vez, sozinha (sem
// rede, o render cai no carregamento da página, dizendo a URL); M04_FONTES=cache só lê o cache (falha se faltar).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { CAMINHOS, conferirArquivo, conferirNativo, esconderPlaca, ICD_VULKAN_NVIDIA, ErroDeUso, tempoLimite, escolherModo, lerArgumentos, sondarPlaca, type Ambiente,
  type Argumentos, type ArquivoSondado, type Escolha } from "./regras.ts";
import { Recursos, rodarSemSaida } from "./processos.ts";
import { esperarJob, type Aberto } from "./abertura.ts";
// @ts-ignore: módulo .mjs sem tipos
import { prefixoContencao } from "../ferramentas/contencao.mjs";
import { entradaDoVideo } from "../composicao/audio.ts";
import { gravarBrilho } from "./brilho.ts";

const SONDA = new URL("./sonda-nvenc.ts", import.meta.url).pathname;
const PLACA_ENV = {
  __EGL_VENDOR_LIBRARY_FILENAMES: "/usr/share/glvnd/egl_vendor.d/10_nvidia.json",
  VK_ICD_FILENAMES: ICD_VULKAN_NVIDIA.find(existsSync) ?? ICD_VULKAN_NVIDIA[0],
  GBM_BACKEND: "nvidia-drm",
};
const MARCA = 16;
const avisar = (texto: string) => process.stderr.write(`motor: ${texto}\n`);

/** O ambiente de verdade da sonda (cli/regras.ts, sondarPlaca). */
export function ambienteReal(): Ambiente {
  return {
    env: process.env,
    existe: existsSync,
    vendors: () => {
      try {
        return readdirSync("/sys/class/drm").filter((d) => /^renderD\d+$/.test(d))
          .map((d): [string, string] => { try { return [d, readFileSync(`/sys/class/drm/${d}/device/vendor`, "utf8")]; } catch { return [d, ""]; } });
      } catch { return []; }
    },
    noPath: (b) => spawnSync("sh", ["-c", 'command -v "$1"', "sh", b], { stdio: "ignore" }).status === 0,
    sondarNvenc: (_renderNode, { codec, alfa }) => {
      // P13 (experimento, como o MOTOR_PULADO): MOTOR_SONDA_NVENC=0 não abre o NVENC na sonda, porque quem chamou já
      // sondou (as K páginas do paralelo.mjs abriam K sondas, cada uma com a partida do CUDA e do Vulkan).
      if (process.env.MOTOR_SONDA_NVENC === "0") return null;
      const r = spawnSync(process.execPath, [SONDA, CAMINHOS.nativo, alfa ? "hevc-alfa" : codec], { encoding: "utf8", timeout: 20000, killSignal: "SIGKILL",
        env: { ...process.env, ...PLACA_ENV } });
      if (r.error) return `sonda: ${r.error.message}`;
      return r.status === 0 ? null : (r.stderr.trim().split("\n").pop() || `sonda saiu com ${r.status}`);
    },
    sondarNativo: () => conferirNativo(() => createRequire(import.meta.url)(CAMINHOS.nativo)),
  };
}

type Fim = { codigo: number | null; sinal: string | null; estourou: boolean };

/** Vigia o processo: tempo-limite (que pode ser refeito, contado do início) e o fim. Estourou, mata o grupo. */
function vigiar(p: ChildProcess, limiteMs: number, nome: string): { fim: Promise<Fim>; refazer: (ms: number) => void } {
  const inicio = performance.now();
  let estourou = false, relogio: NodeJS.Timeout | undefined, acabou = false;
  const armar = (ms: number) => {
    clearTimeout(relogio);
    relogio = setTimeout(() => {
      estourou = true;
      avisar(`${nome} passou do tempo-limite de ${Math.round(ms / 1000)} s`);
      try { process.kill(-p.pid!, "SIGKILL"); } catch {}
    }, Math.max(0, ms - (performance.now() - inicio)));
  };
  armar(limiteMs);
  const fim = new Promise<Fim>((ok) => {
    p.on("error", (e) => { acabou = true; clearTimeout(relogio); avisar(`${nome} não abriu: ${e.message}`); ok({ codigo: -1, sinal: null, estourou }); });
    p.on("close", (codigo, sinal) => { acabou = true; clearTimeout(relogio); ok({ codigo, sinal, estourou }); });
  });
  return { fim, refazer: (ms) => { if (!acabou) armar(ms); } };
}

/** Espera o processo sair; com tempo-limite, mata o grupo. Devolve o código (ou o sinal). */
const esperar = (p: ChildProcess, limiteMs: number, nome: string) => vigiar(p, limiteMs, nome).fim;

/** Move entre sistemas de arquivos (a pasta temporária pode estar noutro). */
function mover(de: string, para: string) {
  try { renameSync(de, para); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    copyFileSync(de, para); rmSync(de, { force: true });
  }
}

async function subirWeston(r: Recursos, tmp: string): Promise<string> {
  const socket = `motor-render-${process.pid}`;
  const dir = process.env.XDG_RUNTIME_DIR;
  if (!dir) throw new Error("XDG_RUNTIME_DIR vazio: o weston precisa dele para o socket (sessão de usuário do systemd)");
  const log = join(tmp, "weston.log");
  const p = r.iniciar("weston", ["--backend=headless", "--renderer=gl", `--socket=${socket}`, "--width=1920", "--height=1096",
    "--idle-time=0", `--log=${log}`], { env: { ...process.env, ...PLACA_ENV } });
  let morreu = false;
  p.on("exit", () => { morreu = true; });
  for (let i = 0; i < 100; i++) {
    if (existsSync(join(dir, socket))) return socket;
    if (morreu) break;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  const fim = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").slice(-5).join("\n") : "";
  throw new Error(`o weston não subiu em 5 s${morreu ? " (saiu)" : ""}:\n${fim}`);
}

type Resumo = Record<string, any>;

/** As opções do Chromium no modo placa (as mesmas no frio e no quente, cli/abertura.ts). */
const flagsPlaca = (e: Escolha) => ["--ozone-platform=wayland", `--render-node-override=${e.renderNode}`];

async function renderizar(a: Argumentos, e: Escolha, r: Recursos, tmp: string, aberto: Aberto | null = null) {
  const cpu = e.modo === "cpu";
  // P02: o captura/main.ts roda no Node com o `electron` e o `nativo.node` trocados pelo host do CEF (captura/cef/).
  if (!existsSync(CAMINHOS.hostCef)) throw new Error(`falta o host do CEF (${CAMINHOS.hostCef}): captura/cef/montar.sh`);
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    M04_MODO: e.modo, M04_PACOTE: a.entrada.pasta, M04_COMPOSICAO: a.composicao, M04_INICIO: String(a.de),
    M04_ROTULO: "render", M04_SAIDA: tmp, M04_AUDIO: a.audio ? "1" : "0", M04_ALFA: a.alfa ? "1" : "0",
    M04_CODEC: a.codec,
    // Sem --gravar, nenhum quadro vem para a CPU no modo placa (R04, só a linha da marca).
    M04_CONFERIR: a.gravar.length ? "1" : "0", M04_GRAVAR: a.gravar.join(","),
  };
  if (a.quadros !== null) env.M04_QUADROS = String(a.quadros);
  // Achado do P07: a fonte do Google fora do cache derrubava o render. Agora o comando a baixa (só ela, só uma vez).
  if (!process.env.M04_FONTES) env.M04_FONTES = "preparar";
  // P10: a linha do tempo declarada; o vídeo e o áudio embutidos são os <video> e <audio> da página (P10.5,
  // docs/formatos/linha-do-tempo.md, composicao/midia-linha.ts). Começar no meio (--de) dá o mesmo quadro N que o
  // render inteiro: o main.ts desenha antes o N − 1 sem captura (R03, P10.4).
  env.M04_LINHA = JSON.stringify(a.entrada.declaracao);
  if (process.env.MOTOR_REPETIR === "0") env.M04_REPETIR = "0";
  let flags: string[];
  let prefixo: string[] = [];
  if (cpu) {
    // A placa escondida, como o M06: sem /dev/dri nem /dev/nvidia* (bwrap), --disable-gpu e CUDA_VISIBLE_DEVICES vazio.
    // O WebGL da conversão de cor (cor-limpa.js) sai do SwiftShader, que no Chromium 156 só liga com a flag «unsafe»;
    // a página é nossa e sem rede (adr.md, seção 9).
    env.CUDA_VISIBLE_DEVICES = "";
    flags = ["--ozone-platform=headless", "--ozone-override-screen-size=4096,4096", "--disable-gpu", "--disable-gpu-compositing",
      "--enable-unsafe-swiftshader"];
    const sem = esconderPlaca(rodarSemSaida, existsSync("/dev/nvidiactl"));
    prefixo = sem.prefixo;
    if (sem.aviso) avisar(sem.aviso);
  } else {
    Object.assign(env, PLACA_ENV, { WAYLAND_DISPLAY: aberto?.wayland ?? await subirWeston(r, tmp) });
    flags = flagsPlaca(e);
  }
  if (a.contencao) prefixo = [...prefixoContencao(), ...prefixo];
  // --no-sandbox: o chrome-sandbox do npm não é root com SUID (pendência do adr.md, seção 3).
  const navegador = [process.execPath, "--import", CAMINHOS.ganchosCef, join(CAMINHOS.captura, "main.ts")];
  // P02: o cache de compilação do Node guarda o TypeScript já sem tipos e o código do V8 da captura pelo CEF (sem ele,
  // ~0,06 s de CPU por render só para abrir as cascas). Fora do repositório; sem acesso, o Node segue sem cache.
  if (!env.NODE_COMPILE_CACHE && process.env.HOME) env.NODE_COMPILE_CACHE = join(process.env.HOME, ".cache", "motor-video", "node-compilado");
  const comando = [...prefixo, ...navegador, "--no-sandbox", ...flags];
  const limite = tempoLimite(a.quadros, e.modo);
  avisar(`renderizando «${a.composicao}» no modo ${e.modo}${a.quadros ? `, ${a.quadros} quadros a partir do ${a.de}` : ""}`);
  const t0 = performance.now();
  // Quente (--esperar): o navegador já está de pé e recebe as variáveis do job; daqui em diante, igual ao frio.
  const p = aberto ? aberto.entregar(env) : r.iniciar(comando[0], comando.slice(1), { env, stdio: ["ignore", "pipe", "pipe"] });
  const vigia = vigiar(p, limite, "a captura");
  const log: string[] = [];
  const falhas: string[] = [];
  let resumo: Resumo | null = null, composicao: Resumo | null = null;
  const linha = (l: string) => {
    log.push(l);
    if (process.env.MOTOR_DEPURAR === "1") process.stderr.write(`  captura: ${l}\n`);
    if (l.startsWith("resumo ")) { try { resumo = JSON.parse(l.slice(7)); } catch {} }
    else if (l.startsWith("composição ")) {
      try {
        const c = JSON.parse(l.slice(11));
        composicao = c;
        avisar(`composição ${l.slice(11)}`);
        // A duração real chegou: o limite passa a contar os quadros de verdade, não o padrão de 3000.
        if (a.quadros === null && Number.isInteger(c.duracao)) {
          const q = Math.max(1, c.duracao - a.de), ms = tempoLimite(q, e.modo);
          vigia.refazer(ms);
          if (process.env.MOTOR_DEPURAR === "1") avisar(`tempo-limite refeito: ${Math.round(ms / 1000)} s (${q} quadros)`);
        }
      } catch {}
    }
    else if (/^(falhou|paint falhou|página:)/.test(l)) falhas.push(l);
  };
  for (const s of [p.stdout!, p.stderr!]) {
    let resto = "";
    s.on("data", (d) => { const partes = (resto + d).split("\n"); resto = partes.pop()!; partes.forEach(linha); });
    s.on("end", () => { if (resto) linha(resto); });
  }
  const fim = await vigia.fim;
  writeFileSync(join(tmp, "captura.log"), log.join("\n"));
  const parede = (performance.now() - t0) / 1000;
  const res: Resumo = resumo ?? {};
  if (fim.codigo !== 0 || res.motivo !== "ok") {
    const motivo = falhas.length ? falhas.slice(0, 6).join("\n") : log.slice(-12).join("\n");
    throw new Error(`o render falhou (a captura saiu com ${fim.codigo ?? fim.sinal}${fim.estourou ? ", tempo-limite" : ""}):\n${motivo}`);
  }
  return { resumo: res, composicao: composicao as Resumo | null, parede };
}

/** Roda um ffmpeg curto no grupo dele; lança com o fim do stderr se falhar. */
async function ffmpeg(r: Recursos, args: string[], nome: string) {
  const p = r.iniciar("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
  let erro = "";
  p.stderr!.on("data", (d) => { erro += d; });
  const fim = await esperar(p, 120000, nome);
  if (fim.codigo !== 0) throw new Error(`${nome} falhou: ${erro.trim().slice(-400)}`);
}

/**
 * O arquivo final: o MP4 da mistura do áudio, se houve; senão, o vídeo cru posto em MP4 sem recodificar (com --alfa,
 * o HEVC cru). É montado num parcial ao lado da saída, conferido (conferirArquivo) e só então vai para o lugar; se não
 * confere, o parcial é apagado na liberação e a saída nem aparece.
 */
async function finalizar(a: Argumentos, e: Escolha, r: Recursos, tmp: string, fps: number, quadros: number, comAudio: boolean) {
  mkdirSync(dirname(a.saida), { recursive: true });
  const ext = a.alfa ? ".hevc" : ".mp4";
  const parcial = join(dirname(a.saida), `.${basename(a.saida, ext)}.parcial-${process.pid}${ext}`);
  r.parcial(parcial);
  // Na CPU o codec é sempre H.264 (--hevc pede a placa, cli/regras.ts).
  const bruto = join(tmp, `render.${a.codec}`);
  if (a.alfa) mover(bruto, parcial);
  else if (existsSync(join(tmp, "render.mp4"))) mover(join(tmp, "render.mp4"), parcial);
  else {
    const v = entradaDoVideo(bruto, fps);
    await ffmpeg(r, [...v.entrada, "-c:v", "copy", ...v.filtro, "-video_track_timescale", "90000",
      "-movflags", "+faststart", "-f", "mp4", parcial], "o ffmpeg que monta o MP4");
  }
  // Só para o teste da conferência: tira o último quadro do parcial (cli/render.test.ts).
  if (process.env.MOTOR_TESTE_DIVERGIR === "quadro" && !a.alfa) {
    const copia = `${parcial}.copia.mp4`;
    r.parcial(copia);
    await ffmpeg(r, ["-i", parcial, "-map", "0", "-c", "copy", "-frames:v", String(quadros - 1), copia], "o ffmpeg da divergência");
    renameSync(copia, parcial);
  }
  const sonda = sondarSaida(parcial);
  const erro = conferirArquivo(sonda, { quadros, fps, audio: comAudio });
  if (erro) throw new Error(`o arquivo final não confere: ${erro}; ${basename(a.saida)} não foi gravado`);
  renameSync(parcial, a.saida);
  r.soltar(parcial);
  return sonda;
}

/** O que o arquivo tem: quadros de vídeo (pacotes contados), codecs e a duração de cada faixa. */
function sondarSaida(arquivo: string): ArquivoSondado {
  const s = spawnSync("ffprobe", ["-v", "error", "-count_packets", "-show_entries",
    "stream=codec_type,codec_name,nb_read_packets,duration", "-of", "json", arquivo], { encoding: "utf8" });
  const num = (x: unknown) => (x === undefined || x === "N/A" ? null : Number(x));
  try {
    const j = JSON.parse(s.stdout);
    const v = j.streams.find((x: Resumo) => x.codec_type === "video"), au = j.streams.find((x: Resumo) => x.codec_type === "audio");
    return { quadros: v ? Number(v.nb_read_packets) : null, video: v?.codec_name ?? null, audio: au?.codec_name ?? null,
      duracaoVideo: num(v?.duration), duracaoAudio: num(au?.duration) };
  } catch { return { quadros: null, video: null, audio: null, duracaoVideo: null, duracaoAudio: null }; }
}

async function principal() {
  // Abertura rápida (serviço): `--esperar` abre antes (pelo CEF) e lê os argumentos do stdin (cli/abertura.ts).
  if (process.argv[2] === "--esperar") {
    const q = await esperarJob({ sondar: () => sondarPlaca(ambienteReal()), subirWeston, flags: flagsPlaca, placaEnv: PLACA_ENV },
      // `--esperar --previa`: o processo quente da prévia (cli/previa.ts, S07), que também grava quadros.
      { previa: process.argv.includes("--previa") });
    return executar(q.a, q.e, q.r, q.tmp, q.aberto);
  }
  let a: Argumentos, e: Escolha;
  try {
    a = lerArgumentos(process.argv.slice(2));
    e = escolherModo(a.modo, () => sondarPlaca(ambienteReal(), { codec: a.codec, alfa: a.alfa }));
  } catch (erro) {
    if (erro instanceof ErroDeUso) {
      (erro.codigo === 0 ? process.stdout : process.stderr).write(`${erro.codigo === 0 ? "" : "erro: "}${erro.message}\n`);
      process.exit(erro.codigo);
    }
    throw erro;
  }
  if (e.aviso) avisar(`aviso: ${e.aviso}`);
  const depurar = process.env.MOTOR_DEPURAR === "1";
  const r = new Recursos({ manter: a.manter, aoIniciar: depurar ? (pid, c) => avisar(`grupo ${pid}: ${basename(c)}`) : null });
  r.aoSinal();
  return executar(a, e, r, null, null);
}

async function executar(a: Argumentos, e: Escolha, r: Recursos, temporaria: string | null, aberto: Aberto | null) {
  const t0 = performance.now();
  try {
    const tmp = temporaria ?? r.pasta("motor-render-");
    if (process.env.MOTOR_DEPURAR === "1") avisar(`temporária ${tmp}`);
    const { resumo, composicao, parede } = await renderizar(a, e, r, tmp, aberto);
    if (a.gravar.length) {
      mkdirSync(a.gravarPasta!, { recursive: true });
      for (const n of a.gravar) {
        const de = join(tmp, `render-${n}.bgra`);
        if (!existsSync(de)) throw new Error(`--gravar: o quadro ${n} não foi gravado (fora do trecho ${a.de}…${a.de + resumo.quadros - 1}?)`);
        mover(de, join(a.gravarPasta!, `motor-${n}.bgra`));
      }
    }
    const comAudio = (resumo.audio?.trilhas ?? 0) > 0;
    const saida = await finalizar(a, e, r, tmp, composicao?.fps ?? 30, resumo.quadros, comAudio);
    if (a.audio && !comAudio) avisar("a composição não tem áudio: o MP4 saiu só com vídeo");
    // Brilho por quadro medido na placa (só na placa): a série ao lado da saída e a piscada (cli/brilho.ts).
    const brilho = resumo.brilho?.length ? gravarBrilho(a.saida, resumo.brilho, resumo.mudanca ?? [], { qps: composicao?.fps ?? 30, de: a.de, msBrilho: resumo.msBrilho ?? null, alfa: a.alfa }) : null;
    if (resumo.brilhoErro) avisar(`aviso: o brilho por quadro não foi medido (${resumo.brilhoErro})`);
    for (const p of brilho?.piscadas ?? []) avisar(`aviso: piscada no quadro ${p.quadro} (pico isolado de ${p.pico} no brilho: ${p.antes} → ${p.brilho} → ${p.depois}; limite ${brilho!.limitePiscada})`);
    const resultado = {
      ok: true, saida: a.saida, modo: e.modo, caiuParaCpu: e.aviso !== null, composicao: composicao ?? { id: a.composicao },
      // codec: o do vídeo do arquivo (h264 ou hevc). O «video» abaixo é o resumo do vídeo embutido (P10.5), null sem vídeo.
      quadros: resumo.quadros, codec: saida.video, audio: saida.audio, duracao: saida.duracaoVideo, duracaoAudio: saida.duracaoAudio,
      bytes: statSync(a.saida).size, parede: Number(((performance.now() - t0) / 1000).toFixed(2)),
      paredeRender: Number(parede.toFixed(2)), paredeQuadros: resumo.paredeQuadros, mistura: resumo.audio ?? null,
      // C01: medianas por quadro na thread do NVENC (ms), desenhado e repetido; só na placa.
      ...(resumo.msCodificacao != null ? { msCodificacao: resumo.msCodificacao, msRepeticao: resumo.msRepeticao ?? null } : {}),
      gravados: a.gravar.length ? a.gravarPasta : null,
      // Brilho por quadro (docs/formatos/brilho.md): a série no arquivo ao lado, o resumo e as piscadas aqui; null na CPU.
      brilho,
      // S08 (experimento, MOTOR_TAKE_PLACA=1): quadros com o vídeo montado na placa e pelo canvas, e o NVDEC.
      ...(resumo.take ? { take: { ...resumo.take, quadros: resumo.takeQuadros ?? null, msMontagem: resumo.msMontagem ?? null, montados: resumo.montados ?? 0, nvdec: resumo.nvdec ?? null } } : {}),
      transicoesAoFim: resumo.transicoesAoFim ?? null, animacoesSoltas: resumo.animacoesSoltas ?? null,
        // S01: animações de cima do GSAP e animações Lottie que a página trouxe (o motor as põe no quadro N).
        bibliotecas: resumo.bibliotecas ?? null,
        // R03: elementos com a dica de transform do will-change trocada por left (captura/main.ts, conferirLista).
        camadasNeutras: resumo.camadasNeutras ?? 0,
        midias: resumo.midias ?? null, video: resumo.midias?.videos ? { entregues: resumo.videoEntregues, repetidos: resumo.videoRepetidos,
          aquecimento: resumo.videoAquecimento ?? 0, ms: resumo.videoMs, cor: resumo.cor ?? null } : null,
        // P10.4: quadros N − 1 desenhados sem captura antes de uma descontinuidade (começo no meio, salto).
        aquecidos: resumo.aquecidos ?? 0,
        // R03 depois de escala 0: quadros N desenhados sem captura antes do N − 1 (captura/main.ts, o laço).
        limpos: resumo.limpos ?? 0,
        // P10.3: quadros repetidos no NVENC sem página nem cópia (só na placa), e por que não houve, se não houve.
        repetidos: resumo.repetidos ?? 0, repetirNao: resumo.repetirMotivo ?? null,
        // C01: repetidos escritos como P pulado, sem NVENC (o resto o NVENC codificou: começo de GOP, alfa), e por que
        // o pulado parou de valer, se parou.
        pulados: resumo.pulados ?? 0, puladoDesligado: resumo.puladoDesligado ?? null,
        // P13 (experimento, M04_BATIDA=externa): batidas de quadro mandadas pelo motor no laço; sem ela, não aparece.
        ...(resumo.batidasLaco !== undefined ? { batidasLaco: resumo.batidasLaco, paints: resumo.paints } : {}),
    };
    // P10: animação fora da document.timeline não anda com N (docs/formatos/linha-do-tempo.md).
    if (resultado.animacoesSoltas) avisar(`aviso: ${resultado.animacoesSoltas} animação(ões) fora da linha do tempo do documento ficaram paradas (rolagem ou outra DocumentTimeline)`);
    await r.liberar();
    process.stdout.write(`${JSON.stringify(resultado)}\n`);
    avisar(`pronto: ${a.saida} (${resumo.quadros} quadros, ${saida.video}${saida.audio ? ` + ${saida.audio}` : ""}, ${resultado.parede} s)`);
  } catch (erro) {
    await r.liberar();
    process.stderr.write(`erro: ${(erro as Error).message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await principal();
