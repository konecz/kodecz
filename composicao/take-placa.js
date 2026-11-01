// S08 (experimento, MOTOR_TAKE_PLACA=1): o lado da página da montagem do take na placa. O vídeo embutido da linha do
// tempo não é desenhado no <canvas> (fica transparente, um buraco); o motor decodifica o quadro no NVDEC e o põe por
// baixo da textura da página, antes do NVENC (nativo/src/mistura.rs). A página só diz onde o vídeo está.
//
// O buraco só mostra o vídeo se nada for pintado por baixo dele. O que fica por baixo, a página tira:
// - o fundo da raiz (html ou body) vira o «fundo» da montagem, posto pelo motor por baixo de tudo (a raiz fica
//   transparente o render inteiro);
// - um ancestral do vídeo com fundo de cor que cobre o quadro inteiro (o «palco») também vira o fundo, no quadro;
// - um ancestral com fundo que o vídeo cobre inteiro fica transparente no quadro (não aparecia mesmo).
// O vídeo pode estar ampliado ou reduzido (tamanho no CSS ou `transform: scale` nele, zoom animado): a página diz onde
// cada texel cai no quadro e o núcleo amostra bilinear como o Chromium (ver `geometria`). Quando a geometria não se
// reproduz (subpixel nas bordas visíveis, opacidade, filtro, máscara, rotação, 3D) ou há algo
// pintado por baixo que não é isso, o quadro volta ao caminho do M09/P10.5 (o motor decodifica na CPU e a página
// desenha o canvas). A ordem de pintura é aproximada pela ordem do documento e pelo posicionamento (ver `acima`).
// O recorte arredondado de um ancestral (o cartão com `overflow: hidden` e `border-radius`, com sombra e contorno) vai
// ao núcleo como [x0, y0, x1, y1, raio] (`arredondamento`): a cobertura do canto é a do Skia, e na faixa do canto a
// página fica por baixo do vídeo (mistura.rs, `Arredondado`); por isso nada posicionado depois do vídeo pode cruzar
// os cantos, salvo o fundo quase opaco que cobre o canto inteiro, com o texto dele (o cobertor, ver o fim de `medir`).
//
// Script clássico: o main.ts o avalia na página (como o cor-limpa.js).
(function () {
  'use strict';
  const CLASSE = 'motor-sob-video';

  const cor = (texto) => {
    const m = /^rgba?\(([^)]+)\)$/.exec(texto ?? '');
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  };
  const transparente = (s) => s.backgroundImage === 'none' && (cor(s.backgroundColor)?.a ?? 1) === 0;
  const solido = (s) => s.backgroundImage === 'none' && cor(s.backgroundColor)?.a === 1;
  const rgb = (s) => { const c = cor(s.backgroundColor); return (c.r << 16) | (c.g << 8) | c.b; };
  const semBorda = (s) => ['Top', 'Right', 'Bottom', 'Left'].every((l) => s[`border${l}Width`] === '0px' || s[`border${l}Style`] === 'none')
    && s.boxShadow === 'none' && (s.outlineStyle === 'none' || s.outlineWidth === '0px');
  const semRaio = (s) => ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].every((c) => /^0px( 0px)?$/.test(s[`border${c}Radius`]));
  const efeitoSimples = (s, transformacao = false) => s.opacity === '1' && s.filter === 'none' && s.mixBlendMode === 'normal' && s.clipPath === 'none'
    && (s.maskImage ?? 'none') === 'none' && (s.backdropFilter ?? 'none') === 'none' && s.visibility === 'visible'
    && (transformacao || s.transform === 'none' || /^matrix\(1, 0, 0, 1, [-0-9.e]+, [-0-9.e]+\)$/.test(s.transform));
  // Transformação de nó próprio no Chromium (a origem da caixa vai arredondada ao pixel antes dela).
  const transformado = (s) => s.transform !== 'none' || /\btransform\b/.test(s.willChange) || (s.translate ?? 'none') !== 'none'
    || (s.scale ?? 'none') !== 'none' || (s.rotate ?? 'none') !== 'none';
  const cruza = (r, c) => r.width > 0 && r.height > 0 && r.left < c[2] && r.right > c[0] && r.top < c[3] && r.bottom > c[1];
  const dentro = (r, c) => r.left >= c[0] && r.top >= c[1] && r.right <= c[2] && r.bottom <= c[3];
  const visivel = (e) => typeof e.checkVisibility !== 'function' || e.checkVisibility({ opacityProperty: true, visibilityProperty: true });

  // Pseudo-elemento com conteúdo (pinta uma caixa que a varredura dos elementos não vê).
  const comPseudo = (e) => ['::before', '::after'].some((p) => !['none', 'normal'].includes(getComputedStyle(e, p).content));
  // Texto solto direto no elemento (não está em nenhum filho).
  const comTexto = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
  // A caixa pintada: a da borda, mais a sombra e o contorno (com folga, sem calcular o tamanho de cada um).
  const caixaPintada = (e, s) => {
    const b = e.getBoundingClientRect();
    const f = s.boxShadow !== 'none' || (s.outlineStyle !== 'none' && s.outlineWidth !== '0px') ? 256 : 0;
    return f ? { left: b.left - f, top: b.top - f, right: b.right + f, bottom: b.bottom + f, width: b.width + 2 * f, height: b.height + 2 * f } : b;
  };
  const animado = (e) => e.getAnimations().length > 0;
  // Elementos que pintam conteúdo próprio sem fundo (imagem, canvas, SVG, controles).
  const SUBSTITUIDOS = new Set(['img', 'canvas', 'video', 'svg', 'iframe', 'embed', 'object', 'input', 'textarea', 'select', 'button', 'picture']);
  const semLinhaDeBorda = (s) => ['Top', 'Right', 'Bottom', 'Left'].every((l) => s[`border${l}Width`] === '0px' || s[`border${l}Style`] === 'none');
  // Até onde a sombra e o contorno pintam além da caixa (px): deslocamento + 1,5 × desfoque (os 3 sigmas do Skia) +
  // espalhamento, e a largura + o afastamento do contorno; com folga de 2 px.
  const alcance = (s, e) => {
    let a = 0;
    // `sigmas`: quantos desfoques a sombra alcança (1,5 na box-shadow, em que o desfoque é 2 sigmas).
    const sombras = (lista, sigmas) => {
      for (const sombra of lista) {
        const n = sombra.replace(/rgba?\([^)]*\)|#[0-9a-f]+|inset/gi, ' ').match(/-?[\d.]+px/g)?.map(parseFloat) ?? [];
        const [dx = 0, dy = 0, desfoque = 0, espalha = 0] = n;
        a = Math.max(a, Math.max(Math.abs(dx), Math.abs(dy)) + sigmas * desfoque + Math.max(0, espalha));
      }
    };
    if (s.boxShadow !== 'none') sombras(s.boxShadow.split(/,(?![^(]*\))/), 1.5);
    if (s.outlineStyle !== 'none' && s.outlineWidth !== '0px') a = Math.max(a, parseFloat(s.outlineWidth) + Math.max(0, parseFloat(s.outlineOffset) || 0));
    // Filtro só de drop-shadow numa imagem ou num SVG que recorta o próprio conteúdo (o que ele pinta fica na caixa dele):
    // o alcance de cada sombra, contando o desfoque como 1 sigma (o equivalente SVG da especificação, stdDeviation = o
    // desfoque; do lado seguro se o Chromium usar 2 sigmas, como na box-shadow). Num contêiner, a sombra é a dos filhos,
    // que podem transbordar a caixa: não é calculado. Outro filtro (desfoque) e sombra do texto também não: valem como
    // se cobrissem tudo em volta.
    const gotas = s.filter === 'none' ? [] : s.filter.match(/drop-shadow\((?:[^()]|\([^()]*\))*\)/g) ?? [];
    const fechado = e && (e.localName === 'img' || (e.localName === 'svg' && s.overflowX !== 'visible' && s.overflowY !== 'visible'));
    if (s.filter !== 'none' && fechado && gotas.join(' ') === s.filter.trim()) sombras(gotas.map((g) => g.slice(12, -1)), 3);
    else if (s.filter !== 'none') a = Math.max(a, 256);
    if ((s.textShadow ?? 'none') !== 'none') a = Math.max(a, 256);
    return a ? a + 2 : 0;
  };
  // A opacidade do fundo do elemento: o alfa da cor de fundo (sem imagem, filtro nem mistura), com ele e os
  // ancestrais sem opacidade (senão 0: o fundo pré-multiplicado não seria o que a página diz).
  const opacidadeDoFundo = (e, s) => {
    if (s.backgroundImage !== 'none' || s.filter !== 'none' || s.mixBlendMode !== 'normal') return 0;
    for (let x = e; x; x = x.parentElement) if (getComputedStyle(x).opacity !== '1') return 0;
    return cor(s.backgroundColor)?.a ?? 0;
  };
  // O retângulo r (com cantos de raio re) cobre o quadrado q inteiro, fora dos cantos arredondados dele.
  const cobre = (r, re, q) => {
    const k = Number.isFinite(re) ? re : 0;
    const dentro2 = (x0, y0, x1, y1) => q[0] >= x0 && q[1] >= y0 && q[2] <= x1 && q[3] <= y1;
    return Number.isFinite(re) && (dentro2(r.left + k, r.top, r.right - k, r.bottom) || dentro2(r.left, r.top + k, r.right, r.bottom - k));
  };
  // O raio único (círculo, os quatro cantos iguais) de um elemento, ou null.
  const raioUnico = (s) => {
    const r = ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].map((c) => s[`border${c}Radius`].split(' '));
    const v = r[0][0];
    return /^[\d.]+px$/.test(v) && r.every((x) => x.every((y) => y === v)) ? parseFloat(v) : null;
  };
  // Pseudo-elemento posicionado: pode pintar fora da caixa do elemento.
  const pseudoSolto = (e) => ['::before', '::after'].some((p) => {
    const s = getComputedStyle(e, p);
    return !['none', 'normal'].includes(s.content) && (s.position === 'absolute' || s.position === 'fixed');
  });

  let L = 0, A = 0, estilo = null, fundoRaiz = null, ligado = false, motivo = null, raizAntes = '';
  // O que a página escreve na raiz (style inline e classes); se mudar no render, o fundo tirado deixa de valer.
  const retratoDaRaiz = () => [document.documentElement, document.body].map((e) => e ? e.getAttribute('style') + '|' + e.className : '').join('||');
  const marcados = new Set();

  /**
   * Antes do render: tira o fundo da raiz (vira o fundo da montagem). Devolve { ligado, fundo, motivo }; desligado, a
   * página fica como está e todos os quadros vão pelo caminho do canvas.
   */
  function preparar(largura, altura) {
    L = largura; A = altura;
    const html = document.documentElement, body = document.body;
    const sh = getComputedStyle(html), sb = body ? getComputedStyle(body) : null;
    // O fundo da raiz é o do html; sem ele, o do body vai para a raiz (propagação do CSS).
    const raiz = !transparente(sh) ? sh : sb && !transparente(sb) ? sb : null;
    if (raiz && !solido(raiz)) { motivo = 'fundo da raiz com imagem ou semitransparente'; return { ligado: false, fundo: null, motivo }; }
    fundoRaiz = raiz ? rgb(raiz) : null;
    // Fundo no html e no body: o do body só pinta a caixa dele; cobrindo o quadro inteiro, é ele que aparece.
    if (raiz === sh && sb && !transparente(sb)) {
      const b = body.getBoundingClientRect();
      if (!solido(sb) || !semRaio(sb) || b.left > 0 || b.top > 0 || b.right < L || b.bottom < A) {
        motivo = 'fundo no html e outro no body, que não cobre o quadro'; return { ligado: false, fundo: null, motivo };
      }
      fundoRaiz = rgb(sb);
    }
    if (animado(html) || (body && animado(body))) { motivo = 'animação no html ou no body (o fundo pode mudar)'; return { ligado: false, fundo: null, motivo }; }
    estilo = document.createElement('style');
    estilo.textContent = `html, body { background: transparent !important; } .${CLASSE} { background: transparent !important; }`;
    (document.head ?? html).append(estilo);
    raizAntes = retratoDaRaiz();
    ligado = true;
    return { ligado, fundo: fundoRaiz, motivo: null };
  }

  /**
   * A cada quadro, antes de medir: se a página mexeu na raiz (style, classe ou animação no html ou no body), o fundo
   * tirado no começo deixa de valer; o take sai de vez e o resto do render vai pelo canvas, com a raiz de volta.
   */
  function conferirRaiz() {
    if (!ligado) return;
    const html = document.documentElement, body = document.body;
    if (retratoDaRaiz() === raizAntes && !animado(html) && !(body && animado(body))) return;
    ligado = false; motivo = 'a página mudou o html ou o body no meio do render'; fundoRaiz = null;
    estilo?.remove();
    aplicar([]);
  }

  /** O elemento `e` (depois do canvas na ordem do documento) é pintado acima dele: posicionado até o ancestral comum. */
  function acima(e, ancestrais) {
    for (let x = e; x && !ancestrais.has(x); x = x.parentElement) {
      const s = getComputedStyle(x);
      if (s.position !== 'static') return s.zIndex === 'auto' || Number(s.zIndex) >= 0;
    }
    return false;
  }

  /**
   * Geometria do vídeo no quadro atual: { x, y, sx, sy, recorte, fundo, marcar } (o texel u cai em x + sx·u) ou
   * { motivo } se o quadro vai pelo canvas. `vazios`: os canvas de outros vídeos, transparentes neste quadro (fora do
   * trecho deles). Não muda a página (o `aplicar` muda).
   */
  function medir(canvas, largura, altura, vazios = new Set()) {
    if (!ligado) return { motivo };
    // Mede a página como ela é: sem as marcas do quadro anterior (o `aplicar` põe de volta as deste, antes do paint).
    for (const e of marcados) e.classList.remove(CLASSE);
    marcados.clear();
    const ancestrais = new Set();
    const cadeia = [];
    const sc = getComputedStyle(canvas);
    if (sc.position === 'static' || sc.zIndex !== 'auto') return { motivo: 'vídeo sem posição ou com z-index (a ordem de pintura não é a do documento)' };
    if (!semRaio(sc) || !efeitoSimples(sc, true)) return { motivo: 'efeito no vídeo' };
    let ancestralTransformado = false;
    let arredondamento = null, cartao = null;
    const recortam = new Set();
    if ((sc.zoom ?? '1') !== '1') return { motivo: 'zoom do CSS no vídeo' };
    for (let e = canvas.parentElement; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (!transformado(s)) { if ((s.zoom ?? '1') !== '1') return { motivo: 'zoom do CSS num ancestral' }; continue; }
      ancestralTransformado = true;
      // Só a translação num ancestral é reproduzida (a regra antiga, retângulo no pixel); o resto escala ou gira o vídeo.
      if ((s.scale ?? 'none') !== 'none' || (s.rotate ?? 'none') !== 'none' || (s.zoom ?? '1') !== '1'
        || !(s.transform === 'none' || /^matrix\(1, 0, 0, 1, [-0-9.e]+, [-0-9.e]+\)$/.test(s.transform))) return { motivo: 'escala, rotação ou zoom num ancestral do vídeo' };
    }
    const g = geometria(canvas, sc, largura, altura, ancestralTransformado);
    if (g.motivo !== undefined) return g;
    const q = g.quad;
    let recorte = [Math.max(0, q[0]), Math.max(0, q[1]), Math.min(L, q[2]), Math.min(A, q[3])];
    for (let e = canvas.parentElement; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      ancestrais.add(e);
      const s = getComputedStyle(e);
      if (!efeitoSimples(s)) return { motivo: 'efeito num ancestral (opacidade, filtro, transformação)' };
      // Com z-index, o ancestral é um contexto de empilhamento: o que vem depois dele pode ficar por baixo.
      if (s.zIndex !== 'auto') return { motivo: 'z-index num ancestral do vídeo' };
      // ::before, ::after e texto solto do ancestral são pintados antes do vídeo e não aparecem na varredura.
      if (comPseudo(e) || comTexto(e)) return { motivo: 'pseudo-elemento ou texto num ancestral do vídeo' };
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        recortam.add(e);
        const b = e.getBoundingClientRect();
        const x0 = b.left + e.clientLeft, y0 = b.top + e.clientTop;
        recorte = [Math.max(recorte[0], x0), Math.max(recorte[1], y0), Math.min(recorte[2], x0 + e.clientWidth), Math.min(recorte[3], y0 + e.clientHeight)];
        if (!semRaio(s)) {
          // Um recorte arredondado só (o cartão): sem linha de borda (o recorte seria a caixa de dentro, com outro
          // raio), sem fundo próprio (pintado com o canto suavizado por baixo do vídeo), cantos iguais e no pixel.
          const r = raioUnico(s);
          const caixa = [b.left, b.top, b.right, b.bottom];
          if (arredondamento) return { motivo: 'recorte arredondado dentro de outro' };
          if (r === null) return { motivo: 'recorte arredondado com cantos diferentes ou elípticos' };
          if (!semLinhaDeBorda(s) || !transparente(s)) return { motivo: 'recorte arredondado com borda ou fundo' };
          if (!caixa.every(Number.isInteger)) return { motivo: 'recorte arredondado fora do pixel' };
          // O CSS reduz os raios que não cabem; aqui, raio maior que a metade vai pelo canvas.
          if (2 * r > b.width || 2 * r > b.height) return { motivo: 'recorte arredondado com raio maior que a metade' };
          arredondamento = [...caixa, r];
          cartao = e;
        }
      }
      cadeia.unshift([e, s]);
    }
    for (const e of [document.body, document.documentElement]) {
      if (!e) continue;
      if (comPseudo(e) || comTexto(e)) return { motivo: 'pseudo-elemento ou texto no body ou no html' };
      ancestrais.add(e);
    }
    if (recorte[2] <= recorte[0] || recorte[3] <= recorte[1]) return { x: g.tx, y: g.ty, sx: g.sx, sy: g.sy, recorte: null, fundo: fundoRaiz, marcar: [], arredondado: null };
    // Borda do vídeo visível fora do pixel: o Chromium a desenha com antisserrilhado, que o núcleo não faz.
    if (!recorte.every(Number.isInteger)) return { motivo: recorte.some((v, i) => v === q[i]) ? 'borda do vídeo visível fora do pixel' : 'recorte fora do pixel' };
    // O que os ancestrais pintam por baixo do vídeo.
    let fundo = fundoRaiz, palco = null;
    const marcar = [];
    for (const [e, s] of cadeia) {
      if (transparente(s) && semBorda(s)) continue;
      // Sombra (de fora) e contorno de um ancestral que recorta o vídeo: pintam fora da caixa dele, por baixo do vídeo
      // (no canto arredondado, a faixa do canto já põe a página por baixo do vídeo).
      if (!semBorda(s)) {
        // Só no cartão arredondado (o medido na seção 8.2): o contorno de fora (afastamento ≥ 0; o de dentro é pintado
        // por cima do vídeo) e a sombra de fora.
        if (e === cartao && transparente(s) && semLinhaDeBorda(s) && !/inset/.test(s.boxShadow)
          && (s.outlineStyle === 'none' || (parseFloat(s.outlineOffset) || 0) >= 0)) continue;
        return { motivo: 'borda ou sombra num ancestral' };
      }
      const b = e.getBoundingClientRect();
      if (solido(s) && semRaio(s) && b.left <= 0 && b.top <= 0 && b.right >= L && b.bottom >= A) { fundo = rgb(s); palco = e; marcar.push(e); }
      else if (dentro(b, recorte)) marcar.push(e);
      else return { motivo: 'fundo de ancestral por baixo do vídeo' };
    }
    // Nada antes do vídeo (fora os ancestrais) pintado no recorte; nada depois dele, no recorte, pintado por baixo. Com o
    // palco tirado, nada antes dele pintado no quadro inteiro (apareceria pelo fundo dele).
    const quadro = [0, 0, L, A];
    let depois = false;
    // Os quadrados dos cantos arredondados (com 1 px de folga): nada posicionado depois do vídeo pode cruzar a faixa do
    // canto dentro deles (`naFaixa`; fora da faixa, o núcleo faz a mistura de sempre).
    const cantos = [], sobreCantos = [];
    if (arredondamento) {
      const [x0, y0, x1, y1, r] = arredondamento, R = Math.ceil(r) + 1;
      for (const [a, b] of [[x0, y0], [x1 - R, y0], [x0, y1 - R], [x1 - R, y1 - R]]) cantos.push([a, b, a + R, b + R]);
    }
    // A caixa c cruza a faixa do canto i (0 < cobertura < 1: os pixels a uma distância entre raio − 0,5 e raio + 0,5 do
    // centro do círculo do canto, do lado de fora do centro)? Com 1 px de folga (o pixel que a caixa cobre em parte).
    // Na faixa, o núcleo põe a página por baixo do vídeo; dentro dela (cobertura 1) e fora do cartão (0), a mistura de
    // sempre, certa com qualquer coisa por cima.
    const naFaixa = (c, i) => {
      const [x0, y0, x1, y1, r] = arredondamento;
      const cx = i & 1 ? x1 - r : x0 + r, cy = i & 2 ? y1 - r : y0 + r;
      // O quadrante do canto, de fora do centro até 1 px além da caixa do cartão.
      const q = [i & 1 ? cx : x0 - 1, i & 2 ? cy : y0 - 1, i & 1 ? x1 + 1 : cx, i & 2 ? y1 + 1 : cy];
      const l = Math.max(c.left - 1, q[0]), t = Math.max(c.top - 1, q[1]), d = Math.min(c.right + 1, q[2]), b = Math.min(c.bottom + 1, q[3]);
      if (!(l < d && t < b)) return false;
      const perto = Math.hypot(Math.max(l - cx, 0, cx - d), Math.max(t - cy, 0, cy - b));
      const longe = Math.hypot(Math.max(Math.abs(l - cx), Math.abs(d - cx)), Math.max(Math.abs(t - cy), Math.abs(b - cy)));
      return perto < r + 0.5 && longe > r - 0.5;
    };
    const percorrer = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ELEMENT);
    for (let e = percorrer.nextNode(); e; e = percorrer.nextNode()) {
      if (e === canvas) { depois = true; continue; }
      if (ancestrais.has(e) || e.localName === 'script' || e.localName === 'style') continue;
      if (vazios.has(e)) { const s = getComputedStyle(e); if (transparente(s) && semBorda(s) && !comPseudo(e)) continue; }
      const s = getComputedStyle(e);
      const b = !depois && pseudoSolto(e) ? { left: 0, top: 0, right: L, bottom: A, width: L, height: A } : caixaPintada(e, s);
      if (!depois) {
        if (palco && !palco.contains(e) && cruza(b, quadro) && visivel(e)) return { motivo: 'algo pintado antes do palco' };
        if (cruza(b, recorte) && visivel(e)) return { motivo: 'algo pintado antes do vídeo, por baixo dele' };
      } else if (cruza(b, recorte) && visivel(e) && !acima(e, ancestrais)) return { motivo: 'algo depois do vídeo pintado por baixo dele (sem posição)' };
      // Só conta o que o elemento pinta: um contêiner sem fundo, borda, sombra, texto nem pseudo-elemento (a camada
      // dos gráficos em tela cheia, por exemplo) não cobre o canto; os filhos dele são vistos um a um.
      else if (cantos.length && visivel(e) && !(transparente(s) && semBorda(s) && !comPseudo(e) && !comTexto(e) && !SUBSTITUIDOS.has(e.localName)
        && s.filter === 'none' && (s.backdropFilter ?? 'none') === 'none')) {
        const r = e.getBoundingClientRect(), f = alcance(s, e);
        const c = { left: r.left - f, top: r.top - f, right: r.right + f, bottom: r.bottom + f, width: r.width + 2 * f, height: r.height + 2 * f };
        if (cantos.some((q, i) => cruza(c, q) && naFaixa(c, i))) sobreCantos.push({ e, s, r, c });
      }
    }
    // Algo por cima de um canto: só se o fundo de um elemento quase opaco (90 % ou mais, sem sombra) cobre o canto
    // inteiro (a legenda passando por cima do cartão). Nesse canto (bit em `arredondado[5]`), o núcleo separa o fundo
    // dele (`arredondado[6]`) do que fica por baixo e faz a conta exata; no pixel que não é esse fundo sobre algo (o
    // texto), põe a página toda por cima do vídeo coberto (até 3 níveis; registro do S08, seção 8.6). O resto vai pelo
    // canvas.
    let mascara = 0, cobertor = 0;
    const cobertores = new Set();
    for (const { e, s, r, c } of sobreCantos) {
      if (c.left !== r.left || comPseudo(e) || opacidadeDoFundo(e, s) < 0.9) continue;
      const re = raioUnico(s) ?? Infinity;
      const k = cor(s.backgroundColor);
      // O fundo dele pré-multiplicado em 8 bits, como o Chromium o rasteriza (0xAARRGGBB).
      const a = Math.round(k.a * 255), p = (v) => Math.round((v * a) / 255);
      const este = ((a << 24) | (p(k.r) << 16) | (p(k.g) << 8) | p(k.b)) >>> 0;
      // O texto dele por cima do canto também vai pela placa: o pixel de letra na faixa do canto não se separa do fundo
      // e pode sair até 3 níveis longe do canvas (em até 2 pixels por quadro, medido), a exceção do R03 aceita pelo
      // responsável em 2026-11-01 (domain.md, R03; registro do S08, seção 8.6).
      cantos.forEach((q, i) => {
        if (!cobre(r, re, q)) return;
        if (cobertor && cobertor !== este) return; // outro fundo já cobre um canto: este não vale (vai pelo canvas)
        cobertor = este; mascara |= 1 << i; cobertores.add(e);
      });
    }
    // No canto coberto, só o próprio cobertor pode estar por cima, com o texto dele (filhos sem fundo, borda, sombra,
    // filtro nem pseudo-elemento): outro elemento ali ficaria por baixo do vídeo na conta.
    const doCobertor = (e, s, r, c) => cobertores.has(e) || ([...cobertores].some((x) => x.contains(e))
      && transparente(s) && semBorda(s) && !comPseudo(e) && c.left === r.left);
    for (const { e, s, r, c } of sobreCantos) {
      if (cantos.some((q, i) => cruza(c, q) && naFaixa(c, i) && !(mascara & (1 << i) && doCobertor(e, s, r, c)))) return { motivo: 'algo por cima do canto arredondado' };
    }
    const arredondado = arredondamento && mascara ? [...arredondamento, mascara, cobertor] : arredondamento;
    return { x: g.tx, y: g.ty, sx: g.sx, sy: g.sy, recorte, fundo, marcar, arredondado };
  }

  const px = (v) => parseFloat(v);
  // As medidas do layout são múltiplos de 1/64 de pixel (LayoutUnit); o que sai de conta em float volta a eles.
  const q64 = (v) => Math.round(v * 64) / 64;

  /**
   * Onde o vídeo é desenhado: o texel u (bordas em 0..largura) cai em `t + s·u` no quadro, como o Chromium desenha o
   * canvas (medido contra o caminho do canvas, registro do S08, seção 7). Devolve { sx, sy, tx, ty, quad } (quad: o
   * retângulo desenhado, [x0, y0, x1, y1]) ou { motivo }.
   * - Sem transformação: o retângulo do conteúdo arredondado ao pixel (x0 = arred(esquerda), x1 = arred(direita)).
   * - Com `transform` de escala e translação (a, 0, 0, d, e, f), ou outra coisa que dê nó de transformação: a origem
   *   da caixa arredondada ao pixel, o tamanho arredondado e a transformação em volta do `transform-origin`.
   * Bilinear nos dois casos; o mesmo texel por pixel quando s = 1 e t inteiro.
   */
  function geometria(canvas, sc, largura, altura, ancestralTransformado) {
    if (['Top', 'Right', 'Bottom', 'Left'].some((l) => px(sc[`padding${l}`]) !== 0 || px(sc[`border${l}Width`]) !== 0)) return { motivo: 'borda ou espaçamento no vídeo' };
    const r = canvas.getBoundingClientRect();
    const w = px(sc.width), h = px(sc.height);
    const proprio = transformado(sc);
    let m = null;
    if (proprio) {
      if ((sc.translate ?? 'none') !== 'none' || (sc.scale ?? 'none') !== 'none' || (sc.rotate ?? 'none') !== 'none') return { motivo: 'translate, scale ou rotate soltos no vídeo' };
      if (sc.transform === 'none') m = { a: 1, d: 1, e: 0, f: 0 };
      else {
        const t = /^matrix\(([^)]+)\)$/.exec(sc.transform);
        const v = t ? t[1].split(',').map(Number) : [];
        if (v.length !== 6 || v[1] !== 0 || v[2] !== 0 || !(v[0] > 0) || !(v[3] > 0)) return { motivo: 'transformação no vídeo que não é escala e translação' };
        m = { a: v[0], d: v[3], e: v[4], f: v[5] };
      }
    }
    const escalado = w !== largura || h !== altura || (m !== null && (m.a !== 1 || m.d !== 1));
    // Sem escala, a regra antiga: o retângulo medido já no pixel e do tamanho do vídeo (vale com ancestral transladado).
    // Com translação ou will-change no próprio vídeo, só ela (o arredondamento do Chromium não foi medido nesse caso).
    if (!escalado) {
      const direto = Number.isInteger(r.left) && Number.isInteger(r.top) && r.width === largura && r.height === altura;
      if (direto) return { sx: 1, sy: 1, tx: r.left, ty: r.top, quad: [r.left, r.top, r.right, r.bottom] };
      if (ancestralTransformado || proprio) return { motivo: 'posição fora do pixel' };
    }
    if (ancestralTransformado) return { motivo: 'vídeo escalado ou fora do pixel com transformação num ancestral' };
    if (escalado && sc.objectFit !== 'fill') return { motivo: 'object-fit no vídeo escalado' };
    if (escalado && sc.imageRendering !== 'auto') return { motivo: 'image-rendering no vídeo escalado' };
    const pronta = (g) => (g.sx < 0.5 || g.sy < 0.5 ? { motivo: 'vídeo reduzido abaixo da metade' } : g);
    if (!m) {
      const x0 = Math.round(q64(r.left)), x1 = Math.round(q64(r.right)), y0 = Math.round(q64(r.top)), y1 = Math.round(q64(r.bottom));
      if (x1 <= x0 || y1 <= y0) return { motivo: 'vídeo sem tamanho' };
      return pronta({ sx: (x1 - x0) / largura, sy: (y1 - y0) / altura, tx: x0, ty: y0, quad: [x0, y0, x1, y1] });
    }
    const [ox, oy] = sc.transformOrigin.split(' ').map(px);
    // A borda esquerda transformada é P + o + a·(0 − o) + e: dela sai a origem P da caixa, que o Chromium arredonda.
    const p0 = Math.round(q64(r.left - ox - m.e + m.a * ox)), p1 = Math.round(q64(r.top - oy - m.f + m.d * oy));
    const wl = Math.round(q64(w)), hl = Math.round(q64(h));
    if (wl <= 0 || hl <= 0) return { motivo: 'vídeo sem tamanho' };
    const tx = p0 + ox * (1 - m.a) + m.e, ty = p1 + oy * (1 - m.d) + m.f;
    return pronta({ sx: (m.a * wl) / largura, sy: (m.d * hl) / altura, tx, ty, quad: [tx, ty, tx + m.a * wl, ty + m.d * hl] });
  }

  /** Marca os ancestrais tirados neste quadro e desmarca os do anterior (se o `medir` não rodou neste quadro). */
  function aplicar(marcar) {
    const agora = new Set(marcar);
    for (const e of marcados) if (!agora.has(e)) { e.classList.remove(CLASSE); marcados.delete(e); }
    for (const e of agora) if (!marcados.has(e)) { e.classList.add(CLASSE); marcados.add(e); }
  }

  const motorTake = { preparar, conferirRaiz, medir, aplicar, get ligado() { return ligado; }, get fundo() { return fundoRaiz; } };
  globalThis.motorTake = motorTake;
})();
