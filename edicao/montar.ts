// `kodecz assemble`: an edit as data (edicao.json, docs/formatos/edicao.md) becomes a composition folder ready for
// `kodecz render`: index.html with the declaration block, :root --fps, the brand, the blocks' markup and files, the
// media, the voice, event sounds and the music ducked under the voice; plus edicao.resolvida.json, the same edit with
// every trigger already in frames. Each block builds its own markup with blocos/<name>/montar.ts (edicao/tipos.ts).
// The page is static HTML and CSS: frame N depends only on N (R03).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { criarContexto } from "./contexto.ts";
import { montarSom, montarTrilha, type Audio, type Som, type Trilha } from "./audio.ts";
import { esc } from "./html.ts";
import type { ContextoMontagem, Gatilho, Item, Montado, Montar, Palavra } from "./tipos.ts";
import { lerDesignMd, paraCss } from "../identidade/design-md.ts";

export const BLOCOS = new URL("../blocos/", import.meta.url).pathname;
/** Built-in item types (not folders of blocos/). */
export const EMBUTIDOS = ["video", "imagem", "audio"] as const;
/** Parameters of a block item that name a media file: published to midia/ before the block is built. */
export const PARAMETROS_DE_MIDIA = ["src", "logo", "imagem", "poster"] as const;
/** Default length of a scene transition, in frames. */
export const DURACAO_TRANSICAO = 15;
/** Without `composicao.quadros`, the video ends this long after the last thing that happens (seconds). */
export const FOLGA_FINAL = 0.5;
const TRANSICOES: Record<string, string> = { fade: "transicao-fade", wipe: "transicao-wipe", deslizar: "transicao-deslizar" };
const DESTINOS = ["reels", "instagram", "anuncio", "tiktok", "shorts", "youtube"];
const CAMPOS_DO_ITEM = new Set(["bloco", "de", "ate", "itens", "transicao"]);

export interface Edicao {
  composicao: { id: string; largura: number; altura: number; fps: number; quadros?: number };
  marca?: string;
  falas?: string;
  voz?: string | { src: string; volume?: number };
  destino?: string;
  itens: Item[];
  sons?: Som[];
  trilha?: Trilha;
}

/** An item with its frames resolved, before its markup. `herdaFim`: its end is its parent's (it follows a change). */
interface No {
  bloco: string; caminho: string; item: Item; params: Record<string, unknown>;
  inicio: number; fim: number; herdaFim: boolean; filhos: No[]; transicao?: unknown;
  /** The resolved end differs from the item's `ate` (a transition kept the scene longer). */
  fimAjustado?: boolean;
}

export interface Resultado {
  /** The edit with every trigger in frames (what edicao.resolvida.json holds). */
  resolvida: Record<string, unknown>;
  avisos: string[];
  quadros: number;
  html: string;
}

class ErroDaEdicao extends Error {}
const erro = (onde: string, msg: string) => new ErroDaEdicao(`${onde}: ${msg}`);
const ehObjeto = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

function lerJson(caminho: string, oQue: string): unknown {
  let texto: string;
  try { texto = readFileSync(caminho, "utf8"); } catch { throw new ErroDaEdicao(`${oQue} not found: ${caminho}`); }
  try { return JSON.parse(texto); } catch (e) { throw new ErroDaEdicao(`${oQue} is not valid JSON (${caminho}): ${(e as Error).message}`); }
}

/** The words file: `{ "palavras": [ { "texto", "inicio", "fim" } ] }`, sorted by start. */
export function lerFalas(caminho: string): Palavra[] {
  const j = lerJson(caminho, "words file («falas»)");
  if (!ehObjeto(j) || !Array.isArray(j.palavras)) throw new ErroDaEdicao(`words file ${caminho}: expected { "palavras": [ { "texto", "inicio", "fim" } ] }`);
  return j.palavras.map((p: unknown, k: number) => {
    const w = p as Record<string, unknown>;
    if (!ehObjeto(w) || typeof w.texto !== "string" || typeof w.inicio !== "number" || typeof w.fim !== "number" ||
      !Number.isFinite(w.inicio) || !Number.isFinite(w.fim) || w.inicio < 0 || w.fim < w.inicio) {
      throw new ErroDaEdicao(`words file ${caminho}: palavras[${k}] must be { "texto": text, "inicio": s ≥ 0, "fim": s ≥ inicio }`);
    }
    return { texto: w.texto, inicio: w.inicio, fim: w.fim };
  }).sort((a: Palavra, b: Palavra) => a.inicio - b.inicio);
}

/** Duration of a media file in seconds (ffprobe), or null when it cannot be read. */
export function duracaoDaMidia(caminho: string): number | null {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", caminho], { encoding: "utf8" });
  const d = Number(r.stdout?.trim());
  return r.status === 0 && Number.isFinite(d) && d > 0 ? d : null;
}

function conferirComposicao(c: unknown): Edicao["composicao"] {
  if (!ehObjeto(c)) throw erro("composicao", "missing: { \"id\", \"largura\", \"altura\", \"fps\" }");
  if (typeof c.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(c.id)) throw erro("composicao.id", "letters, digits, _ and - (it is the <composition> argument of kodecz render)");
  for (const k of ["largura", "altura"] as const) {
    const v = c[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v % 2 || v < 16 || v > 8192) throw erro(`composicao.${k}`, "an even integer from 16 to 8192 px");
  }
  if ((c.largura as number) < 800) throw erro("composicao.largura", "at least 800 px (the frame mark is 800 px wide)");
  if (typeof c.fps !== "number" || !Number.isInteger(c.fps) || c.fps < 1 || c.fps > 240) throw erro("composicao.fps", "an integer from 1 to 240");
  if (c.quadros !== undefined && (typeof c.quadros !== "number" || !Number.isInteger(c.quadros) || c.quadros < 1)) throw erro("composicao.quadros", "an integer ≥ 1 (or leave it out)");
  return c as Edicao["composicao"];
}

/** Every `ate` and `de` of the items, at any depth, in frames (to find the length of the video). */
function fronteiras(itens: Item[], ctx: ContextoMontagem, onde: string): number[] {
  const r: number[] = [];
  itens.forEach((it, k) => {
    const caminho = `${onde}[${k}]`;
    if (!ehObjeto(it)) throw erro(caminho, "an item is an object with «bloco»");
    try {
      if (it.ate !== undefined) r.push(ctx.q(ctx.tempo(it.ate)));
      if (it.de !== undefined) r.push(ctx.q(ctx.tempo(it.de)) + 1);
    } catch (e) { throw erro(caminho, (e as Error).message); }
    if (Array.isArray(it.itens)) r.push(...fronteiras(it.itens, ctx, `${caminho}.itens`));
  });
  return r;
}

function resolverNo(it: Item, pai: { inicio: number; fim: number }, ctx: ContextoMontagem, caminho: string): No {
  if (!ehObjeto(it)) throw erro(caminho, "an item is an object with «bloco»");
  if (typeof it.bloco !== "string" || !it.bloco) throw erro(caminho, "«bloco» is missing (a folder of blocos/, or video, imagem, audio)");
  let inicio: number, fim: number;
  try {
    inicio = it.de === undefined ? pai.inicio : ctx.q(ctx.tempo(it.de));
    fim = it.ate === undefined ? pai.fim : ctx.q(ctx.tempo(it.ate));
  } catch (e) { throw erro(caminho, (e as Error).message); }
  if (fim <= inicio) throw erro(caminho, `ends at frame ${fim}, not after its start (frame ${inicio})`);
  if (it.itens !== undefined && !Array.isArray(it.itens)) throw erro(`${caminho}.itens`, "a list of items");
  const params = Object.fromEntries(Object.entries(it).filter(([k]) => !CAMPOS_DO_ITEM.has(k)));
  const no: No = { bloco: it.bloco, caminho, item: it, params, inicio, fim, herdaFim: it.ate === undefined, filhos: [], transicao: it.transicao };
  no.filhos = (it.itens ?? []).map((f, k) => resolverNo(f, no, ctx, `${caminho}.itens[${k}]`));
  return no;
}

/** A new end for a node and the children that inherit it. */
function mudarFim(no: No, fim: number) {
  no.fim = fim;
  for (const f of no.filhos) if (f.herdaFim) mudarFim(f, fim);
}

/**
 * A scene's `transicao` becomes the transition block around its children; the previous scene of the same list stays
 * until the transition ends (with `deslizar`, it ends exactly there and gets the leaving layer).
 */
function aplicarTransicoes(lista: No[]) {
  let anterior: No | null = null;
  for (const no of lista) {
    if (no.transicao !== undefined && no.bloco !== "cena") throw erro(`${no.caminho}.transicao`, "only a «cena» has a transition");
    if (no.bloco === "cena" && no.transicao !== undefined) {
      const t = no.transicao;
      if (!ehObjeto(t) || typeof t.tipo !== "string" || !Object.hasOwn(TRANSICOES, t.tipo)) {
        throw erro(`${no.caminho}.transicao`, `{ "tipo": ${Object.keys(TRANSICOES).map((x) => `"${x}"`).join(" | ")}, "duracao"?: frames, "lado"? }`);
      }
      const duracao = t.duracao ?? DURACAO_TRANSICAO;
      if (typeof duracao !== "number" || !Number.isInteger(duracao) || duracao < 1) throw erro(`${no.caminho}.transicao.duracao`, "frames, an integer ≥ 1");
      if (duracao >= no.fim - no.inicio) throw erro(`${no.caminho}.transicao.duracao`, `${duracao} frames do not fit in the scene (${no.fim - no.inicio} frames)`);
      const extra = Object.fromEntries(Object.entries(t).filter(([k]) => k !== "tipo"));
      const bloco = TRANSICOES[t.tipo];
      if (anterior) {
        const ate = no.inicio + duracao;
        if (t.tipo === "deslizar") {
          if (anterior.fim < no.inicio) throw erro(`${no.caminho}.transicao`, `a slide needs the previous scene (${anterior.caminho}) to last until this one starts (frame ${no.inicio}); it ends at ${anterior.fim}`);
          if (anterior.fim !== ate) { mudarFim(anterior, ate); anterior.fimAjustado = true; }
          anterior.filhos = [{ bloco, caminho: `${anterior.caminho}(sai)`, item: { bloco }, params: { ...extra, duracao, papel: "sai" },
            inicio: anterior.inicio, fim: anterior.fim, herdaFim: true, filhos: anterior.filhos }];
        } else if (anterior.fim >= no.inicio && anterior.fim < ate) {
          mudarFim(anterior, ate); anterior.fimAjustado = true;
        }
      }
      no.filhos = [{ bloco, caminho: `${no.caminho}(${t.tipo})`, item: { bloco }, params: { ...extra, duracao, ...(t.tipo === "deslizar" ? { papel: "entra" } : {}) },
        inicio: no.inicio, fim: no.fim, herdaFim: true, filhos: no.filhos }];
    }
    if (no.bloco === "cena") anterior = no;
  }
  for (const no of lista) aplicarTransicoes(no.filhos);
}

/** Gatilho-shaped values ({ palavra }, { segundo }, { fimDaFrase }) of a block's parameters, in frames. */
function resolverParametros(v: unknown, ctx: ContextoMontagem): unknown {
  if (Array.isArray(v)) return v.map((x) => resolverParametros(x, ctx));
  if (!ehObjeto(v)) return v;
  if ("palavra" in v || "segundo" in v || "fimDaFrase" in v) {
    try { return ctx.q(ctx.tempo(v as Gatilho)); } catch { /* not a trigger: keep it */ }
  }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolverParametros(x, ctx)]));
}

/** Files published into the composition: media (symlinks to the source) and block files (copies). */
class Publicacao {
  midia = new Map<string, string>(); // real path → published path
  usados = new Set<string>();
  base: string;
  constructor(base: string) { this.base = base; }

  /** A media file of the edit (relative to the edit's folder), published as midia/<name>. */
  publicarMidia(src: unknown, onde: string): string {
    if (typeof src !== "string" || !src.trim()) throw erro(onde, "«src» (the file) is missing");
    if (/^[a-z]+:/i.test(src)) throw erro(onde, `«src» must be a local file, not ${src}`);
    const caminho = resolve(this.base, src);
    if (!existsSync(caminho) || !statSync(caminho).isFile()) throw erro(onde, `file not found: ${src} (paths are relative to the edit's folder)`);
    const real = realpathSync(caminho);
    const ja = this.midia.get(real);
    if (ja) return ja;
    const ext = extname(real), raiz = basename(real, ext).replace(/[^A-Za-z0-9._-]+/g, "-") || "midia";
    let nome = `midia/${raiz}${ext}`;
    for (let k = 2; this.usados.has(nome); k++) nome = `midia/${raiz}-${k}${ext}`;
    this.usados.add(nome);
    this.midia.set(real, nome);
    return nome;
  }
}

async function carregarBloco(pastaBlocos: string, nome: string, cache: Map<string, Montar>): Promise<Montar> {
  const ja = cache.get(nome);
  if (ja) return ja;
  if (!/^[a-z0-9-]+$/.test(nome) || !existsSync(join(pastaBlocos, nome, "KODECZ.md"))) {
    throw new ErroDaEdicao(`unknown block «${nome}»: use a folder of blocos/ (blocos/INDICE.md) or a built-in type (${EMBUTIDOS.join(", ")})`);
  }
  const arquivo = join(pastaBlocos, nome, "montar.ts");
  if (!existsSync(arquivo)) {
    throw new ErroDaEdicao(`block «${nome}» has no assembly yet (blocos/${nome}/montar.ts is missing): kodecz assemble cannot place it; ` +
      `write its markup by hand from blocos/${nome}/bloco.html, or add montar.ts (edicao/tipos.ts)`);
  }
  const m = await import(pathToFileURL(arquivo).href);
  if (typeof m.montar !== "function") throw new ErroDaEdicao(`blocos/${nome}/montar.ts does not export a montar(item, ctx) function`);
  cache.set(nome, m.montar);
  return m.montar;
}

function atributosDeAudio(a: Audio, papel?: string): string {
  const at = [`src="${esc(a.src)}"`, `data-inicio="${a.inicio}"`];
  if (a.quadros !== undefined) at.push(`data-quadros="${a.quadros}"`);
  if (a.recorte) at.push(`data-recorte="${a.recorte}"`);
  if (a.volume !== "1") at.push(`data-volume="${a.volume}"`);
  if (papel) at.push(`data-papel="${esc(papel)}"`);
  return at.join(" ");
}

const AJUSTES = ["cover", "contain", "fill", "none", "scale-down"];

function estiloDeMidia(p: Record<string, unknown>, onde: string, extra = ""): string {
  const ajuste = p.ajuste ?? "cover";
  if (typeof ajuste !== "string" || !AJUSTES.includes(ajuste)) throw erro(`${onde}.ajuste`, `object-fit: ${AJUSTES.join(", ")}`);
  if (p.estilo !== undefined && (typeof p.estilo !== "string" || /[<>]/.test(p.estilo))) throw erro(`${onde}.estilo`, "inline CSS text");
  return esc([extra, ajuste === "cover" ? "" : `object-fit: ${ajuste}`, (p.estilo as string | undefined) ?? ""].filter(Boolean).join("; "));
}

function classes(p: Record<string, unknown>, base: string, onde: string): string {
  if (p.classe === undefined) return base;
  if (typeof p.classe !== "string" || !/^[A-Za-z0-9_ -]+$/.test(p.classe)) throw erro(`${onde}.classe`, "class names");
  return `${base} ${p.classe}`;
}

function numeroDe(p: Record<string, unknown>, campo: string, onde: string, min: number, max: number): number | undefined {
  const v = p[campo];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw erro(`${onde}.${campo}`, `a number from ${min} to ${max}`);
  return v;
}

export interface Opcoes { /** Folder of the blocks (default: blocos/ of this repository). */ blocos?: string }

/**
 * Assembles the edit at `caminhoEdicao` into the folder `saida`: writes index.html, edicao.resolvida.json, marca/,
 * blocos/<name>/… and midia/ (symlinks). Throws on any error of the edit, with where it is.
 */
export async function montarEdicao(caminhoEdicao: string, saida: string, o: Opcoes = {}): Promise<Resultado> {
  const pastaBlocos = o.blocos ?? BLOCOS;
  const j = lerJson(caminhoEdicao, "edit");
  if (!ehObjeto(j)) throw new ErroDaEdicao("the edit is a JSON object: { \"composicao\", \"itens\", … }");
  const e = j as unknown as Edicao;
  const base = dirname(resolve(caminhoEdicao));
  const comp = conferirComposicao(e.composicao);
  if (!Array.isArray(e.itens)) throw erro("itens", "a list of items (it can be empty)");
  if (e.destino !== undefined && (typeof e.destino !== "string" || !DESTINOS.includes(e.destino))) throw erro("destino", DESTINOS.join(", "));
  const avisos: string[] = [];

  const palavras = e.falas === undefined ? [] : lerFalas(resolve(base, String(e.falas)));
  const ctx = criarContexto({ fps: comp.fps, largura: comp.largura, altura: comp.altura, palavras });
  const pub = new Publicacao(base);

  // Voice.
  const voz = e.voz === undefined ? undefined : typeof e.voz === "string" ? { src: e.voz } : e.voz;
  if (voz !== undefined && !ehObjeto(voz)) throw erro("voz", "the voice file, or { \"src\", \"volume\" }");
  let vozAudio: Audio | undefined, duracaoVoz: number | null = null;
  if (voz) {
    const src = pub.publicarMidia(voz.src, "voz");
    duracaoVoz = duracaoDaMidia(resolve(base, voz.src));
    const v = numeroDe(voz as Record<string, unknown>, "volume", "voz", 0, 10);
    vozAudio = { src, inicio: 0, volume: v === undefined ? "1" : String(v) };
  }
  if (voz && palavras.length === 0) avisos.push("there is a voice but no «falas»: word triggers and ducking cannot work");

  // Length of the video.
  let total = comp.quadros;
  if (total === undefined) {
    const candidatos = fronteiras(e.itens, ctx, "itens");
    if (duracaoVoz) candidatos.push(ctx.q(duracaoVoz));
    if (palavras.length) candidatos.push(ctx.q(palavras.at(-1)!.fim + FOLGA_FINAL));
    for (const [k, s] of (e.sons ?? []).entries()) {
      try { if (ehObjeto(s) && s.fim !== undefined) candidatos.push(ctx.q(ctx.tempo(s.fim as Gatilho))); } catch (x) { throw erro(`sons[${k}]`, (x as Error).message); }
    }
    if (candidatos.length === 0) throw erro("composicao.quadros", "nothing gives the length of the video (no voice, no words, no «ate»): set it");
    total = Math.max(...candidatos);
  }

  // Items: frames, transitions, markup.
  const raiz = { inicio: 0, fim: total };
  const nos = e.itens.map((it, k) => resolverNo(it, raiz, ctx, `itens[${k}]`));
  aplicarTransicoes(nos);
  for (const no of nos) if (no.fim > total) avisos.push(`${no.caminho} ends at frame ${no.fim}, after the end of the video (${total})`);

  const cache = new Map<string, Montar>();
  const css: string[] = [], js: string[] = [], heads: string[] = [];
  const arquivosDeBloco = new Map<string, string>(); // published → source
  const registrar = (bloco: string, lista: string[] | undefined, destino: string[], onde: string) => {
    if (lista !== undefined && !Array.isArray(lista)) throw erro(onde, `block «${bloco}» returned css/js that is not a list of paths`);
    for (const rel of lista ?? []) {
      if (typeof rel !== "string") throw erro(onde, `block «${bloco}» returned a css/js entry that is not a path`);
      const n = normalize(rel);
      if (isAbsolute(n) || n.startsWith("..")) throw erro(onde, `block «${bloco}» returned a file outside its folder: ${rel}`);
      const fonte = join(pastaBlocos, bloco, n);
      if (!existsSync(fonte)) throw erro(onde, `block «${bloco}» returned a file that does not exist: blocos/${bloco}/${n}`);
      const publicado = `blocos/${bloco}/${n.split(sep).join("/")}`;
      arquivosDeBloco.set(publicado, fonte);
      if (!destino.includes(publicado)) destino.push(publicado);
    }
  };

  // Each node gives its markup and its CSS in pre-order (its own files, then its children's).
  const montarNo = async (no: No): Promise<{ html: string; css: string[] }> => {
    const p = no.params, onde = no.caminho;
    if (no.bloco === "video") {
      if (no.filhos.length) throw erro(onde, "a video has no «itens»");
      const src = pub.publicarMidia(p.src, onde);
      const at = [`class="${classes(p, "kz-midia", onde)}"`, `src="${esc(src)}"`, `data-inicio="${no.inicio}"`, `data-quadros="${no.fim - no.inicio}"`];
      const recorte = numeroDe(p, "recorte", onde, 0, 1e6);
      if (recorte) at.push(`data-recorte="${ctx.q(recorte)}"`);
      const volume = numeroDe(p, "volume", onde, 0, 10);
      if (volume !== undefined && volume !== 1) at.push(`data-volume="${volume}"`);
      const velocidade = numeroDe(p, "velocidade", onde, 0.1, 10);
      if (velocidade !== undefined && velocidade !== 1) at.push(`data-velocidade="${velocidade}"`);
      if (p.mudo === true) at.push("muted");
      if (p.papel !== undefined) at.push(`data-papel="${esc(p.papel)}"`);
      const st = estiloDeMidia(p, onde);
      if (st) at.push(`style="${st}"`);
      return { html: `<video ${at.join(" ")}></video>`, css: [] };
    }
    if (no.bloco === "imagem") {
      if (no.filhos.length) throw erro(onde, "an image has no «itens»");
      const src = pub.publicarMidia(p.src, onde);
      const st = estiloDeMidia(p, onde, `--inicio: ${no.inicio}; --fim: ${no.fim}`);
      return { html: `<img class="${classes(p, "kz-midia kz-trecho", onde)}" src="${esc(src)}" alt="${esc(p.alt ?? "")}" style="${st}">`, css: [] };
    }
    if (no.bloco === "audio") {
      if (no.filhos.length) throw erro(onde, "an audio has no «itens»");
      const src = pub.publicarMidia(p.src, onde);
      let a: Audio;
      try {
        a = montarSom({ src, em: no.inicio / ctx.fps, fim: no.item.ate === undefined ? undefined : no.fim / ctx.fps,
          volume: p.volume as number | undefined, recorte: p.recorte as number | undefined }, ctx, onde);
      } catch (x) { throw erro(onde, (x as Error).message.replace(`${onde}: `, "")); }
      return { html: `<audio ${atributosDeAudio(a, p.papel as string | undefined)}></audio>`, css: [] };
    }
    const montar = await carregarBloco(pastaBlocos, no.bloco, cache);
    const filhos: { html: string; css: string[] }[] = [];
    for (const f of no.filhos) filhos.push(await montarNo(f));
    const conteudo = filhos.map((f) => f.html).join("\n");
    const item: Record<string, unknown> = { ...no.item, ...p, conteudo };
    delete item.itens; delete item.transicao;
    // Media a block receives (the presenter's take, a logo…) goes to midia/ like the built-ins' and the block gets
    // the published path; a URL or data: stays as is.
    for (const chave of PARAMETROS_DE_MIDIA) {
      const v = item[chave];
      if (typeof v === "string" && v && !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(v)) item[chave] = pub.publicarMidia(v, `${onde}.${chave}`);
    }
    if (no.bloco === "cena" || no.fimAjustado) { item.de = no.inicio / ctx.fps; item.ate = no.fim / ctx.fps; }
    let m: Montado;
    try { m = montar(item, ctx); } catch (x) { throw erro(onde, (x as Error).message); }
    if (!m || typeof m.html !== "string") throw erro(onde, `blocos/${no.bloco}/montar.ts returned no «html»`);
    const proprios: string[] = [];
    registrar(no.bloco, m.css, proprios, onde);
    registrar(no.bloco, m.js, js, onde);
    if (m.head !== undefined && typeof m.head !== "string") throw erro(onde, `blocos/${no.bloco}/montar.ts returned a «head» that is not text`);
    if (m.head && !heads.includes(m.head)) heads.push(m.head);
    return { html: m.html, css: [...proprios, ...filhos.flatMap((f) => f.css)] };
  };
  const corpo: string[] = [];
  for (const no of nos) {
    const r = await montarNo(no);
    corpo.push(r.html);
    for (const c of r.css) if (!css.includes(c)) css.push(c);
  }

  // Sound.
  const audios: string[] = [];
  if (vozAudio) audios.push(`<audio ${atributosDeAudio(vozAudio, "voz")}></audio>`);
  const sons: Audio[] = [];
  if (e.sons !== undefined && !Array.isArray(e.sons)) throw erro("sons", "a list of { \"src\", \"em\", \"volume\", \"antes\"?, \"fim\"? }");
  for (const [k, s] of (e.sons ?? []).entries()) {
    if (!ehObjeto(s)) throw erro(`sons[${k}]`, "{ \"src\", \"em\", \"volume\", \"antes\"?, \"fim\"? }");
    const src = pub.publicarMidia(s.src, `sons[${k}]`);
    const a = montarSom({ ...s, src }, ctx, `sons[${k}]`);
    if (a.inicio >= total) avisos.push(`sons[${k}] starts at frame ${a.inicio}, after the end of the video (${total})`);
    sons.push(a);
    audios.push(`<audio ${atributosDeAudio(a, "som")}></audio>`);
  }
  let trilha: Audio | undefined;
  if (e.trilha !== undefined) {
    if (!ehObjeto(e.trilha)) throw erro("trilha", "{ \"src\", \"volume\", \"abaixarSobVoz\", \"atraso\"?, \"rampaEntrada\"?, \"rampaSaida\"? }");
    const src = pub.publicarMidia(e.trilha.src, "trilha");
    trilha = montarTrilha({ ...e.trilha, src }, ctx, total, "trilha");
    if (trilha.volume !== "0" && (e.trilha.abaixarSobVoz ?? 0) > 0 && palavras.length === 0) avisos.push("trilha: «abaixarSobVoz» without «falas» does nothing");
    audios.push(`<audio ${atributosDeAudio(trilha, "trilha")}></audio>`);
  }

  // Brand.
  let marcaHref: string | undefined;
  const marcaArquivos = new Map<string, string>(); // published → source (css text written separately)
  let marcaCss: string | undefined;
  if (e.marca === undefined) avisos.push("no «marca»: the blocks use their fallback values and the background is not painted");
  else {
    const fonte = resolve(base, String(e.marca));
    if (!existsSync(fonte)) throw erro("marca", `file not found: ${e.marca}`);
    const dir = dirname(fonte);
    if (/\.md$/i.test(fonte)) {
      const r = lerDesignMd(fonte);
      if (!r.ok || !r.tokens) throw erro("marca", `${e.marca} is not a valid DESIGN.md: ${r.erros.map((x) => `${x.caminho}: ${x.mensagem}`).join("; ")}`);
      marcaCss = paraCss(r.tokens);
      for (const f of r.tokens.fonts ?? []) marcaArquivos.set(`marca/${String(f.src)}`, join(dir, String(f.src)));
      marcaHref = "marca/marca.css";
    } else if (/\.css$/i.test(fonte)) {
      marcaCss = readFileSync(fonte, "utf8");
      for (const m of marcaCss.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
        const ref = m[2].trim();
        if (/^(data:|[a-z]+:\/\/|\/)/i.test(ref)) continue;
        const alvo = resolve(dir, ref);
        if (!existsSync(alvo)) throw erro("marca", `${e.marca} refers to ${ref}, which does not exist`);
        if (relative(dir, alvo).startsWith("..")) throw erro("marca", `${e.marca} refers to ${ref}, outside its folder`);
        marcaArquivos.set(`marca/${relative(dir, alvo).split(sep).join("/")}`, alvo);
      }
      marcaHref = `marca/${basename(fonte)}`;
    } else throw erro("marca", "a .css file (CSS variables of the brand) or a DESIGN.md");
  }

  const declaracao = { id: comp.id, width: comp.largura, height: comp.altura, fps: comp.fps, frames: total };
  const html = [
    "<!doctype html>",
    e.destino ? `<html data-destino="${e.destino}">` : "<html>",
    '<meta charset="utf-8">',
    `<title>${esc(comp.id)}</title>`,
    `<!-- Made by kodecz assemble from ${esc(basename(caminhoEdicao))} (docs/formatos/edicao.md); edit the JSON, not this page. -->`,
    `<script type="application/json" id="kodecz">\n${JSON.stringify(declaracao)}\n</script>`,
    ...(marcaHref ? [`<link rel="stylesheet" href="${esc(marcaHref)}">`] : []),
    ...css.map((c) => `<link rel="stylesheet" href="${esc(c)}">`),
    ...heads,
    "<style>",
    `  :root { --fps: ${comp.fps}; }`,
    `  html, body { margin: 0; width: ${comp.largura}px; height: ${comp.altura}px; overflow: hidden; background: var(--color-ground); }`,
    "  .kz-midia { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }",
    "  .kz-trecho { opacity: 0; animation: kz-trecho-entra 0s linear calc(var(--inicio) * 1s / var(--fps)) forwards,",
    "               kz-trecho-sai 0s linear calc(var(--fim) * 1s / var(--fps)) forwards; }",
    "  @keyframes kz-trecho-entra { from, to { opacity: 1; } }",
    "  @keyframes kz-trecho-sai { from, to { opacity: 0; } }",
    "</style>",
    "",
    ...corpo,
    "",
    ...audios,
    ...js.map((s) => `<script src="${esc(s)}"></script>`),
    "",
  ].join("\n");

  const descreverNo = (no: No): Record<string, unknown> => ({
    bloco: no.bloco, de: no.inicio, ate: no.fim, ...(resolverParametros(no.params, ctx) as Record<string, unknown>),
    ...(no.filhos.length ? { itens: no.filhos.map(descreverNo) } : {}),
  });
  const resolvida: Record<string, unknown> = {
    composicao: { ...comp, quadros: total },
    unidade: "frames: every «de», «ate» and «inicio» below is a frame of the composition; «data-volume» points count from the media's start",
    ...(marcaHref ? { marca: marcaHref } : {}),
    ...(e.destino ? { destino: e.destino } : {}),
    ...(vozAudio ? { voz: vozAudio } : {}),
    itens: nos.map(descreverNo),
    sons,
    ...(trilha ? { trilha } : {}),
  };

  // Write.
  mkdirSync(saida, { recursive: true });
  const escrever = (rel: string, conteudo: string) => { const c = join(saida, rel); mkdirSync(dirname(c), { recursive: true }); writeFileSync(c, conteudo); };
  const ligar = (rel: string, alvo: string) => {
    const c = join(saida, rel);
    mkdirSync(dirname(c), { recursive: true });
    if (existsSync(c) || isLink(c)) rmSync(c, { force: true });
    symlinkSync(realpathSync(alvo), c);
  };
  const copiar = (rel: string, fonte: string) => {
    const c = join(saida, rel);
    mkdirSync(dirname(c), { recursive: true });
    if (isLink(c)) rmSync(c, { force: true });
    copyFileSync(fonte, c);
  };
  for (const [real, rel] of pub.midia) ligar(rel, real);
  for (const [rel, fonte] of arquivosDeBloco) copiar(rel, fonte);
  for (const [rel, fonte] of marcaArquivos) ligar(rel, fonte);
  if (marcaHref && marcaCss !== undefined) escrever(marcaHref, marcaCss);
  escrever("index.html", html);
  escrever("edicao.resolvida.json", `${JSON.stringify(resolvida, null, 2)}\n`);
  return { resolvida, avisos, quadros: total, html };
}

function isLink(c: string): boolean {
  try { return lstatSync(c).isSymbolicLink(); } catch { return false; }
}

export { ErroDaEdicao };
