// S02: processo (no Node, com a API do Electron dada pela casca do CEF, captura/cef/ganchos.ts) que roda as checagens de DOM dos blocos (conferencia.json) numa página em linha
// do tempo declarada. Põe o quadro N como o motor (main.mjs do M04): a linha do tempo do documento parada desde antes
// de a página rodar (Animation.setPlaybackRate 0), cada animação já vista pausada em N × 1000 / qps. Não captura
// pixel: só lê o DOM (caixas, linhas, opacidade, propriedades). Chamado por conferir-dom.ts; resposta na última linha
// do stdout, `dom <json>`.
// Uso: node --import captura/cef/ganchos.ts blocos/conferir-dom.cjs --no-sandbox --ozone-platform=headless --disable-gpu <raiz> <pagina> <pedido.json>
const { app, BrowserWindow } = require('electron');
const { createReadStream, existsSync, readFileSync, statSync } = require('node:fs');
const { createServer } = require('node:http');
const { extname, join, normalize, sep } = require('node:path');

const [raiz, pagina, arquivoPedido] = process.argv.slice(-3);
const pedido = JSON.parse(readFileSync(arquivoPedido, 'utf8'));
const TIPOS = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.wav': 'audio/wav' };

// Roda na página: as funções da conferência (window.__conferir). Medidas e momentos em INDICE.md («Conferência»).
// Visível: opacidade efetiva (com a dos ancestrais) acima de 0,01, caixa dentro do quadro e nenhum clip-path (dele ou
// de um ancestral) que recorte tudo.
const CONFERIR = `(qps, largura, altura) => {
  const raizCss = getComputedStyle(document.documentElement);
  // Margem em px: número em px, vw ou vh (do quadro), ou um token (--spacing-safe) com um desses. % não diz se é da
  // largura ou da altura: recusada com mensagem.
  const px = (id, v) => {
    const original = String(v).trim(), s = original.startsWith('--') ? raizCss.getPropertyValue(original).trim() : original;
    const m = /^(-?\\d*\\.?\\d+)(px|rem|em|vw|vh|vmin|vmax)?$/.exec(s);
    if (!m) throw new Error(id + ': margem ' + original + (s !== original ? ' (' + (s || 'vazia') + ')' : '') +
      ': só px, rem, em, vw ou vh (ou vmin, vmax); % e cqw/cqh não dizem a base no quadro → pôr a margem em px');
    const fs = parseFloat(raizCss.fontSize), k = { px: 1, rem: fs, em: fs, vw: largura / 100, vh: altura / 100, vmin: Math.min(largura, altura) / 100, vmax: Math.max(largura, altura) / 100 };
    return Number(m[1]) * k[m[2] ?? 'px'];
  };
  const num = (el, nome, padrao = null) => { const v = parseFloat(getComputedStyle(el).getPropertyValue(nome)); return Number.isFinite(v) ? v : padrao; };
  const opacidade = (el) => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    const c = getComputedStyle(e); if (c.display === 'none') return 0; o *= Number(c.opacity); } return o; };
  // clip-path que a conferência não sabe medir (path(), shape(), url(), calc(), posição de 4 valores): conta como sem
  // recorte e vira um achado P1 (pagina.recorte), uma vez por elemento.
  const naoConferidos = new Map();
  const CAIXAS = /\\b(border-box|padding-box|content-box|margin-box|fill-box|stroke-box|view-box)\\b/g;
  const POSICAO = { left: '0%', top: '0%', center: '50%', right: '100%', bottom: '100%' };
  // Área que sobra do elemento sob o clip-path dele, de 0 a 1 (1 sem recorte). inset() pela conta; circle(), ellipse()
  // e polygon() pela fração de uma grade de 32 × 32 pontos que cai dentro da forma (0 se a forma não tem área).
  const sobra = (el, n) => {
    const cp = getComputedStyle(el).clipPath.replace(CAIXAS, ' ').trim();
    if (!cp || cp === 'none') return 1;
    const W = el.offsetWidth ?? el.getBoundingClientRect().width, H = el.offsetHeight ?? el.getBoundingClientRect().height;
    if (!W || !H) return 0;
    const med = (x, base) => x.endsWith('%') ? parseFloat(x) / 100 * base : parseFloat(x);
    const naoSei = () => { if (!naoConferidos.has(el)) naoConferidos.set(el, [cp, n]); return 1; };
    const m = /^(inset|circle|ellipse|polygon)\\((.*)\\)$/.exec(cp);
    if (!m || /[a-z-]\\(/.test(m[2])) return naoSei();
    const [, forma, a] = m;
    if (forma === 'inset') {
      const v = a.split(' round ')[0].trim().split(/\\s+/);
      const [t, r = t, b = t, l = r] = v;
      const w = Math.max(0, W - med(l, W) - med(r, W)), h = Math.max(0, H - med(t, H) - med(b, H));
      return (w * h) / (W * H);
    }
    let dentro;
    if (forma === 'polygon') {
      const pts = a.replace(/^(nonzero|evenodd)\\s*,\\s*/, '').split(',').map((p) => p.trim().split(/\\s+/));
      if (pts.some((p) => p.length !== 2)) return naoSei();
      const xy = pts.map(([x, y]) => [med(x, W), med(y, H)]);
      if (xy.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return naoSei();
      let area = 0;
      for (let i = 0; i < xy.length; i++) { const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length]; area += x1 * y2 - x2 * y1; }
      if (Math.abs(area) < 1e-6) return 0;
      dentro = (x, y) => { let d = false;
        for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) { const [xi, yi] = xy[i], [xj, yj] = xy[j];
          if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) d = !d; }
        return d; };
    } else {
      const [raios, pos = '50% 50%'] = a.split(/\\s*\\bat\\b\\s*/);
      const p = pos.trim().split(/\\s+/).map((x) => POSICAO[x] ?? x);
      if (p.length > 2) return naoSei();
      const cx = med(p[0], W), cy = med(p[1] ?? '50%', H);
      const lado = (k, eixo) => {
        const d = eixo === 'x' ? [cx, W - cx] : eixo === 'y' ? [cy, H - cy] : [cx, W - cx, cy, H - cy];
        if (k === 'closest-side') return Math.min(...d);
        if (k === 'farthest-side') return Math.max(...d);
        return med(k, eixo === 'x' ? W : eixo === 'y' ? H : Math.hypot(W, H) / Math.SQRT2);
      };
      const rs = raios.trim() ? raios.trim().split(/\\s+/) : ['closest-side'];
      const rx = forma === 'circle' ? lado(rs[0], 'r') : lado(rs[0], 'x');
      const ry = forma === 'circle' ? rx : lado(rs[1] ?? rs[0], 'y');
      if (!Number.isFinite(rx) || !Number.isFinite(ry)) return naoSei();
      if (!(rx > 0 && ry > 0)) return 0;
      dentro = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
    }
    const N = 32;
    let k = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (dentro((i + 0.5) * W / N, (j + 0.5) * H / N)) k++;
    return k / (N * N);
  };
  const recortada = (el, n) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) if (sobra(e, n) <= 0.0001) return true; return false; };
  const visivel = (el, n) => { const r = el.getBoundingClientRect(); return getComputedStyle(el).visibility !== 'hidden' &&
    r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < largura && r.top < altura &&
    opacidade(el) > 0.01 && !recortada(el, n); };
  // Em movimento: alguma animação de geometria (transform, clip-path, posição) dele ou de um ancestral no meio do
  // caminho neste quadro. A zona segura vale para o que está parado; o que entra ou sai pode cruzar a borda.
  const GEOMETRIA = new Set(['transform', 'translate', 'scale', 'rotate', 'clipPath', 'left', 'top', 'right', 'bottom']);
  const movendo = (el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) for (const a of e.getAnimations()) {
    const p = a.effect?.getComputedTiming().progress;
    if (p !== null && p !== undefined && p > 0 && p < 1 && a.effect.getKeyframes().some((k) => Object.keys(k).some((x) => GEOMETRIA.has(x)))) return true;
  } return false; };
  const linhas = (el) => {
    const g = document.createRange(); g.selectNodeContents(el);
    const rs = [...g.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5).sort((a, b) => a.top - b.top);
    let n = 0, base = -Infinity;
    for (const r of rs) if (r.top > base + r.height / 2) { n++; base = r.top; }
    return n;
  };
  // Quanto (px) a caixa do elemento ou o texto dele passa da margem m em volta do quadro.
  const fora = (el, m) => {
    const g = document.createRange(); g.selectNodeContents(el);
    const rs = [el.getBoundingClientRect(), ...[...g.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5)];
    return Math.max(0, ...rs.map((r) => Math.max(m - r.left, m - r.top, r.right - (largura - m), r.bottom - (altura - m))));
  };
  const inteira = (el, n) => { const r = el.getBoundingClientRect();
    return opacidade(el) >= 0.999 && sobra(el, n) >= 0.9999 && Math.abs(r.left) < 1 && Math.abs(r.top) < 1 &&
      Math.abs(r.width - largura) < 1 && Math.abs(r.height - altura) < 1 ? 0 : 1; };
  const momento = (el, quando, n) => quando === 'fim' ? num(el, '--fim') === n
    : quando === 'inicio' ? num(el, '--inicio') === n
    : quando === 'fim-da-transicao' ? num(el, '--inicio') + num(el, '--duracao', 15) === n
    : quando === 'visivel' ? visivel(el, n)
    : quando === 'visivel-parado' ? visivel(el, n) && !movendo(el) : (() => { throw new Error('momento desconhecido: ' + quando); })();
  const onde = (el, seletor, i) => el.id ? '#' + el.id : seletor + (i ? ' ' + (i + 1) : '');
  const nome = (el) => el.id ? '#' + el.id : el.classList.length ? '.' + el.classList[0] : el.localName;
  const r2 = (x) => Math.round(x * 1000) / 1000;
  const t = (n) => (n / qps).toFixed(2).replace('.', ',');
  const valor = (c, el, n) => {
    if (c.medida === 'linhas') return linhas(el);
    if (c.medida === 'fora-da-margem') return Math.round(fora(el, px(c.id, c.margem ?? 0)));
    if (c.medida === 'transborda') return Math.max(0, el.scrollWidth - el.clientWidth);
    if (c.medida === 'inteira') return inteira(el, n);
    if (c.medida === 'escala') return r2(el.getBoundingClientRect().width / el.offsetWidth);
    if (c.medida === 'fim-menos-inicio') return num(el, '--fim') - num(el, '--inicio');
    if (c.medida === 'distancia-do-alvo') return Math.abs(num(el, c.propriedade) - Number(el.dataset.valor));
    if (c.medida === 'opacidade') return r2(opacidade(el));
    throw new Error(c.id + ': medida desconhecida: ' + c.medida);
  };
  const achado = (c, n, lugar, v) => ((c.maximo !== undefined && !(v <= c.maximo)) || (c.minimo !== undefined && !(v >= c.minimo)))
    ? [{ id: c.id, prioridade: c.prioridade, quadro: n, onde: lugar, valor: v,
      mensagem: c.mensagem.replaceAll('{t}', t(n)).replaceAll('{quadro}', n).replaceAll('{onde}', lugar).replaceAll('{valor}', v) }] : [];
  // fim-do-bloco: a medida no último quadro em que o elemento está visível (o corte da cena, a saída dele ou o fim da
  // composição), guardada quadro a quadro e julgada só no fechar(); se ele nunca aparece, a do último quadro pedido.
  const fimDoBloco = new Map();

  // Avalia as checagens no quadro n (ultimo: o último quadro pedido) e devolve os achados.
  const avaliar = (checagens, n, ultimo) => {
    const achados = [];
    for (const c of checagens) {
      const els = [...document.querySelectorAll(c.seletor)];
      if (c.medida === 'visiveis') {
        if (c.quando !== 'todos') throw new Error(c.id + ': a medida visiveis vale só com quando = todos');
        achados.push(...achado(c, n, c.seletor, els.filter((el) => visivel(el, n)).length));
        continue;
      }
      els.forEach((el, i) => {
        const lugar = onde(el, c.seletor, i);
        if (c.quando === 'fim-do-bloco') {
          const chave = c.id + ' ' + i, antes = fimDoBloco.get(chave), visto = visivel(el, n);
          if (visto ? !antes || !antes.visto || n > antes.n : n === ultimo && !antes)
            fimDoBloco.set(chave, { c, n, lugar, v: valor(c, el, n), visto });
          return;
        }
        if (momento(el, c.quando, n)) achados.push(...achado(c, n, lugar, valor(c, el, n)));
      });
    }
    return achados;
  };
  // Depois do último quadro: os achados do fim-do-bloco e dos clip-path não conferidos.
  const fechar = () => [
    ...[...fimDoBloco.values()].flatMap(({ c, n, lugar, v }) => achado(c, n, lugar, v)),
    ...[...naoConferidos].map(([el, [cp, n]]) => ({ id: 'pagina.recorte', prioridade: 'P1', quadro: n, onde: nome(el), valor: 0,
      mensagem: 't=' + t(n) + ' · ' + nome(el) + ' · o clip-path ' + cp + ' não é conferido (conta como sem recorte em visível e ' +
        'inteira) → usar inset(), circle(), ellipse() ou polygon(), sem calc()' })),
  ];
  // Elemento que os blocos animam e ficou sem animação: variável sem padrão faltando (sem --fim fora de uma cena, por
  // exemplo) invalida a declaração inteira.
  const animacoes = (lista, n) => {
    const achados = [], vistos = new Set();
    for (const { bloco, seletor, variaveis } of lista) for (const el of document.querySelectorAll(seletor)) {
      if (vistos.has(el) || getComputedStyle(el).animationName !== 'none') continue;
      vistos.add(el);
      const faltam = variaveis.filter((v) => getComputedStyle(el).getPropertyValue(v).trim() === '');
      achados.push({ id: 'pagina.animacao', prioridade: 'P0', quadro: n, onde: nome(el), valor: faltam.length,
        mensagem: 't=' + t(n) + ' · ' + nome(el) + ' · a animação do bloco ' + bloco + ' é inválida e não roda' + (faltam.length
          ? ' (sem ' + faltam.join(', ') + ') → pôr ' + faltam.join(', ') + ' no style do bloco, ou o bloco dentro de uma cena (que dá --inicio e --fim)'
          : ' → conferir as variáveis do style do bloco') });
    }
    return achados;
  };
  // Todo clip-path da página, uma vez: o que a conferência não mede vira pagina.recorte mesmo sem checagem que o veja.
  const recortes = (n) => { for (const el of document.querySelectorAll('*')) sobra(el, n); };
  return { avaliar, fechar, animacoes, recortes };
}`;

app.whenReady().then(async () => {
  const servidor = createServer((req, res) => {
    const caminho = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const arquivo = join(raiz, caminho);
    if (!arquivo.startsWith(raiz + sep) || !existsSync(arquivo) || statSync(arquivo).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TIPOS[extname(arquivo)] ?? 'application/octet-stream' });
    createReadStream(arquivo).pipe(res);
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const janela = new BrowserWindow({ show: false, width: 800, height: 600, enableLargerThanScreen: true,
    webPreferences: { backgroundThrottling: false } });
  const wc = janela.webContents;
  // A declaração lida do arquivo, para a janela já nascer do tamanho do quadro.
  // O bloco id="kodecz" (ou o antigo id="motor-video"), com os campos em inglês ou os antigos (cli/nomes.ts).
  const bruto = JSON.parse(/<script[^>]*id="(?:kodecz|motor-video)"[^>]*>([\s\S]*?)<\/script>/.exec(readFileSync(join(raiz, pagina), 'utf8'))[1]);
  const decl = { id: bruto.id, largura: bruto.width ?? bruto.largura, altura: bruto.height ?? bruto.altura, qps: bruto.fps ?? bruto.qps,
    quadros: bruto.frames ?? bruto.quadros };
  // O CDP só responde com um documento aberto: about:blank antes (como o main.mjs do M04).
  await wc.loadURL('about:blank');
  wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: decl.largura, height: decl.altura, deviceScaleFactor: 1, mobile: false });
  await wc.debugger.sendCommand('Animation.enable');
  await wc.debugger.sendCommand('Animation.setPlaybackRate', { playbackRate: 0 });
  await wc.loadURL(`http://127.0.0.1:${servidor.address().port}/${pagina}`);
  await wc.executeJavaScript(`(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    window.__vistas = new Set();
    window.__ir = (n, qps) => {
      for (const a of document.getAnimations()) if (a.timeline === document.timeline) window.__vistas.add(a);
      for (const a of window.__vistas) { if (a.playState === 'idle') { window.__vistas.delete(a); continue; } a.pause(); a.currentTime = n * 1000 / qps; }
    };
    window.__conferir = (${CONFERIR})(${decl.qps}, ${decl.largura}, ${decl.altura});
  })()`);
  const quadros = pedido.quadros ?? Array.from({ length: decl.quadros }, (_, n) => n);
  // O erro lançado na página chega ao executeJavaScript sem a mensagem: volta como { erro }.
  const achados = await wc.executeJavaScript(`(() => { try {
    const checagens = ${JSON.stringify(pedido.checagens)}, quadros = ${JSON.stringify(quadros)}, todos = [];
    const primeiro = quadros.length ? Math.min(...quadros) : 0, ultimo = quadros.length ? Math.max(...quadros) : -1;
    // Os blocos convertem quadros em tempo com o --fps da raiz (o antigo --qps ainda é lido): diferente do declarado,
    // tudo sai fora do tempo.
    const raizCss = getComputedStyle(document.documentElement);
    const varFps = raizCss.getPropertyValue('--fps').trim() === '' && raizCss.getPropertyValue('--qps').trim() !== '' ? '--qps' : '--fps';
    const qpsCss = parseFloat(raizCss.getPropertyValue(varFps));
    if (qpsCss !== ${decl.qps}) todos.push({ id: 'pagina.qps', prioridade: 'P0', quadro: 0, onde: ':root', valor: qpsCss,
      mensagem: 't=0,00 · :root · ' + varFps + ' é ' + qpsCss + ', e o bloco kodecz declara fps ${decl.qps} → pôr :root { --fps: ${decl.qps}; }' });
    window.__ir(primeiro, ${decl.qps});
    todos.push(...window.__conferir.animacoes(${JSON.stringify(pedido.animacoes ?? [])}, primeiro));
    window.__conferir.recortes(primeiro);
    for (const n of quadros) { window.__ir(n, ${decl.qps}); todos.push(...window.__conferir.avaliar(checagens, n, ultimo)); }
    todos.push(...window.__conferir.fechar());
    return todos;
  } catch (e) { return { erro: String(e && e.message || e) }; } })()`);
  if (achados.erro) throw new Error(achados.erro);
  const medidas = pedido.medir ? await wc.executeJavaScript(`(() => {
    const r = {};
    for (const [n, seletor, prop] of ${JSON.stringify(pedido.medir)}) {
      window.__ir(n, ${decl.qps});
      r[n + ' ' + seletor + ' ' + prop] = [...document.querySelectorAll(seletor)].map((el) => prop === 'caixa'
        ? (({ left, top, width, height }) => ({ left, top, width, height }))(el.getBoundingClientRect())
        : getComputedStyle(el).getPropertyValue(prop));
    }
    return r;
  })()`) : null;
  console.log(`dom ${JSON.stringify({ declaracao: decl, quadros: quadros.length, achados, medidas })}`);
  app.exit(0);
}).catch((e) => { console.log(`dom ${JSON.stringify({ erro: String(e && e.stack || e) })}`); app.exit(1); });
