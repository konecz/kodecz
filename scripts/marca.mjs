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

// Ícones (Octicons, MIT) e logos (Simple Icons, CC0), grade 24, em marca/icones/icones.json.
const ICONES = JSON.parse(readFileSync(join(saida, "icones", "icones.json"), "utf8"));
function icone(nome, x, y, tam, cor) {
  const d = ICONES.octicons[nome] ?? ICONES.logos[nome];
  if (!d) throw new Error(`ícone ${nome} não existe`);
  return `<path transform="translate(${f(x)} ${f(y)}) scale(${Math.round((tam / 24) * 1000) / 1000})" d="${d}" fill="${cor}" fill-rule="evenodd"/>`;
}
// Uma peça: o quadrado de cantos redondos com o ícone no meio e, embaixo, uma palavra.
function peca(t, x, y, lado, nome, rotulo, { forte = false, atraso = 0 } = {}) {
  return `<g class="surge" style="animation-delay:${atraso}s">
<rect x="${f(x)}" y="${f(y)}" width="${lado}" height="${lado}" rx="${lado * 0.24}" fill="${forte ? t.azul : t.cartao}" stroke="${forte ? t.azul : t.borda}"/>
${icone(nome, x + lado * 0.25, y + lado * 0.25, lado * 0.5, forte ? "#ffffff" : t.azul)}
${rotulo ? `<text x="${f(x + lado / 2)}" y="${f(y + lado + 30)}" text-anchor="middle" class="g" font-size="20" font-weight="800" fill="${t.tinta}" letter-spacing="-.4">${esc(rotulo)}</text>` : ""}</g>`;
}

// Cabeçalho: o nome, uma frase e a fita girando. Nada mais.
function cabecalho(t) {
  const W = 1200, H = 300;
  const corpo = `<text x="44" y="164" class="g" font-size="128" font-weight="800" fill="${t.tinta}" letter-spacing="-6">Kodecz</text>
<text x="50" y="226" class="g" font-size="38" font-weight="700" fill="${t.azul}" letter-spacing="-1">Video as a web page.</text>
${fita(1000, H / 2, 240, t.azul)}`;
  return svg(W, H, corpo, { fundo: t.fundo, borda: t.borda, titulo: "Kodecz: video as a web page" });
}

// O que a página pode usar: os logos, um por peça, entrando um depois do outro.
function tecnologias(t) {
  const lista = ["html5", "css", "javascript", "typescript", "react", "webgl", "threedotjs", "greensock", "svg"];
  const lado = 84, W = 1200, H = 140, vao = (W - 88 - lado * lista.length) / (lista.length - 1);
  const corpo = lista.map((n, i) => peca(t, 44 + i * (lado + vao), 28, lado, n, "", { atraso: 0.08 * i })).join("\n");
  return svg(W, H, corpo, { fundo: t.fundo, borda: t.borda, css: ENTRADA, titulo: "HTML, CSS, JavaScript, TypeScript, React, WebGL, three.js, GSAP and SVG" });
}

// O caminho do quadro nas duas pistas, só com peças: página → Chromium → quadro → codificador → MP4.
function caminhoDoQuadro(t) {
  const W = 1200, H = 380, lado = 92, x0 = 150;
  const pistas = [
    { y: 44, marca: "nvidia", pecas: [["file-code", "Page"], ["browser", "Chromium"], ["zap", "Texture"], ["nvidia", "NVENC"], ["play", "MP4"]] },
    { y: 216, marca: "cpu", pecas: [["file-code", "Page"], ["browser", "Chromium"], ["image", "Raw frame"], ["cpu", "x264"], ["play", "MP4"]] },
  ];
  const vao = (W - x0 - 44 - lado * 5) / 4, cx = (i) => x0 + i * (lado + vao), dist = cx(4) - cx(0);
  const corpo = pistas.map((p, pi) => {
    const meio = p.y + lado / 2;
    const linha = `<line x1="${cx(0) + lado}" y1="${meio}" x2="${cx(4)}" y2="${meio}" stroke="${t.azul}" stroke-width="2.5" stroke-dasharray="2 7" stroke-linecap="round"/>`;
    const quadros = [0, 1, 2].map((k) => `<rect style="animation:anda ${pi ? 5.4 : 3.6}s linear ${-(pi ? 1.8 : 1.2) * k}s infinite" x="${cx(0) + lado / 2 - 9}" y="${meio - 7}" width="18" height="14" rx="3" fill="${t.azul}"/>`).join("\n");
    const pecas = p.pecas.map(([ic, rot], i) => peca(t, cx(i), p.y, lado, ic, rot, { forte: i === 2, atraso: 0.1 * i + 0.3 * pi })).join("\n");
    const marca = `${icone(p.marca, 44, meio - 34, 56, t.fraco)}<text x="72" y="${meio + 50}" text-anchor="middle" class="g" font-size="20" font-weight="800" fill="${t.sec}" letter-spacing="-.4">${p.marca === "nvidia" ? "GPU" : "CPU"}</text>`;
    return `${marca}\n${linha}\n${quadros}\n${pecas}`;
  }).join("\n");
  const css = `${ENTRADA}
@keyframes anda{0%{transform:translateX(0);opacity:0}10%{opacity:1}90%{opacity:1}100%{transform:translateX(${f(dist)}px);opacity:0}}`;
  return svg(W, H, corpo, { fundo: t.fundo, borda: t.borda, css, titulo: "With an NVIDIA GPU: page, Chromium, texture, NVENC, MP4. On the CPU: page, Chromium, raw frame, x264, MP4." });
}

// Os números sem texto: cada segundo é um quadradinho. A fila do Remotion (com o logo dele) e a do Kodecz (com a
// fita) acendem no mesmo ritmo, um segundo por vez, e a do Kodecz acaba muito antes. O ícone diz a medida (CPU ou
// relógio) e o ganho fica grande à direita.
function logoRemotion(x, y, alto) {
  const m = ICONES.marcas.remotion, k = alto / m.viewBox[1];
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${Math.round(k * 10000) / 10000})">${m.caminhos
    .map((c) => `<path d="${c.d}" fill="${c.cor}" fill-opacity="${c.op}"/>`).join("")}</g>`;
}
function numeros(t) {
  const W = 1200, H = 320, x0 = 44, lado = 11, passo = 14, xq = 300, ritmo = 0.07, ciclo = 6;
  const grupos = [
    { icone: "cpu", y: 46, remotion: 37.7, kodecz: 2.0, ganho: "19×" },
    { icone: "clock", y: 186, remotion: 9.9, kodecz: 2.7, ganho: "3.7×" },
  ];
  const fila = (v, y, cor) => {
    const inteiros = Math.floor(v), resto = v - inteiros, q = [];
    for (let i = 0; i < Math.ceil(v); i++) {
      const w = i < inteiros ? lado : Math.max(2, lado * resto);
      q.push(`<rect class="seg" style="animation-delay:${f(i * ritmo)}s" x="${xq + i * passo}" y="${y}" width="${f(w)}" height="${lado}" rx="2.5" fill="${cor}"/>`);
    }
    return q.join("") + `<text x="${xq + Math.ceil(v) * passo + 8}" y="${y + lado - 1}" class="m" font-size="13" fill="${t.fraco}">${v.toFixed(1)}s</text>`;
  };
  const corpo = grupos.map((g) => {
    const yR = g.y + 8, yK = g.y + 56;
    return `${icone(g.icone, x0, g.y + 8, 46, t.sec)}
<text x="${x0 + 23}" y="${g.y + 80}" text-anchor="middle" class="g" font-size="20" font-weight="800" fill="${t.sec}" letter-spacing="-.4">${g.icone === "cpu" ? "CPU" : "Time"}</text>
${logoRemotion(134, yR - 10, 32)}
<text x="174" y="${yR + 11}" class="g" font-size="23" font-weight="800" fill="${t.sec}" letter-spacing="-.5">Remotion</text>
${fila(g.remotion, yR, t.fraco)}
${fita(152, yK + 6, 36, t.azul, { quadros: 1, traco: 1.1, linhas: 8 })}
<text x="180" y="${yK + 12}" class="g" font-size="23" font-weight="800" fill="${t.tinta}" letter-spacing="-.5">Kodecz</text>
${fila(g.kodecz, yK, t.azul)}
<text x="${W - 44}" y="${g.y + 72}" text-anchor="end" class="g" font-size="96" font-weight="800" fill="${t.azul}" letter-spacing="-4">${g.ganho}</text>`;
  }).join("\n");
  const css = `.seg{animation:seg ${ciclo}s linear infinite both}
@keyframes seg{0%{opacity:.18}3%{opacity:1}88%{opacity:1}96%{opacity:.18}100%{opacity:.18}}`;
  return svg(W, H, corpo, { fundo: t.fundo, borda: t.borda, css, titulo: "One square per second. CPU time: Remotion 37.7 s, Kodecz 2.0 s, 19 times less. Wall time: Remotion 9.9 s, Kodecz 2.7 s, 3.7 times faster." });
}

// O ciclo do agente (escrever, ver, conferir, corrigir), sem texto: quatro peças em volta da fita, setas no sentido
// do ciclo e um ponto que dá a volta acendendo cada peça quando passa por ela. Só transform e opacity, para andar
// em navegador fraco e com «menos movimento» ligado; a fita do meio é leve (poucas linhas e quadros).
function agentes(t) {
  const W = 1200, H = 440, cx = W / 2, cy = H / 2, r = 150, lado = 84, ciclo = 6;
  const passos = [["code-square", -90], ["eye", 0], ["check-circle", 90], ["paintbrush", 180]];
  const pos = (ang, raio = r) => [cx + raio * Math.cos((ang * Math.PI) / 180), cy + raio * Math.sin((ang * Math.PI) / 180)];
  const anel = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${t.borda}" stroke-width="2"/>`;
  // Setas no meio de cada trecho, apontando no sentido horário.
  const setas = [-45, 45, 135, 225].map((ang) => {
    const [x, y] = pos(ang);
    return `<path transform="translate(${f(x)} ${f(y)}) rotate(${ang + 90})" d="M-7 -8 L5 0 L-7 8" fill="none" stroke="${t.azul}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
  // O ponto que dá a volta, começando no alto (peça 0).
  const ponto = `<g class="gira"><circle cx="${cx}" cy="${cy - r}" r="9" fill="${t.azul}"/></g>`;
  // Cada peça: a normal por baixo e a acesa (azul cheio, ícone branco) por cima, que acende quando o ponto chega.
  const pecas = passos.map(([ic, ang], i) => {
    const [px, py] = pos(ang), x = px - lado / 2, y = py - lado / 2;
    const acesa = `<g class="acende" style="animation-delay:${f(i * (ciclo / 4) - 0.35)}s">
<rect x="${f(x)}" y="${f(y)}" width="${lado}" height="${lado}" rx="${lado * 0.24}" fill="${t.azul}"/>
${icone(ic, x + lado * 0.25, y + lado * 0.25, lado * 0.5, "#ffffff")}</g>`;
    return peca(t, x, y, lado, ic, "", { atraso: 0.12 * i }) + acesa;
  }).join("\n");
  const css = `${ENTRADA}
.gira{transform-origin:${cx}px ${cy}px;animation:gira ${ciclo}s linear infinite}
@keyframes gira{to{transform:rotate(360deg)}}
.acende{opacity:0;animation:acende ${ciclo}s linear infinite}
@keyframes acende{0%{opacity:0}4%{opacity:1}18%{opacity:1}26%{opacity:0}100%{opacity:0}}`;
  const centro = fita(cx, cy, 120, t.azul, { quadros: 10, linhas: 8, trecho: 16, traco: 1.4 });
  return svg(W, H, `${anel}\n${setas}\n${ponto}\n${centro}\n${pecas}`, { fundo: t.fundo, borda: t.borda, css, titulo: "The agent loop: write, preview, check, fix, and around again" });
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
  arquivos[`tecnologias-${nome}.svg`] = tecnologias(t);
  arquivos[`agentes-${nome}.svg`] = agentes(t);
  arquivos[`logo-nome-${nome}.svg`] = logoComNome(t);
  arquivos[`logo-nome-animada-${nome}.svg`] = logoComNome(t, { animada: true });
}
arquivos["logo.svg"] = logo(TEMAS.claro.azul);
arquivos["logo-animada.svg"] = logo(TEMAS.claro.azul, { animada: true });
arquivos["logo-azul.svg"] = logo(AZUL_MARCA.tinta, { fundo: AZUL_MARCA.fundo });
for (const [nome, conteudo] of Object.entries(arquivos)) writeFileSync(join(saida, nome), conteudo);
console.log(Object.entries(arquivos).map(([n, c]) => `${n}  ${(c.length / 1024).toFixed(0)} KB`).join("\n"));
