// Kodecz Bench (P12): script de página a mais da coleta, para os motores de oráculo genéricos (bench-gerador/motores.ts).
// Embrulha o window.motor_extra do bench/sonda.js e acrescenta, no campo `estilo` de cada quadro:
//   vis:     todo elemento visível (opacidade efetiva ≥ 0,05 e caixa na tela), com a caixa e a opacidade (todo quadro);
//   css:     nos quadros de amostra (o 0 e um a cada meio segundo), o estilo calculado dos visíveis que têm texto
//            próprio, mídia ou pintam algo: letra, cor, fundo, sombras, filtros, raio, transformação, as linhas do
//            texto (palavras por linha), se o texto está cortado por um ancestral com overflow e se está tapado;
//   estatico (só no quadro 0): as animações da página (document.getAnimations), as fontes (document.fonts) e as
//            famílias pedidas que não existem.
// Só lê o DOM; não muda nada.
(() => {
  const antes = window.motor_extra;
  const ids = new WeakMap();
  let proximo = 0;
  const chave = (e) => { if (!ids.has(e)) ids.set(e, ++proximo); return ids.get(e); };
  const caixa = (r) => [+r.x.toFixed(2), +r.y.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)];
  const QPS = window.motor_conf?.qps ?? (() => { try { const d = JSON.parse((document.getElementById('kodecz') ?? document.getElementById('motor-video')).textContent); return d.fps ?? d.qps; } catch { return 30; } })();
  const PASSO = Math.max(1, Math.round(QPS / 2));
  const transparente = (c) => !c || c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);
  const textoProprio = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
  const GENERICAS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'emoji', 'math', 'fangsong', 'ui-serif', 'ui-sans-serif', 'ui-monospace']);
  const primeiraFamilia = (ff) => (ff.split(',')[0] || '').trim().replace(/^["']|["']$/g, '');

  // Família existe? Mede um texto com a família e cada genérica de reserva: se nunca muda, ela não existe.
  const ctx = document.createElement('canvas').getContext('2d');
  const AMOSTRA = 'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJ 0123456789 áãçõ';
  const existeCache = new Map();
  const existe = (fam) => {
    if (!fam || GENERICAS.has(fam.toLowerCase())) return true;
    if (existeCache.has(fam)) return existeCache.get(fam);
    let r = false;
    for (const g of ['monospace', 'serif', 'sans-serif']) {
      ctx.font = `40px ${g}`; const a = ctx.measureText(AMOSTRA).width;
      ctx.font = `40px "${fam}", ${g}`; const b = ctx.measureText(AMOSTRA).width;
      if (Math.abs(a - b) > 0.5) { r = true; break; }
    }
    existeCache.set(fam, r);
    return r;
  };

  // Linhas de um texto: palavras agrupadas pelo topo do retângulo de cada uma.
  const linhasDe = (e) => {
    const linhas = [];
    const andar = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    const r = document.createRange();
    for (let n = andar.nextNode(); n; n = andar.nextNode()) {
      const s = n.textContent;
      const re = /\S+/g;
      let m;
      while ((m = re.exec(s))) {
        r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
        const rs = r.getClientRects();
        if (!rs.length) continue;
        const topo = rs[0].top;
        let l = linhas.find((x) => Math.abs(x.topo - topo) < Math.max(2, rs[0].height * 0.4));
        if (!l) { l = { topo, p: [], fundo: 0 }; linhas.push(l); }
        l.p.push(m[0]);
        l.fundo = Math.max(l.fundo, rs[0].bottom);
      }
    }
    return linhas.sort((a, b) => a.topo - b.topo).map((l) => ({ t: l.p.join(' '), y: +l.topo.toFixed(1), b: +l.fundo.toFixed(1) }));
  };

  let estatico = null;
  const lerEstatico = () => {
    const anims = document.getAnimations().map((a) => {
      const ef = a.effect, alvo = ef?.target ?? null, tm = ef?.getTiming?.() ?? {};
      let chaves = [];
      try { chaves = ef.getKeyframes().map((k) => { const o = {}; for (const [p, v] of Object.entries(k)) if (!['computedOffset', 'composite'].includes(p)) o[p] = v; return o; }); } catch {}
      return { k: alvo ? chave(alvo) : null, id: alvo?.id ?? null, tipo: a.constructor.name, delay: tm.delay ?? 0, dur: typeof tm.duration === 'number' ? tm.duration : 0,
        easing: tm.easing ?? 'linear', iter: tm.iterations === Infinity ? -1 : (tm.iterations ?? 1), fill: tm.fill ?? 'auto', dir: tm.direction ?? 'normal', chaves,
        props: [...new Set(chaves.flatMap((c) => Object.keys(c).filter((p) => !['offset', 'easing'].includes(p))))] };
    });
    const fontes = [...document.fonts].map((f) => ({ familia: f.family.replace(/^["']|["']$/g, ''), status: f.status }));
    const audios = [...document.querySelectorAll('audio, video')].map((a) => ({ src: a.getAttribute('src'), inicio: a.getAttribute('data-inicio'), volume: a.getAttribute('data-volume'),
      velocidade: a.getAttribute('data-velocidade'), quadros: a.getAttribute('data-quadros'), recorte: a.getAttribute('data-recorte'), mudo: a.muted }));
    return { anims, fontes, audios, paginaFundo: getComputedStyle(document.body).backgroundColor, htmlFundo: getComputedStyle(document.documentElement).backgroundColor,
      blocos: document.querySelectorAll('script[id="kodecz"], script[id="motor-video"]').length };
  };

  window.motor_extra = (n) => {
    const base = antes ? antes(n) : {};
    if (estatico === null) estatico = lerEstatico();
    const L = document.documentElement.clientWidth, A = document.documentElement.clientHeight;
    const estilos = new Map();
    const est = (e) => { let s = estilos.get(e); if (!s) { s = getComputedStyle(e); estilos.set(e, s); } return s; };
    const ops = new Map();
    const op = (e) => {
      if (!e || e.nodeType !== 1) return 1;
      if (ops.has(e)) return ops.get(e);
      const s = est(e);
      const o = s.display === 'none' || s.visibility === 'hidden' ? 0 : Number(s.opacity) * op(e.parentElement);
      ops.set(e, o);
      return o;
    };
    const amostra = n % PASSO === 0;
    const vis = [], css = [];
    for (const e of document.body.querySelectorAll('*')) {
      if (e.matches('script, style, audio, br, source')) continue;
      const o = op(e);
      if (o < 0.05) continue;
      if (window.motor_foraDoTrecho?.(e, n)) continue;
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.right <= 0 || r.bottom <= 0 || r.left >= L || r.top >= A) continue;
      const k = chave(e), texto = textoProprio(e), s = est(e);
      const midia = e.matches('img, video, canvas');
      const pinta = !transparente(s.backgroundColor) || s.backgroundImage !== 'none' || s.boxShadow !== 'none' || s.filter !== 'none' || s.backdropFilter !== 'none';
      if (!texto && !midia && !pinta && !e.matches('section, [data-papel]')) continue;
      vis.push([k, caixa(r), +o.toFixed(3)]);
      if (!amostra) continue;
      const item = { k, id: e.id || null, tag: e.localName, papel: e.getAttribute('data-papel'), pai: e.parentElement?.id || null,
        texto: texto.slice(0, 200), fs: parseFloat(s.fontSize), fw: Number(s.fontWeight), ff: s.fontFamily, ls: s.letterSpacing === 'normal' ? 0 : parseFloat(s.letterSpacing),
        tt: s.textTransform, cor: s.color, fundo: s.backgroundColor, bgimg: s.backgroundImage === 'none' ? null : s.backgroundImage.slice(0, 300),
        sombra: s.boxShadow === 'none' ? null : s.boxShadow, tsombra: s.textShadow === 'none' ? null : s.textShadow,
        filtro: s.filter === 'none' ? null : s.filter, bfiltro: s.backdropFilter === 'none' ? null : s.backdropFilter,
        raio: parseFloat(s.borderTopLeftRadius) || 0, transf: s.transform === 'none' ? null : s.transform, alinh: s.textAlign, dir: s.direction,
        borda: parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none' ? s.borderTopColor : null, deco: s.textDecorationLine !== 'none' ? s.textDecorationLine : null,
        transicao: s.transitionDuration && s.transitionDuration.split(',').some((d) => parseFloat(d) > 0) ? s.transitionProperty : null,
        overflow: s.overflow };
      if (midia) {
        item.nat = [e.naturalWidth || e.videoWidth || e.width || 0, e.naturalHeight || e.videoHeight || e.height || 0, e.localName === 'img' ? (e.complete ? 1 : 0) : 1];
        // SVG é vetor: ampliar não perde nitidez.
        if (/\.svg(\?|#|$)/i.test(e.currentSrc || e.getAttribute('src') || '')) item.vetor = true;
      }
      if (texto) {
        item.linhas = linhasDe(e);
        item.familia = primeiraFamilia(s.fontFamily);
        // Texto mais largo que a própria caixa (medido antes da fonte, largura fixa com nowrap).
        if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0) item.estouro = e.scrollWidth - e.clientWidth;
        item.existe = existe(item.familia);
        // Cortado: a última linha passa do fundo de um ancestral com overflow que corta.
        for (let a = e; a && a !== document.body; a = a.parentElement) {
          const sa = est(a);
          if (sa.overflow !== 'visible' || sa.overflowY !== 'visible') {
            const ra = a.getBoundingClientRect(), fundo = Math.max(...item.linhas.map((l) => l.b), 0);
            if (fundo > ra.bottom + 0.5) { item.cortado = +(fundo - ra.bottom).toFixed(1); break; }
          }
        }
        // Tapado: no centro do texto, um elemento opaco por cima (fora da família dele).
        const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
        if (cx >= 0 && cy >= 0 && cx < L && cy < A) {
          for (const x of document.elementsFromPoint(cx, cy)) {
            if (x === e || e.contains(x)) break;
            if (x.contains(e) || op(x) < 0.5) continue;
            const sx = est(x);
            const cobre = x.matches('img, video, canvas') || (!transparente(sx.backgroundColor) && !/rgba\(.*,\s*0?\.[0-4]\d*\)$/.test(sx.backgroundColor));
            if (cobre) { item.tapado = x.id || x.localName; break; }
          }
        }
      }
      css.push(item);
    }
    return { ...base, estilo: { vis, ...(amostra ? { css } : {}), ...(n === 0 || estatico.enviado !== true ? { estatico: (estatico.enviado = true, estatico) } : {}) } };
  };
})();
