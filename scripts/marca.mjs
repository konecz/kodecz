// Gera a marca do Kodecz em SVG: a logo (parada e animada) e os cartões do README, no tema claro e no escuro.
// O traço é o da Konecz (konecz.com e o perfil konecz/konecz): objetos em 3D desenhados só com linhas finas azuis,
// mais claras na frente e mais apagadas atrás. A logo é a fita da Konecz fechada num triângulo de «play», com meia
// torção (uma fita de Möbius): fita de vídeo e fita da marca no mesmo desenho.
// Sem dependências: `node scripts/marca.mjs` reescreve tudo em marca/.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const saida = join(raiz, "marca");
mkdirSync(saida, { recursive: true });

// ------------------------------------------------------------------ base
const f = (n) => Math.round(n * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const unit = (a) => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const caminho = (pts) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(" ")}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function misturar(a, b, p) {
  const c = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(c(a, i) + (c(b, i) - c(a, i)) * p).toString(16).padStart(2, "0")).join("")}`;
}

// Os mesmos temas do perfil konecz/konecz: neutros do GitHub (o cartão some no README) e o azul do konecz.com.
const tema = (fundo, cartao, trilha, borda, tinta, sec, fraco, azul, azulClaro) =>
  ({ fundo, cartao, trilha, borda, tinta, sec, fraco, azul, azulClaro });
const TEMAS = {
  claro: tema("#ffffff", "#f6f8fa", "#eff2f5", "#d1d9e0", "#1f2328", "#59636e", "#818b98", "#1f56e0", "#7ea2ff"),
  escuro: tema("#0d1117", "#151b23", "#212830", "#3d444d", "#f0f6fc", "#9198a1", "#656c76", "#4d82ff", "#8fb0ff"),
};
// A marca sobre o azul do konecz.com (avatar, social preview): linhas brancas e azul-claro.
const AZUL_MARCA = { fundo: "#1f56e0", tinta: "#ffffff", azul: "#ffffff", azulClaro: "#d6e2ff" };

const fonte = (arq) => readFileSync(join(saida, "fontes", arq)).toString("base64");
const FONTES = `@font-face{font-family:G;src:url(data:font/woff2;base64,${fonte("schibsted-grotesk-latin-wght-normal.woff2")}) format("woff2");font-weight:100 900}
@font-face{font-family:M;src:url(data:font/woff2;base64,${fonte("ibm-plex-mono-latin-500-normal.woff2")}) format("woff2");font-weight:500}`;
const CLASSES = `.g{font-family:G,"Schibsted Grotesk",Inter,"Segoe UI",Helvetica,Arial,sans-serif}
.m{font-family:M,"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:500;font-variant-numeric:tabular-nums}`;

function svg(w, h, corpo, { fundo, borda, css = "", fontes = true, rx = 16, titulo = "" } = {}) {
  const moldura = fundo
    ? `<rect width="${w}" height="${h}" rx="${rx}" fill="${fundo}"/>${borda ? `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="${rx - 0.5}" fill="none" stroke="${borda}"/>` : ""}`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
${titulo ? `<title>${esc(titulo)}</title>\n` : ""}<style>
${fontes ? FONTES : ""}
${CLASSES}
${css}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
${moldura}
${corpo}
</svg>
`;
}

// ------------------------------------------------------------------ a fita do Kodecz
// O eixo da fita: um triângulo de cantos redondos com a ponta para a direita (o «play»), que sobe e desce em z
// nos cantos para a meia torção ler em 3D.
const PONTOS = 96;
function centro(s) {
  const a = 0.2;
  const x = Math.cos(s) + a * Math.cos(2 * s);
  const y = Math.sin(s) - a * Math.sin(2 * s);
  const z = 0.22 * Math.sin(3 * s + 0.6);
  return [x * 0.82 + 0.08, y * 0.82, z];
}
const BASE = Array.from({ length: PONTOS + 1 }, (_, i) => {
  const s = (2 * Math.PI * i) / PONTOS, c = centro(s);
  const t = unit(centro(s + 1e-3).map((v, k) => v - c[k]));
  const n = unit(cruz(t, [0, 0, 1]));
  return { s, c, n, b: cruz(t, n), largura: 0.2 * (1 - 0.18 * Math.cos(3 * s)) };
});

function anima(nome, valores, dur) {
  if (valores.every((v) => v === valores[0])) return "";
  return `<animate attributeName="${nome}" dur="${dur}s" repeatCount="indefinite" values="${[...valores, valores[0]].join(";")}"/>`;
}
const opac = (v) => (Math.round(v * 100) / 100).toString();

// A fita no espaço, numa caixa de `alto` px com o centro em (cx, cy). Com `quadros` > 1, o giro vai e volta e a
// torção dá uma volta inteira no ciclo, e o SMIL interpola entre os quadros (anda dentro de um <img> do GitHub).
function fita(cx, cy, alto, cor, { ciclo = 20, quadros = 16, linhas = 12, traco = 1.5, trecho = 8, pose = 0 } = {}) {
  const escala = alto / 2.3;
  const trechos = [];
  for (let q = 0; q < quadros; q++) {
    const u = quadros === 1 ? pose : q / quadros;
    const giro = 0.55 * Math.sin(2 * Math.PI * u) + 0.25, fase = 2 * Math.PI * u;
    const inc = 0.2 * Math.sin(2 * Math.PI * u + 1) + 0.12;
    const cg = Math.cos(giro), sg = Math.sin(giro), ci = Math.cos(inc), si = Math.sin(inc);
    for (let k = 0; k < linhas; k++) {
      const t = -1 + (2 * k) / (linhas - 1);
      for (let j = 0; j * trecho < PONTOS; j++) {
        const pts = [];
        let somaZ = 0;
        for (let i = j * trecho; i <= Math.min(PONTOS, (j + 1) * trecho); i++) {
          const p = BASE[i], theta = p.s / 2 + fase, d = t * p.largura;
          const ct = Math.cos(theta) * d, st = Math.sin(theta) * d;
          let x = p.c[0] + ct * p.n[0] + st * p.b[0], y = p.c[1] + ct * p.n[1] + st * p.b[1], z = p.c[2] + ct * p.n[2] + st * p.b[2];
          [x, z] = [x * cg + z * sg, -x * sg + z * cg];
          [y, z] = [y * ci - z * si, y * si + z * ci];
          const persp = 3.4 / (3.4 - z);
          pts.push([cx + x * escala * persp, cy - y * escala * persp]);
          somaZ += z;
        }
        const tr = ((trechos[k] ??= [])[j] ??= { d: [], o: [] });
        tr.d.push(caminho(pts));
        tr.o.push(opac(clamp(0.6 + (somaZ / pts.length) * 1.3, 0.18, 1)));
      }
    }
  }
  // Os trechos de trás primeiro: no quadro parado, a frente cobre o fundo.
  const lista = trechos.flat().sort((a, b) => Number(a.o[0]) - Number(b.o[0]));
  const corpo = lista.map((tr) =>
    `<path d="${tr.d[0]}" stroke-opacity="${tr.o[0]}">${anima("d", tr.d, ciclo)}${anima("stroke-opacity", tr.o, ciclo)}</path>`).join("");
  return `<g fill="none" stroke="${cor}" stroke-width="${traco}" stroke-linecap="round" stroke-linejoin="round">${corpo}</g>`;
}

// ------------------------------------------------------------------ peças
const ENTRADA = `.cresce{transform-box:fill-box;transform-origin:0 50%;animation:cresce 1.6s cubic-bezier(.3,0,.2,1) both}
@keyframes cresce{from{transform:scaleX(0)}}
.surge{animation:surge 1s ease-out both}
@keyframes surge{from{opacity:0;transform:translateY(8px)}}
.vivo{animation:vivo 2.4s ease-in-out infinite}
@keyframes vivo{0%,100%{opacity:1}50%{opacity:.3}}`;

// Cabeçalho: «Kodecz» grande, a frase e a fita girando à direita, como o cabeçalho do perfil da Konecz.
function cabecalho(t) {
  const W = 1200, H = 320;
  const corpo = `<text x="44" y="158" class="g" font-size="112" font-weight="800" fill="${t.tinta}" letter-spacing="-5">Kodecz</text>
<text x="48" y="214" class="g" font-size="34" font-weight="700" fill="${t.azul}" letter-spacing="-1">Video as a web page. On the GPU or the CPU.</text>
<g class="m" font-size="15" fill="${t.sec}"><text x="49" y="262">same page · deterministic frames · no screenshots, on either one</text></g>
<g class="m" font-size="13" fill="${t.fraco}"><text x="49" y="290">by Konecz · AI Factory</text></g>
${fita(1000, H / 2, 250, t.azul)}`;
  return svg(W, H, corpo, { fundo: t.fundo, borda: t.borda, titulo: "Kodecz: video as a web page, rendered on the GPU or the CPU" });
}

// O caminho do quadro, nas duas pistas: na placa (textura até o NVENC) e na CPU (o quadro cru do Chromium até o
// x264). Cinco etapas ligadas por uma linha em cada pista, e quadros numerados andando sem virar PNG.
function caminhoDoQuadro(t) {
  const W = 1200, H = 470, x0 = 44, larg = 196, alto = 84;
  const pistas = [
    { nome: "GPU", y: 112, etapas: [["Page", "HTML · CSS · JS"], ["Chromium", "GPU raster, off-screen"], ["Texture", "shared, zero-copy"], ["NVENC", "H.264 · HEVC · alpha"], ["MP4", "+ audio mix"]], forte: 2 },
    { nome: "CPU", y: 296, etapas: [["Page", "the same folder"], ["Chromium", "software raster"], ["Raw frame", "no PNG, no encode"], ["x264", "H.264 on the CPU"], ["MP4", "+ audio mix"]], forte: 2 },
  ];
  const vao = (W - 2 * x0 - larg * 5) / 4, cx = (i) => x0 + i * (larg + vao), dist = cx(4) - cx(0);
  const desenho = pistas.map((p, pi) => {
    const linha = `<line x1="${x0 + larg / 2}" y1="${p.y + alto / 2}" x2="${cx(4) + larg / 2}" y2="${p.y + alto / 2}" stroke="${t.azul}" stroke-width="2" stroke-dasharray="2 6" stroke-linecap="round"/>`;
    const caixas = p.etapas.map(([nome, sub], i) => `<g class="surge" style="animation-delay:${0.12 * i + 0.3 * pi}s">
<rect x="${f(cx(i))}" y="${p.y}" width="${larg}" height="${alto}" rx="14" fill="${t.cartao}" stroke="${i === p.forte ? t.azul : t.borda}" stroke-width="${i === p.forte ? 2 : 1}"/>
<text x="${f(cx(i) + 18)}" y="${p.y + 38}" class="g" font-size="25" font-weight="800" fill="${t.tinta}" letter-spacing="-1">${esc(nome)}</text>
<text x="${f(cx(i) + 18)}" y="${p.y + 64}" class="m" font-size="13" fill="${t.sec}">${esc(sub)}</text></g>`).join("\n");
    const quadros = [0, 1, 2].map((k) => `<g style="animation:anda ${pi ? 6 : 4.5}s linear ${-(pi ? 2 : 1.5) * k}s infinite">
<rect x="${x0 + larg / 2 - 22}" y="${p.y - 40}" width="44" height="26" rx="5" fill="${t.azul}"/>
<text x="${x0 + larg / 2}" y="${p.y - 22}" text-anchor="middle" class="m" font-size="12" fill="#ffffff">N+${k}</text></g>`).join("\n");
    const rotulo = `<text x="${x0}" y="${p.y - 52}" class="m" font-size="14" fill="${t.sec}" letter-spacing="1">${p.nome === "GPU" ? "WITH AN NVIDIA GPU" : "WITHOUT ONE"}</text>`;
    return `${rotulo}\n${linha}\n${quadros}\n${caixas}`;
  }).join("\n");
  const css = `${ENTRADA}
@keyframes anda{0%{transform:translateX(0);opacity:0}8%{opacity:1}92%{opacity:1}100%{transform:translateX(${f(dist)}px);opacity:0}}`;
  const rodape = `<g class="m" font-size="14" fill="${t.sec}">
<circle class="vivo" cx="${x0 + 6}" cy="${H - 31}" r="5" fill="${t.azul}"/>
<text x="${x0 + 22}" y="${H - 26}">one page for both · on each, frame N is always the same pixels, in any order</text></g>`;
  return svg(W, H, `${desenho}\n${rodape}`, { fundo: t.fundo, borda: t.borda, css, titulo: "How a frame is made, on the GPU (page, Chromium, shared texture, NVENC, MP4) and on the CPU (page, Chromium software raster, raw frame, x264, MP4), without screenshots" });
}

// Os números, medidos (docs/medidas.md): CPU e tempo de parede contra o render oficial do Remotion.
function numeros(t) {
  const W = 1200, H = 380, x0 = 44;
  const grupos = [
    { rotulo: "CPU TIME", y: 100, max: 43.7, linhas: [["Remotion", 43.7, false], ["Kodecz", 4.4, true]], ganho: "10×", sub: "less CPU" },
    { rotulo: "WALL TIME", y: 238, max: 13.6, linhas: [["Remotion", 13.6, false], ["Kodecz", 4.6, true]], ganho: "3×", sub: "faster" },
  ];
  const barraX = x0 + 130, barraW = 640;
  const corpo = grupos.map((g, gi) => {
    const linhas = g.linhas.map(([nome, v, nosso], i) => {
      const yy = g.y + 18 + i * 42, w = Math.max(6, (v / g.max) * barraW);
      return `<text x="${x0}" y="${yy + 19}" class="g" font-size="20" font-weight="${nosso ? 800 : 600}" fill="${nosso ? t.tinta : t.sec}">${nome}</text>
<rect x="${barraX}" y="${yy}" width="${barraW}" height="26" rx="6" fill="${t.trilha}"/>
<rect class="cresce" style="animation-delay:${0.2 * gi + 0.15 * i}s" x="${barraX}" y="${yy}" width="${f(w)}" height="26" rx="6" fill="${nosso ? t.azul : t.fraco}"/>
<text x="${f(barraX + w + 12)}" y="${yy + 19}" class="m" font-size="16" fill="${nosso ? t.azul : t.sec}">${v} s</text>`;
    }).join("\n");
    return `<text x="${x0}" y="${g.y}" class="m" font-size="14" fill="${t.sec}" letter-spacing="1">${g.rotulo}</text>
${linhas}
<g class="surge" style="animation-delay:${0.6 + 0.2 * gi}s"><text x="${W - 44}" y="${g.y + 62}" text-anchor="end" class="g" font-size="76" font-weight="800" fill="${t.azul}" letter-spacing="-3">${g.ganho}</text>
<text x="${W - 44}" y="${g.y + 92}" text-anchor="end" class="m" font-size="15" fill="${t.sec}">${g.sub}</text></g>`;
  }).join("\n");
  const titulo = `<text x="${x0}" y="50" class="g" font-size="30" font-weight="800" fill="${t.tinta}" letter-spacing="-1">Same video, a fraction of the CPU</text>`;
  const nota = `<text x="${x0}" y="${H - 22}" class="m" font-size="12" fill="${t.fraco}">1080p · 150 frames · H.264 · RTX 5090 · SSIM 0.998 vs. Remotion · measured 2026-10-30</text>`;
  return svg(W, H, `${titulo}\n${corpo}\n${nota}`, { fundo: t.fundo, borda: t.borda, css: ENTRADA, titulo: "Same video: Remotion 43.7 s of CPU, Kodecz 4.4 s; wall time 13.6 s against 4.6 s" });
}

// A logo: só a fita, parada (para avatar e favicon) ou girando; e a logo com o nome ao lado.
function logo(cor, { animada = false, fundo = null, tam = 512 } = {}) {
  const corpo = fita(tam / 2, tam / 2, tam * 0.78, cor, animada
    ? { traco: tam / 300, linhas: 14 }
    : { quadros: 1, pose: 0, traco: tam / 300, linhas: 14 });
  return svg(tam, tam, corpo, { fundo, rx: fundo ? tam * 0.22 : 0, fontes: false, titulo: "Kodecz" });
}
function logoComNome(t, { animada = false } = {}) {
  const W = 760, H = 220;
  const corpo = `${fita(110, H / 2, 190, t.azul, animada ? {} : { quadros: 1, pose: 0 })}
<text x="232" y="146" class="g" font-size="118" font-weight="800" fill="${t.tinta}" letter-spacing="-5">Kodecz</text>`;
  return svg(W, H, corpo, { titulo: "Kodecz" });
}

// ------------------------------------------------------------------ gravar
const arquivos = {};
for (const [nome, t] of Object.entries(TEMAS)) {
  arquivos[`cabecalho-${nome}.svg`] = cabecalho(t);
  arquivos[`caminho-${nome}.svg`] = caminhoDoQuadro(t);
  arquivos[`numeros-${nome}.svg`] = numeros(t);
  arquivos[`logo-nome-${nome}.svg`] = logoComNome(t);
  arquivos[`logo-nome-animada-${nome}.svg`] = logoComNome(t, { animada: true });
}
arquivos["logo.svg"] = logo(TEMAS.claro.azul);
arquivos["logo-animada.svg"] = logo(TEMAS.claro.azul, { animada: true });
arquivos["logo-azul.svg"] = logo(AZUL_MARCA.tinta, { fundo: AZUL_MARCA.fundo });
for (const [nome, conteudo] of Object.entries(arquivos)) writeFileSync(join(saida, nome), conteudo);
console.log(Object.entries(arquivos).map(([n, c]) => `${n}  ${(c.length / 1024).toFixed(0)} KB`).join("\n"));
