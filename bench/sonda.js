// Kodecz Bench (P12): script de página a mais da coleta do S04 (conferencia/coletar.ts, campo `extra`). Só lê o DOM
// no quadro em que a página está e devolve o que os oráculos do bench precisam além da geometria do S04:
//   midias:   <img>, <video>, <canvas> visíveis, com a caixa na tela e a caixa do conteúdo (object-fit, object-position);
//   els:      elementos com data-papel ou data-celula (caixa, opacidade efetiva, cor, fundo, peso da fonte);
//   pintados: elementos visíveis que pintam fundo, borda, sombra ou contorno, menores que um quarto do quadro, com
//             as células (data-celula) que contêm, para achar o realce posto sobre uma célula.
(() => {
  const ids = new WeakMap();
  let proximo = 0;
  const chave = (e) => { if (!ids.has(e)) ids.set(e, ++proximo); return ids.get(e); };
  const caixa = (r) => [r.x, r.y, r.width, r.height];
  const transparente = (c) => !c || c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);

  window.motor_extra = (n) => {
    const L = document.documentElement.clientWidth, A = document.documentElement.clientHeight;
    const estilos = new Map();
    const estilo = (e) => { let s = estilos.get(e); if (!s) { s = getComputedStyle(e); estilos.set(e, s); } return s; };
    const opacidade = (e) => {
      let o = 1;
      for (let a = e; a && a.nodeType === 1; a = a.parentElement) {
        const s = estilo(a);
        if (s.display === 'none' || s.visibility === 'hidden') return 0;
        o *= Number(s.opacity);
      }
      return o;
    };

    // Caixa do conteúdo de uma mídia: o object-fit e o object-position na caixa sem transformação, levados à caixa
    // na tela (vale para escala e deslocamento, não para rotação).
    const conteudo = (e, r) => {
      const iw = e.videoWidth || e.naturalWidth || e.width, ih = e.videoHeight || e.naturalHeight || e.height;
      const bw = e.offsetWidth || r.width, bh = e.offsetHeight || r.height;
      if (!iw || !ih || !bw || !bh) return caixa(r);
      const s = estilo(e), fit = s.objectFit;
      let w = bw, h = bh;
      if (fit === 'contain' || fit === 'cover' || fit === 'scale-down') {
        const k = fit === 'cover' ? Math.max(bw / iw, bh / ih) : Math.min(bw / iw, bh / ih);
        w = iw * k; h = ih * k;
        if (fit === 'scale-down' && k > 1) { w = iw; h = ih; }
      } else if (fit === 'none') { w = iw; h = ih; }
      const [px, py] = s.objectPosition.split(' ');
      const pos = (v, livre) => (v.endsWith('%') ? (parseFloat(v) / 100) * livre : parseFloat(v));
      const x = pos(px ?? '50%', bw - w), y = pos(py ?? '50%', bh - h);
      const ex = r.width / bw, ey = r.height / bh;
      return [r.x + x * ex, r.y + y * ey, w * ex, h * ey];
    };

    const midias = [];
    for (const e of document.querySelectorAll('img, video, canvas')) {
      const r = e.getBoundingClientRect(), op = opacidade(e);
      if (op < 0.05 || r.width <= 0 || r.height <= 0) continue;
      if (window.motor_foraDoTrecho?.(e, n)) continue;
      midias.push({ k: chave(e), tag: e.localName, src: e.getAttribute('src') ?? '', papel: e.getAttribute('data-papel'),
        caixa: caixa(r), conteudo: conteudo(e, r), op });
    }

    const els = [];
    for (const e of document.querySelectorAll('[data-papel], [data-celula]')) {
      const r = e.getBoundingClientRect(), s = estilo(e);
      els.push({ k: chave(e), papel: e.getAttribute('data-papel'), celula: e.getAttribute('data-celula'), caixa: caixa(r),
        op: opacidade(e), cor: s.color, fundo: s.backgroundColor, peso: s.fontWeight, texto: e.textContent.trim().replace(/\s+/g, ' ').slice(0, 60) });
    }

    const pintados = [];
    for (const e of document.body.querySelectorAll('*')) {
      if (e.matches('img, video, canvas, script, style')) continue;
      const s = estilo(e);
      const pinta = !transparente(s.backgroundColor) || s.backgroundImage !== 'none' || s.boxShadow !== 'none'
        || ['Top', 'Right', 'Bottom', 'Left'].some((l) => parseFloat(s[`border${l}Width`]) > 0 && s[`border${l}Style`] !== 'none' && !transparente(s[`border${l}Color`]))
        || (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0);
      if (!pinta) continue;
      const r = e.getBoundingClientRect();
      if (r.width * r.height <= 0 || r.width * r.height > 0.25 * L * A) continue;
      const op = opacidade(e);
      if (op < 0.05) continue;
      const celulas = [...e.querySelectorAll('[data-celula]')].map((c) => c.getAttribute('data-celula'));
      const dentro = e.closest('[data-celula]')?.getAttribute('data-celula') ?? null;
      pintados.push({ k: chave(e), caixa: caixa(r), op, celulas: e.hasAttribute('data-celula') ? [e.getAttribute('data-celula'), ...celulas] : celulas, dentro,
        sig: [s.backgroundColor, s.backgroundImage, s.boxShadow, s.borderTopColor, s.outlineColor].join('|') });
    }
    return { midias, els, pintados };
  };
})();
