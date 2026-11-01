// Script de página da conferência (S04), injetado pelo coletar.ts na composição. Só lê o DOM no quadro em que a
// página está (motor_geometria); a folha do quadro limpo (motor_limpar) e as marcas da foto do relatório
// (motor_marcas) existem só nesta passada de conferência, nunca no render.
// Papéis (G41): data-papel="apresentador" (o <img>, <video> ou <canvas> do take), "legenda" e "faixa".
// Formato do resultado em docs/formatos/conferencia.md; as regras estão em regras.ts.
(() => {
  const OPACIDADE_MIN = window.motor_conf?.opacidadeMin ?? 0.05;
  const IGNORAR = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'HEAD']);
  const caixa = (r) => [r.x, r.y, r.width, r.height];
  const cortar = (a, b) => {
    const x = Math.max(a[0], b[0]), y = Math.max(a[1], b[1]);
    const w = Math.min(a[0] + a[2], b[0] + b[2]) - x, h = Math.min(a[1] + a[3], b[1] + b[3]) - y;
    return w > 0 && h > 0 ? [x, y, w, h] : null;
  };

  // O <video> da linha do tempo só pinta no trecho dele (data-inicio, data-quadros; docs/formatos/linha-do-tempo.md):
  // fora dele, o canvas do motor fica transparente e não há apresentador na tela.
  const QPS = window.motor_conf?.qps ?? 30;
  const foraDoTrecho = (el, n) => {
    if (el.localName !== 'video' || n === undefined) return false;
    const inicio = Number(el.getAttribute('data-inicio') ?? 0), recorte = Number(el.getAttribute('data-recorte') ?? 0);
    const vel = Number(el.getAttribute('data-velocidade') || 1);
    // Sem data-quadros: (duração × qps − recorte) / velocidade, como o quadrosDaMidia do render (C02).
    const quadros = el.hasAttribute('data-quadros') ? Number(el.getAttribute('data-quadros'))
      : Number.isFinite(el.duration) ? Math.ceil((el.duration * QPS - recorte) / vel - 0.0001) : Infinity;
    return n < inicio || n >= inicio + quadros;
  };
  window.motor_foraDoTrecho = foraDoTrecho;

  window.motor_geometria = (n) => {
    const tela = [0, 0, document.documentElement.clientWidth, document.documentElement.clientHeight];
    const estilos = new Map();
    const estilo = (e) => { let s = estilos.get(e); if (!s) { s = getComputedStyle(e); estilos.set(e, s); } return s; };
    const opacidades = new Map();
    // Opacidade efetiva: o produto do opacity dos ancestrais; display: none em qualquer um zera.
    const opacidade = (e) => {
      if (!e || e.nodeType !== 1) return 1;
      if (opacidades.has(e)) return opacidades.get(e);
      const s = estilo(e);
      const o = s.display === 'none' ? 0 : Number(s.opacity) * opacidade(e.parentElement);
      opacidades.set(e, o);
      return o;
    };
    const visivel = (e) => estilo(e).visibility !== 'hidden' && estilo(e).visibility !== 'collapse' && opacidade(e) >= OPACIDADE_MIN;
    // Recorte pelos ancestrais que cortam (overflow diferente de visible) e pelo quadro.
    const recortar = (c, e) => {
      let r = cortar(c, tela);
      for (let a = e; a && r; a = a.parentElement) {
        const s = estilo(a);
        if (a !== e && (s.overflowX !== 'visible' || s.overflowY !== 'visible')) r = cortar(r, caixa(a.getBoundingClientRect()));
      }
      return r;
    };
    // Fundo, borda ou sombra que o texto pinta junto (chip, faixa com fundo): até o elemento com papel, ou 3 níveis.
    const pinta = (e) => {
      const s = estilo(e);
      const fundo = s.backgroundColor && !/rgba\(.*,\s*0\)$|transparent/.test(s.backgroundColor);
      const borda = ['Top', 'Right', 'Bottom', 'Left'].some((l) => parseFloat(s[`border${l}Width`]) > 0 && s[`border${l}Style`] !== 'none');
      return fundo || s.backgroundImage !== 'none' || borda || s.boxShadow !== 'none';
    };
    // O fundo de cena (mais de um quarto do quadro) não é chip: fica a caixa das linhas do texto.
    const fundoDe = (e) => {
      for (let a = e, i = 0; a && a !== document.body && i < 3; a = a.parentElement, i++) {
        const r = a.getBoundingClientRect();
        if (pinta(a) && r.width * r.height <= 0.25 * tela[2] * tela[3]) return a;
        if (a.hasAttribute('data-papel')) break;
      }
      return null;
    };

    const apEl = [...document.querySelectorAll('[data-papel="apresentador"]')].find((e) => visivel(e) && !foraDoTrecho(e, n) && e.getBoundingClientRect().width > 0) ?? null;
    const apresentador = apEl ? caixa(apEl.getBoundingClientRect()) : null;
    // O take: a mídia do elemento (data-midia do motor, ou src) e o início dele. Troca de take é corte, não zoom.
    const take = apEl ? `${apEl.getAttribute('data-midia') ?? apEl.getAttribute('src') ?? ''}@${apEl.getAttribute('data-inicio') ?? ''}` : null;

    const porElemento = new Map();
    const andar = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode: (no) => {
        if (!no.data.trim()) return NodeFilter.FILTER_REJECT;
        for (let a = no.parentElement; a; a = a.parentElement) {
          if (IGNORAR.has(a.tagName)) return NodeFilter.FILTER_REJECT;
          if (a.getAttribute('data-papel') === 'apresentador') return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const faixa = document.createRange();
    for (let no = andar.nextNode(); no; no = andar.nextNode()) {
      const e = no.parentElement;
      if (!visivel(e)) continue;
      faixa.selectNodeContents(no);
      const linhas = [...faixa.getClientRects()].map(caixa).filter((c) => c[2] > 0 && c[3] > 0);
      if (!linhas.length) continue;
      const papelEl = e.closest('[data-papel]');
      const fundo = fundoDe(e);
      // Um item por elemento que pinta o fundo (ou pelo elemento do texto): o chip inteiro é a caixa.
      const dono = fundo ?? e;
      let item = porElemento.get(dono);
      if (!item) {
        item = { texto: '', papel: papelEl?.getAttribute('data-papel') ?? null, caixas: [], el: dono, cruas: [], opacidade: 0 };
        porElemento.set(dono, item);
        if (fundo) { const c = recortar(caixa(fundo.getBoundingClientRect()), fundo); if (c) item.caixas.push(c); }
      }
      item.texto = (item.texto + ' ' + no.data.trim()).trim();
      item.opacidade = Math.max(item.opacidade, opacidade(e));
      if (!fundo) for (const l of linhas) { const c = recortar(l, e); if (c) item.caixas.push(c); }
    }
    const textos = [...porElemento.values()].filter((t) => t.caixas.length).map(({ texto, papel, caixas, opacidade: o }) => ({ texto, papel, caixas, opacidade: Math.round(o * 1000) / 1000 }));

    // Legendas: as caixas de linha cruas (sem recorte), para contar linhas e ver se saem do quadro, e o estouro da caixa.
    const legendas = [];
    for (const el of document.querySelectorAll('[data-papel="legenda"]')) {
      if (!visivel(el)) continue;
      const caixas = [];
      const nos = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let no = nos.nextNode(); no; no = nos.nextNode()) {
        if (!no.data.trim() || !visivel(no.parentElement)) continue;
        faixa.selectNodeContents(no);
        for (const r of faixa.getClientRects()) if (r.width > 0 && r.height > 0) caixas.push(caixa(r));
      }
      if (!caixas.length) continue;
      let estouro = false;
      for (const a of [el, ...el.querySelectorAll('*')]) {
        const s = estilo(a);
        if ((s.overflowX !== 'visible' || s.textOverflow === 'ellipsis') && a.scrollWidth > a.clientWidth + 1) estouro = true;
      }
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const s = estilo(a);
        if (s.overflowX !== 'visible' && a.scrollWidth > a.clientWidth + 1) {
          const r = a.getBoundingClientRect();
          if (caixas.some((c) => c[0] < r.x - 0.5 || c[0] + c[2] > r.x + r.width + 0.5)) estouro = true;
        }
      }
      legendas.push({ texto: el.textContent.trim().replace(/\s+/g, ' '), caixas, estouro });
    }

    const faixas = [];
    [...document.querySelectorAll('[data-papel="faixa"]')].forEach((el, i) => {
      if (!visivel(el)) return;
      const c = caixa(el.getBoundingClientRect());
      if (!cortar(c, tela)) return;
      const texto = el.textContent.trim().replace(/\s+/g, ' ');
      faixas.push({ chave: `${i}\u0000${texto}`, texto, opacidade: Math.round(opacidade(el) * 1000) / 1000, caixa: c.map((v) => Math.round(v * 10) / 10) });
    });

    // Texto fora do DOM: <canvas> e <img> visíveis sobre o apresentador (fora dele) não são conferidos.
    const naoConferidos = [];
    if (apresentador) {
      for (const el of document.querySelectorAll('canvas, img, svg image, video')) {
        if (el === apEl || apEl.contains(el) || el.contains(apEl) || !visivel(el)) continue;
        const c = recortar(caixa(el.getBoundingClientRect()), el);
        const sobre = c && cortar(c, apresentador);
        if (sobre && sobre[2] * sobre[3] >= 0.01 * tela[2] * tela[3]) naoConferidos.push({ tipo: el.localName, caixa: c });
      }
    }
    return { apresentador, take, textos, legendas, faixas, naoConferidos };
  };

  // Quadro limpo: só o apresentador pinta (visibility não muda o layout). O rosto é procurado nele, sem o texto por
  // cima (texto sobre a boca derrubaria o detector e a pior quebra viraria «sem rosto»).
  window.motor_limpar = (ligar) => {
    let s = document.getElementById('motor-limpo');
    if (!ligar) { s?.remove(); return true; }
    if (!s) {
      s = document.createElement('style');
      s.id = 'motor-limpo';
      s.textContent = 'html, body { background: #000 !important; } body * { visibility: hidden !important; }'
        + ' [data-papel="apresentador"], [data-papel="apresentador"] * { visibility: visible !important; }'
        + ' [data-motor-fora] { visibility: hidden !important; }';
      document.head.append(s);
    }
    return true;
  };

  // G20 (contraste sobre o fundo real): os textos legíveis do quadro com a cor de preenchimento, o tamanho, o peso e as
  // caixas de linha (recortadas pelo quadro e pelos ancestrais que cortam, como na geometria); o texto do apresentador,
  // o SVG e o de preenchimento transparente (degradê recortado no texto: a cor não é uma só) ficam de fora. A cor vem
  // em rgba() sempre: passa por um canvas de 1 px (color-mix, oklch e color() saem do getComputedStyle em outro formato).
  const tinta = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const emRgba = (c) => {
    tinta.clearRect(0, 0, 1, 1); tinta.fillStyle = '#000'; tinta.fillStyle = c; tinta.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = tinta.getImageData(0, 0, 1, 1).data;
    return a ? `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})` : null;
  };
  // Coberto: em algum ponto da linha do texto, um elemento pintado por cima dele (fundo com alfa ≥ 0,1, imagem de
  // fundo que não é da tela inteira, mídia ou filtro de fundo), em parte ou semitransparente: o texto atrás de um modal,
  // da caixa da legenda ou de uma camada escura não é para ser lido. A ordem de pintura vem do elementsFromPoint, com o
  // pointer-events ligado em tudo enquanto se pergunta (o que tem pointer-events: none também cobre).
  const transparente = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return true; const v = m[1].split(/[\s,/]+/).filter(Boolean); return v.length > 3 && Number(v[3]) < 0.1; };
  const cobre = (x, tela) => {
    const s = getComputedStyle(x);
    if (s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false;
    if (x.matches('img, video, canvas') || s.backdropFilter !== 'none' || !transparente(s.backgroundColor)) return true;
    if (s.backgroundImage === 'none') return false;
    const r = x.getBoundingClientRect();
    return r.width * r.height < 0.9 * tela[2] * tela[3];
  };
  const coberto = (e, linhas, tela) => {
    for (const [x, y, w, h] of linhas) for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const g of [0.25, 0.5, 0.75]) {
      const px = x + w * f, py = y + h * g;
      if (px < 0 || py < 0 || px >= tela[2] || py >= tela[3]) continue;
      for (const el of document.elementsFromPoint(px, py)) {
        if (el === e || e.contains(el) || el.contains(e)) break;
        if (cobre(el, tela)) return true;
      }
    }
    return false;
  };
  window.motor_textosComCor = (n, minimo) => {
    const tela = [0, 0, document.documentElement.clientWidth, document.documentElement.clientHeight];
    const ponteiro = document.createElement('style');
    ponteiro.textContent = '* { pointer-events: auto !important; }';
    document.head.append(ponteiro);
    try {
    const recortar = (c, e) => {
      let r = cortar(c, tela);
      for (let a = e; a && r; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (a !== e && (s.overflowX !== 'visible' || s.overflowY !== 'visible')) r = cortar(r, caixa(a.getBoundingClientRect()));
      }
      return r;
    };
    const op = (e) => { let o = 1; for (let a = e; a; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === 'none') return 0; o *= Number(s.opacity); } return o; };
    const porEl = new Map(), cobertos = new Set(), faixa = document.createRange();
    const andar = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
    for (let no = andar.nextNode(); no; no = andar.nextNode()) {
      const e = no.parentElement;
      if (!no.data.trim() || !e || e instanceof SVGElement || e.closest('[data-papel="apresentador"]')) continue;
      if ([...IGNORAR].some((t) => e.closest(t.toLowerCase()))) continue;
      const s = getComputedStyle(e);
      if (s.visibility === 'hidden' || s.visibility === 'collapse' || foraDoTrecho(e, n) || op(e) < minimo) continue;
      faixa.selectNodeContents(no);
      const caixas = [...faixa.getClientRects()].map(caixa).map((c) => recortar(c, e)).filter(Boolean);
      if (!caixas.length || cobertos.has(e)) continue;
      if (coberto(e, caixas, tela)) { cobertos.add(e); porEl.delete(e); continue; }
      let t = porEl.get(e);
      if (!t) {
        const cor = emRgba(s.webkitTextFillColor || s.color);
        if (!cor) continue;
        t = { texto: '', papel: e.closest('[data-papel]')?.getAttribute('data-papel') ?? null, cor, fs: parseFloat(s.fontSize), fw: Number(s.fontWeight), caixas: [] };
        porEl.set(e, t);
      }
      t.texto = (t.texto + ' ' + no.data.trim()).trim();
      t.caixas.push(...caixas.map((c) => c.map((v) => Math.round(v * 10) / 10)));
    }
    return [...porEl.values()];
    } finally { ponteiro.remove(); }
  };
  // O quadro com o texto transparente (o preenchimento só: fundo, chip, borda e sombra ficam), para medir o fundo real.
  window.motor_semTexto = (ligar) => {
    let s = document.getElementById('motor-sem-texto');
    if (!ligar) { s?.remove(); return true; }
    if (!s) {
      s = document.createElement('style');
      s.id = 'motor-sem-texto';
      // O <video> fora do trecho dele não pinta no render (o canvas fica transparente): aqui também não.
      s.textContent = 'body *, body *::before, body *::after { -webkit-text-fill-color: transparent !important; }'
        + ' [data-motor-fora] { visibility: hidden !important; }';
      document.head.append(s);
    }
    return true;
  };

  // Foto do relatório: caixas desenhadas por cima (vermelho = texto; amarelo = rosto com a margem).
  window.motor_marcas = (lista) => {
    document.getElementById('motor-marcas')?.remove();
    if (!lista?.length) return true;
    const camada = document.createElement('div');
    camada.id = 'motor-marcas';
    camada.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    for (const m of lista) {
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;left:${m.caixa[0]}px;top:${m.caixa[1]}px;width:${m.caixa[2]}px;height:${m.caixa[3]}px;`
        + `box-sizing:border-box;border:3px solid ${m.cor};`;
      camada.append(d);
    }
    document.documentElement.append(camada);
    return true;
  };
})();
