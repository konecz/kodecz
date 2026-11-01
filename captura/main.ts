// Captura do motor: abre a composição em linha do tempo declarada (P10, docs/formatos/linha-do-tempo.md) e a renderiza
// pelo caminho do M02/M03: textura do Chromium → Vulkan → NVENC (ou, na CPU, bitmap → x264), com o quadro N garantido
// pela marca (M03). Roda no Node sobre o host do CEF (captura/cef/ganchos.ts troca o `electron` e o `nativo.node`).
// A entrada do Remotion saiu do motor em 2026-10-31 (docs/adr.md, seção 16).
// A janela é uma moldura (moldura.html) de L × (A + 16): em cima, um <iframe> L × A com a composição, que para ela é
// a janela inteira (vh, position:fixed e bottom dependem disso); embaixo, a faixa da marca, fora da área codificada.
// Mesmo processo e mesmo compositor: marca e conteúdo saem no mesmo quadro.
// Passos: servir a pasta da composição por HTTP local; a moldura abre o index.html no iframe; a página fica com a
// linha do tempo do documento parada (auxiliarLinha); para cada N, motor_irPara(N) põe cada animação no quadro N e,
// só então, a marca N é trocada na moldura; o paint com a marca N é o aceito.
// Variáveis: M04_LINHA (a declaração, JSON { id, largura, altura, qps, quadros }, obrigatória; ver auxiliarLinha),
//   M04_PACOTE (pasta da composição, servida ao iframe), M04_COMPOSICAO (o id),
//   M04_INICIO / M04_QUADROS (trecho; padrão a composição inteira), M04_QPS (240), M04_CONFERIR (1), M04_ROTULO,
//   M04_SAIDA, M04_ESPERA (200), M04_TEMPO (ms de espera da página: fontes e imagens, 30000),
//   M04_GRAVAR (índices gravados em BGRA, para o lado a lado; «todos» grava todos em M04_GRAVAR_PASTA),
//   M04_FONTES (preparar = baixa para o cache as fontes do Google que faltarem, padrão do cli/render.ts; sem isso, só o cache),
//   M04_FONTES_CACHE (pasta do cache, padrão ~/.cache/motor-video/fontes), M04_AUTOTESTE (1 = testa
//   o bloqueio de rede, de navegação e de janela e a resposta 400 antes de renderizar), M04_AUDIO (1 = coleta os
//   assets de cada quadro e mistura no <rótulo>.mp4, ver audio.ts; 0 = sem áudio), M04_FFMPEG / M04_FFPROBE /
//   M04_AAC (binários e codificador da mistura),
//   M04_MARCA_VIDEO (1 = lê em cada quadro a marca do vídeo sintético do M09, marca-video.ts, para o
//   conferir-video.mjs; precisa de M04_CONFERIR=1),
//   M04_COR (propria = o motor converte o vídeo de YUV para RGB como o Remotion, cor-limpa.js; chromium = a do
//   Chromium; padrão propria), M04_COR_MISTA (1 = aceita quadros que a conversão própria não cobre, como 10 bits,
//   alfa ou NV12, pelo caminho do Chromium; sem isso, o render falha dizendo o formato), M04_COR_TESTE (1 = roda o
//   teste das falhas da conversão, que perde o contexto WebGL: o render seguinte tem de falhar),
//   M04_MODO (placa = textura → Vulkan → NVENC, padrão; cpu = M08: o `paint` sem textura, a marca da faixa lida em
//   JS, faixa.ts, e o quadro cru ao x264 por pipe, codificador-cpu.ts, como o M06; o vídeo sai em <rótulo>.h264),
//   M04_ALFA (1 = HEVC com a camada de alfa, padrão, para a montagem do M05; 0 = sem alfa, o MP4 final do comando),
//   M04_CODEC (P01, só na placa: hevc, padrão aqui; h264, o padrão do comando, perfil High, sem alfa; o vídeo sai em
//   <rótulo>.<codec>, e o qps da composição vai ao VUI do NVENC),
//   vídeo e áudio embutidos pelos <video> e <audio> da página (P10.5, ver midia-linha.ts),
//   M04_REPETIR (P10.3, só na placa: 1 = repete no NVENC, sem página nem cópia, o quadro que os
//   intervalos das animações dizem igual ao anterior, padrão; 0 = desenha todos), M04_FILA (P10.2: quadros copiados
//   que podem esperar o NVENC, padrão do nativo).
// Experimento (P13): M04_BATIDA=externa, só na placa: o compositor do CEF só faz quadro quando o motor bate
//   (SendExternalBeginFrame), em vez das M04_QPS batidas por segundo sempre: no laço, só da marca N até o paint com
//   ela, e enquanto a página trabalha no quadro (rAF do aquecimento, motor_quadro); fora do laço, sempre. No ritmo do
//   M04_QPS ou a cada M04_BATIDA_MS ms. O CEF dá a cada batida o prazo de um intervalo do windowless_frame_rate: a
//   janela declara M04_BATIDA_QPS (1000) para o prazo ser curto; com 240, o quadro levava ~10 ms e 4 batidas.
// Só para teste e diagnóstico (P10.4): M04_ORDEM (embaralhada = o trecho fora de ordem, com a semente M04_SEMENTE;
//   ou a lista de quadros, «59,2», nessa ordem), M04_CHROMIUM (opções a mais do Chromium, separadas por espaço),
//   M04_RASTRO (arquivo JSON do rastro do Chromium no laço) e M04_RASTRO_CAT (categorias; padrão a das camadas).
// O comando de render (cli/render.ts, M08) monta estas variáveis; ver o ARCHITECTURE.md.
import { app, BrowserWindow } from 'electron';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { lerMarcaVideo } from './marca-video.ts';
import { aoTerminar, ColetorDeAudio, filhosAtivos } from '../composicao/audio.ts';
import { lerFaixa, lerMarcaEm } from './faixa.ts';
import { assetsDoQuadro, fecharMidias, indiceNoVideo, paraPagina, prepararMidias, quadroDoVideo, tempoNoVideo } from '../composicao/midia-linha.ts';
import { CodificadorCpu } from './codificador-cpu.ts';
import { ErroDeFonte, HOSTS_FONTES, obterFonte } from './fontes.ts';
import { quadrosParados } from '../composicao/parados.ts';

const MARCA = 16, TARJA_Y = 1064;
const env = process.env;
const modo = env.M04_MODO ?? 'placa';
if (!['placa', 'cpu'].includes(modo)) { console.log(`falhou: M04_MODO deve ser placa ou cpu: ${modo}`); process.exit(2); }
const cpu = modo === 'cpu';
const pacote = env.M04_PACOTE ?? new URL('../tmp/m04/pacote', import.meta.url).pathname;
const id = env.M04_COMPOSICAO ?? 'Sintetica';
const QPS = Number(env.M04_QPS ?? 240);
const BATIDA_EXTERNA = env.M04_BATIDA === 'externa' && !cpu;
// Intervalo do relógio da batida externa, em ms (padrão o do M04_QPS).
const PASSO_BATIDA = Number(env.M04_BATIDA_MS ?? 1000 / QPS);
// O qps declarado ao CEF com a batida externa: só dá o prazo de cada batida (1 / qps), não bate sozinho.
const QPS_BATIDA = Number(env.M04_BATIDA_QPS ?? 1000);
if (BATIDA_EXTERNA && !(Number.isInteger(QPS_BATIDA) && QPS_BATIDA > 0 && PASSO_BATIDA >= 1)) {
  console.log(`falhou: M04_BATIDA_QPS (${env.M04_BATIDA_QPS}) tem de ser inteiro positivo e M04_BATIDA_MS (${env.M04_BATIDA_MS}) ao menos 1`);
  process.exit(2);
}
const ESPERA = Number(env.M04_ESPERA ?? 200);
const TEMPO = Number(env.M04_TEMPO ?? 30000);
const conferir = (env.M04_CONFERIR ?? '1') === '1';
const marcaVideo = env.M04_MARCA_VIDEO === '1';
// A entrada é só a linha do tempo (P10): o pacote do Remotion saiu do motor (docs/adr.md, seção 16).
if (!env.M04_LINHA) { console.log('falhou: falta M04_LINHA (a declaração da linha do tempo); a entrada do Remotion saiu do motor (docs/adr.md, seção 16)'); process.exit(2); }
const linha = JSON.parse(env.M04_LINHA);
// A conversão de cor própria (M09) vale para o vídeo embutido da linha do tempo (P10.5), que monta o VideoFrame com o
// quadro decodificado pelo motor.
const corPropria = (env.M04_COR ?? 'propria') === 'propria';
const COR_LIMPA = corPropria ? readFileSync(new URL('../composicao/cor-limpa.js', import.meta.url), 'utf8') : '';
// S08: o vídeo embutido da linha do tempo decodificado no NVDEC e montado por baixo da página na placa
// (composicao/take-placa.js, nativo/src/mistura.rs), por padrão na placa sem alfa; o quadro cuja geometria não se
// reproduz vai pelo canvas (P10.5). MOTOR_TAKE_PLACA=0 desliga (tudo pelo canvas).
const takePlaca = env.MOTOR_TAKE_PLACA !== '0' && !cpu && env.M04_ALFA === '0';
const TAKE_PLACA = takePlaca ? readFileSync(new URL('../composicao/take-placa.js', import.meta.url), 'utf8') : '';
const comAudio = (env.M04_AUDIO ?? '1') === '1';
const rotulo = env.M04_ROTULO ?? 'm04';
const saida = env.M04_SAIDA ?? new URL('../tmp/m04', import.meta.url).pathname;
const gravarTodos = env.M04_GRAVAR === 'todos';
const gravar = new Set(gravarTodos ? [] : (env.M04_GRAVAR ?? '').split(',').filter(Boolean).map(Number));
// Com M04_GRAVAR=todos, cada quadro vai para M04_GRAVAR_PASTA/<n>.bgra (para diferenca.mjs).
const pastaGravar = env.M04_GRAVAR_PASTA ?? join(env.M04_SAIDA ?? new URL('../tmp/m04', import.meta.url).pathname, `quadros-${env.M04_ROTULO ?? 'm04'}`);
if (gravarTodos) mkdirSync(pastaGravar, { recursive: true });
// Rede: só o servidor local, data:, blob: e as fontes do Google, que saem de um cache fora do repositório (R01: a
// lista de fontes é da composição; captura/fontes.ts). M04_FONTES=preparar baixa para o cache a que faltar (o comando
// de render liga sozinho); sem isso, só o cache.
const cacheFontes = env.M04_FONTES_CACHE ?? join(homedir(), '.cache', 'motor-video', 'fontes');
const prepararFontes = env.M04_FONTES === 'preparar';
mkdirSync(cacheFontes, { recursive: true });
mkdirSync(saida, { recursive: true });

// No modo CPU o módulo nativo não é carregado (a máquina pode não ter Vulkan nem NVENC): a marca é lida em JS.
const nativo = cpu ? null : createRequire(import.meta.url)('../nativo/nativo.node');
const lerMarca = nativo?.lerMarca ?? lerMarcaEm;
const codec = cpu ? 'h264' : (env.M04_CODEC ?? 'hevc');
const bruto = join(saida, `${rotulo}.${codec}`);
// Mídia em data: das <video>/<audio> da linha do tempo, decodificada em arquivo (apagada no aoTerminar e no encerrar).
const dados = join(saida, `${rotulo}-dados`);
const MOLDURA = new URL('./moldura.html', import.meta.url).pathname;
const registro = [];
const conta = { paints: 0, ignorados: 0, descartados: 0, cutucadas: 0, semPixmap: 0, bloqueados: 0, navegacoesNegadas: 0, http400: 0,
  fontesDoCache: 0, fontesBaixadas: 0, fontesFaltando: 0, videoEntregues: 0, videoRepetidos: 0, videoAquecimento: 0, videoMs: 0 };
const tempos = {};
let midias = null;
let voltas = null, pedidos = null, motor = null, servidor = null, servidorMoldura = null, encerrado = false, inicio = 0, largura = 0, audio = null,
  totalQuadros = 0, altura = 0, codificador = null, pendente = null, ultimosPixels = null;

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.css': 'text/css', '.map': 'application/json', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav' };

// P08: duas portas do 127.0.0.1, duas origens. A da moldura só serve a moldura.html; a da composição, o pacote e o
// /__motor/video/. A composição, noutra origem, não lê o DOM nem as variáveis da moldura nem chama as funções dela
// (mesma origem, lia: o outerHTML da moldura e o código auxiliar). Mesmo site (o host é o mesmo, só a porta muda):
// o Chromium deixa o iframe no processo da moldura, e marca e conteúdo seguem saindo no mesmo quadro do compositor.
function servirMoldura() {
  return new Promise((ok) => {
    servidorMoldura = createServer((req, res) => {
      if (req.url !== '/__motor/moldura.html') { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': 'text/html' });
      createReadStream(MOLDURA).pipe(res);
    }).listen(0, '127.0.0.1', () => ok(servidorMoldura.address().port));
  });
}
function servir() {
  return new Promise((ok) => {
    servidor = createServer((req, res) => {
      let caminho;
      // URL malformada (%E0) derrubava o processo no decodeURIComponent: responde 400.
      try { caminho = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, ''); }
      catch { conta.http400++; res.writeHead(400).end(); return; }
      // P10.5: o quadro do vídeo embutido da linha do tempo, decodificado pelo motor (midia-linha.ts).
      if (caminho.startsWith('/__motor/video/')) { servirVideo(caminho, new URL(req.url, 'http://x').searchParams, res); return; }
      let arquivo = join(pacote, caminho);
      if (existsSync(arquivo) && statSync(arquivo).isDirectory()) arquivo = join(arquivo, 'index.html');
      if (!arquivo.startsWith(pacote) || !existsSync(arquivo)) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': TIPOS[extname(arquivo)] ?? 'application/octet-stream' });
      createReadStream(arquivo).pipe(res);
    }).listen(0, '127.0.0.1', () => ok(servidor.address().port));
  });
}

// P10.5: /__motor/video/<k>/<n> devolve o quadro do vídeo k no quadro n da composição, em I420 (o formato do arquivo),
// ou 204 se é o mesmo quadro do vídeo já entregue (a página mantém o canvas). Erro derruba o render.
// Integração do P10 (P10.4): ?vazio=1 quando o canvas foi limpo (fora do trecho), e o quadro vem mesmo se for o já
// entregue (fora de ordem, o 11 depois do 30 aquece o 10, já entregue antes do 30); ?aquecer=1 no N − 1 desenhado
// sem captura, que conta à parte (videoAquecimento), não como entregue.
// Caminho fora do formato (segmento a mais, número faltando) é 404, sem derrubar o render; a query vem à parte (busca).
async function servirVideo(caminho, busca, res) {
  const partes = /^\/__motor\/video\/(\d+)\/(\d+)$/.exec(caminho);
  if (!partes) { res.writeHead(404).end(); return; }
  const [, k, n] = partes;
  try {
    const m = midias?.[Number(k)];
    if (!m) throw new Error(`pedido de vídeo inválido: ${caminho}`);
    const t0 = performance.now();
    const q = await quadroDoVideo(m, Number(n), linha.qps, { vazio: busca.get('vazio') === '1' });
    conta.videoMs += performance.now() - t0;
    if (q.repetido) { conta.videoRepetidos++; res.writeHead(204).end(); return; }
    if (busca.get('aquecer') === '1') conta.videoAquecimento++;
    else conta.videoEntregues++;
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': q.buffer.length }).end(q.buffer);
  } catch (erro) {
    console.log(`falhou: vídeo: ${erro.message}`);
    res.writeHead(500).end();
    encerrar('erro');
  }
}

// P10: código que roda na página da linha do tempo declarada. Todas as animações da página (CSS
// @keyframes e element.animate) começam em t = 0 do vídeo; o quadro N é posto pausando cada uma e ajustando
// currentTime para N × 1000 / qps, o que é síncrono com a marca (experimento da linha do tempo, degrau 1). Antes, o
// gancho opcional window.motor_quadro(n, ms) desenha o que não é animação (canvas, WebGL). Transição de CSS vai ao fim
// (estado final, determinístico); animação de outra linha do tempo (rolagem, ou uma DocumentTimeline própria) não tem como ser posta
// no quadro N e é contada em motor_soltas. As duas contagens são de animações distintas, não de quadros. A linha do
// tempo do documento fica parada desde antes de a página rodar (Animation.setPlaybackRate 0, ver abaixo): sem isso, a
// animação curta sem fill acabava no relógio real enquanto a página carregava e sumia do getAnimations (R03).
// S01, compatível com GSAP: o cliente traz o GSAP na pasta dele (nós não o distribuímos; parecer jurídico, J5). Este
// gancho roda antes dos scripts da página e vigia a window.gsap: quando o GSAP chega (o arquivo UMD faz
// window.gsap = ...), a linha do tempo raiz dele é pausada no tempo 0 e deixa de remover as animações que acabam. Assim,
// o ticker do GSAP (requestAnimationFrame e Date.now) não anda nada, toda animação criada na carga começa em t = 0 do
// vídeo (a raiz parada em 0) e voltar a um quadro anterior encontra a animação que já acabou. O motor_irPara põe a
// raiz no tempo N / qps. GSAP que chega com animações já criadas, ou fora da window.gsap (módulo ES; o GSAP anota a
// versão em window.gsapVersions), derruba o render no motor_preparar com o motivo.
const GANCHO_GSAP = `if (!location.pathname.startsWith('/__motor/')) (() => {
  const estado = { raizes: [], gsap: null, erro: null };
  Object.defineProperty(window, 'motor_gsap', { value: estado });
  let atual;
  Object.defineProperty(window, 'gsap', { configurable: true, enumerable: true, get: () => atual, set: (g) => {
    atual = g;
    const raiz = g?.globalTimeline;
    if (!raiz || estado.raizes.includes(raiz)) return;
    estado.raizes.push(raiz);
    estado.gsap = g;
    if (estado.raizes.length > 1) estado.erro = 'mais de um GSAP na página';
    else if (raiz.time() !== 0 || raiz.getChildren(false, true, true).length) estado.erro = 'o GSAP chegou à window.gsap com animações já criadas';
    raiz.autoRemoveChildren = false;
    raiz.pause();
    g.ticker?.lagSmoothing?.(0);
  } });
})();`;

const auxiliarLinha = (qps) => `
  window.motor_voltas = 0;
  const transicoes = new WeakSet(), soltas = new WeakSet(), vistas = new Set();
  Object.defineProperty(window, 'motor_transicoes', { get: () => window.motor_contaT ?? 0 });
  Object.defineProperty(window, 'motor_soltas', { get: () => window.motor_contaS ?? 0 });
  // S01, compatível com Lottie (lottie-web, que o cliente traz): as animações registradas na window.lottie. Cada uma
  // começa em t = 0 do vídeo; o quadro dela no quadro N é N × fr × velocidade / qps, com o laço do lottie-web (loop
  // true: sem fim; loop k: k + 1 voltas; sem loop: para no último quadro, totalFrames − 1).
  let raizGsap = null, tempoLottie = 30000;
  const lottie = () => { const l = window.lottie ?? window.bodymovin; return typeof l?.getRegisteredAnimations === 'function' ? l : null; };
  const animacoesLottie = () => lottie()?.getRegisteredAnimations() ?? [];
  const esperarLottie = () => Promise.all(animacoesLottie().filter((a) => !a.isLoaded).map((a) => new Promise((ok, falha) => {
    a.addEventListener('DOMLoaded', ok);
    a.addEventListener('data_failed', () => falha(new Error('Lottie: a animação não carregou' + (a.path ? ' (' + a.path + a.fileName + ')' : ''))));
  })));
  const quadroLottie = (a, n) => {
    const total = a.totalFrames, f = (n * a.frameRate * Math.abs(a.playSpeed || 1)) / ${qps};
    const voltas = a.loop === true ? Infinity : typeof a.loop === 'number' && a.loop > 0 ? a.loop + 1 : 1;
    return f < (voltas - 1) * total ? f % total : Math.min(f - (voltas - 1) * total, total - 1);
  };
  // S01: a raiz do GSAP no tempo s (as animações dela andam junto); a animação de cima pausada (uma timeline
  // { paused: true }, por exemplo) vai ao tempo dela, contado do começo dela. Os eventos (onUpdate) valem.
  const porGsap = (s) => {
    raizGsap.totalTime(s);
    for (const c of raizGsap.getChildren(false, true, true)) if (c.paused()) c.totalTime(Math.max(0, s - c.startTime()));
  };
  window.motor_bibliotecas = () => ({ gsap: raizGsap ? raizGsap.getChildren(false, true, true).length : 0, lottie: animacoesLottie().length });
  // R03 com will-change (achado no P13): o Chromium guarda a rasterização de uma camada com a dica de transform no
  // will-change (transform, translate, rotate, scale, perspective, transform-style) na posição subpixel e na escala em
  // que ela foi rasterizada pela primeira vez, e não a refaz depois (cc/layers/picture_layer_impl.cc,
  // CanRecreateHighResTilingForLCDTextAndRasterTransform). O quadro N passava a depender de onde o render começou (até
  // 98 níveis na borda do texto). O motor tira essas dicas e põe left no lugar: a camada própria fica (motivo de
  // composição sem a dica de transform), e o raster passa a ser o de N. Não opacity: ela faz do elemento uma raiz de
  // fundo e o backdrop-filter de um filho deixaria de ver a página. O contexto de empilhamento e o bloco de contenção
  // (absolute e fixed) que a dica dava ficam pelo translate: 0px, num :where() que perde para qualquer regra da página.
  // A troca é desfeita quando a página tira a dica (o quadro não depende de ela ter passado por ali). Só no documento
  // da composição: fora ficam pseudoelementos, shadow DOM, iframes e filhos de <svg> (o Chromium já não manda a dica
  // deles ao cc). O que a página muda depois volta a ser conferido (MutationObserver): elementos, atributos e folhas
  // de estilo; não pega a dica que muda por seletor de irmão (+, ~, :has) nem por variável herdada.
  const DICAS_TRANSFORM = new Set(['transform', 'translate', 'rotate', 'scale', 'perspective', 'transform-style']);
  const nossos = new Map(); // elemento → { valor posto pelo motor, will-change inline da página antes dele }
  let camadasTodas = true;
  const camadasPendentes = new Set(), folhas = [];
  const candidato = (el) => el instanceof Element && !el.ownerSVGElement;
  const temDica = (lista) => lista.split(',').some((i) => DICAS_TRANSFORM.has(i.trim()));
  const ehMeu = (el, nosso) => nosso !== undefined && el.style.getPropertyValue('will-change') === nosso.valor
    && el.style.getPropertyPriority('will-change') === 'important';
  // Confere uma lista de elementos em três passadas (devolver o will-change da página, ler o calculado, trocar), para o
  // Chromium recalcular o estilo uma vez só, e não uma por elemento. A dica pode ter mudado por regra (classe, folha):
  // por isso o valor do motor sai antes da leitura.
  const conferirLista = (lista) => {
    const els = lista.filter(candidato);
    const paginas = els.map((el) => {
      const nosso = nossos.get(el), st = el.style;
      if (ehMeu(el, nosso)) {
        if (nosso.pagina.v) st.setProperty('will-change', nosso.pagina.v, nosso.pagina.p); else st.removeProperty('will-change');
        return nosso.pagina;
      }
      return { v: st.getPropertyValue('will-change'), p: st.getPropertyPriority('will-change') };
    });
    const calculados = els.map((el) => getComputedStyle(el).willChange);
    els.forEach((el, k) => {
      const itens = calculados[k].split(',').map((i) => i.trim());
      if (!itens.some((i) => DICAS_TRANSFORM.has(i))) {
        if (nossos.delete(el)) el.removeAttribute('data-motor-camada');
        return;
      }
      const resto = itens.filter((i) => !DICAS_TRANSFORM.has(i) && i !== 'auto');
      if (!resto.includes('left')) resto.push('left');
      const valor = resto.join(', ');
      el.style.setProperty('will-change', valor, 'important');
      nossos.set(el, { valor, pagina: paginas[k] });
      if (!el.hasAttribute('data-motor-camada')) el.setAttribute('data-motor-camada', '');
    });
  };
  // Mudança do style inline: a dica só muda pelo próprio will-change inline. Se o valor do motor continua lá, ou se o
  // inline não traz a dica (o GSAP escreve o style a cada quadro), nada a ler.
  const mudouStyle = (el) => {
    if (!candidato(el)) return;
    const nosso = nossos.get(el);
    if (ehMeu(el, nosso)) return;
    if (nosso === undefined && !temDica(el.style.getPropertyValue('will-change'))) return;
    conferirLista([el]);
  };
  const neutralizarCamadas = async () => {
    if (folhas.length) await Promise.all(folhas.splice(0));
    if (camadasTodas) {
      camadasTodas = false;
      camadasPendentes.clear();
      for (const el of nossos.keys()) if (!el.isConnected) nossos.delete(el);
      conferirLista([...document.querySelectorAll('*')]);
    } else if (camadasPendentes.size) {
      const lista = new Set();
      for (const raiz of camadasPendentes) {
        if (!raiz.isConnected) continue;
        lista.add(raiz);
        for (const el of raiz.querySelectorAll('*')) lista.add(el);
      }
      camadasPendentes.clear();
      conferirLista([...lista]);
    }
  };
  window.motor_camadas = () => [...nossos.keys()].filter((el) => el.isConnected).length;
  const prepararCamadas = async () => {
    const estilo = document.createElement('style');
    estilo.textContent = ':where([data-motor-camada]) { translate: 0px; }';
    document.head.append(estilo);
    const ehFolha = (n) => n.localName === 'style' || n.localName === 'link';
    const semClasseDoMotor = (v) => (v ?? '').split(' ').filter((c) => c && c !== 'motor-sob-video').sort().join(' ');
    new MutationObserver((registros) => {
      for (const r of registros) {
        if (r.type === 'attributes') {
          if (r.attributeName === 'data-motor-camada') continue;
          if (r.attributeName === 'style') mudouStyle(r.target);
          else if (ehFolha(r.target)) camadasTodas = true;
          // A classe do S08 (take-placa.js), que o motor liga e desliga a cada quadro, não muda a dica.
          else if (r.attributeName !== 'class' || semClasseDoMotor(r.oldValue) !== semClasseDoMotor(r.target.getAttribute('class'))) camadasPendentes.add(r.target);
          continue;
        }
        if (r.type === 'characterData') { if (r.target.parentNode?.localName === 'style') camadasTodas = true; continue; }
        if (r.target.localName === 'style') camadasTodas = true;
        for (const n of r.removedNodes) if (ehFolha(n)) camadasTodas = true;
        for (const n of r.addedNodes) {
          if (n === estilo || !(n instanceof Element)) continue;
          // A folha de <link> carrega depois: o quadro seguinte espera por ela antes de conferir.
          if (n.localName === 'link' && !n.sheet) folhas.push(new Promise((ok) => { n.addEventListener('load', ok, { once: true }); n.addEventListener('error', ok, { once: true }); }));
          if (ehFolha(n) || n.querySelector('style, link')) camadasTodas = true;
          else camadasPendentes.add(n);
        }
      }
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true });
    await neutralizarCamadas();
  };
  window.motor_preparar = async (tempo) => {
    tempoLottie = tempo;
    let relogio;
    const limite = new Promise((_, falha) => { relogio = setTimeout(() => falha(new Error('a página não ficou pronta em ' + tempo + ' ms (fontes e imagens)')), tempo); });
    const imagens = Promise.all([...document.images].map((i) => i.decode().catch(() => { throw new Error('imagem não carregou: ' + (i.currentSrc || i.src)); })));
    try { await Promise.race([Promise.all([document.fonts.ready, imagens, esperarLottie()]), limite]); } finally { clearTimeout(relogio); }
    // S01: o GSAP da página, parado pelo GANCHO_GSAP. O ticker dorme (o que a página pôs nele andaria no relógio).
    const gs = window.motor_gsap;
    if (gs?.erro) throw new Error('GSAP: ' + gs.erro + ' (carregar o GSAP por <script> antes de criar as animações; docs/formatos/linha-do-tempo.md)');
    if (!gs?.raizes.length && window.gsapVersions?.length) throw new Error('GSAP: a página usa o GSAP fora da window.gsap (módulo ES?): carregar por <script> ou pôr window.gsap = gsap antes de criar as animações');
    if (window.gsapVersions?.length > 1) throw new Error('GSAP: mais de um GSAP na página');
    // O GSAP 2 (TweenMax, TweenLite) não passa pela window.gsap e andaria no relógio: recusado.
    if (!gs?.raizes.length && (window.TweenMax || window.TweenLite || window.TimelineMax || window.TimelineLite)) throw new Error('GSAP: GSAP 2 (TweenMax/TweenLite) não é aceito; usar o GSAP 3 (window.gsap)');
    raizGsap = gs?.raizes[0] ?? null;
    // O quadro 0 sem nada desenhado pelo GSAP (a raiz já está em 0 e não desenharia) é outro estado que o 0 a que se
    // volta de um quadro adiante (R03): o motor passa pelo 1 ms e volta, e todo caminho até o 0 é o mesmo.
    if (raizGsap) { porGsap(0.001); porGsap(0); }
    gs?.gsap?.ticker?.sleep?.();
    lottie()?.freeze?.();
    for (const a of document.getAnimations()) if (a.timeline === document.timeline && !(typeof CSSTransition !== 'undefined' && a instanceof CSSTransition)) vistas.add(a);
    await prepararCamadas();
    return document.getAnimations().length;
  };
  // P10.5: <video> e <audio> da página (no documento na hora da leitura; não os de <template> nem os criados
  // depois). O motor lê os atributos (motor_midias), sonda os arquivos e devolve o tamanho e a cor de cada vídeo
  // (motor_midiasProntas): o <video> vira um <canvas> do tamanho do vídeo, com os mesmos atributos (menos os de mídia
  // e width/height), e o <audio> sai da página (o som vai pela mistura do motor).
  const MIDIA = new Set(['src', 'muted', 'autoplay', 'loop', 'controls', 'preload', 'playsinline', 'poster', 'crossorigin',
    'width', 'height', 'data-inicio', 'data-recorte', 'data-quadros', 'data-volume', 'data-velocidade']);
  const videos = [];
  const midiasDaPagina = () => [...document.querySelectorAll('video, audio')];
  window.motor_midias = () => midiasDaPagina().map((e) => ({ tipo: e.localName, src: e.getAttribute('src') === null ? '' : e.src,
    inicio: e.getAttribute('data-inicio'), recorte: e.getAttribute('data-recorte'), quadros: e.getAttribute('data-quadros'),
    volume: e.getAttribute('data-volume'), velocidade: e.getAttribute('data-velocidade'), mudo: e.hasAttribute('muted') }));
  window.motor_midiasProntas = (lista) => {
    const elementos = midiasDaPagina();
    if (elementos.length !== lista.length) throw new Error('as mídias da página mudaram entre a leitura e a preparação');
    lista.forEach((m, i) => {
      const e = elementos[i];
      e.pause();
      e.removeAttribute('src');
      e.load();
      if (m.tipo === 'audio') { e.remove(); return; }
      const c = document.createElement('canvas');
      for (const a of e.attributes) if (!MIDIA.has(a.name)) c.setAttribute(a.name, a.value);
      c.setAttribute('data-motor-video', String(m.k));
      c.width = m.largura; c.height = m.altura;
      e.replaceWith(c);
      videos.push({ ...m, canvas: c, ctx: c.getContext('2d'), desenhado: false, placa: false });
    });
    return videos.length;
  };
  const limpar = (v) => { if (v.desenhado) { v.ctx.clearRect(0, 0, v.largura, v.altura); v.desenhado = false; } };
  // O quadro do vídeo vem do motor em I420; o createImageBitmap (embrulhado pelo cor-limpa.js) converte a cor como o
  // Remotion. Fora do trecho, o canvas fica transparente.
  const desenharUm = async (v, n, aquecer) => {
    // R03 depois de escala 0: o quadro de limpeza (motor_aquecer com limpar) só redesenha as camadas da página; o
    // vídeo vem no N − 1 logo depois, e pedir o N aqui faria o leitor voltar (reabrir) a cada descontinuidade.
    if (aquecer === 'limpar') return;
    const r = await fetch('/__motor/video/' + v.k + '/' + n + '?vazio=' + (v.desenhado ? 0 : 1) + '&aquecer=' + (aquecer ? 1 : 0));
    if (r.status === 204 && v.desenhado) return;
    if (r.status !== 200) throw new Error('vídeo ' + v.k + ': o quadro ' + n + ' não veio (' + r.status + ')');
    const q = new VideoFrame(await r.arrayBuffer(), { format: 'I420', codedWidth: v.largura, codedHeight: v.altura, timestamp: 0, colorSpace: v.cor });
    let bmp;
    try { bmp = await createImageBitmap(q); } finally { q.close(); }
    v.ctx.clearRect(0, 0, v.largura, v.altura);
    v.ctx.drawImage(bmp, 0, 0);
    bmp.close();
    v.desenhado = true;
  };
  const desenharVideos = async (n, aquecer) => {
    for (const v of videos) {
      if (n < v.inicio || n >= v.inicio + v.quadros) { limpar(v); continue; }
      await desenharUm(v, n, aquecer);
    }
  };
  // S08 (experimento, take-placa.js): depois das animações postas, um vídeo por quadro vai para a placa (canvas
  // transparente, geometria para o motor); o resto, e o quadro cuja geometria não se reproduz, pelo canvas.
  const takeConta = window.motor_takeConta = { placa: 0, canvas: 0, motivos: {} };
  window.motor_takePreparar = (ks) => {
    for (const v of videos) v.placa = ks.includes(v.k);
    return globalThis.motorTake.preparar(innerWidth, innerHeight);
  };
  const montarTake = async (n, aquecer) => {
    globalThis.motorTake.conferirRaiz();
    let video = null, fundo = globalThis.motorTake.fundo, marcar = [];
    // Os canvas dos vídeos fora do trecho ficam transparentes neste quadro: não pintam por baixo do que vai na placa.
    const vazios = new Set(videos.filter((v) => n < v.inicio || n >= v.inicio + v.quadros).map((v) => v.canvas));
    for (const v of videos) {
      if (n < v.inicio || n >= v.inicio + v.quadros) { limpar(v); continue; }
      const g = !v.placa ? { motivo: 'vídeo fora do NVDEC' } : video ? { motivo: 'outro vídeo na placa neste quadro' }
        : globalThis.motorTake.medir(v.canvas, v.largura, v.altura, vazios);
      if (g.motivo !== undefined) {
        if (!aquecer) { takeConta.canvas++; takeConta.motivos[g.motivo] = (takeConta.motivos[g.motivo] ?? 0) + 1; }
        await desenharUm(v, n, aquecer);
        continue;
      }
      limpar(v);
      if (!aquecer) takeConta.placa++;
      fundo = g.fundo; marcar = g.marcar;
      if (g.recorte) video = { k: v.k, x: g.x, y: g.y, sx: g.sx, sy: g.sy, recorte: g.recorte, arredondado: g.arredondado };
    }
    globalThis.motorTake.aplicar(marcar);
    return { fundo, video };
  };
  const irPara = async (n, aquecer = false) => {
    const ms = (n * 1000) / ${qps};
    const take = videos.length > 0 && globalThis.motorTake?.ligado === true;
    if (videos.length && !take) await desenharVideos(n, aquecer);
    if (typeof window.motor_quadro === 'function') await window.motor_quadro(n, ms);
    // S01: GSAP e Lottie no quadro N, depois do gancho e antes das Web Animations.
    if (raizGsap) porGsap(n / ${qps});
    const lotties = animacoesLottie();
    // Animação Lottie criada depois da carga: a mesma espera, com o mesmo limite do motor_preparar.
    if (lotties.some((a) => !a.isLoaded)) {
      let relogio;
      const limite = new Promise((_, falha) => { relogio = setTimeout(() => falha(new Error('Lottie: a animação não carregou em ' + tempoLottie + ' ms')), tempoLottie); });
      try { await Promise.race([esperarLottie(), limite]); } finally { clearTimeout(relogio); }
    }
    for (const a of lotties) a.goToAndStop(quadroLottie(a, n), true);
    for (const a of document.getAnimations()) {
      if (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) {
        if (!transicoes.has(a)) { transicoes.add(a); window.motor_contaT = (window.motor_contaT ?? 0) + 1; }
        a.finish();
      } else if (a.timeline !== document.timeline) {
        if (!soltas.has(a)) { soltas.add(a); window.motor_contaS = (window.motor_contaS ?? 0) + 1; }
      } else vistas.add(a);
    }
    // P10.4 (R03): todas as animações já vistas, não só as do getAnimations de agora. A que já acabou sem fill sai do
    // getAnimations; sem a lista, voltar a um quadro anterior (render fora de ordem) a deixava de fora. A cancelada
    // (idle: a página trocou a animação do CSS, por exemplo) fica de fora: pausar a reviveria.
    for (const a of vistas) {
      if (a.playState === 'idle') { vistas.delete(a); continue; }
      a.pause(); a.currentTime = ms;
    }
    // <img> posta ou trocada depois do motor_preparar (pelo motor_quadro, por exemplo).
    await Promise.all([...document.images].filter((i) => !i.complete).map((i) => i.decode().catch(() => { throw new Error('imagem não carregou: ' + (i.currentSrc || i.src)); })));
    await document.fonts.ready;
    await neutralizarCamadas();
    return take ? await montarTake(n, aquecer) : null;
  };
  window.motor_irPara = async (n) => { const take = await irPara(n); return take ? { n, take } : n; };
  // P10.4 (R03): o quadro n posto e desenhado, sem marca (o motor não o captura). Duas voltas de rAF: o compositor
  // fez o commit e desenhou o quadro, então as camadas (as escalas de rasterização) ficam como depois de n.
  // R03 depois de escala 0: com limpar, o quadro n desenhado só para o cc trocar os ladrilhos das camadas (ver o laço).
  window.motor_aquecer = async (n, limpar = false) => {
    await irPara(n, limpar ? 'limpar' : true);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return n;
  };
  // P10.3: [início, fim] em ms do vídeo de cada animação da document.timeline (fim null = sem fim), para o motor saber
  // quais quadros repetem o anterior (parados.ts). A transição vai ao fim no primeiro quadro desenhado e não conta.
  // Com o gancho motor_quadro ou animação de outra linha do tempo, o motor não tem como saber: desenha todos. Também com
  // SVG SMIL ou <img> que pode ser animada (GIF, APNG, WebP animado), que mudam sem passar pela document.timeline.
  // Detecção conservadora pela extensão: .gif e .apng, e também .png e .webp (podem ser animados; na dúvida, desliga).
  window.motor_intervalos = () => {
    const smil = document.querySelectorAll('svg animate, svg animateTransform, svg animateMotion, svg set').length;
    const imagensAnimadas = [...document.images].filter((i) => {
      const src = i.currentSrc || i.src || '';
      if (/^data:image\\/(gif|apng|png|webp)[;,]/i.test(src)) return true;
      let caminho = src;
      try { caminho = new URL(src, location.href).pathname; } catch {}
      return /\\.(gif|apng|png|webp)$/i.test(caminho);
    }).length;
    let soltas = 0;
    const intervalos = [];
    // As já vistas (P10.4) também: a que acabou sem fill saiu do getAnimations, mas volta num render fora de ordem.
    for (const a of new Set([...vistas, ...document.getAnimations()])) {
      if (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) continue;
      if (a.timeline !== document.timeline) { soltas++; continue; }
      let t = null;
      try { t = a.effect?.getComputedTiming() ?? null; } catch {}
      if (!t || !Number.isFinite(t.delay) || Number.isNaN(t.endTime)) { intervalos.push([0, null]); continue; }
      const fim = Number.isFinite(t.endTime) ? t.endTime : null;
      intervalos.push([Math.max(0, fim === null ? t.delay : Math.min(t.delay, fim)), fim]);
    }
    // S01: GSAP e Lottie mudam o quadro sem a document.timeline; o motor não lê os intervalos deles e desenha todos.
    return { quadro: typeof window.motor_quadro === 'function', gsap: !!raizGsap, lottie: animacoesLottie().length > 0, soltas, smil, imagensAnimadas, intervalos };
  };
  true`;

function anotar(n, pixels, info) {
  const item = { n, frameCount: info?.metadata?.frameCount ?? null };
  if (pixels && conferir) {
    item.hash = createHash('sha256').update(pixels).digest('hex');
    item.tarja = lerMarca(pixels, largura, TARJA_Y);
    if (marcaVideo) item.video = lerMarcaVideo(pixels, largura);
    if (gravar.has(n)) writeFileSync(join(saida, `${rotulo}-${n}.bgra`), pixels);
    if (gravarTodos) writeFileSync(join(pastaGravar, `${n}.bgra`), pixels);
  }
  registro.push(item);
}

// O Remotion abre o Chrome com --hide-scrollbars (@remotion/renderer, open-browser.ts; dist/open-browser.js:165): o que
// transborda da composição é cortado sem barra de rolagem. Sem isso, um vídeo ampliado sem overflow:hidden
// deixava a barra no quadro (M09, composição Transborda).
app.commandLine.appendSwitch('hide-scrollbars');
// Diagnóstico (P10.4): opções a mais do Chromium (M04_CHROMIUM="--disable-gpu-rasterization ..."), para isolar causas.
for (const opcao of (env.M04_CHROMIUM ?? '').split(' ').filter(Boolean)) {
  const [nome, valor] = opcao.replace(/^--/, '').split('=');
  app.commandLine.appendSwitch(nome, valor ?? '');
}

app.whenReady().then(async () => {
  const porta = await servir();
  const portaMoldura = await servirMoldura();
  const t0 = performance.now();
  const janela = new BrowserWindow({
    // M08, modo CPU: janela opaca, fundo preto. Com a janela transparente, o compositor por software do Electron não
    // limpa a área com dano entre um paint e outro: o semitransparente se acumula (rastro de quem se move) e o SSIM
    // contra a placa caiu para 0,76–0,80. Preto é o que o NVENC sem alfa do modo placa dá (alfa pré-multiplicado
    // ignorado): os dois MP4 ficam iguais. O modo CPU, por isso, não tem saída com alfa.
    width: 1920, height: 1080 + MARCA, useContentSize: true, show: false, transparent: !cpu,
    ...(cpu ? { backgroundColor: '#000000' } : {}),
    webPreferences: {
      // Nada de Node na página; o que roda antes dela entra pelo CDP (Page.addScriptToEvaluateOnNewDocument).
      offscreen: { useSharedTexture: !cpu, ...(BATIDA_EXTERNA ? { batidaExterna: true } : {}) }, sandbox: true, contextIsolation: true, nodeIntegration: false,
      partition: 'motor-m04', ...(cpu ? { backgroundThrottling: false } : {}),
    },
  });
  const wc = janela.webContents;
  wc.setFrameRate(BATIDA_EXTERNA ? QPS_BATIDA : QPS);
  // P13, batida externa: o relógio bate no ritmo do QPS enquanto ligado (carga da página, aquecimento); no laço, só
  // a batida da marca. Sem a batida externa, nada disso roda (o compositor bate sozinho).
  let relogio = null;
  const bater = () => { conta.batidas++; wc.baterQuadro(); };
  const ligarRelogio = (imediato) => {
    if (!BATIDA_EXTERNA || relogio) return;
    if (imediato) bater();
    relogio = setInterval(bater, PASSO_BATIDA);
  };
  const desligarRelogio = () => { if (relogio) { clearInterval(relogio); relogio = null; } };
  /** Espera p com o relógio ligado (a página pode esperar um rAF), e desliga no fim. */
  const comBatidas = async (p, imediato = false) => {
    if (!BATIDA_EXTERNA) return p;
    ligarRelogio(imediato);
    try { return await p; } finally { desligarRelogio(); }
  };
  if (BATIDA_EXTERNA) { conta.batidas = 0; ligarRelogio(true); }
  const base = `http://127.0.0.1:${porta}/`;
  const urlMoldura = `http://127.0.0.1:${portaMoldura}/__motor/moldura.html`;
  const host = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
  const permitido = (url) => url.startsWith(base) || url === urlMoldura || url.startsWith('data:') || url.startsWith('blob:')
    || (url.startsWith('https://') && HOSTS_FONTES.has(host(url)));
  // Todo https desta sessão passa por aqui: fonte do Google sai do cache; o resto é recusado. No modo preparar a fonte
  // que falta vem da rede (e é gravada); sem ele, ou sem rede, fonte fora do cache derruba o render com a instrução.
  wc.session.protocol.handle('https', async (pedido) => {
    if (!HOSTS_FONTES.has(host(pedido.url))) { conta.bloqueados++; return new Response('bloqueado pelo motor', { status: 403 }); }
    try {
      const f = await obterFonte(pedido.url, { cache: cacheFontes, preparar: prepararFontes, userAgent: () => wc.getUserAgent(),
        buscar: (url, o) => wc.session.fetch(url, { ...o, bypassCustomProtocolHandlers: true }) });
      if (f.origem === 'cache') conta.fontesDoCache++; else conta.fontesBaixadas++;
      return new Response(f.corpo, { headers: { 'content-type': f.tipo, 'access-control-allow-origin': '*' } });
    } catch (erro) {
      // Cedo: o pedido da fonte vem no carregamento da página, antes do primeiro quadro.
      conta.fontesFaltando++;
      console.log(`falhou: ${erro instanceof ErroDeFonte ? erro.message : `fonte ${pedido.url}: ${erro.message}`}`);
      setTimeout(() => encerrar('fonte fora do cache'), 0);
      return new Response('fonte fora do cache', { status: 404 });
    }
  });
  wc.session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, ok) => {
    const cancelar = !permitido(d.url);
    if (cancelar && conta.bloqueados++ < 5) console.log('rede bloqueada:', d.url.slice(0, 120));
    ok({ cancel: cancelar });
  });
  const NAVEGAVEIS = new Set(['about:blank', urlMoldura, `${base}index.html`]);
  wc.on('will-frame-navigate', (e) => {
    if (NAVEGAVEIS.has(e.url)) return;
    conta.navegacoesNegadas++;
    e.preventDefault();
  });
  wc.setWindowOpenHandler(() => { conta.navegacoesNegadas++; return { action: 'deny' }; });
  // O CDP só responde com um documento aberto (o Puppeteer também parte de about:blank).
  await wc.loadURL('about:blank');
  if (env.M04_DEPURAR) console.log('passo', "wc.debugger.attach('1.3');");
  wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Page.enable');
  // S01: o GSAP que a página traz fica parado desde que chega a window.gsap, antes de qualquer animação dela.
  await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: GANCHO_GSAP });
  // A conversão de cor do vídeo embutido (M09); na moldura, não.
  if (corPropria) await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `if (!location.pathname.startsWith('/__motor/')) (function () {
${COR_LIMPA}
  })();` });
  wc.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) console.log('página:', e.message); });

  let alvo = null, aceito = null;
  // M08, modo CPU: o bitmap BGRA de L × (A + 16); a marca é lida na linha do meio da faixa, e só o quadro com a
  // marca N vai ao codificador (o envio, com contrapressão, fica no laço principal).
  if (cpu) wc.on('paint', (_evento, _sujo, imagem) => {
    conta.paints++;
    try {
      if (encerrado || !codificador) return;
      if (alvo === null) { conta.ignorados++; return; }
      const { width: l, height: a } = imagem.getSize();
      if (l !== largura || a !== altura + MARCA) { conta.tamanhoErrado = (conta.tamanhoErrado ?? 0) + 1; return; }
      const bitmap = imagem.toBitmap();
      if (lerFaixa(bitmap.subarray((altura + MARCA / 2) * l * 4, (altura + MARCA / 2 + 1) * l * 4)) !== alvo) { conta.descartados++; return; }
      pendente = bitmap.subarray(0, l * altura * 4);
      anotar(alvo, pendente, null);
      alvo = null;
      aceito();
    } catch (erro) {
      console.log('paint falhou:', erro.message);
      encerrar('erro');
    }
  });
  else wc.on('paint', (evento) => {
    const tex = evento.texture;
    conta.paints++;
    try {
      if (encerrado || !motor) return;
      const pixmap = tex?.textureInfo?.handle?.nativePixmap;
      if (!pixmap) { conta.semPixmap++; return; }
      if (alvo === null) { conta.ignorados++; return; }
      const [plano] = pixmap.planes;
      const { width: l, height: a } = tex.textureInfo.codedSize;
      const r = motor.quadroMarcado({ fd: plano.fd, stride: plano.stride, offset: plano.offset, largura: l, altura: a },
        String(pixmap.modifier), alvo, conferir);
      if (!r.codificado) { conta.descartados++; return; }
      ultimosPixels = r.pixels ?? null;
      anotar(alvo, r.pixels, tex.textureInfo);
      alvo = null;
      aceito();
    } catch (erro) {
      console.log('paint falhou:', erro.message);
      encerrar('erro');
    } finally {
      tex?.release();
    }
  });

  // P10: a linha do tempo do documento parada antes de a página carregar; o motor põe cada animação no quadro N.
  await wc.debugger.sendCommand('Animation.enable');
  await wc.debugger.sendCommand('Animation.setPlaybackRate', { playbackRate: 0 });
  if (env.M04_DEPURAR) console.log('passo', 'await wc.loadURL(`http://127.0.0.1:${por');
  await wc.loadURL(urlMoldura);
  const moldura = (codigo) => wc.executeJavaScript(codigo, true);
  // P08: a moldura abre a composição (outra origem) e espera o load; a linha do tempo (P10) está pronta no load do
  // documento.
  await moldura(`motor_abrir(${JSON.stringify(`${base}index.html`)})`);
  if (env.M04_DEPURAR) console.log('passo', 'const quadro = wc.mainFrame.frames.find(');
  // CEF: a resposta do load (executeJavaScript) pode chegar antes dos eventos de quadro e contexto do CDP; sem esperar,
  // o iframe aparecia sem contexto (osProcessId -1) e o render caía com «abriu noutro processo». No Electron não existe.
  await wc.mainFrame.assentar?.();
  const quadro = wc.mainFrame.frames.find((f) => f.url.endsWith('/index.html'));
  if (!quadro) throw new Error('iframe da composição não encontrado');
  // P08 (R03): a marca só sai no mesmo quadro do compositor que o conteúdo se o iframe estiver no processo da moldura
  // (mesmo site). Um Chromium que separe origens em processos (iframe fora do processo) quebraria isso em silêncio.
  if (quadro.osProcessId !== wc.mainFrame.osProcessId) throw new Error(`a composição abriu noutro processo (${quadro.osProcessId}, moldura ${wc.mainFrame.osProcessId}): a marca deixaria de sair no mesmo quadro`);
  const avaliar = (codigo) => quadro.executeJavaScript(codigo, true);
  // P10: a declaração já foi conferida pelo comando (cli/regras.ts); a página só espera fontes e imagens.
  const comp = { id: linha.id, width: linha.largura, height: linha.altura, fps: linha.qps, durationInFrames: linha.quadros };
  console.log('composição', JSON.stringify({ id: comp.id, largura: comp.width, altura: comp.height, fps: comp.fps, duracao: comp.durationInFrames, formato: 'linha' }));
  largura = comp.width; altura = comp.height;
  if (comp.width !== 1920 || comp.height !== 1080) janela.setContentSize(comp.width, comp.height + MARCA);
  await moldura(`motor_tamanho(${comp.width}, ${comp.height}); true`);
  await avaliar(auxiliarLinha(comp.fps));
  // P10.5: vídeo e áudio embutidos; a fonte tem de estar na pasta da composição (servida pelo motor).
  midias = prepararMidias(await avaliar('window.motor_midias()'), { base, pasta: pacote, dados,
    qps: comp.fps, quadros: comp.durationInFrames, ffmpeg: env.M04_FFMPEG, ffprobe: env.M04_FFPROBE, filhos: filhosAtivos() });
  if (midias.length) {
    await avaliar(`window.motor_midiasProntas(${JSON.stringify(paraPagina(midias))})`);
    console.log('mídias', JSON.stringify(midias.map((m) => ({ tipo: m.tipo, inicio: m.inicio, recorte: m.recorte, quadros: m.quadros, volume: m.volume, velocidade: m.velocidade, mudo: m.mudo,
      ...(m.tipo === 'video' ? { largura: m.largura, altura: m.altura, cor: m.cor, quadrosDoVideo: m.pts.length } : {}) }))));
  }
  conta.animacoes = await avaliar(`window.motor_preparar(${TEMPO})`);
  conta.bibliotecas = await avaliar('window.motor_bibliotecas()');
  tempos.abrir = Math.round(performance.now() - t0);
  if (env.M04_AUTOTESTE === '1') {
    // Rede para fora, URL malformada, servidor vivo depois, window.open, a moldura fora de alcance e navegação para fora.
    const r = await avaliar(`(async () => {
      const r = {};
      r.foraBloqueado = await fetch('https://example.com/').then((x) => !x.ok, () => true);
      r.httpForaBloqueado = await fetch('http://example.com/').then((x) => !x.ok, () => true);
      r.malformada400 = (await fetch('/%E0')).status === 400;
      r.servidorVivo = (await fetch('/index.html')).status === 200;
      r.janelaNegada = window.open('https://example.com/') === null;
      // P08: a moldura (outra origem) fora de alcance; o servidor da composição não serve a moldura.
      r.molduraFechada = (() => { try { return parent.document === undefined; } catch { return true; } })()
        && (() => { try { parent.motor_marcar(0); return false; } catch { return true; } })();
      r.molduraNaoServida = (await fetch('/__motor/moldura.html')).status === 404;
      return r;
    })()`);
    await avaliar(`location.href = 'https://example.com/'; true`).catch(() => {});
    await new Promise((ok) => setTimeout(ok, 500));
    r.navegacaoNegada = wc.mainFrame.frames.some((f) => f.url === `${base}index.html`) && conta.navegacoesNegadas >= 2;
    r.semNodeNaPagina = await avaliar('typeof require === "undefined" && typeof process?.versions?.node === "undefined"');
    console.log('autoteste', JSON.stringify(r));
    if (!Object.values(r).every(Boolean)) throw new Error('autoteste de segurança falhou');
  }

  const primeiro = Number(env.M04_INICIO ?? 0);
  const total = Number(env.M04_QUADROS ?? comp.durationInFrames - primeiro);
  pedidos = total;
  if (corPropria) {
    conta.corAutoteste = await avaliar('window.motor_corAutoteste()');
    if (conta.corAutoteste !== 0) throw new Error(`conversão de cor da página difere da régua em ${conta.corAutoteste} amostras`);
    if (env.M04_COR_TESTE === '1') {
      conta.corTeste = await avaliar('window.motor_corTesteFalhas()');
      console.log('cor-teste', JSON.stringify(conta.corTeste));
    }
  }
  if (cpu) {
    codificador = new CodificadorCpu({ largura: comp.width, altura: comp.height, fps: comp.fps, saida: bruto, ffmpeg: env.M04_FFMPEG });
    filhosAtivos().add(codificador.p);
  } else motor = new nativo.Motor({ largura: comp.width, altura: comp.height, marca: MARCA, saida: bruto, alfa: (env.M04_ALFA ?? '1') === '1',
    codec, qps: comp.fps,
    ...(env.M04_FILA ? { fila: Number(env.M04_FILA) } : {}) });
  // S08 (experimento): cada vídeo H.264/HEVC aberto no NVDEC do motor; a página tira o fundo da raiz (vira o fundo da
  // montagem) e passa a dizer onde o vídeo está.
  if (takePlaca && midias?.some((m) => m.tipo === 'video')) {
    const naPlaca = [];
    for (const m of midias) {
      if (m.tipo !== 'video' || !['h264', 'hevc'].includes(m.codec) || m.descartados > 0) continue;
      // O que o NVDEC não abre (codec ou cor que ele recusa) fica no canvas; o erro vai ao resumo.
      try {
        m.placa = motor.abrirVideo({ arquivo: m.arquivo, codec: m.codec, largura: m.largura, altura: m.altura,
          matriz: m.cor.matrix ?? undefined, cheia: m.cor.fullRange === true, ffmpeg: env.M04_FFMPEG ?? 'ffmpeg' });
        naPlaca.push(m.k);
      } catch (erro) { (conta.takeRecusados ??= []).push(`${m.src}: ${erro.message}`); }
    }
    await avaliar(`${TAKE_PLACA}; true`);
    conta.take = await avaliar(`window.motor_takePreparar(${JSON.stringify(naPlaca)})`);
    console.log('take na placa', JSON.stringify({ videos: naPlaca.length, ...conta.take }));
  }
  // O que o motor_irPara devolveu → a montagem do quadro n no nativo (o quadro do vídeo pelo mesmo pts do P10.5).
  const montagemDe = (r, n) => {
    const t = r?.take;
    if (!t) return null;
    const v = t.video ? midias[t.video.k] : null;
    // Escala ≠ 1 ou origem fora do pixel: o núcleo amostra bilinear ([sx, sy, tx, ty]); senão, o texel direto.
    const g = t.video;
    const direto = g && g.sx === 1 && g.sy === 1 && Number.isInteger(g.x) && Number.isInteger(g.y);
    const video = v ? { video: v.placa, indice: indiceNoVideo(v, tempoNoVideo(v, n, linha.qps)), x: Math.floor(g.x), y: Math.floor(g.y),
      recorte: g.recorte, ...(direto ? {} : { escala: [g.sx, g.sy, g.x, g.y] }), ...(g.arredondado ? { arredondado: g.arredondado } : {}) } : undefined;
    return t.fundo === null && !video ? null : { fundo: t.fundo ?? undefined, video };
  };
  totalQuadros = total;
  if (comAudio) audio = new ColetorDeAudio({ pasta: join(saida, `${rotulo}-audio`), fps: comp.fps, primeiro, base, pacote });
  // SIGTERM (timeout do rodar.sh, kill): os ffmpeg (mistura e modo CPU) morrem junto, a pasta <rótulo>-audio é
  // apagada e o vídeo pela metade também.
  // A pasta <rótulo>-dados (mídia em data: decodificada, origemDoAsset do audio.ts) também vai embora.
  aoTerminar(() => { fecharMidias(midias); audio?.limpar(); rmSync(dados, { recursive: true, force: true }); if (cpu) rmSync(bruto, { force: true }); });
  // Com áudio, o motor monta os assets do quadro das mídias declaradas (assetsDoQuadro, P10.5), sem perguntar à página.
  // P10.3: na placa, o quadro igual ao anterior é repetido no NVENC (motor.repetir: o mesmo buffer
  // de entrada, sem página, paint, cópia nem textura). Com conferência, ele leva os pixels do anterior, que são o que o
  // NVENC lê. Integração com o P10.5: o áudio da linha não impede (os assets vêm das mídias declaradas, assetsDoQuadro,
  // sem a página), e o vídeo embutido entra como trecho que muda (do primeiro quadro dele ao que limpa o canvas).
  let parados = new Set();
  conta.repetidos = 0;
  if (!cpu && (env.M04_REPETIR ?? '1') === '1') {
    const info = await avaliar('window.motor_intervalos()');
    conta.repetirMotivo = info.quadro ? 'motor_quadro' : info.gsap ? 'GSAP' : info.lottie ? 'Lottie' : info.soltas ? 'animações soltas' : info.smil ? 'SVG SMIL'
      : info.imagensAnimadas ? 'imagem que pode ser animada (GIF, APNG, WebP)' : null;
    const trechos = (midias ?? []).filter((m) => m.tipo === 'video').map((m) => [m.inicio, m.inicio + m.quadros]);
    if (!conta.repetirMotivo) parados = new Set(quadrosParados(info.intervalos, primeiro, total, comp.fps, trechos));
  }
  // P10.4, só para teste do R03: M04_ORDEM=embaralhada renderiza o trecho fora de ordem (semente fixa, M04_SEMENTE,
  // padrão 12345); M04_ORDEM=<n,n,...> renderiza só esses quadros, nessa ordem. O vídeo sai na ordem do render.
  const ordem = ordemDosQuadros(primeiro, total, env.M04_ORDEM, Number(env.M04_SEMENTE ?? 12345));
  if (ordem.length !== total) { pedidos = totalQuadros = ordem.length; }
  // Diagnóstico (P10.4): o rastro do Chromium do laço inteiro, em JSON (camadas.mjs do experimento lê as camadas).
  const rastro = env.M04_RASTRO ? new Promise((ok) => wc.debugger.on('message', (_e, m, p) => { if (m === 'Tracing.tracingComplete') ok(p.stream); })) : null;
  if (rastro) await wc.debugger.sendCommand('Tracing.start', { traceConfig: { includedCategories: (env.M04_RASTRO_CAT ?? 'disabled-by-default-cc.debug,cc').split(',') },
    transferMode: 'ReturnAsStream', streamFormat: 'json' });
  inicio = performance.now();
  // P10.4 (R03): na linha do tempo, o quadro N desenhado pelo Chromium depende do quadro desenhado antes dele: o
  // compositor guarda por um quadro a rasterização da camada na escala anterior e, se ela for maior que a de agora,
  // desenha com a geometria dela (até 60 níveis na borda; docs/experimentos/2026-10-p10-4-ponto-de-partida.md). Em
  // ordem, o anterior de N é sempre N − 1. Então, todo quadro que não vem logo depois do anterior (o primeiro de um
  // trecho que começa no meio, ou um salto) é precedido pelo N − 1 desenhado sem captura; o 0 depois de um salto, por
  // ele mesmo (o estado do 0 é o da página recém-aberta). Em ordem desde o 0, nenhum quadro a mais.
  // Integração com o P10.3: depois de quadros repetidos, a página ficou no último desenhado (M), mas os intervalos
  // garantem que nada mudou de M a N − 1; o N que vem logo depois do repetido não é descontinuidade e não aquece.
  // O aquecimento não passa pela mistura de áudio (só o laço chama audio.quadro) nem pela marca (nada é gravado).
  let anterior = null;
  conta.aquecidos = 0;
  conta.limpos = 0;
  desligarRelogio();
  const batidasAntes = conta.batidas;
  for (const n of ordem) {
    if (encerrado) break;
    // P10.3 com o P10.4: só repete o quadro que vem logo depois do anterior (desenhado ou repetido), que é o que está
    // no buffer do NVENC; fora de ordem, desenha.
    if (parados.has(n) && anterior === n - 1) {
      motor.repetir();
      conta.repetidos++;
      anotar(n, ultimosPixels, null);
      audio?.quadro(n, assetsDoQuadro(midias, n, base), total);
      anterior = n;
      continue;
    }
    if (n - 1 !== anterior && !(anterior === null && n === 0)) {
      // R03 depois de escala 0 (achado no P10.5 embaralhado): o cc só tira de uma camada os ladrilhos que a última
      // AppendQuads dela não usou (cc/layers/picture_layer_impl.cc, CleanUpTilingsOnActiveLayer e
      // LastAppendQuadsScalesContains). Camada que não é desenhada no N − 1 (scaleX(0), por exemplo) guarda os ladrilhos
      // do último quadro em que apareceu, e o N, fora de ordem, saía com eles (até 112 níveis na ponta da barra que
      // cresce de 0). Por isso, antes do N − 1, o próprio N é desenhado uma vez, sem captura e sem vídeo: toda camada
      // visível em N passa por uma AppendQuads em N, e os ladrilhos de outro quadro saem. Depois, o N − 1 refaz a
      // história de um quadro do P10.4. Em ordem desde o 0, nada muda (não há descontinuidade). O 0 depois de um salto já
      // é aquecido por ele mesmo, logo abaixo: limpar antes seria o mesmo desenho duas vezes.
      if (n > 0) {
        await comBatidas(avaliar(`motor_aquecer(${n}, true)`), true);
        conta.limpos++;
      }
      await comBatidas(avaliar(`motor_aquecer(${Math.max(0, n - 1)})`), true);
      conta.aquecidos++;
    }
    anterior = n;
    const pintou = new Promise((ok) => { aceito = ok; });
    alvo = n;
    // Batida externa: o relógio só bate se a página demorar mais de uma batida no quadro (um rAF no motor_quadro).
    const ida = await comBatidas(avaliar(`motor_irPara(${n}, ${JSON.stringify(comp.id)}, ${TEMPO})`));
    if (conta.take?.ligado) motor.montar(montagemDe(ida, n));
    // P08: a marca N, escrita pelo motor na moldura depois de o quadro N assentar na composição (que não alcança a
    // moldura). Mesmo processo e mesmo compositor: o primeiro paint com a marca N traz o conteúdo de N.
    await moldura(`motor_marcar(${n}); true`);
    // Batida externa: o quadro N pede duas batidas (a primeira faz a página entregar o quadro ao compositor, a
    // seguinte o desenha); o relógio bate da marca até o paint com ela, no ritmo do M04_QPS.
    ligarRelogio(true);
    audio?.quadro(n, assetsDoQuadro(midias, n, base), total);
    let tentativas = 0;
    while (!(await Promise.race([pintou.then(() => true), new Promise((ok) => setTimeout(ok, ESPERA, false))]))) {
      if (encerrado) return;
      if (++tentativas > 10) throw new Error(`quadro ${n}: nenhum paint com a marca depois de ${tentativas - 1} cutucadas`);
      conta.cutucadas++;
      await moldura('motor_cutucar(); true');
    }
    desligarRelogio();
    if (pendente) { const p = pendente; pendente = null; await codificador.escrever(p); }
  }
  if (BATIDA_EXTERNA) conta.batidasLaco = conta.batidas - batidasAntes;
  if (rastro) {
    await wc.debugger.sendCommand('Tracing.end');
    const fluxo = await rastro, partes = [];
    for (let fim = false; !fim;) {
      const r = await wc.debugger.sendCommand('IO.read', { handle: fluxo, size: 1 << 22 });
      partes.push(r.base64Encoded ? Buffer.from(r.data, 'base64').toString() : r.data);
      fim = r.eof;
    }
    writeFileSync(env.M04_RASTRO, partes.join(''));
  }
  voltas = await avaliar('window.motor_voltas');
  if (conta.take?.ligado) conta.takeQuadros = await avaliar('window.motor_takeConta');
  Object.assign(conta, await avaliar(`({ transicoesAoFim: window.motor_transicoes, animacoesSoltas: window.motor_soltas,
    camadasNeutras: window.motor_camadas?.() ?? 0, cor: window.motor_cor ?? null })`));
  // Conversão própria pela metade é cor diferente sem aviso: quadro que ela não cobre derruba o render, a não ser
  // que M04_COR_MISTA=1 aceite. Os contadores saem no resumo sempre.
  if (corPropria && conta.cor?.passados > 0 && env.M04_COR_MISTA !== '1') {
    const motivos = Object.entries(conta.cor.motivos).map(([m, q]) => `${m}: ${q}`).join(', ');
    throw new Error(`conversão de cor própria não cobriu ${conta.cor.passados} quadros (${motivos}); M04_COR_MISTA=1 aceita pelo Chromium`);
  }
  encerrar('ok');
}).catch((erro) => { console.log('falhou:', erro?.message ?? String(erro)); encerrar('erro'); });

/** A ordem dos quadros do laço: em sequência (padrão), embaralhada com semente fixa ou a lista dada (M04_ORDEM). */
function ordemDosQuadros(primeiro, total, pedido, semente) {
  const seguida = Array.from({ length: total }, (_, i) => primeiro + i);
  if (!pedido || pedido === 'seguida') return seguida;
  if (pedido !== 'embaralhada') return pedido.split(',').map(Number);
  let s = semente;
  const r = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = seguida.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [seguida[i], seguida[j]] = [seguida[j], seguida[i]]; }
  return seguida;
}

async function encerrar(motivo) {
  if (encerrado) return;
  encerrado = true;
  // Sem isso o Chromium continua pintando (achado do M06).
  for (const j of BrowserWindow.getAllWindows()) { try { j.webContents.stopPainting(); } catch {} }
  fecharMidias(midias);
  const resumo = { rotulo, motivo, composicao: id, pedidos, voltas,
    quadros: registro.length, qps: QPS, conferir, ...conta, videoMs: Math.round(conta.videoMs), tempos,
    ...(midias ? { midias: { videos: midias.filter((m) => m.tipo === 'video').length, audios: midias.filter((m) => m.tipo === 'audio').length,
      decodificados: midias.reduce((s, m) => s + (m.leitor?.decodificados ?? 0), 0), reaberturas: midias.reduce((s, m) => s + (m.leitor?.reaberturas ?? 0), 0) } } : {}),
    paredeLaco: Number(((performance.now() - inicio) / 1000).toFixed(3)) };
  try {
    // P10.2: o fechar espera a fila do NVENC esvaziar; o paredeQuadros conta essa espera (e o fim da sessão), para
    // comparar com a captura síncrona, em que a codificação estava dentro do laço.
    const r = motor?.fechar();
    resumo.paredeQuadros = Number(((performance.now() - inicio) / 1000).toFixed(3));
    // Medianas em ms (P10.2): espera por buffer livre, cópia e codificação (na thread do NVENC, em paralelo).
    const mediana = (v) => { if (!v?.length) return null; const o = [...v].sort((a, b) => a - b); return Number((o[o.length >> 1] / 1000).toFixed(3)); };
    if (r) Object.assign(resumo, { importacoes: r.importacoes, bytes: r.bytes, codificados: r.quadros, repetidosNoFluxo: r.repetidos, pulados: r.pulados, puladoDesligado: r.puladoDesligado ?? null,
      msEspera: mediana(r.esperaUs), msCopia: mediana(r.copiaUs), msCodificacao: mediana(r.codificacaoUs), msRepeticao: mediana(r.repeticaoUs),
      // S08: mediana da montagem (NVDEC e mistura) e o que o NVDEC leu.
      ...(r.montagemUs?.length ? { msMontagem: mediana(r.montagemUs), montados: r.montagemUs.length, nvdec: { quadros: r.nvdecQuadros, reaberturas: r.nvdecReaberturas, bytes: r.nvdecBytes } } : {}),
      // Brilho de cada quadro do fluxo, medido na placa (nativo/src/brilho.rs); o cli/render.ts procura a piscada.
      ...(r.brilho?.length ? { brilho: r.brilho, mudanca: r.mudanca, msBrilho: mediana(r.brilhoUs) } : {}),
      ...(r.brilhoErro ? { brilhoErro: r.brilhoErro } : {}) });
  } catch (erro) { resumo.erroAoFechar = erro.message; }
  if (codificador) {
    resumo.modo = 'cpu';
    try {
      if (motivo !== 'ok') await codificador.matar();
      else { const r = await codificador.fechar(); Object.assign(resumo, { bytes: r.bytes, codificados: r.quadros }); }
    } catch (erro) { resumo.erroAoFechar = erro.message; await codificador.matar(); }
  }
  // Codificador que não fechou bem (NVENC ou ffmpeg) é render com erro, mesmo com todos os quadros enviados.
  if (resumo.erroAoFechar) motivo = 'erro';
  servidor?.close();
  servidorMoldura?.close();
  try { BrowserWindow.getAllWindows()[0]?.webContents.debugger.detach(); } catch {}
  // Áudio: um único ffmpeg junta o vídeo cru fechado acima e a mistura no MP4 (audio.ts). Sem áudio, nada muda.
  if (!audio) return terminar(motivo, resumo);
  if (motivo !== 'ok' || resumo.erroAoFechar) { audio.limpar(); return terminar(motivo, resumo); }
  // P13: página de um trecho (páginas em paralelo) não mistura: grava os assets por quadro, com a src relativa à
  // base, e quem juntou os trechos mistura uma vez para o vídeo inteiro (P13: docs/experimentos/2026-10-p13-paginas-em-paralelo/paralelo.mjs).
  if (env.M04_AUDIO_ASSETS) {
    try {
      writeFileSync(env.M04_AUDIO_ASSETS, JSON.stringify(audio.exportar()));
      resumo.audio = { trilhas: 0, assets: audio.assets, exportado: env.M04_AUDIO_ASSETS };
    } catch (erro) { console.log('falhou: áudio:', erro.message); motivo = 'erro'; }
    audio.limpar();
    return terminar(motivo, resumo);
  }
  // M04_AAC: aac (nativo do ffmpeg, padrão), libfdk_aac (o do Remotion, com o ffmpeg dele) ou pcm (sem perda, para medir).
  const aac = { libfdk_aac: ['-c:a', 'libfdk_aac', '-b:a', '320k', '-cutoff', '18000'], pcm: ['-c:a', 'pcm_s16le'] }[env.M04_AAC]
    ?? ['-c:a', 'aac', '-b:a', '320k'];
  audio.misturar({ video: bruto, saida: join(saida, `${rotulo}.mp4`), totalQuadros,
    ffmpeg: env.M04_FFMPEG, ffprobe: env.M04_FFPROBE, codificador: aac })
    .then((r) => { resumo.audio = r ?? { trilhas: 0 }; terminar(motivo, resumo); },
      (erro) => { console.log('falhou: áudio:', erro.message); resumo.audio = { erro: erro.message }; terminar('erro', resumo); });
}

function terminar(motivo, resumo) {
  resumo.motivo = motivo;
  // Fim do encerrar, por qualquer caminho: a mistura do áudio (que lê a mídia em data:) já acabou.
  rmSync(dados, { recursive: true, force: true });
  console.log('resumo', JSON.stringify(resumo));
  // A tarja só existe na composição sintética; o registro guarda o índice relativo para o comparar.mjs do M03.
  const primeiro = Number(env.M04_INICIO ?? 0);
  const quadros = registro.map((q) => ({ ...q, tarja: q.tarja == null ? q.tarja : q.tarja - primeiro }));
  writeFileSync(join(saida, `${rotulo}.json`), JSON.stringify({ resumo, quadros }));
  app.exit(motivo === 'ok' && conta.semPixmap === 0 ? 0 : 1);
}
