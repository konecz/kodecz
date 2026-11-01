// Kodecz Bench (P12): os três motores de oráculo genéricos. A regra de cada classe é DADO (bench-gerador/
// especificacoes.json: medida, parâmetros, operador e limiar); aqui estão só as medidas, cada uma uma conta sobre a
// evidência (bench-gerador/evidencia.ts), reaproveitável entre classes:
//   estilo   — estilo calculado e fonte da página (coleta, sem render): contar elementos por condições, animações,
//              fontes, cores, hierarquia, padrões de texto, diff antes/depois;
//   geometria — caixas, opacidade, linhas, rosto e fala por quadro (a mesma coleta): rosto, zona segura, cortes ×
//              batida e × palavra, jump cut, legendas × fala, movimento por quadro, laço, tela vazia;
//   sinal    — pixel e som do MP4, memória do render, metadado do arquivo e da mídia rotulada.
// Uma medida devolve um número (ou null: não se aplica a esta entrega, «não conferível»); a regra compara com o limiar.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { audio, dimensoes, lumas, luminancia, quadrosRgb, rms, tom } from "../bench/analise.ts";
import { comMargem, interpolarRosto, intersecao, LIMITES, ocorrenciasDaLegenda, ocorrenciasDoZoom, ocorrenciasForaDaZona, ocorrenciasNoRosto,
  rostoNaTela as rostoDaAmostra, textosTremendo, zonaNaTela, type Caixa, type Fundo, type Geometria, type Nota, type Ocorrencia } from "../conferencia/regras.ts";
import type { Evidencia } from "./evidencia.ts";
import type { Regra } from "./mutacoes.ts";
import { lingua } from "./mundo.ts";

/** `ocorrencias`: as quebras uma a uma (trecho, pior quadro, caixa), para o relatório da conferência; cada uma com o
 * valor dela, comparado com o mesmo limite da regra. `notas`: avisos da medida além do limite. O bench lê só o valor. */
export type Valor = { valor: number | null; motivo: string; quadro?: number; ocorrencias?: Ocorrencia[]; notas?: Nota[] };
export type Resultado = { status: "erro" | "certo" | "nao-conferivel"; motivo: string; quadro?: number; valor?: number | null;
  ocorrencias?: Ocorrencia[]; notas?: Nota[] };
export type Medida = {
  motor: "estilo" | "geometria" | "sinal";
  /** O que a medida precisa além da coleta. */
  precisa?: { render?: boolean; memoria?: boolean; duas?: boolean; antes?: boolean };
  descricao: string;
  f(ev: Evidencia, p: any): Valor;
};

// ——— Ajudas ———

type Item = { k: number; id: string | null; tag: string; papel: string | null; pai: string | null; texto: string; fs: number; fw: number; ff: string; ls: number; tt: string;
  cor: string; fundo: string; bgimg: string | null; sombra: string | null; tsombra: string | null; filtro: string | null; bfiltro: string | null; raio: number;
  transf: string | null; alinh: string; dir: string; borda: string | null; deco: string | null; transicao: string | null; overflow: string;
  nat?: number[]; linhas?: { t: string; y: number; b: number }[]; familia?: string; existe?: boolean; cortado?: number; tapado?: string };
type Anim = { k: number | null; id: string | null; tipo: string; delay: number; dur: number; easing: string; iter: number; fill: string; dir: string; chaves: Record<string, unknown>[]; props: string[] };
type Estatico = { anims: Anim[]; fontes: { familia: string; status: string }[]; blocos: number };

const quadros = (ev: Evidencia) => ev.col?.quadros ?? [];
const qps = (ev: Evidencia) => ev.col?.decl.qps ?? ev.tarefa.qps;
const dim = (ev: Evidencia) => ({ L: ev.col?.decl.largura ?? ev.tarefa.dim.largura, A: ev.col?.decl.altura ?? ev.tarefa.dim.altura });
const lado = (ev: Evidencia) => { const { L, A } = dim(ev); return Math.min(L, A); };
const estilo = (q: any) => q?.extra?.estilo ?? {};
const amostras = (ev: Evidencia) => quadros(ev).filter((q: any) => estilo(q).css) as any[];
const itens = (q: any) => (estilo(q).css ?? []) as Item[];
const estatico = (ev: Evidencia): Estatico => (quadros(ev).map((q: any) => estilo(q).estatico).find(Boolean) ?? { anims: [], fontes: [], blocos: 0 }) as Estatico;
const visDe = (q: any) => new Map<number, { caixa: Caixa; op: number }>((estilo(q).vis ?? []).map(([k, caixa, op]: [number, Caixa, number]) => [k, { caixa, op }]));
const nada = (motivo: string): Valor => ({ valor: null, motivo });
const legendaIds = (ev: Evidencia) => {
  const s = new Set<string>();
  for (const q of amostras(ev)) for (const i of itens(q)) if (i.papel === "legenda" && i.id) s.add(i.id);
  return s;
};
const ehLegenda = (i: Item, ids: Set<string>) => i.papel === "legenda" || (!!i.pai && ids.has(i.pai));
const palavras = (s: string) => s.split(/[\s\u00a0]+/).filter((p) => /[\p{L}\p{N}]/u.test(p));
const norm = (s: string) => s.toLowerCase().normalize("NFC").replace(/[.,!?;:«»"“”'’()\[\]。、]/g, "");
const centro = (c: Caixa) => [c[0] + c[2] / 2, c[1] + c[3] / 2];

export function rgba(s: string | null | undefined): [number, number, number, number] | null {
  if (!s) return null;
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (!m) return null;
  const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [v[0], v[1], v[2], v[3] ?? 1];
}
const coresEm = (s: string | null) => [...(s ?? "").matchAll(/rgba?\([^)]+\)/g)].map((m) => rgba(m[0])!).filter(Boolean);
function lab([r, g, b]: number[]): [number, number, number] {
  const c = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [c(r), c(g), c(b)];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
export const deltaE = (a: number[], b: number[]) => { const x = lab(a), y = lab(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function hsv([r, g, b]: number[]) {
  const R = r / 255, G = g / 255, B = b / 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
  let h = 0;
  if (d) h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s: mx ? d / mx : 0, v: mx };
}
const croma = (c: number[]) => { const [, a, b] = lab(c); return Math.hypot(a, b); };
const contrasteDe = (a: number[], b: number[]) => { const la = luminancia(a[0], a[1], a[2]), lb = luminancia(b[0], b[1], b[2]); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
const sobre = (c: [number, number, number, number], fundo: number[]) => c[3] >= 1 ? c.slice(0, 3) : c.slice(0, 3).map((v, i) => v * c[3] + fundo[i] * (1 - c[3]));

/**
 * Os quadros de corte: um elemento de tela cheia (≥ 90 % do quadro) que não estava visível aparece e um que estava
 * some (no mesmo quadro ou até 1 s depois, quando as duas cenas se sobrepõem). Memorizado na evidência.
 */
export function cortes(ev: Evidencia): number[] {
  if (ev.cache.has("cortes")) return ev.cache.get("cortes") as number[];
  const { L, A } = dim(ev), r: number[] = [];
  const cheios = (quadros(ev) as any[]).map((q) => {
    const agora = new Set<number>();
    // Do tamanho da tela e com alguma parte nela (a cena que entra deslizando conta desde o primeiro quadro).
    for (const [k, v] of visDe(q)) { const [, , w, h] = v.caixa; if (w * h >= 0.9 * L * A) agora.add(k); }
    return agora;
  });
  for (let n = 1; n < cheios.length; n++) {
    if (![...cheios[n]].some((k) => !cheios[n - 1].has(k))) continue;
    const some = [...cheios[n - 1]].some((k) => { for (let m = n; m < Math.min(cheios.length, n + qps(ev) + 1); m++) if (!cheios[m].has(k)) return true; return false; });
    if (some) r.push(n);
  }
  // Takes do apresentador que trocam sem elemento de tela cheia novo também são corte.
  let take: string | null | undefined;
  for (const q of quadros(ev) as any[]) { if (q.n > 0 && q.take && take && q.take !== take && !r.includes(q.n)) r.push(q.n); take = q.take ?? take; }
  r.sort((a, b) => a - b);
  ev.cache.set("cortes", r);
  return r;
}

/**
 * Caixa do rosto na tela, por quadro: na conferência, pelas amostras do detector (ev.rostos, em frações da caixa do
 * apresentador, interpoladas); no bench, pela mídia rotulada como apresentador.
 */
function rostoNaTela(ev: Evidencia, q: any): Caixa | null {
  if (ev.rostos) {
    if (!q.apresentador) return null;
    const rel = interpolarRosto(ev.rostos, q.n);
    return rel ? rostoDaAmostra(rel, q.apresentador) : null;
  }
  for (const m of q.extra?.midias ?? []) {
    const rot = Object.entries(ev.rotulos).find(([arq, r]) => r.tipo === "apresentador" && m.src && m.src.endsWith(arq))?.[1] as any;
    if (!rot) continue;
    const [ow, oh] = rot.origem as number[], c = m.conteudo as number[];
    const [x, y, w, h] = rot.rosto as number[];
    return [c[0] + (x * c[2]) / ow, c[1] + (y * c[3]) / oh, (w * c[2]) / ow, (h * c[3]) / oh];
  }
  return null;
}

/** Áudio do MP4 (mono 16 kHz), memorizado. */
const som = (ev: Evidencia) => { if (!ev.mp4) return null; if (!ev.cache.has("audio")) ev.cache.set("audio", audio(ev.mp4)); return ev.cache.get("audio") as Float32Array; };
const lum = (ev: Evidencia) => { if (!ev.mp4) return null; if (!ev.cache.has("lumas")) ev.cache.set("lumas", lumas(ev.mp4)); return ev.cache.get("lumas") as ReturnType<typeof lumas>; };
const db = (x: number) => 10 * Math.log10(Math.max(x, 1e-12));
/** Começos de um tom (janelas de 5 ms): subida acima de `fracao` do nível de pico, depois de silêncio. */
function inicios(a: Float32Array, hz: number, fracao = 0.25, janela = 0.005): number[] {
  const t = tom(a, hz, 16000, janela), pico = Math.max(...t, 1e-12), r: number[] = [];
  let ligado = false;
  t.forEach((v, i) => { if (!ligado && v > pico * fracao) { r.push(i * janela); ligado = true; } else if (ligado && v < pico * fracao * 0.3) ligado = false; });
  return r;
}
function ffprobe(arq: string): any {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", arq], { encoding: "utf8" });
  return r.status === 0 ? JSON.parse(r.stdout) : null;
}

// ——— Condições sobre um item (estilo calculado + contexto do quadro) ———

export type Cond = { prop: string; op: "=" | "!=" | ">" | "<" | ">=" | "<=" | "existe" | "nao-existe" | "regex" | "nao-regex" | "em"; valor?: unknown };
function propDe(i: Item, prop: string, ctx: { L: number; A: number; S: number; q: any; vis: Map<number, { caixa: Caixa; op: number }>; legendas: Set<string>; midias: Caixa[] }): unknown {
  const v = ctx.vis.get(i.k);
  const cx = v?.caixa;
  switch (prop) {
    case "fsRel": return i.fs / ctx.S;
    case "lsEm": return i.fs ? i.ls / i.fs : 0;
    case "op": return v?.op ?? 0;
    case "legenda": return ehLegenda(i, ctx.legendas);
    case "midia": return ["img", "video", "canvas"].includes(i.tag);
    case "temTexto": return !!i.texto;
    case "palavras": return palavras(i.texto).length;
    case "linhasN": return i.linhas?.length ?? 0;
    case "areaRel": return cx ? (cx[2] * cx[3]) / (ctx.L * ctx.A) : 0;
    case "fora": { // fração da caixa fora do quadro
      if (!cx) return 0;
      // Meio pixel de folga (arredondamento da caixa).
      const dentro = Math.max(0, Math.min(cx[0] + cx[2], ctx.L + 0.5) - Math.max(cx[0], -0.5)) * Math.max(0, Math.min(cx[1] + cx[3], ctx.A + 0.5) - Math.max(cx[1], -0.5));
      return Math.max(0, 1 - dentro / Math.max(1, cx[2] * cx[3]));
    }
    case "centrado": return cx ? Math.abs(cx[0] + cx[2] / 2 - ctx.L / 2) < 0.02 * ctx.L : false;
    case "margemRel": return cx ? Math.min(cx[0], cx[1], ctx.L - cx[0] - cx[2], ctx.A - cx[1] - cx[3]) / ctx.S : 1;
    case "sobreMidia": return !!cx && ctx.midias.some((m) => intersecao(cx, m) > 0.3 * cx[2] * cx[3]);
    case "apoio": { // placa própria ou de um ancestral (fundo opaco) ou sombra no texto
      if (i.tsombra) return true;
      const f = rgba(i.fundo);
      return !!f && f[3] >= 0.5;
    }
    case "fundoA": return rgba(i.fundo)?.[3] ?? 0;
    case "arabe": return /[\u0600-\u06FF]/.test(i.texto);
    case "caixaAlta": return i.tt === "uppercase" || (palavras(i.texto).length > 0 && i.texto === i.texto.toUpperCase() && /\p{Lu}/u.test(i.texto));
    case "natEscala": return i.nat && cx && i.nat[0] && !(i as any).vetor ? cx[2] / i.nat[0] : 0;
    case "natVazia": return !!i.nat && (i.nat[0] === 0 || i.nat[2] === 0);
    case "sombraBrilho": { // sombra sem deslocamento e com desfoque grande, colorida (halo)
      const m = /(rgba?\([^)]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/.exec(i.sombra ?? "");
      if (!m) return false;
      const c = rgba(m[1])!;
      return Math.abs(Number(m[2])) < 2 && Math.abs(Number(m[3])) < 2 && Number(m[4]) >= 15 && hsv(c).s > 0.5;
    }
    case "gradRoxoAzul": {
      const cs = coresEm(i.bgimg).map((c) => hsv(c));
      return /gradient/.test(i.bgimg ?? "") && cs.some((c) => c.h >= 250 && c.h <= 320 && c.s > 0.4) && cs.some((c) => c.h >= 190 && c.h < 250 && c.s > 0.4);
    }
    case "estouro": return (i as any).estouro ?? 0;
    case "temUrl": return /url\(/.test(i.bgimg ?? "");
    case "emoji": return /\p{Extended_Pictographic}/u.test(i.texto);
    default: {
      // Sem valor no estilo calculado («none») fica "none", como o CSS escreve.
      const v = (i as any)[prop];
      return v === null && ["filtro", "bfiltro", "sombra", "tsombra", "transf", "bgimg", "borda", "deco", "transicao"].includes(prop) ? "none" : v;
    }
  }
}
function cumpre(v: unknown, c: Cond): boolean {
  const nada = (x: unknown) => x === null || x === undefined || x === false || x === "" || x === 0 || x === "none";
  // Comparar com true ou false é comparar com «tem valor» (o cortado em px, o tapado com o id de quem tapa…).
  if ((c.op === "=" || c.op === "!=") && typeof c.valor === "boolean") return (c.op === "=") === (!nada(v) === c.valor);
  switch (c.op) {
    case "existe": return !nada(v);
    case "nao-existe": return nada(v);
    case "=": return v === c.valor || (typeof v === "number" && Number(c.valor) === v);
    case "!=": return v !== c.valor && !(typeof v === "number" && Number(c.valor) === v);
    case ">": return Number(v) > Number(c.valor);
    case "<": return Number(v) < Number(c.valor);
    case ">=": return Number(v) >= Number(c.valor);
    case "<=": return Number(v) <= Number(c.valor);
    case "regex": return new RegExp(String(c.valor), "u").test(String(v ?? ""));
    case "nao-regex": return !new RegExp(String(c.valor), "u").test(String(v ?? ""));
    case "em": return (c.valor as unknown[]).includes(v);
  }
}
/** Percorre os itens de estilo dos quadros de amostra, com o contexto de cada quadro. */
function* percorrer(ev: Evidencia, onde: Cond[] = []) {
  const { L, A } = dim(ev), S = Math.min(L, A), legendas = legendaIds(ev);
  for (const q of amostras(ev)) {
    const vis = visDe(q);
    const midias = itens(q).filter((i) => ["img", "video", "canvas"].includes(i.tag)).map((i) => vis.get(i.k)?.caixa).filter(Boolean) as Caixa[];
    const ctx = { L, A, S, q, vis, legendas, midias };
    for (const i of itens(q)) if (onde.every((c) => cumpre(propDe(i, c.prop, ctx), c))) yield { i, q, ctx };
  }
}
const descr = (i: Item) => `${i.tag}${i.id ? `#${i.id}` : ""}${i.texto ? ` «${i.texto.slice(0, 30)}»` : ""}`;

// ——— Animações ———

/** Pico de uma cubic-bezier (o y máximo): > 1 é passar do ponto e voltar. */
function picoBezier(e: string): number {
  const m = /cubic-bezier\(([^)]+)\)/.exec(e);
  if (!m) return 1;
  const [, y1, , y2] = m[1].split(",").map(Number);
  let mx = 1;
  for (let t = 0; t <= 1; t += 0.02) { const y = 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3; mx = Math.max(mx, y); }
  return mx;
}
const escalaDe = (v: unknown) => { const m = /scale\(([\d.]+)/.exec(String(v ?? "")); return m ? Number(m[1]) : null; };
function propAnim(a: Anim, prop: string, ev: Evidencia): unknown {
  switch (prop) {
    case "props": return a.props.join(",");
    case "durMs": return a.dur;
    case "inicioQ": return (a.delay * qps(ev)) / 1000;
    case "entrada": { const o0 = a.chaves[0]?.opacity, o1 = a.chaves.at(-1)?.opacity; return o0 !== undefined && Number(o0) < 0.5 && (o1 === undefined || Number(o1) > 0.5) && a.dur > 50; }
    case "layout": return a.props.some((p) => /^(left|top|right|bottom|width|height|margin|padding)/.test(p));
    case "pico": { // passa do valor final: pela curva ou por chave intermediária de escala maior que a final
      const fim = escalaDe(a.chaves.at(-1)?.transform) ?? 1;
      const meio = a.chaves.slice(1, -1).map((c) => escalaDe(c.transform) ?? 0);
      const opMeio = a.chaves.slice(1, -1).some((c) => c.opacity !== undefined && Number(c.opacity) > Number(a.chaves.at(-1)?.opacity ?? 1) + 0.05);
      return Math.max(picoBezier(a.easing), ...a.chaves.map((c) => picoBezier(String(c.easing ?? ""))), ...meio.map((m) => m / fim), opMeio ? 1.5 : 1);
    }
    case "infinita": return a.iter < 0 || a.iter >= 3;
    case "alvoTexto": return !!a.id && amostras(ev).some((q) => itens(q).some((i) => i.id === a.id && !!i.texto));
    case "fracaoQuadro": { const f = (a.delay * qps(ev)) / 1000; return Math.abs(f - Math.round(f)); }
    default: return (a as any)[prop];
  }
}
const animsOnde = (ev: Evidencia, onde: Cond[]) => estatico(ev).anims.filter((a) => onde.every((c) => cumpre(propAnim(a, c.prop, ev), c)));
const assinatura = (a: Anim) => JSON.stringify([a.props, a.chaves.map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== "offset" && k !== "easing"))), Math.round(a.dur / 10), a.easing]);

// ——— Falas, batidas ———

const tempoDe = (ev: Evidencia, n: number) => n / qps(ev);
const falas = (ev: Evidencia) => ev.tarefa.falas;
const dentroDePalavra = (ev: Evidencia, s: number, folga = 0.04) => falas(ev).find((p) => s > p.ini + folga && s < p.fim - folga);
function pertoDeCausa(ev: Evidencia, s: number, tol: number): boolean {
  const t = ev.tarefa;
  if (s <= tol) return true;
  if (falas(ev).some((p) => Math.abs(p.ini - s) <= tol)) return true;
  const k = Math.round((s - t.fase) / t.batida);
  if (Math.abs(t.fase + k * t.batida - s) <= tol) return true;
  return cortes(ev).some((n) => Math.abs(tempoDe(ev, n) - s) <= tol);
}

/** Textos de legenda por quadro (a geometria do S04). */
function legendasPorQuadro(ev: Evidencia): string[][] {
  return quadros(ev).map((q: any) => (q.legendas ?? []).map((l: any) => l.texto as string).filter((t: string) => t.trim()));
}
/** Blocos de legenda: texto, primeiro e último quadro em que aparece. */
function blocosDeLegenda(ev: Evidencia) {
  const r: { texto: string; de: number; ate: number }[] = [];
  const abertos = new Map<string, { texto: string; de: number; ate: number }>();
  legendasPorQuadro(ev).forEach((ls, n) => {
    for (const [t, b] of abertos) if (!ls.includes(t)) { r.push(b); abertos.delete(t); }
    for (const t of ls) { const b = abertos.get(t); if (b) b.ate = n; else abertos.set(t, { texto: t, de: n, ate: n }); }
  });
  r.push(...abertos.values());
  return r.sort((a, b) => a.de - b.de);
}

/** Destino declarado (data-destino na conferência, a plataforma da tarefa no bench), normalizado: minúsculas, sem
 * acento e sem espaços nas pontas; vazio é null. */
export function destinoDe(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return s || null;
}
/** Destinos com a interface do aplicativo por cima do vídeo: a zona segura (G19, K-PLA-01) vale neles. */
export const DESTINOS_COM_INTERFACE = new Set(["reels", "instagram", "tiktok", "shorts", "anuncio"]);

/** Contraste (K-COR-01, G20) com o fundo real de cada texto (a cor média do quadro sob ele, o texto transparente):
 * o menor contraste dividido pelo mínimo do tamanho; uma ocorrência por texto, com o pior quadro. */
function contrasteNoFundoReal(fundos: Fundo[]): Valor {
  let pior: number | null = null, onde = "", n = 0;
  const ocorrencias: Ocorrencia[] = [], quadros = [...new Set(fundos.map((a) => a.n))].sort((x, y) => x - y);
  const passo = quadros.length > 1 ? Math.min(...quadros.slice(1).map((q, i) => q - quadros[i])) : 1;
  for (const a of fundos) for (const t of a.textos) {
    const cor = rgba(t.cor);
    if (!cor || !palavras(t.texto).length) continue;
    const grande = t.fs >= 24 || (t.fs >= 18.66 && t.fw >= 700), minimo = grande ? 3 : 4.5;
    const r = contrasteDe(sobre(cor, t.fundo), t.fundo), v = +(r / minimo).toFixed(3);
    const texto = t.texto.length > 40 ? `${t.texto.slice(0, 40)}…` : t.texto;
    if (pior === null || v < pior) { pior = v; onde = `«${texto}» ${r.toFixed(2)}:1`; n = a.n; }
    const k = `${t.papel ?? ""}\u0000${t.texto}`;
    const motivo = `contraste ${r.toFixed(2).replace(".", ",")}:1 sobre o fundo real (mínimo ${String(minimo).replace(".", ",")}:1 para texto ${grande ? "grande" : "pequeno"})`;
    const caixa = t.caixas.reduce<Caixa>((u, c) => [Math.min(u[0], c[0]), Math.min(u[1], c[1]), Math.max(u[0] + u[2], c[0] + c[2]) - Math.min(u[0], c[0]),
      Math.max(u[1] + u[3], c[1] + c[3]) - Math.min(u[1], c[1])], t.caixas[0]);
    // Uma ocorrência por amostra; as que quebram o limite, do mesmo texto e em amostras seguidas, viram um trecho só
    // (juntarOcorrencias, depois do filtro do limite).
    ocorrencias.push({ valor: v, de: a.n, ate: a.n, pior: a.n, texto, papel: t.papel, caixa, motivo, grupo: k, passo });
  }
  return pior === null ? nada("nenhum texto legível com o fundo medido") : { valor: pior, motivo: onde, quadro: n, ocorrencias };
}

// ——— As medidas ———

export const MEDIDAS: Record<string, Medida> = {
  // ===== estilo calculado e fonte da página =====
  fonteRegex: { motor: "estilo", descricao: "ocorrências de um padrão (regex, p.padrao, p.flags) no index.html entregue; p.semComentarios tira os comentários",
    f(ev, p) {
      let s = ev.fonte;
      if (p.semComentarios !== false) s = s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const m = [...s.matchAll(new RegExp(p.padrao, `g${String(p.flags ?? "").replace(/g/g, "")}`))];
      return { valor: m.length, motivo: m.length ? `«${m[0][0].slice(0, 50)}» ${m.length}× no index.html` : "padrão ausente" };
    } },
  textoRegex: { motor: "estilo", descricao: "textos visíveis distintos que casam com o padrão (p.padrao); p.semLegenda ignora a legenda",
    f(ev, p) {
      const re = new RegExp(p.padrao, `u${String(p.flags ?? "").replace(/[gu]/g, "")}`), achados = new Set<string>();
      for (const { i, ctx } of percorrer(ev, [{ prop: "temTexto", op: "existe" }])) {
        if (p.semLegenda && ehLegenda(i, ctx.legendas)) continue;
        if (re.test(i.texto)) achados.add(i.texto);
      }
      // O texto inteiro de um bloco (com filhos) também conta: «não é só X, é Y» pode atravessar um <span>.
      return { valor: achados.size, motivo: achados.size ? `«${[...achados][0].slice(0, 50)}»` : "nenhum texto casa" };
    } },
  contar: { motor: "estilo", descricao: "elementos distintos que cumprem todas as condições (p.onde: [{prop, op, valor}]) em algum quadro de amostra; props do estilo calculado (fs, fw, ff, familia, ls, tt, cor, fundo, bgimg, sombra, tsombra, filtro, bfiltro, raio, transf, alinh, dir, tag, papel, texto, cortado, tapado, existe) e as calculadas (fsRel, lsEm, op, legenda, midia, temTexto, palavras, linhasN, areaRel, fora, centrado, margemRel, sobreMidia, apoio, arabe, caixaAlta, natEscala, natVazia, sombraBrilho, gradRoxoAzul, temUrl, emoji)",
    f(ev, p) {
      const achados = new Map<string, any>();
      for (const { i, q } of percorrer(ev, p.onde)) { const k = i.id ?? `k${i.k}`; if (!achados.has(k)) achados.set(k, { i, n: q.n }); }
      const a = [...achados.values()][0];
      return { valor: achados.size, motivo: a ? `${descr(a.i)} (quadro ${a.n}) e mais ${achados.size - 1}` : "nenhum elemento", quadro: a?.n };
    } },
  fracao: { motor: "estilo", descricao: "fração dos elementos distintos de p.de (condições) que cumprem p.onde; p.minimo elementos para valer",
    f(ev, p) {
      const de = new Set<string>(), sim = new Set<string>();
      for (const { i, ctx } of percorrer(ev, p.de)) {
        const k = i.id ?? `k${i.k}`;
        de.add(k);
        if ((p.onde as Cond[]).every((c) => cumpre(propDe(i, c.prop, ctx), c))) sim.add(k);
      }
      if (de.size < (p.minimo ?? 1)) return nada(`só ${de.size} elementos para comparar`);
      return { valor: +(sim.size / de.size).toFixed(3), motivo: `${sim.size} de ${de.size}` };
    } },
  hierarquia: { motor: "estilo", descricao: "hierarquia dos textos legíveis (fora a legenda); com p.escopo «video», a razão entre o maior e o menor tamanho do vídeo inteiro; senão, nos quadros com 2 textos ou mais: p.prop 'fs' dá a maior razão entre o maior e o menor tamanho de um quadro; 'fw', o menor peso do maior texto quando ele é título (≥ 1,5× o menor)",
    f(ev, p) {
      let pior: number | null = null, n = 0;
      const ls = legendaIds(ev), todos: number[] = [], ids = new Set<string>();
      for (const q of amostras(ev)) {
        const vis = visDe(q);
        const ts = itens(q).filter((i) => i.texto && palavras(i.texto).length && !ehLegenda(i, ls) && (vis.get(i.k)?.op ?? 0) >= 0.5 && i.tag !== "span").sort((a, b) => b.fs - a.fs);
        if (p.escopo === "video") { for (const i of ts) { todos.push(i.fs); ids.add(i.id ?? `k${i.k}`); } continue; }
        if (ts.length < 2) continue;
        if (p.prop === "fw" && ts[0].fs < 1.5 * ts.at(-1)!.fs) continue;
        const v = p.prop === "fw" ? ts[0].fw : ts[0].fs / ts.at(-1)!.fs;
        // Peso: o pior título. Tamanho: o melhor quadro (basta o vídeo ter hierarquia onde há título e apoio).
        if (pior === null || (p.prop === "fw" ? v < pior : v > pior)) { pior = v; n = q.n; }
      }
      if (p.escopo === "video") {
        if (ids.size < 2) return nada("menos de dois textos no vídeo");
        const v = Math.max(...todos) / Math.min(...todos);
        return { valor: +v.toFixed(3), motivo: `maior / menor tamanho de texto no vídeo = ${v.toFixed(2)}` };
      }
      return pior === null ? nada("nenhum quadro com dois textos") : { valor: +pior.toFixed(3), motivo: `${p.prop === "fw" ? "peso do título" : "título / segundo texto"} = ${pior.toFixed(2)}`, quadro: n };
    } },
  animacoes: { motor: "estilo", descricao: "animações da página (document.getAnimations) que cumprem p.onde; props: props (lista), durMs, inicioQ, easing, iter, fill, tipo (CSSAnimation, CSSTransition, Animation), entrada, layout, pico, infinita, alvoTexto, fracaoQuadro",
    f(ev, p) { const a = animsOnde(ev, p.onde ?? []); return { valor: a.length, motivo: a.length ? `${a.length} animação(ões), ex.: ${a[0].id ?? "?"} [${a[0].props}] ${Math.round(a[0].dur)} ms ${a[0].easing}` : "nenhuma" }; } },
  mesmoInicio: { motor: "estilo", descricao: "o maior grupo de entradas (p.onde) que começam no mesmo quadro (±1)",
    f(ev, p) {
      const a = animsOnde(ev, p.onde ?? [{ prop: "entrada", op: "existe" }, { prop: "alvoTexto", op: "existe" }]).map((x) => (x.delay * qps(ev)) / 1000);
      let mx = 0, em = 0;
      for (const s of a) { const n = a.filter((x) => Math.abs(x - s) <= 1).length; if (n > mx) { mx = n; em = s; } }
      return { valor: mx, motivo: `${mx} entradas juntas no quadro ${Math.round(em)}`, quadro: Math.round(em) };
    } },
  mesmaAssinatura: { motor: "estilo", descricao: "fração das entradas (p.onde) com a assinatura mais comum (propriedades, chaves, duração, easing); null com menos de p.minimo entradas",
    f(ev, p) {
      const a = animsOnde(ev, p.onde ?? [{ prop: "entrada", op: "existe" }]);
      if (a.length < (p.minimo ?? 4)) return nada(`só ${a.length} entradas`);
      const c = new Map<string, number>();
      for (const x of a) c.set(assinatura(x), (c.get(assinatura(x)) ?? 0) + 1);
      const mx = Math.max(...c.values());
      return { valor: +(mx / a.length).toFixed(3), motivo: `${mx} de ${a.length} entradas iguais` };
    } },
  mesmaEntradaEmTudo: { motor: "estilo", descricao: "entradas agrupadas por tipo de elemento (data-papel, ou a tag): fração dos tipos cuja entrada mais comum é a mesma assinatura (propriedades, chaves, duração, easing); null com menos de p.minimo tipos (padrão 3)",
    f(ev, p) {
      const tipos = new Map<string, Map<string, number>>();
      const papelDe = new Map<string, string>();
      for (const q of amostras(ev)) for (const i of itens(q)) if (i.id) papelDe.set(i.id, i.papel ?? i.tag);
      for (const a of animsOnde(ev, [{ prop: "entrada", op: "existe" }])) {
        const t = (a.id && papelDe.get(a.id)) ?? a.id?.replace(/-\d+(-\d+)?$/, "") ?? "?";
        if (!tipos.has(t)) tipos.set(t, new Map());
        const m = tipos.get(t)!; m.set(assinatura(a), (m.get(assinatura(a)) ?? 0) + 1);
      }
      if (tipos.size < (p.minimo ?? 3)) return nada(`só ${tipos.size} tipos de elemento com entrada`);
      const principal = [...tipos.values()].map((m) => [...m].sort((x, y) => y[1] - x[1])[0][0]);
      const c = new Map<string, number>();
      for (const x of principal) c.set(x, (c.get(x) ?? 0) + 1);
      const mx = Math.max(...c.values());
      return { valor: +(mx / tipos.size).toFixed(3), motivo: `${mx} de ${tipos.size} tipos de elemento com a mesma entrada` };
    } },
  fontesFalhas: { motor: "estilo", descricao: "fontes declaradas (@font-face) que falharam ao carregar",
    f(ev) { const f = estatico(ev).fontes.filter((x) => x.status === "error"); return { valor: f.length, motivo: f.length ? `«${f[0].familia}» não carregou` : "todas carregaram" }; } },
  familiaInexistente: { motor: "estilo", descricao: "textos cuja primeira família não existe na máquina do render nem foi declarada (@font-face)",
    f(ev) {
      const declaradas = new Set(estatico(ev).fontes.map((f) => f.familia));
      const r = new Set<string>();
      for (const { i } of percorrer(ev, [{ prop: "temTexto", op: "existe" }])) if (i.existe === false && !declaradas.has(i.familia!)) r.add(i.familia!);
      return { valor: r.size, motivo: r.size ? `«${[...r][0]}» não existe e caiu na de reserva` : "todas existem" };
    } },
  contraste: { motor: "estilo", descricao: "o menor contraste (WCAG) entre a cor do texto e o fundo opaco atrás dele (o dele, o de um ancestral ou o da página), dividido pelo mínimo do tamanho (4,5; 3 para texto grande); texto sobre mídia sem placa fica de fora",
    f(ev) {
      if (ev.fundos) return contrasteNoFundoReal(ev.fundos);
      let pior: number | null = null, onde = "", n = 0;
      for (const q of amostras(ev)) {
        const vis = visDe(q), its = itens(q), porId = new Map(its.filter((i) => i.id).map((i) => [i.id, i]));
        const midias = its.filter((i) => ["img", "video", "canvas"].includes(i.tag)).map((i) => vis.get(i.k)?.caixa).filter(Boolean) as Caixa[];
        const est = estatico(ev) as any, pg = rgba(est.paginaFundo), ph = rgba(est.htmlFundo);
        const pagina = pg && pg[3] > 0.5 ? pg : ph && ph[3] > 0.5 ? ph : null;
        for (const i of its) {
          if (!i.texto || !palavras(i.texto).length || (vis.get(i.k)?.op ?? 0) < 0.5) continue;
          // O fundo: o do próprio elemento ou o do primeiro ancestral com fundo (pela cadeia de pais com id).
          let f = rgba(i.fundo), a: Item | undefined = i;
          while ((!f || f[3] < 0.5) && a?.pai && porId.has(a.pai)) { a = porId.get(a.pai); f = rgba(a!.fundo); }
          if (!f || f[3] < 0.5) {
            const cx = vis.get(i.k)!.caixa;
            if (midias.some((m) => intersecao(cx, m) > 0.2 * cx[2] * cx[3]) || /gradient|url/.test(its.find((x) => x.id === "fundo")?.bgimg ?? "") || its.some((x) => x.id === "fundo" && ["img", "video"].includes(x.tag))) continue;
            f = pagina ?? [...hexRgb(ev.tarefa.paleta.fundo), 1] as any;
          }
          const fc = sobre(f as any, pagina?.slice(0, 3) ?? hexRgb(ev.tarefa.paleta.fundo)), cor = rgba(i.cor)!;
          const r = contrasteDe(sobre(cor, fc), fc), grande = i.fs >= 24 || (i.fs >= 18.66 && i.fw >= 700);
          const v = r / (grande ? 3 : 4.5);
          if (pior === null || v < pior) { pior = v; onde = `${descr(i)} ${r.toFixed(2)}:1`; n = q.n; }
        }
      }
      return pior === null ? nada("nenhum texto sobre fundo conhecido") : { valor: +pior.toFixed(3), motivo: onde, quadro: n };
    } },
  paleta: { motor: "estilo", descricao: "a maior distância (ΔE76) de uma cor visível (texto, fundo, borda, degradê) até a cor mais perto da marca da tarefa; cinzas (croma < p.cromaNeutra, padrão 8) não contam",
    f(ev, p) {
      const marca = ev.tarefa.marca.map(hexRgb), neutra = p.cromaNeutra ?? 8;
      let pior = 0, onde = "";
      const ver = (c: number[] | null, i: Item) => {
        if (!c || (c[3] ?? 1) < 0.2 || croma(c) < neutra) return;
        const d = Math.min(...marca.map((m) => deltaE(c, m)));
        if (d > pior) { pior = d; onde = `${descr(i)} rgb(${c.slice(0, 3).map(Math.round)})`; }
      };
      for (const { i } of percorrer(ev, [{ prop: "midia", op: "nao-existe" }])) {
        if (i.texto) ver(rgba(i.cor), i);
        ver(rgba(i.fundo), i); ver(rgba(i.borda), i);
        for (const c of coresEm(i.bgimg)) ver(c, i);
      }
      return { valor: +pior.toFixed(1), motivo: onde || "todas as cores na marca" };
    } },
  corEntreCenas: { motor: "estilo", descricao: "o mesmo elemento (mesmo texto e etiqueta) em cenas diferentes: a maior diferença (ΔE76) de cor do texto ou do fundo",
    f(ev) {
      const vistos = new Map<string, number[][]>();
      for (const { i } of percorrer(ev, [{ prop: "temTexto", op: "existe" }, { prop: "legenda", op: "=", valor: false }])) {
        for (const [prop, c] of [["cor", rgba(i.cor)], ["fundo", rgba(i.fundo)]] as const) {
          const k = `${i.tag}|${i.texto}|${prop}`;
          if (!vistos.has(k)) vistos.set(k, []);
          if (c && c[3] > 0.5) vistos.get(k)!.push(c);
        }
      }
      let pior = 0, onde = "";
      for (const [k, cs] of vistos) for (const a of cs) for (const b of cs) { const d = deltaE(a, b); if (d > pior && d < 60) { pior = d; onde = k; } }
      return { valor: +pior.toFixed(2), motivo: onde ? `«${onde.split("|")[1].slice(0, 30)}» muda ${pior.toFixed(1)} ΔE` : "cores iguais" };
    } },
  gradienteRaso: { motor: "estilo", descricao: "degradês do CSS: o maior número de px por nível de 8 bits (comprimento ÷ maior diferença de canal entre as cores) — muitos px por nível é banding",
    f(ev) {
      let pior = 0, onde = "";
      for (const { i, ctx } of percorrer(ev, [{ prop: "bgimg", op: "regex", valor: "gradient" }])) {
        const cs = coresEm(i.bgimg);
        if (cs.length < 2) continue;
        let niveis = 0;
        for (let k = 1; k < cs.length; k++) niveis = Math.max(niveis, ...[0, 1, 2].map((j) => Math.abs(cs[k][j] - cs[k - 1][j])));
        const cx = ctx.vis.get(i.k)?.caixa ?? [0, 0, ctx.L, ctx.A];
        const comp = Math.max(cx[2], cx[3]) / Math.max(1, cs.length - 1);
        const v = comp / Math.max(1, niveis);
        if (v > pior) { pior = v; onde = descr(i); }
      }
      return { valor: +pior.toFixed(1), motivo: onde ? `${onde}: ${pior.toFixed(0)} px por nível` : "sem degradê" };
    } },
  diffEstilo: { motor: "estilo", precisa: { antes: true }, descricao: "pedido de revisão (tarefa.permitido não vazio): elementos fora do permitido cuja prop (p.props) mudou entre a partida e a entrega, no mesmo quadro; null fora de revisão",
    f(ev, p) {
      if (!ev.tarefa.permitido.length) return nada("a tarefa não é de revisão");
      if (!ev.antes?.col) return nada("sem a evidência da partida");
      const permitido = new Set(ev.tarefa.permitido);
      const antes = new Map<string, Item>();
      for (const q of amostras(ev.antes)) for (const i of itens(q)) if (i.id) antes.set(`${q.n}|${i.id}`, i);
      const mudou = new Set<string>();
      for (const q of amostras(ev)) {
        const vis = visDe(q), visA = visDe(quadros(ev.antes).find((x: any) => x.n === q.n));
        for (const i of itens(q)) {
          if (!i.id || permitido.has(i.id) || (i.pai && permitido.has(i.pai))) continue;
          const a = antes.get(`${q.n}|${i.id}`);
          if (!a) continue;
          for (const prop of p.props as string[]) {
            const va = prop === "caixa" ? JSON.stringify(visA.get(a.k)?.caixa?.map(Math.round)) : JSON.stringify((a as any)[prop]);
            const vb = prop === "caixa" ? JSON.stringify(vis.get(i.k)?.caixa?.map(Math.round)) : JSON.stringify((i as any)[prop]);
            if (va !== vb) mudou.add(`${i.id}.${prop}`);
          }
        }
      }
      return { valor: mudou.size, motivo: mudou.size ? `mudou fora do pedido: ${[...mudou].slice(0, 4).join(", ")}` : "só o pedido mudou" };
    } },
  cartoes: { motor: "estilo", descricao: "o maior grupo de irmãos (mesmo pai) com raio e sombra e tamanho parecido (±15 %): cartões de site",
    f(ev) {
      let mx = 0, onde = "";
      for (const q of amostras(ev)) {
        const vis = visDe(q), grupos = new Map<string, Caixa[]>();
        for (const i of itens(q)) if (i.raio > 0 && i.sombra && vis.get(i.k)) { const g = i.pai ?? "body"; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g)!.push(vis.get(i.k)!.caixa); }
        for (const [g, cs] of grupos) {
          const iguais = cs.filter((c) => cs.filter((d) => Math.abs(d[2] - c[2]) < 0.15 * c[2] && Math.abs(d[3] - c[3]) < 0.15 * c[3]).length >= 3).length;
          if (iguais > mx) { mx = iguais; onde = g; }
        }
      }
      return { valor: mx, motivo: mx ? `${mx} cartões iguais com raio e sombra em ${onde}` : "sem cartões" };
    } },
  destaques: { motor: "estilo", descricao: "fração dos blocos de texto (títulos, corpos, legendas) com uma palavra destacada (filho com outra cor, peso ou sublinhado); null com menos de p.minimo blocos",
    f(ev, p) {
      const blocos = new Set<string>(), com = new Set<string>();
      for (const q of amostras(ev)) {
        const its = itens(q), porId = new Map(its.filter((i) => i.id).map((i) => [i.id, i]));
        for (const i of its) {
          if (i.tag !== "span" && i.texto && palavras(i.texto).length >= 1 && i.id) blocos.add(i.id);
          if (i.tag === "span" && i.pai && porId.has(i.pai)) {
            const pai = porId.get(i.pai)!;
            if (i.cor !== pai.cor || i.fw !== pai.fw || (i.deco && !pai.deco)) com.add(i.pai);
          }
        }
      }
      if (blocos.size < (p.minimo ?? 4)) return nada(`só ${blocos.size} blocos`);
      return { valor: +(com.size / blocos.size).toFixed(3), motivo: `${com.size} de ${blocos.size} blocos com destaque` };
    } },
  numerosSemDado: { motor: "estilo", descricao: "números na tela (dois dígitos ou mais, ou com %) que não estão nos dados da tarefa",
    f(ev) {
      const dados = ev.tarefa.dados.map((d) => d.replace(/\s/g, ""));
      const r = new Set<string>();
      for (const { i } of percorrer(ev, [{ prop: "temTexto", op: "existe" }])) {
        for (const m of i.texto.matchAll(/[+]?\d[\d.,]*\s?%?/g)) {
          const v = m[0].replace(/\s/g, "");
          if ((v.replace(/\D/g, "").length >= 2 || v.includes("%")) && !dados.some((d) => d === v || d.replace(/\D/g, "") === v.replace(/\D/g, ""))) r.add(v);
        }
      }
      return { valor: r.size, motivo: r.size ? `número sem dado: ${[...r].slice(0, 3).join(", ")}` : "todos os números nos dados" };
    } },
  textoDuplicado: { motor: "estilo", descricao: "o mesmo texto (2 palavras ou mais) em dois elementos visíveis no mesmo quadro, fora a legenda",
    f(ev) {
      const ls = legendaIds(ev);
      for (const q of amostras(ev)) {
        const vis = visDe(q), vistos = new Map<string, number>();
        for (const i of itens(q)) {
          if (!i.texto || ehLegenda(i, ls) || (vis.get(i.k)?.op ?? 0) < 0.5 || palavras(i.texto).length < 2) continue;
          const k = norm(i.texto);
          vistos.set(k, (vistos.get(k) ?? 0) + 1);
          if (vistos.get(k)! >= 2) return { valor: 2, motivo: `«${i.texto.slice(0, 40)}» duas vezes na tela`, quadro: q.n };
        }
      }
      return { valor: 0, motivo: "sem texto repetido" };
    } },
  quebraRuim: { motor: "estilo", descricao: "textos de 2 linhas ou mais com a última linha de uma palavra só, ou com linha que termina em artigo ou preposição",
    f(ev) {
      const CURTAS = new Set(["a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "na", "no", "um", "uma", "the", "of", "an", "in", "on", "to", "die", "der", "das", "den", "dem", "am", "im"]);
      for (const { i, q } of percorrer(ev, [{ prop: "linhasN", op: ">=", valor: 2 }])) {
        const ls = i.linhas!;
        const ult = palavras(ls.at(-1)!.t);
        if (ult.length === 1 && palavras(i.texto).length >= 3) return { valor: 1, motivo: `${descr(i)}: «${ult[0]}» sozinha na última linha`, quadro: q.n };
        const fimArtigo = ls.slice(0, -1).find((l) => CURTAS.has(norm(palavras(l.t).at(-1) ?? "")));
        if (fimArtigo) return { valor: 1, motivo: `${descr(i)}: linha termina em «${palavras(fimArtigo.t).at(-1)}»`, quadro: q.n };
      }
      return { valor: 0, motivo: "quebras boas" };
    } },
  palavrasNaTela: { motor: "estilo", descricao: "o maior número de palavras legíveis na tela num quadro (p.semLegenda: fora a legenda)",
    f(ev, p) {
      let mx = 0, n = 0;
      const ls = legendaIds(ev);
      for (const q of amostras(ev)) {
        const vis = visDe(q);
        const total = itens(q).filter((i) => i.texto && (vis.get(i.k)?.op ?? 0) >= 0.5 && !(p.semLegenda && ehLegenda(i, ls))).reduce((s, i) => s + palavras(i.texto).length, 0);
        if (total > mx) { mx = total; n = q.n; }
      }
      return { valor: mx, motivo: `${mx} palavras no quadro ${n}`, quadro: n };
    } },
  menorFonte: { motor: "estilo", descricao: "o menor tamanho de letra legível (op ≥ 0,5) em fração do lado menor do quadro",
    f(ev) {
      let mn = Infinity, onde = "";
      for (const { i, ctx } of percorrer(ev, [{ prop: "temTexto", op: "existe" }, { prop: "op", op: ">=", valor: 0.5 }])) {
        if (!palavras(i.texto).length) continue;
        const v = i.fs / ctx.S;
        if (v < mn) { mn = v; onde = descr(i); }
      }
      return mn === Infinity ? nada("sem texto") : { valor: +mn.toFixed(4), motivo: `${onde}: ${(mn * 100).toFixed(2)} % do lado menor` };
    } },
  textoForaDaFala: { motor: "estilo", descricao: "palavras na tela quase iguais (1 ou 2 letras de diferença) a uma palavra do vocabulário da tarefa, sem serem iguais: erro de grafia ou nome errado",
    f(ev) {
      const l = lingua(ev.tarefa.escrita);
      const voc = new Set([...ev.tarefa.falas.map((p) => p.t), l.titulo, l.chamada, ...l.rotulos, ...ev.tarefa.textos, ...ev.tarefa.dados].flatMap((s) => s.split(/\s+/)).map(norm).filter(Boolean));
      const dist = (a: string, b: string) => {
        const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
        for (let j = 1; j <= b.length; j++) d[0][j] = j;
        for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        return d[a.length][b.length];
      };
      for (const { i, q } of percorrer(ev, [{ prop: "temTexto", op: "existe" }])) {
        for (const w of palavras(i.texto).map(norm)) {
          if (w.length < 4 || voc.has(w) || /\d/.test(w)) continue;
          const perto = [...voc].find((v) => v.length >= 4 && Math.abs(v.length - w.length) <= 2 && dist(v, w) <= 2);
          if (perto) return { valor: 1, motivo: `«${w}» na tela, perto de «${perto}» da fala`, quadro: q.n };
        }
      }
      return { valor: 0, motivo: "texto da tela bate com a fala" };
    } },
  transcricaoRuim: { motor: "estilo", descricao: "legendas com marcas da transcrição automática ruim da biblioteca (rotulos tipo transcricao: ruido) ou entre colchetes",
    f(ev) {
      const ruido = Object.values(ev.rotulos).flatMap((r: any) => r.tipo === "transcricao" ? r.ruido as string[] : []);
      for (const { i, q } of percorrer(ev, [{ prop: "legenda", op: "=", valor: true }])) {
        const w = palavras(i.texto).find((x) => ruido.includes(x) || /^\[.*\]$/.test(x) || x === "♪");
        if (w || /\[[^\]]+\]|♪/.test(i.texto)) return { valor: 1, motivo: `legenda com «${w ?? i.texto.slice(0, 20)}»`, quadro: q.n };
      }
      return { valor: 0, motivo: "legenda limpa" };
    } },
  cartaoFinal: { motor: "estilo", descricao: "no último quadro de amostra: quantos elementos (texto ou logo) empilhados, todos centrados e com tamanho parecido",
    f(ev) {
      const q = amostras(ev).at(-1);
      if (!q) return nada("sem amostra");
      const { L } = dim(ev), vis = visDe(q);
      const its = itens(q).filter((i) => (i.texto && palavras(i.texto).length) || ["img", "svg"].includes(i.tag)).filter((i) => (vis.get(i.k)?.op ?? 0) >= 0.5 && i.papel !== "legenda");
      const cent = its.filter((i) => { const c = vis.get(i.k)!.caixa; return Math.abs(c[0] + c[2] / 2 - L / 2) < 0.03 * L; });
      const altos = cent.map((i) => vis.get(i.k)!.caixa[3]);
      const parecidos = altos.length ? altos.filter((h) => h < 2 * Math.min(...altos)).length : 0;
      return { valor: cent.length === its.length ? parecidos : 0, motivo: `${its.length} elementos no fim, ${cent.length} centrados` };
    } },
  versoesDesencontradas: { motor: "estilo", descricao: "pacotes carregados em mais de uma versão (nome@versão nos src dos scripts)",
    f(ev) {
      const vs = new Map<string, Set<string>>();
      for (const m of ev.fonte.matchAll(/<script[^>]+src="[^"]*?([\w.-]+)@(\d+\.\d+\.\d+)[^"]*"/g)) { if (!vs.has(m[1])) vs.set(m[1], new Set()); vs.get(m[1])!.add(m[2]); }
      const r = [...vs].filter(([, v]) => v.size > 1);
      return { valor: r.length, motivo: r.length ? `${r[0][0]} em ${[...r[0][1]].join(" e ")}` : "uma versão por pacote" };
    } },
  declaracao: { motor: "estilo", descricao: "o bloco de declaração contra a tarefa: p.campo 'id' (1 se o id não é o pedido ou há mais de um bloco), 'tamanho' (diferença relativa de largura e altura)",
    f(ev, p) {
      const blocos = [...ev.fonte.matchAll(/<script[^>]*id="motor-video"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } });
      const d = blocos[0];
      if (!d) return { valor: 1, motivo: "sem bloco de declaração" };
      if (p.campo === "id") return { valor: blocos.length !== 1 || d.id !== ev.tarefa.id ? 1 : 0, motivo: `${blocos.length} bloco(s), id «${d.id}» (pedido «${ev.tarefa.id}»)` };
      const dl = Math.abs(d.largura - ev.tarefa.dim.largura) / ev.tarefa.dim.largura + Math.abs(d.altura - ev.tarefa.dim.altura) / ev.tarefa.dim.altura;
      return { valor: +dl.toFixed(3), motivo: `${d.largura}×${d.altura} (pedido ${ev.tarefa.dim.largura}×${ev.tarefa.dim.altura})` };
    } },
  fundoOpaco: { motor: "estilo", descricao: "tarefa com fundo transparente: elementos opacos de tela cheia e fundo da página opaco; null se a tarefa não pede transparência",
    f(ev) {
      if (!ev.tarefa.transparente) return nada("a tarefa não pede fundo transparente");
      let n = 0, onde = "";
      for (const { i } of percorrer(ev, [{ prop: "areaRel", op: ">=", valor: 0.9 }])) if ((rgba(i.fundo)?.[3] ?? 0) >= 0.5 || ["img", "video"].includes(i.tag)) { n++; onde = descr(i); }
      const est = estatico(ev) as any;
      for (const pg of [est.paginaFundo, est.htmlFundo]) if ((rgba(pg)?.[3] ?? 0) >= 0.5) { n++; onde = `fundo da página ${pg}`; }
      return { valor: n, motivo: n ? `opaco: ${onde}` : "fundo transparente" };
    } },
  midiaHdr: { motor: "estilo", descricao: "mídias na página que a biblioteca rotula como HDR (transferência PQ ou HLG) usadas sem conversão",
    f(ev) {
      const hdr = Object.entries(ev.rotulos).filter(([, r]: any) => /2084|b67|hlg|pq/i.test(String(r.transferencia ?? ""))).map(([a]) => a);
      const usadas = hdr.filter((a) => ev.fonte.includes(`"${a}"`) || ev.fonte.includes(`'${a}'`) || ev.fonte.includes(`src=${a}`));
      return { valor: usadas.length, motivo: usadas.length ? `${usadas[0]} (HDR) na página` : "nenhuma mídia HDR" };
    } },
  audiosNaoDeterministicos: { motor: "estilo", precisa: { duas: true }, descricao: "atributos de mistura (data-volume, data-inicio, data-velocidade) dos <audio> e <video> que mudam entre duas cargas da página",
    f(ev) {
      if (!ev.col2) return nada("sem a segunda coleta");
      const ler = (col: any) => { const q = col.quadros[0]; return JSON.stringify(q?.extra?.estilo?.estatico?.audios ?? null); };
      const a = ler(ev.col), b = ler(ev.col2);
      return { valor: a === b ? 0 : 1, motivo: a === b ? "mistura igual nas duas cargas" : "a mistura muda entre duas cargas" };
    } },
  quadroNaoDeterministico: { motor: "geometria", precisa: { duas: true }, descricao: "elementos cuja caixa, opacidade ou texto muda entre duas cargas da mesma página no mesmo quadro",
    f(ev) {
      if (!ev.col2) return nada("sem a segunda coleta");
      const b = new Map((ev.col2.quadros as any[]).map((q) => [q.n, q]));
      for (const q of quadros(ev) as any[]) {
        const q2 = b.get(q.n);
        if (!q2) continue;
        const va = estilo(q).vis ?? [], vb = estilo(q2).vis ?? [];
        if (va.length !== vb.length) return { valor: 1, motivo: `quadro ${q.n}: ${va.length} × ${vb.length} elementos visíveis`, quadro: q.n };
        for (let k = 0; k < va.length; k++) if (va[k][1].some((x: number, j: number) => Math.abs(x - vb[k][1][j]) > 0.5) || Math.abs(va[k][2] - vb[k][2]) > 0.02)
          return { valor: 1, motivo: `quadro ${q.n}: um elemento em lugar diferente nas duas cargas`, quadro: q.n };
        if (JSON.stringify(q.textos.map((t: any) => t.texto)) !== JSON.stringify(q2.textos.map((t: any) => t.texto))) return { valor: 1, motivo: `quadro ${q.n}: texto diferente nas duas cargas`, quadro: q.n };
      }
      return { valor: 0, motivo: "as duas cargas dão o mesmo quadro" };
    } },
  travou: { motor: "geometria", descricao: "a página segurou um quadro e não soltou (a coleta passou do tempo-limite)",
    f(ev) { return { valor: ev.travou ? 1 : 0, motivo: ev.travou ? "a coleta não terminou: quadro segurado para sempre" : "todos os quadros soltos" }; } },
  tamanhoDaPagina: { motor: "estilo", descricao: "tamanho do index.html entregue, em KB (dados grandes embutidos na página)",
    f(ev) { const kb = Buffer.byteLength(ev.fonte) / 1024; return { valor: +kb.toFixed(1), motivo: `${kb.toFixed(0)} KB` }; } },

  // ===== geometria e tempo =====
  textoSobreRosto: { motor: "geometria", descricao: "quadros com texto legível (op ≥ 0,5) sobre o rosto do apresentador (caixa da mídia rotulada, com a margem do S04)",
    f(ev) {
      let vistos = 0;
      for (const q of quadros(ev) as any[]) {
        const r = rostoNaTela(ev, q);
        if (!r) continue;
        vistos++;
        const zona = comMargem(r);
        for (const t of q.textos) if ((t.opacidade ?? 1) >= LIMITES.opacidadeLegivel) for (const c of t.caixas) if (intersecao(c, zona) > 0)
          return { valor: 1, motivo: `«${t.texto.slice(0, 30)}» sobre o rosto`, quadro: q.n, ocorrencias: ocorrenciasNoRosto(quadros(ev) as Geometria[], (g) => rostoNaTela(ev, g)) };
      }
      return vistos ? { valor: 0, motivo: "rosto livre", ocorrencias: [] } : nada("sem apresentador rotulado na tela");
    } },
  foraDaZonaSegura: { motor: "geometria", descricao: "plataforma vertical (Reels, TikTok, Shorts): textos legíveis fora da zona segura (G19: 14 % em cima, 35 % embaixo, 6 % dos lados da tela do celular, com o quadro posto no meio da tela de 1080 × 1920 na largura); null no YouTube",
    f(ev) {
      const destino = destinoDe(ev.tarefa.plataforma);
      if (destino === "youtube") return nada("o YouTube horizontal não tem a interface por cima");
      if (!destino || !DESTINOS_COM_INTERFACE.has(destino)) return nada("sem destino com a interface por cima (Reels, Instagram, TikTok, Shorts ou anúncio)");
      const { L, A } = dim(ev), { fora } = zonaNaTela(L, A);
      for (const q of quadros(ev) as any[]) for (const t of q.textos) {
        if ((t.opacidade ?? 1) < LIMITES.opacidadeLegivel) continue;
        for (const c0 of t.caixas) if (fora(c0))
          return { valor: 1, motivo: `«${t.texto.slice(0, 30)}» fora da zona segura`, quadro: q.n, ocorrencias: ocorrenciasForaDaZona(quadros(ev) as Geometria[], L, A) };
      }
      return { valor: 0, motivo: "tudo na zona segura", ocorrencias: [] };
    } },
  respiro: { motor: "geometria", descricao: "a menor folga (fração do lado menor) entre um texto legível e a borda do quadro, ou entre dois textos que não se contêm",
    f(ev) {
      let mn = Infinity, onde = "", n = 0;
      const S = lado(ev), { L, A } = dim(ev);
      for (const q of amostras(ev)) {
        const vis = visDe(q);
        const ts = itens(q).filter((i) => i.texto && palavras(i.texto).length && (vis.get(i.k)?.op ?? 0) >= 0.5 && i.tag !== "span").map((i) => ({ i, c: vis.get(i.k)!.caixa }));
        for (const { i, c } of ts) {
          const borda = Math.min(c[0], c[1], L - c[0] - c[2], A - c[1] - c[3]) / S;
          if (borda < mn && borda > -0.5) { mn = borda; onde = `${descr(i)} na borda`; n = q.n; }
          for (const { i: j, c: d } of ts) {
            if (i === j || i.pai === j.id || j.pai === i.id) continue;
            const dx = Math.max(d[0] - (c[0] + c[2]), c[0] - (d[0] + d[2])), dy = Math.max(d[1] - (c[1] + c[3]), c[1] - (d[1] + d[3]));
            const g = Math.max(dx, dy) / S;
            if (g < mn) { mn = g; onde = `${descr(i)} encostado em ${descr(j)}`; n = q.n; }
          }
        }
      }
      return mn === Infinity ? nada("sem texto") : { valor: +mn.toFixed(4), motivo: `${onde}: ${(mn * 100).toFixed(1)} %`, quadro: n };
    } },
  tremor: { motor: "geometria", descricao: "texto legível que treme ou deriva (aviso do S04: 0,05 a 1,5 px por quadro por mais de 5 s): segundos do maior trecho",
    f(ev) {
      if (!ev.col) return nada("sem coleta");
      const avisos = textosTremendo(ev.col.quadros as any, qps(ev));
      const mx = Math.max(0, ...avisos.map((a) => ((a.ate ?? 0) - (a.de ?? 0)) / qps(ev)));
      return { valor: +mx.toFixed(2), motivo: avisos.length ? avisos[0].motivo : "nenhum texto tremendo", quadro: avisos[0]?.de,
        ocorrencias: avisos.map((a) => ({ valor: +(((a.ate ?? 0) - (a.de ?? 0)) / qps(ev)).toFixed(2), de: a.de!, ate: a.ate!, pior: a.de!, motivo: a.motivo })) };
    } },
  legendaQuebrada: { motor: "geometria", descricao: "legendas (data-papel=\"legenda\") em mais de uma linha ou cortadas (saem do quadro ou estouram a caixa), por trecho de quadros seguidos (G17 do S04)",
    f(ev) {
      const qs = quadros(ev) as Geometria[];
      if (!qs.some((q) => q.legendas?.length)) return nada("nenhuma legenda marcada na tela");
      const oc = ocorrenciasDaLegenda(qs, dim(ev).L);
      return { valor: oc.length, motivo: oc.length ? `«${oc[0].texto}»: ${oc[0].motivo}` : "legenda numa linha e inteira", quadro: oc[0]?.pior, ocorrencias: oc };
    } },
  zoomForaDaFrase: { motor: "geometria", descricao: "punch-ins do apresentador que não voltam na pausa depois da frase da palavra de ênfase, ou com a faixa que não sai junto (G21 do S04), pela fala da tarefa",
    f(ev) {
      const qs = quadros(ev) as Geometria[];
      if (!qs.some((q) => q.apresentador)) return nada("nenhum apresentador (data-papel=\"apresentador\") na tela");
      const r = ocorrenciasDoZoom(qs, falas(ev) ?? [], qps(ev), ev.col?.decl.quadros ?? qs.length);
      return { valor: r.ocorrencias.length, motivo: r.ocorrencias[0]?.motivo ?? `${r.zooms.length} zoom(s) na frase`, quadro: r.ocorrencias[0]?.pior,
        ocorrencias: r.ocorrencias, notas: r.notas };
    } },
  legendaAtrasada: { motor: "geometria", descricao: "mediana de |entrada do bloco de legenda − início da primeira palavra dele na fala da tarefa| (s)",
    f(ev) {
      const fs = falas(ev), off: number[] = [];
      for (const b of blocosDeLegenda(ev)) {
        const w = norm(palavras(b.texto)[0] ?? "");
        if (!w) continue;
        const t = tempoDe(ev, b.de);
        const cands = fs.filter((p) => norm(p.t) === w);
        if (!cands.length) continue;
        off.push(Math.min(...cands.map((p) => Math.abs(t - p.ini))));
      }
      if (off.length < 2) return nada("legendas sem palavras da fala");
      off.sort((a, b) => a - b);
      const med = off[Math.floor(off.length / 2)];
      return { valor: +med.toFixed(3), motivo: `legenda a ${med.toFixed(2)} s da fala (mediana de ${off.length})` };
    } },
  coberturaLegenda: { motor: "geometria", descricao: "fração do tempo de fala (palavras da tarefa) com legenda na tela",
    f(ev) {
      const lq = legendasPorQuadro(ev), fs = falas(ev);
      if (!fs.length) return nada("sem fala");
      let tot = 0, com = 0;
      for (const p of fs) for (let n = Math.round(p.ini * qps(ev)); n < Math.round(p.fim * qps(ev)); n++) { tot++; if (lq[n]?.length) com++; }
      return { valor: +(com / Math.max(1, tot)).toFixed(3), motivo: `${com} de ${tot} quadros de fala com legenda` };
    } },
  tempoDeLeitura: { motor: "geometria", descricao: "o menor tempo na tela (s) de um bloco de legenda com 3 palavras ou mais",
    f(ev) {
      const bs = blocosDeLegenda(ev).filter((b) => palavras(b.texto).length >= 3);
      if (!bs.length) return nada("sem bloco de 3 palavras");
      const mn = Math.min(...bs.map((b) => (b.ate - b.de + 1) / qps(ev)));
      return { valor: +mn.toFixed(3), motivo: `bloco de ${mn.toFixed(2)} s` };
    } },
  corteForaDaBatida: { motor: "geometria", descricao: "a maior distância (em quadros) de um corte à grade de corte da tarefa (batida ou subdivisão)",
    f(ev) {
      const t = ev.tarefa, cs = cortes(ev);
      if (!cs.length) return nada("sem corte");
      let mx = 0, em = 0;
      for (const n of cs) { const s = tempoDe(ev, n), k = Math.round((s - t.fase) / t.grade), d = Math.abs(s - (t.fase + k * t.grade)) * qps(ev); if (d > mx) { mx = d; em = n; } }
      return { valor: +mx.toFixed(2), motivo: `corte no quadro ${em} a ${mx.toFixed(1)} quadros da grade`, quadro: em };
    } },
  corteNaPalavra: { motor: "geometria", descricao: "cortes que caem dentro de uma palavra da fala",
    f(ev) {
      const cs = cortes(ev);
      if (!cs.length) return nada("sem corte");
      const r = cs.filter((n) => dentroDePalavra(ev, tempoDe(ev, n)));
      return { valor: r.length, motivo: r.length ? `corte no quadro ${r[0]}, dentro de «${dentroDePalavra(ev, tempoDe(ev, r[0]))!.t}»` : "cortes nas pausas", quadro: r[0] };
    } },
  jumpCut: { motor: "geometria", descricao: "trocas de take do mesmo apresentador com enquadramento quase igual (escala < 8 % e deslocamento < 3 % da largura)",
    f(ev) {
      const { L } = dim(ev);
      let ant: any = null, n = 0, primeiro: number | undefined;
      for (const q of quadros(ev) as any[]) {
        if (q.apresentador && q.take) {
          if (ant && ant.take !== q.take && Math.abs(q.n - ant.n) <= 1) {
            const e = q.apresentador[2] / ant.apresentador[2], dx = Math.abs(q.apresentador[0] + q.apresentador[2] / 2 - ant.apresentador[0] - ant.apresentador[2] / 2);
            if (Math.abs(e - 1) < 0.08 && dx < 0.03 * L) { n++; primeiro ??= q.n; }
          }
          ant = q;
        } else ant = null;
      }
      return { valor: n, motivo: n ? `jump cut no quadro ${primeiro}` : "trocas de take com mudança de enquadramento", quadro: primeiro };
    } },
  duasCenas: { motor: "geometria", descricao: "quadros depois de um corte em que um elemento de tela cheia da cena que sai continua visível e opaco (op ≥ 0,9) com a nova",
    f(ev) {
      const { L, A } = dim(ev), qs = quadros(ev) as any[];
      let mx = 0, em = 0;
      for (const n of cortes(ev)) {
        const antes = visDe(qs[n - 1]), depois = visDe(qs[Math.min(qs.length - 1, n + qps(ev))]);
        // A cena que sai: tela cheia antes do corte e fora da tela 1 s depois (o fundo fixo fica de fora).
        const cheios = [...antes].filter(([k, v]) => v.caixa[2] * v.caixa[3] >= 0.9 * L * A && v.op >= 0.9 && !depois.has(k)).map(([k]) => k);
        let f = 0;
        // Conta enquanto a cena que sai segue opaca e parada na opacidade (a que já esmaece é transição pensada).
        for (let m = n; m < Math.min(qs.length, n + qps(ev)); m++) {
          const v = visDe(qs[m]), u = visDe(qs[m - 1]);
          if (cheios.some((k) => (v.get(k)?.op ?? 0) >= 0.9 && (u.get(k)?.op ?? 0) - (v.get(k)?.op ?? 0) < 0.02 && Math.abs((v.get(k)?.caixa[0] ?? 0) - (u.get(k)?.caixa[0] ?? 0)) < 1)) f++; else break;
        }
        if (f > mx) { mx = f; em = n; }
      }
      return { valor: mx, motivo: mx ? `${mx} quadros com as duas cenas a partir do ${em}` : "a cena que sai some no corte", quadro: em };
    } },
  transicoes: { motor: "geometria", descricao: "fração dos cortes com transição de efeito (a cena que entra ou sai anda ou esmaece nos 6 quadros do corte); null com menos de p.minimo cortes",
    f(ev, p) {
      const qs = quadros(ev) as any[], { L, A } = dim(ev), cs = cortes(ev);
      if (cs.length < (p.minimo ?? 2)) return nada(`só ${cs.length} corte(s)`);
      let com = 0;
      for (const n of cs) {
        let efeito = false;
        for (let m = Math.max(1, n - 6); m < Math.min(qs.length, n + 6) && !efeito; m++) {
          const a = visDe(qs[m - 1]), b = visDe(qs[m]);
          for (const [k, v] of b) {
            if (v.caixa[2] * v.caixa[3] < 0.9 * L * A) continue;
            const u = a.get(k);
            if (u && (Math.abs(u.op - v.op) > 0.05 || Math.abs(u.caixa[0] - v.caixa[0]) > 2)) { efeito = true; break; }
          }
        }
        if (efeito) com++;
      }
      return { valor: +(com / cs.length).toFixed(3), motivo: `${com} de ${cs.length} cortes com transição` };
    } },
  direcaoContraditoria: { motor: "geometria", descricao: "emendas com movimento em que a cena que sai e a que entra andam em sentidos opostos na horizontal",
    f(ev) {
      const qs = quadros(ev) as any[], { L, A } = dim(ev);
      let n = 0, em: number | undefined;
      for (const c of cortes(ev)) {
        const vel = (de: number, ate: number) => {
          const r: Record<number, number> = {};
          for (let m = Math.max(1, de); m < Math.min(qs.length, ate); m++) {
            const a = visDe(qs[m - 1]), b = visDe(qs[m]);
            for (const [k, v] of b) { const u = a.get(k); if (u && v.caixa[2] * v.caixa[3] >= 0.9 * L * A) r[k] = (r[k] ?? 0) + v.caixa[0] - u.caixa[0]; }
          }
          return r;
        };
        // Em volta do corte: a cena que já estava (visível no quadro antes) e a que entra, cada uma com o quanto andou.
        const ja = visDe(qs[c - 1]), andou = vel(c - 6, c + 10);
        const sai = Object.entries(andou).find(([k, x]) => ja.has(Number(k)) && Math.abs(x) > 0.05 * L)?.[1];
        const entra = Object.entries(andou).find(([k, x]) => !ja.has(Number(k)) && Math.abs(x) > 0.05 * L)?.[1];
        if (sai !== undefined && entra !== undefined && Math.sign(sai) !== Math.sign(entra)) { n++; em ??= c; }
      }
      return { valor: n, motivo: n ? `no corte ${em}, uma cena sai para um lado e a outra entra pelo mesmo lado` : "direções coerentes", quadro: em };
    } },
  fimSeco: { motor: "geometria", descricao: "segundos entre o fim da última palavra da fala e o fim do vídeo",
    f(ev) {
      const fs = falas(ev);
      if (!fs.length) return nada("sem fala");
      const fim = (ev.col?.decl.quadros ?? ev.tarefa.quadros) / qps(ev), v = fim - fs.at(-1)!.fim;
      return { valor: +v.toFixed(3), motivo: `${v.toFixed(2)} s depois da última palavra` };
    } },
  falaCortada: { motor: "geometria", descricao: "segundos de fala da tarefa que passam do fim declarado do vídeo",
    f(ev) {
      const fs = falas(ev);
      if (!fs.length) return nada("sem fala");
      const fim = (ev.col?.decl.quadros ?? ev.tarefa.quadros) / qps(ev), v = Math.max(0, fs.at(-1)!.fim - fim);
      return { valor: +v.toFixed(3), motivo: v > 0 ? `${v.toFixed(2)} s de fala depois do fim` : "a fala cabe" };
    } },
  duracaoDestino: { motor: "geometria", descricao: "duração declarada sobre o máximo do destino da tarefa (> 1: longo demais) — ou o mínimo sobre ela, se for curto",
    f(ev) {
      const d = (ev.col?.decl.quadros ?? ev.tarefa.quadros) / qps(ev), t = ev.tarefa;
      const v = Math.max(d / t.duracaoMax, t.duracaoMin / d);
      return { valor: +v.toFixed(3), motivo: `${d.toFixed(1)} s para ${t.plataforma} (${t.duracaoMin} a ${t.duracaoMax} s)` };
    } },
  primeiroQuadro: { motor: "geometria", descricao: "segundos até aparecer o gancho: apresentador, mídia ou texto legível que não seja só o logo",
    f(ev) {
      const { L, A } = dim(ev);
      const opacos = new Set<number>();
      for (const q of amostras(ev)) for (const i of itens(q)) if ((rgba(i.fundo)?.[3] ?? 0) >= 0.95 && !i.texto) opacos.add(i.k);
      for (const q of amostrasTodas(ev)) {
        // Um elemento opaco de tela cheia por cima de tudo (o último visível) tapa o quadro.
        const vis = estilo(q).vis ?? [], ult = vis.at(-1);
        if (ult && opacos.has(ult[0]) && ult[2] >= 0.9 && ult[1][2] * ult[1][3] >= 0.9 * L * A) continue;
        if (q.apresentador) return { valor: tempoDe(ev, q.n), motivo: `apresentador no quadro ${q.n}` };
        if (q.textos.some((t: any) => (t.opacidade ?? 1) >= 0.5 && palavras(t.texto).length)) return { valor: tempoDe(ev, q.n), motivo: `texto no quadro ${q.n}` };
        if ((q.extra?.midias ?? []).some((m: any) => m.op >= 0.5 && m.caixa[2] * m.caixa[3] >= 0.1 * L * A && !/logo/.test(m.src))) return { valor: tempoDe(ev, q.n), motivo: `mídia no quadro ${q.n}` };
      }
      return { valor: 99, motivo: "nada aparece" };
    } },
  telaVazia: { motor: "geometria", descricao: "o maior trecho (quadros) no meio do vídeo (fora do primeiro e do último meio segundo) só com o fundo: nenhum texto, mídia ou apresentador",
    f(ev) {
      const qs = quadros(ev) as any[], m = Math.round(qps(ev) / 2), { L, A } = dim(ev);
      let mx = 0, atual = 0, em = 0;
      for (const q of qs) {
        if (q.n < m || q.n >= qs.length - m) { atual = 0; continue; }
        const vazio = !q.apresentador && !q.textos.some((t: any) => (t.opacidade ?? 1) >= 0.1) && !(q.extra?.midias ?? []).some((x: any) => x.op >= 0.1 && x.caixa[2] * x.caixa[3] < 0.9 * L * A);
        atual = vazio ? atual + 1 : 0;
        if (atual > mx) { mx = atual; em = q.n - atual + 1; }
      }
      return { valor: mx, motivo: mx ? `${mx} quadros só com o fundo a partir do ${em}` : "sem tela vazia", quadro: em };
    } },
  semMudanca: { motor: "geometria", descricao: "o maior trecho (s) sem mudança visual (nada aparece, some ou anda mais de 0,5 px) e sem fala",
    f(ev) {
      const qs = quadros(ev) as any[], fs = falas(ev);
      let mx = 0, ini = 0, em = 0;
      for (let k = 1; k < qs.length; k++) {
        const a = visDe(qs[k - 1]), b = visDe(qs[k]);
        let muda = a.size !== b.size || qs[k].take !== qs[k - 1].take;
        if (!muda) for (const [kk, v] of b) { const u = a.get(kk); if (!u || Math.abs(u.op - v.op) > 0.01 || v.caixa.some((x, j) => Math.abs(x - u.caixa[j]) > 0.5)) { muda = true; break; } }
        const s = tempoDe(ev, k), falando = fs.some((p) => s >= p.ini - 0.05 && s <= p.fim + 0.05);
        if (muda || falando) ini = k;
        const d = (k - ini) / qps(ev);
        if (d > mx) { mx = d; em = ini; }
      }
      return { valor: +mx.toFixed(2), motivo: `${mx.toFixed(1)} s parado e sem fala a partir do quadro ${em}`, quadro: em };
    } },
  laco: { motor: "sinal", precisa: { render: true }, descricao: "tarefa em laço: porcentagem dos pixels que mudam mais de 24 níveis (num canal) entre o primeiro e o último quadro do MP4; null fora de laço",
    f(ev) {
      if (!ev.tarefa.laco) return nada("a tarefa não é laço");
      if (!ev.mp4) return nada("sem render");
      const { quadros: n } = dimensoes(ev.mp4);
      const m = quadrosRgb(ev.mp4, [0, n - 1]);
      const a = m.get(0), b = m.get(n - 1);
      if (!a || !b) return nada("quadros não lidos");
      let difs = 0;
      for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i] - b[i]) > 24 || Math.abs(a[i + 1] - b[i + 1]) > 24 || Math.abs(a[i + 2] - b[i + 2]) > 24) difs++;
      const v = (100 * difs) / (a.length / 3);
      return { valor: +v.toFixed(3), motivo: `primeiro × último quadro: ${v.toFixed(2)} % dos pixels diferentes` };
    } },
  movimentoSemCausa: { motor: "geometria", descricao: "animações contínuas (laço ou ≥ 2 s) de elementos sem texto que começam longe (> p.tol s) de palavra, batida e corte",
    f(ev, p) {
      const tol = p.tol ?? 0.15;
      const a = estatico(ev).anims.filter((x) => (x.iter < 0 || x.iter >= 3 || x.dur >= 2000) && !propAnim(x, "alvoTexto", ev) && x.tipo !== "CSSTransition")
        .filter((x) => !pertoDeCausa(ev, x.delay / 1000, tol));
      return { valor: a.length, motivo: a.length ? `${a[0].id ?? "?"} começa em ${(a[0].delay / 1000).toFixed(2)} s sem fala, batida nem corte perto` : "todo movimento com causa" };
    } },
  velocidadeTela: { motor: "geometria", descricao: "elementos grandes (≥ p.area do quadro): a maior velocidade sustentada por p.janela s — p.tipo 'translacao' (larguras por s) ou 'zoom' (fração de escala por s)",
    f(ev, p) {
      const qs = quadros(ev) as any[], { L, A } = dim(ev), j = Math.max(2, Math.round((p.janela ?? 0.5) * qps(ev)));
      const porK = new Map<number, number[]>();
      for (let k = 1; k < qs.length; k++) {
        const a = visDe(qs[k - 1]), b = visDe(qs[k]);
        for (const [kk, v] of b) {
          const u = a.get(kk);
          if (!u || v.caixa[2] * v.caixa[3] < (p.area ?? 0.4) * L * A) continue;
          const val = p.tipo === "zoom" ? Math.abs(v.caixa[2] / u.caixa[2] - 1) * qps(ev) : (Math.hypot(centro(v.caixa)[0] - centro(u.caixa)[0], centro(v.caixa)[1] - centro(u.caixa)[1]) / L) * qps(ev);
          if (!porK.has(kk)) porK.set(kk, Array(qs.length).fill(0));
          porK.get(kk)![k] = val;
        }
      }
      let mx = 0, em = 0;
      for (const vs of porK.values()) for (let k = 0; k + j <= vs.length; k++) { const m = Math.min(...vs.slice(k, k + j)); if (m > mx) { mx = m; em = k; } }
      return { valor: +mx.toFixed(3), motivo: `${mx.toFixed(2)} ${p.tipo === "zoom" ? "de escala" : "larguras"} por s, sustentado, a partir do quadro ${em}`, quadro: em };
    } },
  sobressalto: { motor: "geometria", descricao: "o maior salto isolado de um elemento num quadro (fração do lado menor), com os vizinhos parados, fora de corte",
    f(ev) {
      const qs = quadros(ev) as any[], S = lado(ev), cs = new Set(cortes(ev));
      let mx = 0, em = 0;
      const pos = (q: any, k: number) => visDe(q).get(k)?.caixa;
      for (let k = 2; k < qs.length - 1; k++) {
        if (cs.has(k) || cs.has(k - 1) || cs.has(k + 1)) continue;
        for (const [kk, v] of visDe(qs[k])) {
          const a = pos(qs[k - 1], kk), z = pos(qs[k - 2], kk), d = pos(qs[k + 1], kk);
          if (!a || !z || !d || v.caixa[2] * v.caixa[3] > 0.5 * S * S * 4) continue;
          const salto = Math.hypot(v.caixa[0] - a[0], v.caixa[1] - a[1]) / S;
          const antes = Math.hypot(a[0] - z[0], a[1] - z[1]) / S, depois = Math.hypot(d[0] - v.caixa[0], d[1] - v.caixa[1]) / S;
          if (salto > mx && antes < salto / 6 && depois < salto / 6) { mx = salto; em = k; }
        }
      }
      return { valor: +mx.toFixed(4), motivo: mx ? `salto de ${(mx * 100).toFixed(1)} % no quadro ${em}` : "sem salto", quadro: em };
    } },
  repetidosNoMp4: { motor: "sinal", precisa: { render: true }, descricao: "MP4 entregue contra o render da própria página: fração dos quadros com movimento (algo anda mais de p.px, padrão 2 px) em que o entregue fica mais perto do quadro anterior do render que do mesmo quadro (repetido ou atrasado); sem a referência, null",
    f(ev, p) {
      const qs = quadros(ev) as any[];
      if (!ev.mp4 || !ev.mp4Render) return nada("sem o MP4 entregue e o render de referência");
      const cinza = (arq: string) => { const r = spawnSync("ffmpeg", ["-v", "error", "-i", arq, "-vf", "scale=160:-2:flags=area,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 30 }); return r.stdout as Buffer; };
      const { largura, altura } = dimensoes(ev.mp4Render), h = Math.round((altura * 160) / largura / 2) * 2, t = 160 * h;
      const E = cinza(ev.mp4), R = cinza(ev.mp4Render);
      const dif = (a: Buffer, i: number, b: Buffer, j: number) => { let s = 0; for (let x = 0; x < t; x++) s += Math.abs(a[i * t + x] - b[j * t + x]); return s / t; };
      let mov = 0, rep = 0;
      for (let k = 1; k < qs.length && (k + 1) * t <= Math.min(E.length, R.length); k++) {
        const a = visDe(qs[k - 1]), b = visDe(qs[k]);
        let anda = false;
        for (const [kk, v] of b) { const u = a.get(kk); if (u && v.op > 0.5 && v.caixa.some((x, j) => Math.abs(x - u.caixa[j]) > (p.px ?? 2))) { anda = true; break; } }
        if (!anda) continue;
        const d0 = dif(E, k, R, k), d1 = dif(E, k, R, k - 1), dr = dif(R, k, R, k - 1);
        if (dr < 0.3) continue;
        mov++;
        if (d1 < 0.5 * d0) rep++;
      }
      if (mov < 4) return nada("pouco movimento");
      return { valor: +(rep / mov).toFixed(3), motivo: `${rep} de ${mov} quadros de movimento repetidos ou atrasados no MP4 entregue` };
    } },
  quadrosParadosNoMovimento: { motor: "geometria", descricao: "fração dos quadros de movimento (algo anda > 0,5 px no quadro anterior e no seguinte) em que nada anda",
    f(ev) {
      const qs = quadros(ev) as any[];
      const anda = (k: number) => { if (k < 1 || k >= qs.length) return null; const a = visDe(qs[k - 1]), b = visDe(qs[k]); for (const [kk, v] of b) { const u = a.get(kk); if (u && v.caixa.some((x, j) => Math.abs(x - u.caixa[j]) > 0.5)) return true; } return false; };
      const m = qs.map((_, k) => anda(k));
      let mov = 0, parados = 0;
      for (let k = 1; k < qs.length - 1; k++) { if (m[k]) mov++; if (m[k] === false && m[k - 1] && m[k + 1]) parados++; }
      if (mov < 6) return nada("pouco movimento");
      return { valor: +(parados / mov).toFixed(3), motivo: `${parados} quadros parados no meio de ${mov} de movimento` };
    } },
  sumicoSeco: { motor: "geometria", descricao: "elementos visíveis (op ≥ 0,9) que somem de um quadro para o outro fora de corte e fora da legenda",
    f(ev) {
      const qs = quadros(ev) as any[], cs = new Set(cortes(ev)), ls = legendaIds(ev);
      const idDe = new Map<number, Item>();
      for (const q of amostras(ev)) for (const i of itens(q)) idDe.set(i.k, i);
      const fim = qs.length - 1;
      for (let k = 1; k < qs.length; k++) {
        if ([0, 1, 2].some((d) => cs.has(k - d) || cs.has(k + d)) || k >= fim) continue;
        const a = visDe(qs[k - 1]), b = visDe(qs[k]);
        for (const [kk, v] of a) {
          if (v.op < 0.9 || b.has(kk)) continue;
          const i = idDe.get(kk);
          if (!i || ehLegenda(i, ls) || !(i.texto || ["img", "video", "canvas"].includes(i.tag))) continue;
          // Saiu pela borda (deslizando para fora): é saída.
          const { L: LL, A: AA } = dim(ev), cx = v.caixa;
          if (cx[0] < 1 || cx[1] < 1 || cx[0] + cx[2] > LL - 1 || cx[1] + cx[3] > AA - 1) continue;
          return { valor: 1, motivo: `${descr(i)} some sem saída no quadro ${k}`, quadro: k };
        }
      }
      return { valor: 0, motivo: "tudo sai com saída ou no corte" };
    } },
  velocidadeNaEmenda: { motor: "geometria", descricao: "nos cortes: a maior razão entre a velocidade de mídias grandes (≥ 10 % do quadro) nos 3 quadros antes e nos 3 depois (só quando algum lado passa de 1 % da largura por quadro)",
    f(ev) {
      const qs = quadros(ev) as any[], { L, A } = dim(ev);
      const midias = new Set<number>();
      for (const q of amostras(ev)) for (const i of itens(q)) if (["img", "video", "canvas"].includes(i.tag)) midias.add(i.k);
      const vel = (de: number, ate: number) => {
        let mx = 0;
        for (let m = Math.max(1, de); m < Math.min(qs.length, ate); m++) {
          const a = visDe(qs[m - 1]), b = visDe(qs[m]);
          for (const [k, v] of b) { const u = a.get(k); if (u && midias.has(k) && u.op >= 0.95 && v.op >= 0.95 && v.caixa[2] * v.caixa[3] >= 0.1 * L * A && v.caixa[2] * v.caixa[3] < 0.9 * L * A) mx = Math.max(mx, Math.hypot(...[0, 1].map((j) => centro(v.caixa)[j] - centro(u.caixa)[j])) / L, Math.abs(v.caixa[2] / u.caixa[2] - 1)); }
        }
        return mx;
      };
      let pior = 1, em = 0;
      const telaAnda = (c: number) => { for (let m = Math.max(1, c - 3); m < Math.min(qs.length, c + 4); m++) { const a = visDe(qs[m - 1]), b = visDe(qs[m]); for (const [k, v] of b) { const u = a.get(k); if (u && v.caixa[2] * v.caixa[3] >= 0.9 * L * A && Math.abs(v.caixa[0] - u.caixa[0]) > 2) return true; } } return false; };
      for (const c of cortes(ev)) {
        if (telaAnda(c)) continue;
        const a = vel(c - 3, c), b = vel(c + 1, c + 4);
        if (Math.max(a, b) < 0.01) continue;
        const r = Math.max(a, b) / Math.max(Math.min(a, b), 0.002);
        if (r > pior) { pior = r; em = c; }
      }
      return { valor: +pior.toFixed(2), motivo: pior > 1 ? `no corte ${em}, velocidade muda ${pior.toFixed(1)}×` : "sem movimento nos cortes", quadro: em };
    } },
  rostoTapadoNaEnfase: { motor: "geometria", descricao: "quadros da palavra de ênfase da tarefa em que o rosto do apresentador está tapado (≥ 50 %) por mídia ou elemento opaco posto depois dele, ou fora da tela",
    f(ev) {
      const t = ev.tarefa, w = t.falas[t.enfase[0]];
      if (!w) return nada("sem ênfase");
      const qs = quadros(ev) as any[];
      if (!qs.some((q) => rostoNaTela(ev, q))) return nada("sem apresentador no vídeo");
      // Os itens de estilo de todas as amostras (o que entra entre duas amostras também conta).
      const porK = new Map<number, Item>();
      for (const q of amostras(ev)) for (const i of itens(q)) if (!porK.has(i.k)) porK.set(i.k, i);
      const todosOsItens = [...porK.values()];
      let tapados = 0, total = 0;
      for (let n = Math.round(w.ini * qps(ev)); n <= Math.round(w.fim * qps(ev)) && n < qs.length; n++) {
        total++;
        const q = qs[n], r = rostoNaTela(ev, q);
        const css = todosOsItens;
        if (!r) { tapados++; continue; }
        const vis = estilo(q).vis ?? [];
        const iAp = vis.findIndex(([k]: any) => css.some((i) => i.k === k && i.papel === "apresentador"));
        if (iAp < 0) return nada("o apresentador não está marcado (data-papel=\"apresentador\")");
        for (const [k, c, op] of vis.slice(iAp + 1)) {
          const i = css.find((x) => x.k === k);
          if (op < 0.9 || !i || i.papel === "legenda") continue;
          const opaco = ["img", "video", "canvas"].includes(i.tag) || (rgba(i.fundo)?.[3] ?? 0) >= 0.9;
          if (opaco && intersecao(c, r) >= 0.5 * r[2] * r[3]) { tapados++; break; }
        }
      }
      return total ? { valor: tapados, motivo: `${tapados} de ${total} quadros da ênfase sem o rosto` } : nada("ênfase fora do vídeo");
    } },
  reenquadro: { motor: "geometria", descricao: "o apresentador no formato da tarefa: p.tipo 'faixas' dá a fração do quadro sem a imagem dele (barras); 'rosto', a fração do rosto fora do quadro",
    f(ev, p) {
      const { L, A } = dim(ev);
      let pior = 0, vistos = 0;
      for (const q of quadros(ev) as any[]) {
        const m = (q.extra?.midias ?? []).find((x: any) => Object.entries(ev.rotulos).some(([arq, r]: any) => r.tipo === "apresentador" && x.src.endsWith(arq)));
        if (!m) continue;
        vistos++;
        if (p.tipo === "faixas") {
          const c = m.conteudo, dentro = Math.max(0, Math.min(c[0] + c[2], L) - Math.max(c[0], 0)) * Math.max(0, Math.min(c[1] + c[3], A) - Math.max(c[1], 0));
          pior = Math.max(pior, 1 - dentro / (L * A));
        } else {
          const r = rostoNaTela(ev, q)!, dentro = Math.max(0, Math.min(r[0] + r[2], L) - Math.max(r[0], 0)) * Math.max(0, Math.min(r[1] + r[3], A) - Math.max(r[1], 0));
          pior = Math.max(pior, 1 - dentro / (r[2] * r[3]));
        }
      }
      return vistos ? { valor: +pior.toFixed(3), motivo: `${(pior * 100).toFixed(0)} % ${p.tipo === "faixas" ? "do quadro sem imagem" : "do rosto fora"}` } : nada("sem apresentador rotulado");
    } },
  coberturaDaPalavra: { motor: "geometria", descricao: "trechos de mídia de cobertura (rotulada) na tela cuja palavra do rótulo não é falada durante o trecho (±0,3 s)",
    f(ev) {
      const qs = quadros(ev) as any[], trechos = new Map<string, { de: number; ate: number; rot: string }>();
      for (const q of qs) for (const m of q.extra?.midias ?? []) {
        const e = Object.entries(ev.rotulos).find(([arq, r]: any) => r.tipo === "cobertura" && m.src.endsWith(arq));
        if (!e || m.op < 0.5) continue;
        const k = `${m.k}`, tr = trechos.get(k);
        if (tr) tr.ate = q.n; else trechos.set(k, { de: q.n, ate: q.n, rot: String((e[1] as any).rotulo) });
      }
      if (!trechos.size) return nada("sem cobertura rotulada");
      const errados = [...trechos.values()].filter((tr) => !falas(ev).some((p) => norm(p.t) === norm(tr.rot) && p.ini >= tempoDe(ev, tr.de) - 0.3 && p.ini <= tempoDe(ev, tr.ate) + 0.3));
      return { valor: errados.length, motivo: errados.length ? `cobertura «${errados[0].rot}» sem a palavra na fala (quadros ${errados[0].de}–${errados[0].ate})` : "cada cobertura com a sua palavra", quadro: errados[0]?.de };
    } },

  // ===== sinal e metadado =====
  semSom: { motor: "sinal", precisa: { render: true }, descricao: "nível (dB) do som do MP4 durante a fala da tarefa",
    f(ev) {
      const a = som(ev);
      if (!a) return nada("sem render");
      if (!a.length) return { valor: -120, motivo: "o MP4 não tem áudio" };
      const r = rms(a), fs = falas(ev);
      if (!fs.length) return nada("sem fala");
      const v = fs.flatMap((p) => r.slice(Math.round(p.ini * 100), Math.round(p.fim * 100)));
      const m = Math.sqrt(v.reduce((s, x) => s + x * x, 0) / Math.max(1, v.length));
      return { valor: +(20 * Math.log10(Math.max(m, 1e-6))).toFixed(1), motivo: `${(20 * Math.log10(Math.max(m, 1e-6))).toFixed(1)} dBFS na fala` };
    } },
  nivelDaVoz: { motor: "sinal", precisa: { render: true }, descricao: "nível (dB) do tom da voz rotulada no som do MP4, mediana nas palavras da fala da tarefa",
    f(ev) {
      const a = som(ev), voz = Object.values(ev.rotulos).find((r: any) => r.tipo === "voz") as any;
      if (!a) return nada("sem render");
      if (!voz) return nada("sem voz na biblioteca");
      if (!a.length) return { valor: -120, motivo: "o MP4 não tem áudio" };
      const v = tom(a, voz.hz, 16000, 0.02);
      const r = falas(ev).flatMap((p) => v.slice(Math.round((p.ini + 0.03) * 50), Math.round((p.fim - 0.03) * 50))).map(db).sort((x, y) => x - y);
      if (!r.length) return nada("sem fala");
      const med = r[Math.floor(r.length / 2)];
      return { valor: +med.toFixed(1), motivo: `voz a ${med.toFixed(1)} dB` };
    } },
  trilhaSobreVoz: { motor: "sinal", precisa: { render: true }, descricao: "mediana (dB) da voz sobre a trilha durante a fala, pelos tons da biblioteca rotulada (voz e trilha)",
    f(ev) {
      const a = som(ev), voz = Object.values(ev.rotulos).find((r: any) => r.tipo === "voz") as any, tr = Object.values(ev.rotulos).find((r: any) => r.tipo === "trilha") as any;
      if (!a) return nada("sem render");
      if (!tr) return nada("sem trilha");
      const v = tom(a, voz.hz, 16000, 0.02), m = tom(a, tr.hz, 16000, 0.02), r: number[] = [];
      for (const p of falas(ev)) for (let i = Math.round((p.ini + 0.03) * 50); i < Math.round((p.fim - 0.03) * 50); i++) if (v[i] !== undefined) r.push(db(v[i]) - db(m[i]));
      if (!r.length) return nada("sem fala");
      const nivelVoz = falas(ev).flatMap((p) => v.slice(Math.round((p.ini + 0.03) * 50), Math.round((p.fim - 0.03) * 50))).sort((x, y) => x - y);
      if (db(nivelVoz[Math.floor(nivelVoz.length / 2)] ?? 0) < -50) return nada("sem voz no som: não há o que a trilha cobrir");
      r.sort((x, y) => x - y);
      const med = r[Math.floor(r.length / 2)];
      return { valor: +med.toFixed(1), motivo: `voz ${med.toFixed(1)} dB acima da trilha` };
    } },
  loudness: { motor: "sinal", precisa: { render: true }, descricao: "loudness integrada do MP4 (EBU R128, ITU-R BS.1770): com p.min e p.max, quantos LU ela fica fora da faixa [p.min, p.max] (0 dentro); sem eles, a distância (LU) ao alvo p.alvo (padrão −14 LUFS)",
    f(ev, p) {
      if (!ev.mp4) return nada("sem render");
      const r = spawnSync("ffmpeg", ["-v", "info", "-nostats", "-i", ev.mp4, "-map", "0:a:0?", "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
      const m = [...(r.stderr ?? "").matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1);
      if (!m) return { valor: 99, motivo: "sem áudio para medir" };
      const i = Number(m[1]);
      if ((p.min === undefined) !== (p.max === undefined)) throw new Error("loudness: p.min e p.max vão juntos");
      if (p.min !== undefined && p.max !== undefined)
        return { valor: +foraDaFaixa(i, p.min, p.max).toFixed(1), motivo: `${m[1]} LUFS (faixa ${p.min} a ${p.max})` };
      const v = Math.abs(i - (p.alvo ?? -14));
      return { valor: +v.toFixed(1), motivo: `${m[1]} LUFS (alvo ${p.alvo ?? -14})` };
    } },
  clipping: { motor: "sinal", precisa: { render: true }, descricao: "fração das amostras do áudio do MP4 no teto (|x| ≥ 0,99)",
    f(ev) {
      const a = som(ev);
      if (!a) return nada("sem render");
      if (!a.length) return nada("sem áudio");
      let n = 0;
      for (const x of a) if (Math.abs(x) >= 0.99) n++;
      return { valor: +(n / a.length).toFixed(5), motivo: `${((n / a.length) * 100).toFixed(2)} % das amostras no teto` };
    } },
  entradaSeca: { motor: "sinal", precisa: { render: true }, descricao: "trilha (tom rotulado): nível nos primeiros e nos últimos 30 ms em que soa, sobre o nível típico (≥ 0,5: entra ou sai sem fade)",
    f(ev) {
      const a = som(ev), tr = Object.values(ev.rotulos).find((r: any) => r.tipo === "trilha") as any;
      if (!a) return nada("sem render");
      if (!tr) return nada("sem trilha");
      const t = tom(a, tr.hz, 16000, 0.01).map(Math.sqrt), s = [...t].sort((x, y) => x - y), tipico = s[Math.floor(s.length * 0.9)] || 1e-9;
      const ligado = t.map((v) => v > tipico * 0.03);
      const i0 = ligado.indexOf(true), i1 = ligado.lastIndexOf(true);
      if (i0 < 0) return nada("trilha muda");
      const ini = Math.max(...t.slice(i0, i0 + 3)) / tipico, fim = Math.max(...t.slice(Math.max(0, i1 - 2), i1 + 1)) / tipico;
      const v = Math.max(ini, fim);
      return { valor: +v.toFixed(3), motivo: `trilha começa em ${(ini * 100).toFixed(0)} % e termina em ${(fim * 100).toFixed(0)} % do nível` };
    } },
  efeitoEncurtado: { motor: "sinal", precisa: { render: true }, descricao: "duração do efeito sonoro rotulado no MP4 sobre a duração dele na biblioteca",
    f(ev) {
      const a = som(ev), ef = Object.entries(ev.rotulos).find(([, r]: any) => r.tipo === "efeito") as any;
      if (!a) return nada("sem render");
      if (!ef) return nada("sem efeito sonoro");
      const t = tom(a, ef[1].hz, 16000, 0.005), pico = Math.max(...t, 1e-12);
      const dur = t.filter((v) => v > pico * 0.1).length * 0.005;
      const orig = Number(ef[1].duracao ?? 0.12);
      return { valor: +(dur / orig).toFixed(3), motivo: `efeito de ${(dur * 1000).toFixed(0)} ms (original ${(orig * 1000).toFixed(0)} ms)` };
    } },
  derivaVoz: { motor: "sinal", precisa: { render: true }, descricao: "atraso (ms) da voz no MP4 contra os tempos da fala da tarefa: média no último quinto menos no primeiro; p.modo 'velocidade' dá |inclinação × velocidade pedida − 1|",
    f(ev, p) {
      const a = som(ev), voz = Object.values(ev.rotulos).find((r: any) => r.tipo === "voz") as any;
      if (!a) return nada("sem render");
      if (!a.length) return nada("sem áudio");
      const ons = inicios(a, voz.hz), fs = falas(ev);
      if (fs.length < 5 || ons.length < 5) return nada("fala curta demais");
      // Casa cada palavra com o começo de tom mais perto (até 0,6 s).
      // Um começo de tom por palavra: casa pela ordem quando as contas batem (a voz em outra velocidade se afasta mais
      // que qualquer janela); senão, o começo mais perto (até 0,6 s).
      const pares = (ons.length <= fs.length + Math.max(2, fs.length * 0.1) && ons.length >= fs.length * 0.5 ? fs.slice(0, ons.length).map((w, i) => [w.ini, ons[i]])
        : fs.map((w) => { const o = ons.reduce((m, x) => (Math.abs(x - w.ini) < Math.abs(m - w.ini) ? x : m), Infinity); return Math.abs(o - w.ini) < 0.6 ? [w.ini, o] : null; }).filter(Boolean)) as number[][];
      if (pares.length < 5) return nada("voz não encontrada");
      const n = pares.length, mx = pares.reduce((s, x) => s + x[0], 0) / n, my = pares.reduce((s, x) => s + x[1], 0) / n;
      const incl = pares.reduce((s, x) => s + (x[0] - mx) * (x[1] - my), 0) / pares.reduce((s, x) => s + (x[0] - mx) ** 2, 0);
      if (p.modo === "velocidade") {
        const v = Math.abs(incl - 1);
        return { valor: +v.toFixed(4), motivo: `a voz anda ${(1 / incl).toFixed(3)}× o tempo da página` };
      }
      // Deriva é afastamento lento; mudança de velocidade (|inclinação − 1| > p.ate) é outra coisa (K-AUD-07).
      if (p.ate !== undefined && Math.abs(incl - 1) > p.ate) return { valor: 0, motivo: `a voz anda ${(1 / incl).toFixed(3)}×: mudança de velocidade, não deriva` };
      const k = Math.max(2, Math.floor(pares.length / 5));
      const med = (xs: number[][]) => xs.reduce((s, x) => s + (x[1] - x[0]), 0) / xs.length;
      const v = Math.abs(med(pares.slice(-k)) - med(pares.slice(0, k))) * 1000;
      return { valor: +v.toFixed(1), motivo: `a voz se afasta ${v.toFixed(0)} ms do começo ao fim` };
    } },
  efeitoAtrasado: { motor: "sinal", precisa: { render: true }, descricao: "atraso (quadros) do efeito sonoro rotulado contra a entrada visual mais perto antes dele (elemento que aparece)",
    f(ev) {
      const a = som(ev), ef = Object.entries(ev.rotulos).find(([, r]: any) => r.tipo === "efeito") as any;
      if (!a) return nada("sem render");
      if (!ef) return nada("sem efeito sonoro");
      const s = inicios(a, ef[1].hz, 0.2)[0];
      if (s === undefined) return nada("efeito não encontrado no som");
      const qs = quadros(ev) as any[];
      let melhor = Infinity;
      for (let k = 1; k < qs.length; k++) {
        const antes = visDe(qs[k - 1]);
        // A entrada começa entre o último quadro sem o elemento e o primeiro com ele: conta o anterior.
        for (const [kk] of visDe(qs[k])) if (!antes.has(kk)) { const d = s - tempoDe(ev, k - 1); if (Math.abs(d) < Math.abs(melhor) && Math.abs(d) < 0.6) melhor = d; }
      }
      if (melhor === Infinity) return nada("nenhuma entrada visual perto do efeito");
      const v = melhor * qps(ev);
      return { valor: +v.toFixed(2), motivo: `efeito ${v.toFixed(1)} quadros depois da entrada` };
    } },
  semJL: { motor: "sinal", precisa: { render: true }, descricao: "fração dos cortes em que o som da cena (tons de ambiente rotulados) troca no mesmo quadro da imagem (±1), sem corte em J ou L; null com menos de 2 cortes",
    f(ev) {
      const a = som(ev), amb = Object.values(ev.rotulos).filter((r: any) => r.tipo === "ambiente") as any[];
      if (!a) return nada("sem render");
      if (amb.length < 3) return nada("sem ambiente por cena");
      const cs = cortes(ev);
      if (cs.length < 2) return nada("menos de 2 cortes");
      let secos = 0;
      for (const n of cs) {
        const t = tempoDe(ev, n);
        // O ambiente que começa perto do corte: o primeiro instante em que ele soa.
        const deltas = amb.map((r) => { const o = inicios(a, r.hz, 0.3, 0.01).find((x) => Math.abs(x - t) < 0.6); return o === undefined ? null : o - t; }).filter((x) => x !== null) as number[];
        if (!deltas.length) continue;
        const d = deltas.reduce((m, x) => (Math.abs(x) < Math.abs(m) ? x : m));
        if (Math.abs(d) * qps(ev) <= 1.5) secos++;
      }
      return { valor: +(secos / cs.length).toFixed(3), motivo: `${secos} de ${cs.length} cortes trocam som e imagem juntos` };
    } },
  clarao: { motor: "sinal", precisa: { render: true }, descricao: "o maior número de clarões por segundo (WCAG 2.3.1: par de variações opostas de ≥ 10 % da luminância relativa, com o lado escuro < 0,8), na luma média do quadro",
    f(ev) {
      const ls = lum(ev);
      if (!ls) return nada("sem render");
      const L = ls.map((x) => { const v = x.media / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      const eventos: number[] = [];
      let ref = L[0], dir = 0;
      for (let k = 1; k < L.length; k++) {
        const d = L[k] - ref;
        if (Math.abs(d) >= 0.1 && Math.min(L[k], ref) < 0.8) { const s = Math.sign(d); if (s !== dir) { eventos.push(k); dir = s; } ref = L[k]; }
        else if (Math.sign(L[k] - L[k - 1]) !== dir) ref = L[k];
      }
      let mx = 0;
      for (const e of eventos) mx = Math.max(mx, eventos.filter((x) => x >= e && x < e + qps(ev)).length / 2);
      return { valor: mx, motivo: `${mx} clarões no pior segundo` };
    } },
  canvasVazio: { motor: "sinal", precisa: { render: true }, descricao: "canvas sem desenho no MP4 (desvio da região < 3 níveis) com erro no console da página",
    f(ev) {
      if (!ev.mp4) return nada("sem render");
      const q = (quadros(ev) as any[]).find((x) => (x.extra?.midias ?? []).some((m: any) => m.tag === "canvas" && m.op > 0.5));
      if (!q) return nada("sem canvas na tela");
      const c = q.extra.midias.find((m: any) => m.tag === "canvas").caixa.map(Math.round);
      const { largura } = dimensoes(ev.mp4);
      const px = quadrosRgb(ev.mp4, [q.n + 1]).get(q.n + 1);
      if (!px) return nada("quadro não lido");
      const vs: number[] = [];
      for (let y = c[1] + 2; y < c[1] + c[3] - 2; y += 4) for (let x = c[0] + 2; x < c[0] + c[2] - 2; x += 4) { const i = (y * largura + x) * 3; if (i >= 0 && i < px.length) vs.push(px[i] + px[i + 1] + px[i + 2]); }
      const m = vs.reduce((s, x) => s + x, 0) / vs.length, dp = Math.sqrt(vs.reduce((s, x) => s + (x - m) ** 2, 0) / vs.length) / 3;
      const vazio = dp < 3 && ev.console.length > 0;
      return { valor: vazio ? 1 : 0, motivo: vazio ? `canvas liso (desvio ${dp.toFixed(1)}) e erro no console: ${ev.console[0].slice(0, 60)}` : `canvas com desenho (desvio ${dp.toFixed(1)}) ou sem erro` };
    } },
  memoria: { motor: "sinal", precisa: { render: true, memoria: true }, descricao: "pico de memória (MB): o maior entre o do cgroup da coleta da página (memory.peak) e o do maior processo do render",
    f(ev) {
      const ms = [ev.col?.memoriaMB, ev.render?.memoriaMB].filter((x): x is number => typeof x === "number");
      return ms.length ? { valor: Math.max(...ms), motivo: `${Math.max(...ms)} MB no pico (coleta ${ev.col?.memoriaMB ?? "?"}, render ${ev.render?.memoriaMB ?? "?"})` } : nada("sem medida de memória");
    } },
  arquivoEntregue: { motor: "sinal", precisa: { render: true }, descricao: "metadado do MP4 entregue (ffprobe) contra a tarefa e a plataforma: p.campo 'cor' (etiquetas de cor fora de BT.709 ou ausentes), 'tamanho' (largura e altura diferentes da tarefa), 'codec' (pix_fmt, perfil, qps fora do aceito), 'duracao' (fração de quadros a menos ou a mais que o declarado)",
    f(ev, p) {
      if (!ev.mp4) return nada("sem MP4");
      const j = ffprobe(ev.mp4);
      const v = j?.streams?.find((s: any) => s.codec_type === "video");
      if (!v) return { valor: 1, motivo: "MP4 sem vídeo" };
      if (p.campo === "cor") {
        const ok = [v.color_space, v.color_primaries, v.color_transfer].filter((x) => x === "bt709").length;
        return { valor: 3 - ok, motivo: `cor ${v.color_space ?? "?"}/${v.color_primaries ?? "?"}/${v.color_transfer ?? "?"}` };
      }
      if (p.campo === "tamanho") {
        const d = Math.abs(v.width - ev.tarefa.dim.largura) + Math.abs(v.height - ev.tarefa.dim.altura);
        return { valor: d, motivo: `${v.width}×${v.height} (pedido ${ev.tarefa.dim.largura}×${ev.tarefa.dim.altura})` };
      }
      if (p.campo === "codec") {
        const [a, b] = String(v.r_frame_rate).split("/").map(Number);
        const erros = [v.pix_fmt !== "yuv420p" && `pix_fmt ${v.pix_fmt}`, !/^(Main|High|Constrained Baseline|Baseline)$/.test(v.profile ?? "") && `perfil ${v.profile}`, a / (b || 1) > 60.5 && `qps ${a / b}`].filter(Boolean);
        return { valor: erros.length, motivo: erros.length ? erros.join(", ") : `${v.codec_name} ${v.profile} ${v.pix_fmt}` };
      }
      const n = Number(v.nb_frames ?? dimensoes(ev.mp4).quadros), decl = ev.col?.decl.quadros ?? ev.tarefa.quadros;
      const fr = Math.abs(n - decl) / decl;
      return { valor: +(fr * 100).toFixed(3), motivo: `${n} quadros no arquivo, ${decl} declarados (${(fr * 100).toFixed(2)} %)` };
    } },
};

function amostrasTodas(ev: Evidencia) { return quadros(ev) as any[]; }

/** Quanto `x` fica fora de [min, max] (0 dentro). */
export const foraDaFaixa = (x: number, min: number, max: number) => Math.max(0, min - x, x - max);

/** Aplica a regra (dado) à evidência. `detalhe`: junta as ocorrências que quebram o limite e as notas da medida (a
 * conferência usa; o bench, não, e o resultado dele fica como era). */
export function avaliarRegra(r: Regra, ev: Evidencia, o: { detalhe?: boolean } = {}): Resultado {
  const m = MEDIDAS[r.medida];
  if (!m) return { status: "nao-conferivel", motivo: `medida desconhecida: ${r.medida}` };
  if (!ev.col && m.motor !== "sinal" && r.medida !== "travou" && r.medida !== "fonteRegex" && r.medida !== "tamanhoDaPagina" && r.medida !== "declaracao" && r.medida !== "versoesDesencontradas" && r.medida !== "midiaHdr")
    return { status: "nao-conferivel", motivo: "sem a coleta da página" };
  let v: Valor;
  try { v = m.f(ev, r.p ?? {}); } catch (e) { return { status: "nao-conferivel", motivo: `a medida falhou: ${(e as Error).message.split("\n")[0]}` }; }
  if (v.valor === null || Number.isNaN(v.valor)) return { status: "nao-conferivel", motivo: v.motivo, valor: null };
  const l = r.limite;
  const quebra = (x: number) => r.op === ">" ? x > l : r.op === ">=" ? x >= l : r.op === "<" ? x < l : r.op === "<=" ? x <= l : r.op === "=" ? x === l : x !== l;
  const erro = quebra(v.valor);
  const base: Resultado = { status: erro ? "erro" : "certo", motivo: v.motivo, quadro: v.quadro, valor: v.valor };
  if (!o.detalhe) return base;
  return { ...base, ocorrencias: erro ? juntarOcorrencias((v.ocorrencias ?? []).filter((x) => quebra(x.valor))) : [], notas: v.notas ?? [] };
}

/** Junta as ocorrências amostradas (com `grupo` e `passo`) do mesmo grupo em amostras seguidas num trecho só, com o pior
 * valor (o mais longe do limite: o menor, quando o limite é «abaixo de»; a medida põe o pior primeiro na comparação). */
export function juntarOcorrencias(lista: Ocorrencia[]): Ocorrencia[] {
  const r: Ocorrencia[] = [], aberto = new Map<string, Ocorrencia>();
  for (const x of [...lista].sort((a, b) => a.de - b.de)) {
    if (!x.grupo) { r.push(x); continue; }
    const o = aberto.get(x.grupo);
    if (o && x.de - o.ate <= (x.passo ?? 1)) {
      o.ate = x.ate;
      if (x.valor < o.valor) Object.assign(o, { valor: x.valor, pior: x.pior, caixa: x.caixa, motivo: x.motivo });
    } else { const novo = { ...x }; aberto.set(x.grupo, novo); r.push(novo); }
  }
  return r.map(({ grupo: _, passo: __, ...x }) => x as Ocorrencia).sort((a, b) => a.de - b.de);
}

/** O que uma regra precisa da evidência. */
export function precisaDe(r: Regra) {
  const m = MEDIDAS[r.medida];
  return { render: m?.motor === "sinal" || !!m?.precisa?.render, memoria: !!m?.precisa?.memoria, duas: !!m?.precisa?.duas, antes: !!m?.precisa?.antes, motor: m?.motor ?? "estilo" };
}
