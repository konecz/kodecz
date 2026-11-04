// S02: o formato Kodecz de cada bloco (metadados, seções, conferência, índice), o que é proibido nos blocos (relógio,
// GSAP, SMIL, motor_quadro, hex solto) e um teste por bloco do que é checável no DOM, no quadro N posto como no motor
// (conferir-dom.ts): o exemplo sem achados, os valores nos quadros da borda e o exemplo errado acusado.
// Rodar: node --test blocos/blocos.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analisarYaml, lerDesignMd, paraCss } from "../identidade/design-md.ts";
import { CAMINHOS } from "../cli/regras.ts";
import { BLOCOS, blocosDaPagina, conferirPagina, familiasDaMarca, fontesQueFaltam, type Resultado } from "./conferir-dom.ts";

const NOMES = readdirSync(BLOCOS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(BLOCOS, d.name, "KODECZ.md"))).map((d) => d.name).sort();
const ler = (...p: string[]) => readFileSync(join(BLOCOS, ...p), "utf8");
const SECOES = ["O que é", "Por quê", "Como aplicar", "Bloco", "Conferência", "Erros comuns", "Exemplos"];
const CAMPOS = ["name", "description", "id", "versao", "estado", "regras", "quando", "entradas", "saidas", "custo",
  "conferencia", "origem", "license"];

function kodecz(nome: string) {
  const texto = ler(nome, "KODECZ.md");
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(texto);
  assert.ok(m, `${nome}: KODECZ.md sem frontmatter`);
  return { meta: analisarYaml(m[1], 2) as Record<string, any>, corpo: m[2] };
}

test("há de 8 a 40 blocos, e o índice lista cada um uma vez com o id do KODECZ.md", () => {
  assert.ok(NOMES.length >= 8 && NOMES.length <= 40, `${NOMES.length} blocos`);
  const indice = ler("INDICE.md");
  for (const nome of NOMES) {
    const { meta } = kodecz(nome);
    const linhas = indice.split("\n").filter((l) => l.includes(`(${nome}/KODECZ.md)`));
    assert.equal(linhas.length, 1, `${nome} no INDICE.md`);
    assert.ok(linhas[0].includes(`[${meta.id} ${nome}]`), `${nome}: id ${meta.id} no índice`);
  }
});

test("KODECZ.md: metadados obrigatórios, ids únicos, seções na ordem e conferência igual ao conferencia.json", () => {
  const ids = new Set<string>();
  for (const nome of NOMES) {
    const { meta, corpo } = kodecz(nome);
    for (const c of CAMPOS) assert.ok(meta[c] !== undefined, `${nome}: falta ${c}`);
    assert.equal(meta.name, nome);
    assert.match(meta.id, /^H\d\d$/, `${nome}: id`);
    assert.ok(!ids.has(meta.id), `${nome}: id ${meta.id} repetido`);
    ids.add(meta.id);
    assert.ok(meta.description.length <= 1024);
    assert.equal(meta.license, "Proprietária");
    assert.ok(["proposta", "em-uso", "aposentada"].includes(meta.estado));
    for (const g of meta.regras) assert.match(g, /^G\d\d$/, `${nome}: regra ${g}`);
    const titulos = [...corpo.matchAll(/^## (.+)$/gm)].map((x) => x[1]);
    assert.deepEqual(titulos, SECOES, `${nome}: seções`);
    const arquivo = join(BLOCOS, nome, "conferencia.json");
    const ch = existsSync(arquivo) ? JSON.parse(readFileSync(arquivo, "utf8")).checagens.map((c: any) => c.id) : [];
    assert.deepEqual(meta.conferencia, ch, `${nome}: conferencia do KODECZ.md × conferencia.json`);
    for (const f of ["bloco.css", "bloco.html", "exemplo.html"]) assert.ok(existsSync(join(BLOCOS, nome, f)), `${nome}/${f}`);
    assert.ok(blocosDaPagina(ler(nome, "bloco.html")).includes(nome), `${nome}: bloco.html sem data-bloco="${nome}"`);
    assert.ok(blocosDaPagina(ler(nome, "exemplo.html")).includes(nome), `${nome}: exemplo.html sem data-bloco="${nome}"`);
  }
});

test("conferencia.json: prioridade, momento e medida conhecidos, mensagem no jeito t=… · onde · problema → mudança", () => {
  const momentos = ["visivel", "visivel-parado", "todos", "inicio", "fim", "fim-da-transicao", "fim-do-bloco"];
  const medidas = ["linhas", "transborda", "fora-da-margem", "visiveis", "inteira", "escala", "fim-menos-inicio",
    "distancia-do-alvo", "opacidade"];
  for (const nome of NOMES) {
    const arquivo = join(BLOCOS, nome, "conferencia.json");
    if (!existsSync(arquivo)) continue;
    const j = JSON.parse(readFileSync(arquivo, "utf8"));
    assert.equal(j.bloco, nome);
    for (const c of j.checagens) {
      assert.match(c.id, /^[a-z-]+\.[a-z-]+$/);
      assert.ok(["P0", "P1"].includes(c.prioridade), c.id);
      assert.ok(momentos.includes(c.quando), `${c.id}: quando ${c.quando}`);
      assert.ok(medidas.includes(c.medida), `${c.id}: medida ${c.medida}`);
      assert.ok(c.maximo !== undefined || c.minimo !== undefined, `${c.id}: sem limite`);
      assert.match(c.mensagem, /\{onde\} · .+ → .+/, `${c.id}: mensagem`);
    }
  }
});

test("blocos só com animação declarada e tokens: sem relógio, GSAP, SMIL, kodecz_frame, imagem animada nem hex solto", () => {
  const proibidos: [RegExp, string][] = [
    [/requestAnimationFrame|setTimeout|setInterval|Date\.now|performance\.now|Math\.random/, "relógio ou sorteio (R03)"],
    [/gsap|TweenMax|ScrollTrigger/i, "GSAP (licença incompatível com a Apache-2.0)"],
    [/<animate|<set\b|animateTransform|animateMotion/, "SVG SMIL (desliga o quadro repetido)"],
    [/motor_quadro|kodecz_frame/, "kodecz_frame ou motor_quadro (desliga o quadro repetido)"],
    [/\.(gif|png|webp|apng)\b/i, "imagem que pode ser animada"],
    [/box-shadow/, "sombra (varia entre renders, R03)"],
    [/https?:\/\//, "rede"],
  ];
  const arquivos = ["index.html", "grafico-linha/bloco.js", ...NOMES.flatMap((n) => readdirSync(join(BLOCOS, n))
    .filter((f) => /\.(css|html|js)$/.test(f)).map((f) => `${n}/${f}`))];
  for (const a of arquivos) {
    // Comentários não contam (o texto pode citar o que é proibido).
    const codigo = ler(a).replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const [re, motivo] of proibidos) assert.doesNotMatch(codigo, re, `${a}: ${motivo}`);
    if (a.endsWith("bloco.css")) {
      assert.doesNotMatch(codigo, /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|:\s*(white|black)\b/, `${a}: cor solta (só var(--color-…))`);
      for (const f of codigo.matchAll(/font-family:\s*([^;]+)/g)) assert.match(f[1], /^var\(--font-/, `${a}: fonte solta (só var(--font-…))`);
    }
  }
});

test("marca/marca.css é o CSS do marca/DESIGN.md (S03)", () => {
  const r = lerDesignMd(join(BLOCOS, "marca", "DESIGN.md"));
  assert.ok(r.ok, JSON.stringify(r.erros));
  assert.equal(ler("marca", "marca.css"), paraCss(r.tokens!));
});

// --- DOM, no quadro N (CEF na CPU) -------------------------------------------------------------------
const semCef = existsSync(CAMINHOS.hostCef) ? false : `falta ${CAMINHOS.hostCef} (captura/cef/montar.sh)`;
// As medidas de texto (linhas, transborda, zona segura) só valem com as fontes da marca: com outra no lugar, o teste
// passaria ou falharia por acaso. Sem elas no sistema (fc-match), os testes de DOM são pulados com o motivo.
const faltam = fontesQueFaltam(familiasDaMarca(ler("marca", "marca.css")));
const semDom = semCef || (faltam.length ? `faltam no sistema as fontes da marca dos blocos (${faltam.join(", ")}): as medidas de texto não valeriam` : false);
const exemplo = (nome: string, medir: [number, string, string][] = [], pagina = "exemplo.html") =>
  conferirPagina(BLOCOS, `${nome}/${pagina}`, { medir });
const m = (r: Resultado, n: number, sel: string, prop: string) => r.medidas![`${n} ${sel} ${prop}`];
const semAchados = (r: Resultado) => assert.deepEqual(r.achados.map((a) => a.mensagem), []);
/** clip-path inset sem recorte (inset(0px), inset(0px 0% 0px 0px)…) vira "aberto". */
const aberto = (c: string) => (/^inset\((0(px|%)?\s*)+\)$/.test(c) ? "aberto" : c);
const COR = { ink: "rgb(245, 243, 238)", accent: "rgb(255, 182, 72)", muted: "rgb(159, 176, 216)" };

test("cena: corte seco exato no quadro (29 e 30, 59 e 60), uma cena por vez", { skip: semDom }, async () => {
  const ps: [number, string, string][] = [29, 30, 59, 60].flatMap((n) => ["#a", "#b", "#c"].map((s) => [n, s, "opacity"] as [number, string, string]));
  const r = await exemplo("cena", ps);
  semAchados(r);
  const op = (n: number) => ["#a", "#b", "#c"].map((s) => m(r, n, s, "opacity")[0]);
  assert.deepEqual([op(29), op(30), op(59), op(60)], [["1", "0", "0"], ["0", "1", "0"], ["0", "1", "0"], ["0", "0", "1"]]);
});

test("transicao-fade: opacidade 0 no quadro da troca, no meio e 1 no fim", { skip: semDom }, async () => {
  const r = await exemplo("transicao-fade", [[29, ".kz-fade", "opacity"], [30, ".kz-fade", "opacity"], [37, ".kz-fade", "opacity"], [45, ".kz-fade", "opacity"]]);
  semAchados(r);
  const v = [29, 30, 37, 45].map((n) => Number(m(r, n, ".kz-fade", "opacity")[0]));
  assert.deepEqual([v[0], v[1], v[3]], [0, 0, 1]);
  assert.ok(Math.abs(v[2] - 7 / 15) < 0.01, `meio do fade: ${v[2]}`);
});

test("transicao-wipe: recorte fechado na troca e aberto no fim, nos dois lados", { skip: semDom }, async () => {
  const r = await exemplo("transicao-wipe", [[20, ".kz-wipe", "clip-path"], [35, ".kz-wipe", "clip-path"], [50, ".kz-wipe", "clip-path"]]);
  semAchados(r);
  assert.equal(m(r, 20, ".kz-wipe", "clip-path")[0], "inset(0px 100% 0px 0px)");
  assert.equal(aberto(m(r, 35, ".kz-wipe", "clip-path")[0] as string), "aberto");
  assert.equal(m(r, 50, ".kz-wipe", "clip-path")[1], "inset(100% 0px 0px)");
});

test("transicao-deslizar: as duas cenas andam juntas e a nova termina no lugar", { skip: semDom }, async () => {
  const sel = [".kz-desliza-sai", ".kz-desliza-entra"];
  const r = await exemplo("transicao-deslizar", [30, 37, 45].flatMap((n) => sel.map((s) => [n, s, "caixa"] as [number, string, string])));
  semAchados(r);
  const x = (n: number, s: string) => (m(r, n, s, "caixa")[0] as any).left;
  assert.deepEqual([x(30, sel[0]), x(30, sel[1]), x(45, sel[1])], [0, 1920, 0]);
  assert.ok(Math.abs(x(37, sel[1]) - x(37, sel[0]) - 1920) < 1, "as duas cenas encostadas no meio do deslize");
  assert.equal(x(45, sel[0]), -1920);
});

test("legenda-uma-linha: frases numa linha, uma por vez, a palavra dita em accent; o exemplo errado é acusado", { skip: semDom }, async () => {
  const r = await exemplo("legenda-uma-linha", [[9, ".kz-legenda", "opacity"], [10, ".kz-legenda", "opacity"], [59, ".kz-legenda", "opacity"],
    [60, ".kz-legenda", "opacity"], [110, ".kz-legenda", "opacity"], [35, ".kz-palavra", "color"]]);
  semAchados(r);
  assert.deepEqual([9, 10, 59, 60, 110].map((n) => m(r, n, ".kz-legenda", "opacity")), [["0", "0"], ["1", "0"], ["1", "0"], ["0", "1"], ["0", "0"]]);
  // Quadro 35: «Cada» e «frase» já ditas, «cabe» agora, o resto ainda não.
  assert.deepEqual(m(r, 35, ".kz-palavra", "color").slice(0, 4), [COR.ink, COR.ink, COR.accent, COR.muted]);
  const e = await exemplo("legenda-uma-linha", [], "exemplo-errado.html");
  const ids = new Set(e.achados.map((a) => a.id));
  assert.ok(ids.has("legenda.uma-linha") && ids.has("legenda.uma-por-vez"), [...ids].join(", "));
  const quebra = e.achados.find((a) => a.id === "legenda.uma-linha")!;
  assert.equal(quebra.prioridade, "P0");
  assert.match(quebra.mensagem, /^t=0,33 · \.kz-legenda · a frase quebrou em 2 linhas → /);
  assert.deepEqual([...new Set(e.achados.filter((a) => a.id === "legenda.uma-por-vez").map((a) => a.quadro))],
    Array.from({ length: 10 }, (_, k) => 50 + k), "duas frases do 50 ao 59");
});

// G17 (e a pendência do caso de teste, que cortava em 5 palavras fixas): toda pontuação fecha a frase da legenda, e a
// frase não acaba em artigo, preposição ou conjunção. Lido do texto das páginas certas, sem Electron.
test("legenda-uma-linha: nos exemplos certos, a pontuação só no fim da frase e nada de palavra fraca no fim (G17)", () => {
  const FRACAS = new Set(["o", "a", "os", "as", "um", "uma", "de", "do", "da", "dos", "das", "em", "no", "na", "nos",
    "nas", "num", "numa", "ao", "aos", "à", "às", "pelo", "pela", "pelos", "pelas", "por", "para", "com", "sem", "e", "ou",
    "mas", "nem", "que", "se"]);
  for (const arquivo of ["legenda-uma-linha/exemplo.html", "legenda-uma-linha/bloco.html", "index.html"]) {
    const frases = [...ler(arquivo).matchAll(/<p class="kz-legenda[ "][^>]*>([\s\S]*?)<\/p>/g)]
      .map((x) => x[1].replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean));
    assert.ok(frases.length >= 2, `${arquivo}: ${frases.length} frases`);
    for (const f of frases) {
      const texto = f.join(" ");
      f.slice(0, -1).forEach((p) => assert.doesNotMatch(p, /[.,:;!?]$/, `${arquivo}: «${texto}» segue depois da pontuação`));
      assert.ok(!FRACAS.has(f[f.length - 1].toLowerCase()), `${arquivo}: «${texto}» acaba em palavra fraca`);
    }
  }
});

test("titulo-entrada: o título entra no --inicio, o subtítulo 6 quadros depois, e saem até o --fim", { skip: semDom }, async () => {
  const sel = [".kz-titulo-principal", ".kz-titulo-sub"];
  const r = await exemplo("titulo-entrada", [6, 12, 40, 80].flatMap((n) => sel.map((s) => [n, s, "opacity"] as [number, string, string])));
  semAchados(r);
  const op = (n: number) => sel.map((s) => Number(m(r, n, s, "opacity")[0]));
  assert.deepEqual(op(6), [0, 0]);
  assert.ok(op(12)[0] > 0.5 && op(12)[1] === 0, `quadro 12: ${op(12)}`);
  assert.deepEqual(op(40), [1, 1]);
  assert.ok(op(80).every((o) => o < 0.001), `quadro 80: ${op(80)}`);
});

test("cartela: abre do meio, chamada numa linha; a chamada longa é acusada fora da zona segura", { skip: semDom }, async () => {
  const r = await exemplo("cartela", [[3, ".kz-cartela", "clip-path"], [40, ".kz-cartela", "clip-path"]]);
  semAchados(r);
  assert.deepEqual([3, 40].map((n) => aberto(m(r, n, ".kz-cartela", "clip-path")[0] as string)), ["inset(50% 0px)", "aberto"]);
  const e = await exemplo("cartela", [], "exemplo-errado.html");
  assert.ok(e.achados.some((a) => a.id === "cartela.zona-segura" && a.prioridade === "P0"), JSON.stringify(e.achados.slice(0, 2)));
});

test("terco-inferior: revela e recolhe; junto com a legenda é acusado (G16)", { skip: semDom }, async () => {
  const r = await exemplo("terco-inferior", [[10, ".kz-terco", "clip-path"], [40, ".kz-terco", "clip-path"], [70, ".kz-terco", "clip-path"]]);
  semAchados(r);
  assert.deepEqual([10, 40, 70].map((n) => aberto(m(r, n, ".kz-terco", "clip-path")[0] as string)),
    ["inset(0px 100% 0px 0px)", "aberto", "inset(0px 100% 0px 0px)"]);
  const e = await exemplo("terco-inferior", [], "exemplo-errado.html");
  const juntos = [...new Set(e.achados.filter((a) => a.id === "terco.sem-legenda").map((a) => a.quadro))];
  assert.equal(juntos[0], 40);
  assert.ok(juntos.length >= 15 && juntos.every((n) => n < 60), `quadros com os dois: ${juntos}`);
});

test("zoom-ate-o-fim-da-frase: escala 1 antes da ênfase, 1,15 até a pausa e 1 de novo depois da saída", { skip: semDom }, async () => {
  const r = await exemplo("zoom-ate-o-fim-da-frase", [19, 20, 26, 50, 62].map((n) => [n, ".kz-zoom", "transform"] as [number, string, string]));
  semAchados(r);
  const escala = (n: number) => { const t = m(r, n, ".kz-zoom", "transform")[0] as string;
    return t === "none" ? 1 : Number(/^matrix\(([^,]+),/.exec(t)![1]); };
  assert.deepEqual([19, 20, 26, 50, 62].map(escala), [1, 1, 1.15, 1.15, 1]);
});

test("grafico-barras: as barras crescem em degraus e cada número chega ao valor", { skip: semDom }, async () => {
  const r = await exemplo("grafico-barras", [[10, ".kz-barra-num", "--kz-valor"], [22, ".kz-barra-num", "--kz-valor"], [59, ".kz-barra-num", "--kz-valor"]]);
  semAchados(r);
  assert.deepEqual(m(r, 10, ".kz-barra-num", "--kz-valor"), ["0", "0", "0", "0"]);
  const meio = m(r, 22, ".kz-barra-num", "--kz-valor").map(Number);
  assert.ok(meio[0] > meio[3] && meio[3] === 0 && meio[0] > 0 && meio[0] < 25, `quadro 22: ${meio}`);
  assert.deepEqual(m(r, 59, ".kz-barra-num", "--kz-valor"), ["25", "47", "64", "81"]);
});

test("grafico-linha: o traço se desenha em 45 quadros e o número conta do primeiro ao último valor", { skip: semDom }, async () => {
  const r = await exemplo("grafico-linha", [[10, ".kz-linha-traco", "stroke-dashoffset"], [55, ".kz-linha-traco", "stroke-dashoffset"],
    [10, ".kz-linha-num", "--kz-valor"], [55, ".kz-linha-num", "--kz-valor"], [10, ".kz-linha-ponto", "transform"]]);
  semAchados(r);
  assert.deepEqual([m(r, 10, ".kz-linha-traco", "stroke-dashoffset")[0], m(r, 55, ".kz-linha-traco", "stroke-dashoffset")[0]], ["1px", "0px"]);
  assert.deepEqual([m(r, 10, ".kz-linha-num", "--kz-valor")[0], m(r, 55, ".kz-linha-num", "--kz-valor")[0]], ["12", "41"]);
  assert.equal(m(r, 10, ".kz-linha-ponto", "transform").length, 7, "sete pontos montados pelo bloco.js");
});

test("contagem: conta até 312 no --fim e a regressiva mostra 3, 2 e 1, um por segundo", { skip: semDom }, async () => {
  const r = await exemplo("contagem", [5, 45, 10, 39, 40, 69, 70, 99].map((n) => [n, ".kz-contagem-num", "--kz-valor"] as [number, string, string]));
  semAchados(r);
  const v = (n: number, k: number) => Number(m(r, n, ".kz-contagem-num", "--kz-valor")[k]);
  assert.deepEqual([v(5, 0), v(45, 0)], [0, 312]);
  assert.deepEqual([10, 39, 40, 69, 70, 99].map((n) => v(n, 1)), [3, 3, 2, 2, 1, 1]);
});

test("pagina.qps: --fps (ou o antigo --qps) da raiz diferente do declarado é acusado (P0)", { skip: semCef }, async () => {
  const pasta = mkdtempSync(join(tmpdir(), "blocos-qps-"));
  try {
    // Os nomes antigos (bloco motor-video, qps e --qps) continuam lidos.
    writeFileSync(join(pasta, "index.html"), `<!doctype html><script type="application/json" id="motor-video">
{ "id": "Q", "largura": 800, "altura": 450, "qps": 30, "quadros": 2 }</script><style>:root { --qps: 25; }</style>`);
    const r = await conferirPagina(pasta, "index.html", { checagens: [] });
    assert.deepEqual(r.achados.map((a) => [a.id, a.prioridade, a.valor]), [["pagina.qps", "P0", 25]]);
    writeFileSync(join(pasta, "index.html"), `<!doctype html><script type="application/json" id="kodecz">
{ "id": "Q", "width": 800, "height": 450, "fps": 30, "frames": 2 }</script><style>:root { --fps: 25; }</style>`);
    const s = await conferirPagina(pasta, "index.html", { checagens: [] });
    assert.deepEqual(s.achados.map((a) => [a.id, a.prioridade, a.valor]), [["pagina.qps", "P0", 25]]);
    writeFileSync(join(pasta, "index.html"), `<!doctype html><script type="application/json" id="kodecz">
{ "id": "Q", "width": 800, "height": 450, "fps": 30, "frames": 2 }</script><style>:root { --fps: 30; }</style>`);
    assert.deepEqual((await conferirPagina(pasta, "index.html", { checagens: [] })).achados, []);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test("demonstração: todos os blocos, nenhum achado em nenhum dos 720 quadros", { skip: semDom }, async () => {
  const usados = blocosDaPagina(ler("index.html"));
  assert.deepEqual([...usados].sort(), NOMES, "a demonstração usa todos os blocos");
  const r = await conferirPagina(BLOCOS, "index.html");
  assert.equal(r.quadros, 720);
  semAchados(r);
});

// --- Regressões da revisão do S02 ------------------------------------------------------------------------------
/**
 * Página sintética numa pasta temporária (servida como raiz), com a marca e o CSS dos `blocos` copiados ao lado. As
 * checagens são as dos blocos do `corpo` (data-bloco), salvo `opcoes.checagens`.
 */
async function sintetica(blocos: string[], corpo: string, quadros: number, opcoes: Parameters<typeof conferirPagina>[2] = {},
  estilo = "") {
  const pasta = mkdtempSync(join(tmpdir(), "blocos-sint-"));
  try {
    const css = ["marca/marca.css", ...blocos.map((b) => `${b}/bloco.css`)];
    for (const c of css) writeFileSync(join(pasta, c.replace("/", "-")), ler(c));
    writeFileSync(join(pasta, "index.html"), `<!doctype html><meta charset="utf-8">
<script type="application/json" id="kodecz">{ "id": "S", "width": 1920, "height": 1080, "fps": 30, "frames": ${quadros} }</script>
${css.map((c) => `<link rel="stylesheet" href="${c.replace("/", "-")}">`).join("\n")}
<style>:root { --fps: 30; } html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; } ${estilo}</style>
${corpo}`);
    return await conferirPagina(pasta, "index.html", opcoes);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}
const PLANO = `<div style="position: absolute; inset: 0; background: var(--color-surface)"></div>`;

test("fim-do-bloco: o zoom ainda fechado no corte da cena é acusado no último quadro dela", { skip: semCef }, async () => {
  const zoom = (fim: number) => `<section class="kz-cena" data-bloco="cena" style="--inicio: 0; --fim: 30">
    <div class="kz-zoom" data-bloco="zoom-ate-o-fim-da-frase" style="--inicio: 5; --fim: ${fim}">${PLANO}</div></section>`;
  const r = await sintetica(["cena", "zoom-ate-o-fim-da-frase"], zoom(20), 60);
  assert.deepEqual(r.achados.map((a) => [a.id, a.quadro]), [["zoom.volta", 29]]);
  assert.match(r.achados[0].mensagem, /^t=0,97 · \.kz-zoom · /);
  semAchados(await sintetica(["cena", "zoom-ate-o-fim-da-frase"], zoom(10), 60));
});

test("fim-do-bloco: as barras cortadas antes de o número chegar ao valor são acusadas", { skip: semCef }, async () => {
  const barras = (inicio: number) => `<section class="kz-cena" data-bloco="cena" style="--inicio: 0; --fim: 30">
    <div class="kz-barras" data-bloco="grafico-barras" style="--inicio: ${inicio}; --maximo: 100">
    <div class="kz-barra" style="--valor: 42; --ordem: 0"><i class="kz-barra-coluna"></i><b class="kz-barra-num" data-valor="42"></b><i class="kz-barra-rotulo">jan</i></div>
    </div></section>`;
  const r = await sintetica(["cena", "grafico-barras"], barras(15), 60);
  assert.deepEqual(r.achados.map((a) => [a.id, a.quadro]), [["barras.chega-no-alvo", 29]]);
  semAchados(await sintetica(["cena", "grafico-barras"], barras(0), 60));
});

test("pagina.animacao: bloco sem --fim fora de uma cena (animação inválida) é acusado", { skip: semCef }, async () => {
  const titulo = (estilo: string) => `<div class="kz-titulo" data-bloco="titulo-entrada" style="${estilo}">
    <h1 class="kz-titulo-principal">Título</h1></div>`;
  const r = await sintetica(["titulo-entrada"], titulo("--inicio: 3"), 30);
  const a = r.achados.filter((x) => x.id === "pagina.animacao");
  assert.equal(a.length, 1, JSON.stringify(r.achados));
  assert.equal(a[0].prioridade, "P0");
  assert.match(a[0].mensagem, /^t=0,00 · \.kz-titulo-principal · .*titulo-entrada.*--fim.* → /);
  semAchados(await sintetica(["titulo-entrada"], titulo("--inicio: 3; --fim: 25"), 30));
});

const MARGEM = (margem: string) => [{ id: "t.margem", prioridade: "P0" as const, seletor: ".caixa", quando: "visivel",
  medida: "fora-da-margem", maximo: 0, margem, mensagem: "{onde} · fora → dentro" }];
const CAIXA = `<div class="caixa" style="position: absolute; left: 50px; top: 500px; width: 100px; height: 100px; background: var(--color-ink)"></div>`;

test("fora-da-margem: margem em vw e vh vira px do quadro; em % é recusada com mensagem", { skip: semCef }, async () => {
  const vw = await sintetica([], CAIXA, 1, { checagens: MARGEM("5vw") });
  assert.deepEqual(vw.achados.map((a) => a.valor), [46], "5vw de 1920 = 96 px; a caixa em 50 px passa 46");
  const token = await sintetica([], CAIXA, 1, { checagens: MARGEM("--m") }, ":root { --m: 10vh; }");
  assert.deepEqual(token.achados.map((a) => a.valor), [58], "10vh de 1080 = 108 px");
  const rem = await sintetica([], CAIXA, 1, { checagens: MARGEM("--m") }, ":root { --m: 4rem; font-size: 20px; }");
  assert.deepEqual(rem.achados.map((a) => a.valor), [30], "4rem com a raiz em 20 px = 80 px (o formato do DESIGN.md aceita rem)");
  await assert.rejects(sintetica([], CAIXA, 1, { checagens: MARGEM("--m") }, ":root { --m: 3%; }"), /margem.*3%.*px, rem, em, vw ou vh/);
});

test("recorte: circle, ellipse e polygon que fecham tudo escondem; os abertos não; path() é acusado como não conferido", { skip: semCef }, async () => {
  const c = (clip: string) => `<div class="c" style="position: absolute; inset: 0; background: var(--color-ink); clip-path: ${clip}"></div>`;
  const VISIVEIS = [{ id: "t.visiveis", prioridade: "P0" as const, seletor: ".c", quando: "todos", medida: "visiveis",
    minimo: 2, maximo: 2, mensagem: "{onde} · {valor} → 2" }];
  const r = await sintetica([], ["circle(0px)", "ellipse(0px 40% at 50% 50%)", "polygon(0px 0px, 100% 0px, 50% 0px)",
    "circle(30%)", "polygon(0px 0px, 100% 0px, 100% 100%)"].map(c).join(""), 1, { checagens: VISIVEIS });
  semAchados(r);
  const INTEIRA = [{ id: "t.inteira", prioridade: "P0" as const, seletor: ".c", quando: "visivel", medida: "inteira",
    maximo: 0, mensagem: "{onde} · {valor} → 0" }];
  const i = await sintetica([], ["circle(50%)", "circle(80% at 50% 50%)", "polygon(0px 0px, 100% 0px, 100% 100%, 0px 100%)"].map(c).join(""),
    1, { checagens: INTEIRA });
  assert.deepEqual(i.achados.map((a) => a.onde), [".c"], "o círculo de 50% não cobre os cantos; os outros cobrem");
  const p = await sintetica([], c("path('M0 0 L10 0 L10 10 Z')"), 2, { checagens: [] });
  assert.deepEqual(p.achados.map((a) => [a.id, a.prioridade]), [["pagina.recorte", "P1"]]);
  assert.match(p.achados[0].mensagem, /path\(.*não é conferido/);
});

test("estouro do tempo: o grupo do Electron morre inteiro, com os netos", async () => {
  const pasta = mkdtempSync(join(tmpdir(), "blocos-estouro-"));
  try {
    const falso = join(pasta, "electron");
    // Um «Electron» que abre um neto e não responde: o neto grava o pid dele e dorme.
    writeFileSync(falso, `#!/bin/sh\nsh -c 'echo $$ > "${pasta}/neto"; exec sleep 300' &\nsleep 300\n`, { mode: 0o755 });
    writeFileSync(join(pasta, "index.html"), `<script type="application/json" id="motor-video">{ "id": "E", "largura": 8, "altura": 8, "qps": 30, "quadros": 1 }</script>`);
    const t0 = performance.now();
    await assert.rejects(Promise.resolve().then(() => conferirPagina(pasta, "index.html", { checagens: [], electron: falso, limiteMs: 800 })),
      /estourou/);
    assert.ok(performance.now() - t0 < 10000, "voltou logo depois do limite");
    const neto = Number(readFileSync(join(pasta, "neto"), "utf8"));
    assert.ok(neto > 0);
    assert.throws(() => process.kill(neto, 0), "o neto do Electron morreu junto");
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test("sinal: SIGTERM no Node no meio da conferência mata o grupo do Electron, com os netos", async () => {
  const pasta = mkdtempSync(join(tmpdir(), "blocos-sinal-"));
  try {
    const falso = join(pasta, "electron");
    writeFileSync(falso, `#!/bin/sh\nsh -c 'echo $$ > "${pasta}/neto"; exec sleep 300' &\nsleep 300\n`, { mode: 0o755 });
    writeFileSync(join(pasta, "index.html"), `<script type="application/json" id="motor-video">{ "id": "E", "largura": 8, "altura": 8, "qps": 30, "quadros": 1 }</script>`);
    const codigo = `import { conferirPagina } from ${JSON.stringify(join(BLOCOS, "conferir-dom.ts"))};
      await conferirPagina(${JSON.stringify(pasta)}, "index.html", { checagens: [], electron: ${JSON.stringify(falso)}, limiteMs: 60000 });`;
    const node = spawn(process.execPath, ["--input-type=module", "-e", codigo], { stdio: "ignore" });
    const limite = performance.now() + 10000;
    while (!existsSync(join(pasta, "neto")) && performance.now() < limite) await new Promise((ok) => setTimeout(ok, 50));
    await new Promise((ok) => setTimeout(ok, 100));
    const neto = Number(readFileSync(join(pasta, "neto"), "utf8"));
    const saiu = new Promise<number | null>((ok) => node.on("exit", (c) => ok(c)));
    node.kill("SIGTERM");
    assert.equal(await saiu, 143);
    assert.throws(() => process.kill(neto, 0), "o neto do Electron morreu junto");
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

const semFcMatch = spawnSync("fc-match", ["--version"]).error ? "sem o fc-match (fontconfig)" : false;
test("fontes: a família que o fontconfig não acha aparece na lista das que faltam; as da marca são Inter e Lato", { skip: semFcMatch }, () => {
  const existe = execFileSync("fc-match", ["-f", "%{family[0]}", "sans-serif"], { encoding: "utf8" });
  assert.deepEqual(fontesQueFaltam(["Fonte Que Nao Existe Kz", existe]), ["Fonte Que Nao Existe Kz"]);
  assert.deepEqual(familiasDaMarca(ler("marca", "marca.css")), ["Inter", "Lato"]);
});
