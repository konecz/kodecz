// Conversão de cor do vídeo embutido (P05): YUV 4:2:0 de 8 bits (I420) para RGB, igual bit a bit ao ffmpeg
// (yuv420p → bgr24, mesmo tamanho, flags=bilinear, saída em faixa cheia).
//
// Origem limpa. Escrito em sala limpa a partir de docs/formatos/conversao-de-cor.md, sem ler a implementação
// anterior nem o código-fonte do ffmpeg. De onde vem cada número:
// - Kr e Kb das normas: ITU-R BT.601-7 (e SMPTE 170M), ITU-R BT.709-6, SMPTE ST 240:1999, ITU-R BT.2020-2 (não
//   constante); as fórmulas de R, G e B a partir de Y', Cb e Cr são as das normas.
// - Faixa TV de 8 bits (Y 16..235, croma 16..240 centrado em 128) das mesmas normas; faixa cheia pela convenção do
//   JPEG/JFIF (croma centrado em 128, escala 255 como a do Y).
// - A aritmética inteira (precisão dos coeficientes, piso de cada termo, saturação) foi descoberta por medição, com
//   o ffmpeg usado só como binário oráculo: a varredura das 256³ combinações de (Y, U, V) mostrou que cada canal é
//   a soma de um termo inteiro do Y e um de cada croma, saturada em 0..255; cada termo é o piso de c·x / 2^13, com
//   c = arredondamento do coeficiente real da norma vezes 2^13 (registro em docs/estado/, seção «Etapa 2»).
// - Interface e contadores: docs/formatos/conversao-de-cor.md, seção 4; WebCodecs (VideoFrame, copyTo) e WebGL2.
//
// Script clássico (sem import/export): o main.ts injeta o texto na página; o teste o roda com vm.runInNewContext.
(function () {
  'use strict';
  const BITS = 13, ESCALA = 1 << BITS;

  // Kr e Kb das normas.
  const NORMAS = { bt601: [0.299, 0.114], bt709: [0.2126, 0.0722], smpte240m: [0.212, 0.087], bt2020: [0.2627, 0.0593] };
  // Nomes do WebCodecs (VideoColorSpace.matrix) para a matriz.
  const MATRIZES = { bt709: 'bt709', smpte170m: 'bt601', bt470bg: 'bt601', smpte240m: 'smpte240m', 'bt2020-ncl': 'bt2020' };

  // Coeficientes inteiros (escala 2^13) de uma matriz e faixa.
  const cacheCoef = {};
  function coeficientes(matriz, faixa) {
    const chave = matriz + '/' + faixa;
    if (cacheCoef[chave]) return cacheCoef[chave];
    const [kr, kb] = NORMAS[matriz];
    const kg = 1 - kr - kb;
    const tv = faixa === 'tv';
    const ey = tv ? 255 / 219 : 1, ec = tv ? 255 / 224 : 1;
    const q = (v) => Math.round(v * ESCALA);
    return (cacheCoef[chave] = {
      y0: tv ? 16 : 0,
      cy: q(ey),
      cr: q(2 * (1 - kr) * ec),
      cb: q(2 * (1 - kb) * ec),
      cgu: q((-2 * kb * (1 - kb) / kg) * ec),
      cgv: q((-2 * kr * (1 - kr) / kg) * ec),
    });
  }

  // Regra de escolha (especificação, seção 5).
  function escolha(colorSpace, altura) {
    const cs = colorSpace ?? {};
    const cheia = cs.fullRange === true;
    let matriz;
    if (cs.matrix === null || cs.matrix === undefined) matriz = cheia ? 'bt601' : altura >= 720 ? 'bt709' : 'bt601';
    else matriz = MATRIZES[cs.matrix];
    if (!matriz) return null;
    const faixa = cheia ? 'cheia' : 'tv';
    return { matriz, faixa, coef: coeficientes(matriz, faixa) };
  }

  // Referência em JS da mesma conta do shader.
  function quadro(entrada, esc) {
    const { largura: L, altura: A, dados, planos } = entrada;
    const k = coeficientes(esc.matriz, esc.faixa);
    const saida = new Uint8ClampedArray(L * A * 4);
    const [pY, pU, pV] = planos;
    let o = 0;
    for (let y = 0; y < A; y++) {
      const lY = pY.offset + y * pY.stride, lU = pU.offset + (y >> 1) * pU.stride, lV = pV.offset + (y >> 1) * pV.stride;
      for (let x = 0; x < L; x++) {
        const ty = (k.cy * (dados[lY + x] - k.y0)) >> BITS;
        const u = dados[lU + (x >> 1)] - 128, v = dados[lV + (x >> 1)] - 128;
        saida[o] = ty + ((k.cr * v) >> BITS); // Uint8ClampedArray satura em 0..255
        saida[o + 1] = ty + ((k.cgu * u) >> BITS) + ((k.cgv * v) >> BITS);
        saida[o + 2] = ty + ((k.cb * u) >> BITS);
        saida[o + 3] = 255;
        o += 4;
      }
    }
    return saida;
  }

  const VERTICES = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
  // Mesma conta do quadro(): >> em int com sinal estende o sinal (GLSL ES 3.00, 5.9), igual ao piso do JS.
  const FRAGMENTOS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D planoY, planoU, planoV;
uniform int altura, y0, cy;
uniform ivec4 coef; // cr, cgu, cgv, cb
out vec4 cor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  p.y = altura - 1 - p.y;
  int ty = (cy * (int(texelFetch(planoY, p, 0).r) - y0)) >> ${BITS};
  int u = int(texelFetch(planoU, p >> 1, 0).r) - 128;
  int v = int(texelFetch(planoV, p >> 1, 0).r) - 128;
  ivec3 c = ivec3(ty + ((coef.x * v) >> ${BITS}),
                  ty + ((coef.y * u) >> ${BITS}) + ((coef.z * v) >> ${BITS}),
                  ty + ((coef.w * u) >> ${BITS}));
  cor = vec4(vec3(clamp(c, 0, 255)) / 255.0, 1.0);
}`;

  function instalar(janela) {
    const original = janela.createImageBitmap.bind(janela);
    const estado = janela.motor_cor = {
      convertidos: 0, passados: 0, motivos: {}, contextos: 0, texturas: 0, texturasApagadas: 0, buffers: 0, erro: null,
    };
    let gl = null, canvas = null, programa = null, unif = null, texturas = null, tamTex = '', perdido = false;
    let buffer = null, fila = Promise.resolve();

    const falha = (msg) => { const e = new Error('motor_cor: ' + msg); estado.erro = e.message; return e; };
    const contextoOk = () => { if (perdido || gl.isContextLost()) { perdido = true; throw falha('contexto WebGL perdido'); } };

    function preparar(L, A) {
      if (!gl) {
        if (typeof janela.OffscreenCanvas !== 'function') throw falha('sem OffscreenCanvas');
        canvas = new janela.OffscreenCanvas(L, A);
        gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
        if (!gl) throw falha('sem WebGL2');
        estado.contextos++;
        canvas.addEventListener?.('webglcontextlost', (e) => { perdido = true; e.preventDefault?.(); });
        const sombra = (tipo, fonte) => {
          const s = gl.createShader(tipo);
          gl.shaderSource(s, fonte); gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw falha('shader não compila: ' + gl.getShaderInfoLog(s));
          return s;
        };
        programa = gl.createProgram();
        gl.attachShader(programa, sombra(gl.VERTEX_SHADER, VERTICES));
        gl.attachShader(programa, sombra(gl.FRAGMENT_SHADER, FRAGMENTOS));
        gl.linkProgram(programa);
        if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) throw falha('programa não liga: ' + gl.getProgramInfoLog(programa));
        gl.useProgram(programa);
        unif = {};
        for (const n of ['altura', 'y0', 'cy', 'coef']) unif[n] = gl.getUniformLocation(programa, n);
        ['planoY', 'planoU', 'planoV'].forEach((n, i) => gl.uniform1i(gl.getUniformLocation(programa, n), i));
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      }
      contextoOk();
      const tam = L + 'x' + A;
      if (tam !== tamTex) {
        if (texturas) { for (const t of texturas) gl.deleteTexture(t); estado.texturas -= 3; estado.texturasApagadas += 3; }
        texturas = [[L, A], [L / 2, A / 2], [L / 2, A / 2]].map(([l, a], i) => {
          const t = gl.createTexture();
          gl.activeTexture(gl.TEXTURE0 + i);
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, l, a);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          return t;
        });
        estado.texturas += 3;
        tamTex = tam;
        canvas.width = L; canvas.height = A;
      }
    }

    // Desenha a entrada { largura, altura, dados, planos } com a escolha e devolve o ImageBitmap.
    function desenhar(ent, esc) {
      const { largura: L, altura: A, dados, planos } = ent;
      preparar(L, A);
      const k = esc.coef ?? coeficientes(esc.matriz, esc.faixa);
      gl.useProgram(programa);
      [[L, A], [L / 2, A / 2], [L / 2, A / 2]].forEach(([l, a], i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, texturas[i]);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, planos[i].stride);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, l, a, gl.RED_INTEGER, gl.UNSIGNED_BYTE, dados, planos[i].offset);
      });
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
      gl.uniform1i(unif.altura, A);
      gl.uniform1i(unif.y0, k.y0);
      gl.uniform1i(unif.cy, k.cy);
      gl.uniform4i(unif.coef, k.cr, k.cgu, k.cgv, k.cb);
      gl.viewport(0, 0, L, A);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      contextoOk();
      const erroGl = gl.getError();
      if (erroGl !== gl.NO_ERROR) { contextoOk(); throw falha('gl.getError ' + erroGl); }
      const bitmap = canvas.transferToImageBitmap();
      contextoOk();
      return bitmap;
    }

    // Layout do copyTo: 3 planos, cada um dentro do buffer, stride ≥ largura do plano, offset ≥ 0.
    function conferirLayout(planos, L, A, tamanho) {
      if (!Array.isArray(planos) || planos.length !== 3) throw falha(`layout do copyTo com ${planos?.length} planos (esperava 3)`);
      planos.forEach((p, i) => {
        const l = i ? L / 2 : L, a = i ? A / 2 : A;
        if (!(Number.isInteger(p?.offset) && Number.isInteger(p?.stride) && p.offset >= 0 && p.stride >= l && p.offset + p.stride * (a - 1) + l <= tamanho))
          throw falha(`layout do copyTo, plano ${i} (${JSON.stringify(p)}) não cabe no buffer de ${tamanho} bytes`);
      });
    }

    // Motivo para passar ao original, ou null se a conversão cobre o quadro.
    function motivo(fonte, nArgs) {
      if (nArgs > 1) return 'opções ou recorte no createImageBitmap';
      if ((fonte.rotation ?? 0) !== 0) return `rotação ${fonte.rotation}`;
      if (fonte.flip) return 'espelhado (flip)';
      if (fonte.format !== 'I420') return `formato ${fonte.format}`;
      const r = fonte.visibleRect;
      if (!r || r.width % 2 || r.height % 2) return `tamanho visível ímpar ${r?.width}x${r?.height}`;
      if (fonte.displayWidth !== r.width || fonte.displayHeight !== r.height) return `pixel não quadrado (${fonte.displayWidth}x${fonte.displayHeight} de ${r.width}x${r.height})`;
      if (!escolha(fonte.colorSpace, r.height)) return `matriz ${fonte.colorSpace?.matrix}`;
      return null;
    }

    // Converte um VideoFrame coberto; em fila (o buffer e o contexto são um só).
    function converter(fonte, contar) {
      const tarefa = fila.then(async () => {
        try {
          if (perdido) contextoOk();
          const r = fonte.visibleRect, L = r.width, A = r.height;
          const esc = escolha(fonte.colorSpace, A);
          const precisa = fonte.allocationSize();
          if (!buffer || buffer.length < precisa) { buffer = new Uint8Array(precisa); estado.buffers++; }
          const planos = await fonte.copyTo(buffer);
          conferirLayout(planos, L, A, buffer.length);
          const bitmap = desenhar({ largura: L, altura: A, dados: buffer, planos }, esc);
          if (contar) estado.convertidos++;
          return bitmap;
        } catch (e) {
          const msg = String(e?.message ?? e);
          if (msg.startsWith('motor_cor: ')) throw e;
          if (gl && gl.isContextLost()) { perdido = true; throw falha('contexto WebGL perdido (' + msg + ')'); }
          throw falha(msg);
        }
      });
      fila = tarefa.catch(() => {});
      return tarefa;
    }

    janela.createImageBitmap = async function (fonte, ...resto) {
      const VF = janela.VideoFrame;
      if (typeof VF !== 'function' || !(fonte instanceof VF)) return original(fonte, ...resto);
      const m = motivo(fonte, 1 + resto.length);
      if (m) {
        estado.passados++;
        estado.motivos[m] = (estado.motivos[m] ?? 0) + 1;
        return original(fonte, ...resto);
      }
      return converter(fonte, true);
    };

    // Lê um ImageBitmap de volta num canvas 2D e conta as amostras diferentes da referência.
    function diferencas(bitmap, ref) {
      const c = new janela.OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      let d = 0;
      for (let i = 0; i < px.length; i++) if (px[i] !== ref[i]) d++;
      return d;
    }
    // Quadro I420 sintético 64×32 (ou com stride maior, se folga > 0), conteúdo pseudoaleatório em toda a faixa.
    function sintetico(semente, colorSpace, folga = 0) {
      const L = 64, A = 32, sY = L + folga, sC = L / 2 + folga;
      const n = sY * A, c = sC * A / 2;
      const dados = new Uint8Array(n + 2 * c);
      let s = semente;
      for (let i = 0; i < dados.length; i++) dados[i] = (s = (s * 1103515245 + 12345) & 0x7fffffff) >> 16 & 255;
      return new janela.VideoFrame(dados, {
        format: 'I420', codedWidth: L, codedHeight: A, timestamp: 0, colorSpace,
        layout: [{ offset: 0, stride: sY }, { offset: n, stride: sC }, { offset: n + c, stride: sC }],
      });
    }
    async function conferir(frame) {
      const r = frame.visibleRect;
      const tmp = new Uint8Array(frame.allocationSize());
      const planos = await frame.copyTo(tmp);
      const ref = quadro({ largura: r.width, altura: r.height, dados: tmp, planos }, escolha(frame.colorSpace, r.height));
      return diferencas(await converter(frame, false), ref);
    }

    janela.motor_corAutoteste = async function () {
      const casos = [
        { matrix: 'bt709', fullRange: false, primaries: 'bt709', transfer: 'bt709' },
        { matrix: 'smpte170m', fullRange: false, primaries: 'smpte170m', transfer: 'smpte170m' },
        { matrix: 'bt709', fullRange: true, primaries: 'bt709', transfer: 'bt709' },
        { matrix: 'bt470bg', fullRange: true, primaries: 'bt470bg', transfer: 'smpte170m' },
        // smpte240m não entra: o enum VideoMatrixCoefficients do WebCodecs não tem esse valor (o construtor recusa).
        { matrix: 'bt2020-ncl', fullRange: false, primaries: 'bt2020', transfer: 'bt709' },
      ];
      let d = 0;
      for (let i = 0; i < casos.length; i++) {
        const f = sintetico(7 + i, casos[i]);
        try { d += await conferir(f); } finally { f.close(); }
      }
      return d;
    };

    janela.motor_corTesteFalhas = async function () {
      const cs = { matrix: 'bt709', fullRange: false, primaries: 'bt709', transfer: 'bt709' };
      const mensagem = async (f) => { try { (await converter(f, false)).close(); return 'aceito'; } catch (e) { return e.message; } };
      const res = {};
      // Layout que não cobre os planos: o copyTo deste quadro devolve só 2.
      let f = sintetico(21, cs);
      const copiar = f.copyTo.bind(f);
      f.copyTo = async (buf) => (await copiar(buf)).slice(0, 2);
      res.layoutErrado = await mensagem(f);
      f.close();
      // Folga: quadro criado com stride maior que a largura, e o copyTo pedindo destino também com folga.
      f = sintetico(22, cs, 9);
      const copiarF = f.copyTo.bind(f);
      const L = 64, A = 32, sY = L + 11, sC = L / 2 + 5, oV = 3, oU = oV + sC * A / 2 + 1, oY = oU + sC * A / 2 + 2;
      const layout = [{ offset: oY, stride: sY }, { offset: oU, stride: sC }, { offset: oV, stride: sC }];
      f.allocationSize = () => oY + sY * A;
      f.copyTo = (buf) => copiarF(buf, { layout });
      res.folga = await conferir(f);
      f.close();
      // Perda do contexto: depois disso, toda conversão falha (de propósito, o render seguinte também).
      if (!gl) { const g = sintetico(23, cs); try { (await converter(g, false)).close(); } finally { g.close(); } }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      f = sintetico(24, cs);
      res.perda = await mensagem(f);
      f.close();
      return res;
    };
  }

  const corLimpa = { escolha, quadro, instalar };
  globalThis.corLimpa = corLimpa;
  if (typeof window !== 'undefined' && typeof window.createImageBitmap === 'function') corLimpa.instalar(window);
})();
