// Coleta da conferência (S04): processo do Electron só da conferência, separado do render (decisão do responsável de
// 2026-10-30: o captura/main.ts não muda). Sempre na CPU (desenho por software, janela fora da tela): é pouco trabalho
// e não disputa a placa. Abre a composição em linha do tempo declarada (docs/formatos/linha-do-tempo.md), põe o quadro
// N como o render põe (linha do tempo do documento parada desde antes de carregar; cada animação pausada em
// N × 1000 / qps; o gancho motor_quadro antes) e lê o DOM com o geometria.js. Nada aqui vai para um vídeo.
//
// Pedido em CONF_PEDIDO (JSON): { pasta, declaracao: { id, largura, altura, qps, quadros }, opacidadeMin, tempo, extra }.
// `extra` (opcional): caminhos de scripts de página injetados depois do geometria.js; o que definir window.motor_extra(n)
// sai em cada quadro da geometria, no campo `extra` (é o que o Kodecz Bench lê, bench/sonda.js). A conferência não usa.
// Depois de abrir, escreve «conf {"pronto":…}» e atende comandos JSON, um por linha no stdin; cada resposta sai numa
// linha «conf {…}» no stdout (erro: «conf {"erro":"…"}»):
//   { cmd: "geometria", de, ate, arquivo }      → JSON por linha em arquivo (um quadro por linha)
//   { cmd: "limpos", quadros, pasta, largura }  → <pasta>/<n>.bgra, só o apresentador, reduzido à largura
//   { cmd: "fundos", quadros, largura, minimo, arquivo } → JSON em arquivo: [{ n, textos: [{ texto, papel, cor, fs, fw,
//                                                caixas, fundo }] }], o fundo real dos textos legíveis (G20)
//   { cmd: "fotos", itens: [{ n, marcas, arquivo }] } → PNG do quadro com as caixas desenhadas
//   { cmd: "sair" }
// Diferenças conhecidas para o render: o <video> é decodificado pelo próprio Chromium (no render é o motor, com a cor
// do cor-limpa.js); a cor não importa para achar o rosto, e a caixa do elemento é a mesma.
import { app, BrowserWindow } from 'electron';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { HOSTS_FONTES as FONTES, obterFonte } from '../captura/fontes.ts';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { createInterface } from 'node:readline';

const pedido = JSON.parse(process.env.CONF_PEDIDO ?? '{}');
const { pasta, declaracao: d } = pedido;
const TEMPO = pedido.tempo ?? 30000;
const GEOMETRIA = readFileSync(new URL('./geometria.js', import.meta.url), 'utf8');
const EXTRA = (pedido.extra ?? []).map((c) => readFileSync(c, 'utf8')).join(';\n');
const cacheFontes = process.env.M04_FONTES_CACHE ?? join(homedir(), '.cache', 'motor-video', 'fontes');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.css': 'text/css',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' };

const responder = (obj) => process.stdout.write(`conf ${JSON.stringify(obj)}\n`);
const morrer = (erro) => { responder({ erro: String(erro?.message ?? erro) }); app.exit(1); };
process.on('uncaughtException', morrer);
process.on('unhandledRejection', morrer);

/** Só a pasta da composição, por HTTP local, com Range (o <video> pede pedaços). */
function servir() {
  const raiz = normalize(pasta);
  const s = createServer((req, res) => {
    let caminho;
    try { caminho = normalize(join(raiz, decodeURIComponent(new URL(req.url, 'http://x').pathname))); } catch { res.writeHead(400).end(); return; }
    if (!caminho.startsWith(raiz) || !existsSync(caminho) || !statSync(caminho).isFile()) { res.writeHead(404).end(); return; }
    const tamanho = statSync(caminho).size, tipo = TIPOS[extname(caminho).toLowerCase()] ?? 'application/octet-stream';
    const faixa = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (faixa) {
      const ini = faixa[1] ? Number(faixa[1]) : tamanho - Number(faixa[2]);
      const fim = faixa[1] && faixa[2] ? Math.min(Number(faixa[2]), tamanho - 1) : tamanho - 1;
      res.writeHead(206, { 'content-type': tipo, 'content-length': fim - ini + 1, 'content-range': `bytes ${ini}-${fim}/${tamanho}`, 'accept-ranges': 'bytes' });
      createReadStream(caminho, { start: ini, end: fim }).pipe(res);
    } else {
      res.writeHead(200, { 'content-type': tipo, 'content-length': tamanho, 'accept-ranges': 'bytes' });
      createReadStream(caminho).pipe(res);
    }
  });
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => ok(s.address().port)));
}

// Código da página: o quadro N como no render (auxiliarLinha do captura/main.ts, P10), mais o <video> buscado pelo
// próprio Chromium nos quadros limpos.
const AUXILIAR = `
  const vistas = new Set();
  const transicao = (a) => typeof CSSTransition !== 'undefined' && a instanceof CSSTransition;
  const esperarImagens = () => Promise.all([...document.images].filter((i) => !i.complete).map((i) => i.decode().catch(() => { throw new Error('imagem não carregou: ' + (i.currentSrc || i.src)); })));
  window.motor_preparar = async (tempo) => {
    let relogio;
    const limite = new Promise((_, falha) => { relogio = setTimeout(() => falha(new Error('a página não ficou pronta em ' + tempo + ' ms (fontes, imagens e vídeos)')), tempo); });
    const midias = [...document.querySelectorAll('video, audio')];
    for (const m of midias) { m.pause(); m.muted = true; m.autoplay = false; m.preload = 'auto'; }
    const metadados = midias.filter((m) => m.localName === 'video' && m.readyState < 1)
      .map((m) => new Promise((ok, falha) => { m.addEventListener('loadedmetadata', ok, { once: true }); m.addEventListener('error', () => falha(new Error('vídeo não carregou: ' + m.currentSrc)), { once: true }); }));
    const imagens = Promise.all([...document.images].map((i) => i.decode().catch(() => { throw new Error('imagem não carregou: ' + (i.currentSrc || i.src)); })));
    try { await Promise.race([Promise.all([document.fonts.ready, imagens, ...metadados]), limite]); } finally { clearTimeout(relogio); }
    for (const a of document.getAnimations()) if (a.timeline === document.timeline && !transicao(a)) vistas.add(a);
    return { animacoes: vistas.size, videos: document.querySelectorAll('video').length };
  };
  const buscar = (v, t) => new Promise((ok) => {
    if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) return ok();
    v.addEventListener('seeked', () => ok(), { once: true });
    v.currentTime = t;
  });
  window.motor_irPara = async (n, comVideo) => {
    const ms = (n * 1000) / ${d.qps};
    if (typeof window.motor_quadro === 'function') await window.motor_quadro(n, ms);
    for (const a of document.getAnimations()) {
      if (transicao(a)) a.finish();
      else if (a.timeline === document.timeline) vistas.add(a);
    }
    for (const a of vistas) {
      if (a.playState === 'idle') { vistas.delete(a); continue; }
      a.pause(); a.currentTime = ms;
    }
    if (comVideo) {
      for (const v of document.querySelectorAll('video')) {
        if (window.motor_foraDoTrecho(v, n)) { v.setAttribute('data-motor-fora', ''); continue; }
        v.removeAttribute('data-motor-fora');
        const recorte = Number(v.getAttribute('data-recorte') ?? 0), inicio = Number(v.getAttribute('data-inicio') ?? 0);
        const vel = Number(v.getAttribute('data-velocidade') || 1);
        // O quadro do vídeo que começa até t (tempoNoVideo, com a velocidade, C02), pela busca do Chromium (folga de
        // 0,1 ms para não cair no anterior). O render conta em ticks, sem folga (midia-linha.ts): pode diferir em 1
        // quadro quando o pts passa de t por menos de 0,1 ms (29,97 qps em 30, quadros 1 a 3), o que não muda a caixa
        // do rosto.
        await buscar(v, ((n - inicio) * vel) / ${d.qps} + recorte / ${d.qps} + 0.0001);
      }
    }
    await esperarImagens();
    await document.fonts.ready;
    return n;
  };
  window.motor_geometrias = async (de, ate) => {
    const lista = [];
    for (let n = de; n < ate; n++) { await window.motor_irPara(n, false); lista.push({ n, ...window.motor_geometria(n), ...(window.motor_extra ? { extra: window.motor_extra(n) } : {}) }); }
    return lista;
  };
  window.motor_pintado = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok(true))));
  true`;

app.commandLine.appendSwitch('hide-scrollbars');

app.whenReady().then(async () => {
  const porta = await servir();
  const base = `http://127.0.0.1:${porta}/`;
  const janela = new BrowserWindow({
    width: d.largura, height: d.altura, useContentSize: true, show: false, backgroundColor: '#000000',
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'motor-conferencia',
      backgroundThrottling: false },
  });
  const wc = janela.webContents;
  const host = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
  // Rede: só a pasta da composição; fonte do Google só do cache do motor (nunca baixada aqui).
  wc.session.protocol.handle('https', async (p) => {
    if (!FONTES.has(host(p.url))) return new Response('bloqueado pela conferência', { status: 403 });
    try {
      const f = await obterFonte(p.url, { cache: cacheFontes, preparar: false, buscar: () => { throw new Error('sem rede'); }, userAgent: () => '' });
      return new Response(f.corpo, { headers: { 'content-type': f.tipo, 'access-control-allow-origin': '*' } });
    } catch (erro) {
      setTimeout(() => morrer(new Error(`${erro.message}; o comando de render baixa a que faltar`)), 0);
      return new Response('fonte fora do cache', { status: 404 });
    }
  });
  wc.session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (r, ok) => ok({ cancel: !(r.url.startsWith(base) || r.url.startsWith('data:')
    || r.url.startsWith('blob:') || (r.url.startsWith('https://') && FONTES.has(host(r.url)))) }));
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) process.stderr.write(`página: ${e.message}\n`); });
  await wc.loadURL('about:blank');
  wc.debugger.attach('1.3');
  // A linha do tempo do documento parada desde antes de a página rodar, como no render (P10).
  await wc.debugger.sendCommand('Animation.enable');
  await wc.debugger.sendCommand('Animation.setPlaybackRate', { playbackRate: 0 });
  await wc.loadURL(`${base}index.html`);
  const avaliar = (codigo) => wc.executeJavaScript(codigo, true);
  await avaliar(`window.motor_conf = ${JSON.stringify({ opacidadeMin: pedido.opacidadeMin ?? 0.05, qps: d.qps })}; ${GEOMETRIA};\n${EXTRA};\n${AUXILIAR}`);
  const prep = await avaliar(`window.motor_preparar(${TEMPO})`);
  // window.motor_falas: o que a página publicou (a conferência do esquema é do comando, falas.ts).
  const falas = await avaliar('(() => { const f = window.motor_falas; return f === undefined ? null : JSON.parse(JSON.stringify(f)); })()');
  const tamanho = await avaliar('[document.documentElement.clientWidth, document.documentElement.clientHeight]');
  // O destino declarado (G19): data-destino no <html>, depois de a página preparar (vale o que um script puser).
  const destino = await avaliar("document.documentElement.getAttribute('data-destino')");
  responder({ pronto: true, ...prep, falas, tamanho, destino });

  const capturar = async () => { await avaliar('window.motor_pintado()'); return wc.capturePage(); };
  const comandos = createInterface({ input: process.stdin });
  for await (const linha of comandos) {
    if (!linha.trim()) continue;
    const c = JSON.parse(linha);
    if (c.cmd === 'sair') break;
    const t0 = performance.now();
    if (c.cmd === 'geometria') {
      const partes = [];
      for (let de = c.de; de < c.ate; de += 100) {
        const lista = await avaliar(`window.motor_geometrias(${de}, ${Math.min(c.ate, de + 100)})`);
        for (const g of lista) partes.push(JSON.stringify(g));
      }
      writeFileSync(c.arquivo, partes.join('\n') + '\n');
      responder({ ok: true, quadros: partes.length, ms: Math.round(performance.now() - t0) });
    } else if (c.cmd === 'limpos') {
      let dims = null;
      // O primeiro capturePage só funciona depois de um quadro pintado (antes, UnknownVizError).
      await capturar().catch(() => null);
      await avaliar('window.motor_limpar(true)');
      try {
        for (const n of c.quadros) {
          await avaliar(`window.motor_irPara(${n}, true)`);
          const img = (await capturar()).resize({ width: c.largura, quality: 'good' });
          const { width, height } = img.getSize();
          dims = [width, height];
          writeFileSync(join(c.pasta, `${n}.bgra`), img.toBitmap());
        }
      } finally { await avaliar('window.motor_limpar(false)'); }
      responder({ ok: true, tamanho: dims, ms: Math.round(performance.now() - t0) });
    } else if (c.cmd === 'fundos') {
      // G20: nos quadros pedidos, os textos legíveis com a cor e a cor média do quadro sob as caixas deles, com o
      // texto transparente (reduzido à largura; BGRA).
      await capturar().catch(() => null);
      const saida = [];
      for (const n of c.quadros) {
        await avaliar(`window.motor_irPara(${n}, true)`);
        const textos = await avaliar(`window.motor_textosComCor(${n}, ${Number(c.minimo ?? 0.5)})`);
        if (!textos.length) continue;
        // O quadro como está e o quadro com o texto transparente. Os pixels da caixa que mudam entre os dois são os da
        // letra visível; o fundo é a média do segundo quadro nesses pixels (atrás da letra, e só onde ela aparece: a
        // parte tapada por outra camada não conta). Texto que não muda nada não aparece e fica de fora.
        const comTexto = (await capturar()).resize({ width: c.largura, quality: 'good' }).toBitmap();
        await avaliar('window.motor_semTexto(true)');
        let img;
        try { img = (await capturar()).resize({ width: c.largura, quality: 'good' }); } finally { await avaliar('window.motor_semTexto(false)'); }
        const { width: l, height: h } = img.getSize(), px = img.toBitmap(), ex = l / d.largura, ey = h / d.altura;
        for (const t of textos) {
          let r = 0, g = 0, b = 0, k = 0, muda = 0;
          for (const [x, y, w, a] of t.caixas) {
            const x0 = Math.max(0, Math.floor(x * ex)), x1 = Math.min(l, Math.ceil((x + w) * ex)), y0 = Math.max(0, Math.floor(y * ey)), y1 = Math.min(h, Math.ceil((y + a) * ey));
            for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
              const i = (yy * l + xx) * 4;
              k++;
              if (Math.max(Math.abs(px[i] - comTexto[i]), Math.abs(px[i + 1] - comTexto[i + 1]), Math.abs(px[i + 2] - comTexto[i + 2])) <= 3) continue;
              b += px[i]; g += px[i + 1]; r += px[i + 2]; muda++;
            }
          }
          t.fundo = muda && muda >= 0.005 * k ? [r / muda, g / muda, b / muda].map((v) => Math.round(v * 10) / 10) : null;
        }
        saida.push({ n, textos: textos.filter((t) => t.fundo) });
      }
      writeFileSync(c.arquivo, JSON.stringify(saida));
      responder({ ok: true, amostras: saida.length, ms: Math.round(performance.now() - t0) });
    } else if (c.cmd === 'fotos') {
      await capturar().catch(() => null);
      for (const f of c.itens) {
        await avaliar(`window.motor_irPara(${f.n}, true)`);
        await avaliar(`window.motor_marcas(${JSON.stringify(f.marcas)})`);
        writeFileSync(f.arquivo, (await capturar()).toPNG());
      }
      await avaliar('window.motor_marcas([])');
      responder({ ok: true, ms: Math.round(performance.now() - t0) });
    } else responder({ erro: `comando desconhecido: ${c.cmd}` });
  }
  app.exit(0);
}).catch(morrer);
