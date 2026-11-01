// Leitor e validador do DESIGN.md da marca (S03). Formato em docs/formatos/design-md.md.
// Lê o frontmatter (subconjunto estrito de YAML, sem dependência), valida os tokens, separa as seções da prosa
// e gera as variáveis CSS e os @font-face para a página do vídeo. TypeScript só com sintaxe apagável: roda direto
// no Node 24 (type stripping), sem build.
//
//   node identidade/design-md.ts conferir <DESIGN.md>        → JSON { ok, erros, avisos }; sai com 1 se há erro
//   node identidade/design-md.ts css <DESIGN.md> [--base p]  → :root { --color-…; --font-…; … } e @font-face
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type Valor = string | number | boolean | null | Valor[] | { [chave: string]: Valor };
export type Mapa = { [chave: string]: Valor };
export type Achado = { caminho: string; mensagem: string; linha?: number };
// Os tokens já validados; `any` porque o formato tem chaves livres (nomes de cor, papéis de tipo, componentes).
export type Tokens = Record<string, any>;
export type Resultado = { ok: boolean; erros: Achado[]; avisos: Achado[]; tokens: Tokens | null; secoes: Record<string, string> };

// ---------------------------------------------------------------------------------------------------------------
// Subconjunto de YAML. O que ele aceita é YAML 1.2 válido e dá o mesmo valor no PyYAML (YAML 1.1), conferido nos
// testes; o resto é erro com a linha. Aceita: mapas e listas em bloco (só espaços), mapas e listas em fluxo numa
// linha só (sem aninhar), escalares simples ou entre aspas, blocos `>` e `|` (com `-` opcional), comentários.
// Recusa o que muda de valor entre as versões do YAML (16:9, 0700, 1e3, 1_000, datas, yes/no), pedindo aspas.

class ErroYaml extends Error {
  linha: number;
  constructor(linha: number, mensagem: string) {
    super(`linha ${linha}: ${mensagem}`);
    this.linha = linha;
  }
}
const falha = (linha: number, msg: string): never => { throw new ErroYaml(linha, msg); };
const FORA = "fora do subconjunto de YAML do DESIGN.md";
const RESERVADAS = new Set(["__proto__", "constructor", "prototype"]);
const CHAVE = /^([A-Za-z0-9_][\w.-]*)\s*:(?:\s+(.*))?$/;

/** Índice da aspa que fecha a que abre em `s[k]`, ou -1. Em aspas simples, `''` é a aspa escapada. */
function fimDasAspas(s: string, k: number): number {
  const q = s[k];
  for (let i = k + 1; i < s.length; i++) {
    if (q === '"' && s[i] === "\\") i++;
    else if (s[i] === q) {
      if (q === "'" && s[i + 1] === "'") i++;
      else return i;
    }
  }
  return -1;
}

/**
 * Tira o comentário de uma linha (já sem o recuo). As aspas só contam no começo de um valor: entre aspas, `#` é
 * texto; num texto simples (`Gota d'água # nota`) o apóstrofo é texto e o comentário começa no primeiro ` #`.
 */
function semComentario(s: string): string {
  const cabeca = s.match(/^(-\s+|[A-Za-z0-9_][\w.-]*\s*:(?:\s+|$))?/)![0];
  const v = s.slice(cabeca.length);
  if (v[0] === '"' || v[0] === "'") {
    const j = fimDasAspas(v, 0);
    if (j >= 0 && /^(\s+#.*|\s*)$/.test(v.slice(j + 1))) return cabeca + v.slice(0, j + 1);
    return s.trimEnd(); // aspas sem fechar ou texto depois delas: o escalar acusa
  }
  if (v[0] === "[" || v[0] === "{") {
    for (let i = 0; i < v.length; i++) {
      const c = v[i];
      if ((c === '"' || c === "'") && /(^|[[{,]\s*|:\s+)$/.test(v.slice(0, i))) {
        const j = fimDasAspas(v, i);
        if (j < 0) return s.trimEnd();
        i = j;
      } else if (c === "#" && /\s/.test(v[i - 1] ?? "")) return (cabeca + v.slice(0, i)).trimEnd();
    }
    return s.trimEnd();
  }
  const k = v.search(/(^|\s)#/);
  return (k < 0 ? s : cabeca + v.slice(0, k)).trimEnd();
}

function entreAspas(s: string, linha: number): string {
  const j = fimDasAspas(s, 0);
  if (j < 0) falha(linha, `aspas sem fechar: ${s}`);
  if (j !== s.length - 1) falha(linha, `texto depois das aspas: ${s}; ponha o valor todo entre aspas`);
  const miolo = s.slice(1, -1);
  if (s[0] === "'") return miolo.replaceAll("''", "'");
  let out = "";
  for (let i = 0; i < miolo.length; i++) {
    if (miolo[i] !== "\\") { out += miolo[i]; continue; }
    const e = miolo[++i];
    const simples: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", n: "\n", t: "\t" };
    if (Object.hasOwn(simples, e)) out += simples[e];
    else if (e === "u" && /^[0-9a-fA-F]{4}$/.test(miolo.slice(i + 1, i + 5))) { out += String.fromCharCode(parseInt(miolo.slice(i + 1, i + 5), 16)); i += 4; }
    else falha(linha, `escape \\${e} ${FORA}`);
  }
  return out;
}

// Texto simples que o YAML 1.1 (PyYAML) e o 1.2 leem diferente, ou que um deles lê como número ou data.
const AMBIGUOS = [
  /^[-+]?\d[\d_]*(:[0-5]?\d)+(\.[\d_]*)?$/, // sexagesimal: 16:9, 1:30:00
  /^[-+]?0[\d_]+(\.[\d_]*)?$/, // zero à esquerda: 0700
  /^[-+]?0b[01_]+$/i, // binário
  /^[-+]?(\d[\d_]*(\.[\d_]*)?|\.[\d_]+)[eE][-+]?\d+$/, // expoente: 1e3
  /^(?=.*_)[-+]?[\d_.]*\d[\d_.]*$/, // com _: 1_000
  /^[-+]\.\d/, // sinal antes do ponto: -.5 (texto no PyYAML)
  /^=$/, // valor especial do YAML 1.1
  /^\d{4}-\d\d?-\d\d?([Tt\s].*)?$/, // data: 2026-10-29
];

/** Escalar: entre aspas ou simples (número, booleano, nulo ou texto). `emFluxo` proíbe , [ ] { }. */
function escalar(bruto: string, linha: number, emFluxo = false): Valor {
  const s = bruto.trim();
  if (s.startsWith('"') || s.startsWith("'")) return entreAspas(s, linha);
  if (/^[&*]/.test(s)) falha(linha, `âncora ou alias ${FORA}: ${s}`);
  if (s.startsWith("!")) falha(linha, `tag ${FORA}: ${s}`);
  if (/^[|>]/.test(s)) falha(linha, `bloco de texto «${s}» ${FORA}: só > ou | (com - opcional) logo depois de «chave:»`);
  if (/^[%@`?,\]}:#]/.test(s)) falha(linha, `«${s}» começa com indicador do YAML; escreva entre aspas`);
  if (/^-(\s|$)/.test(s) || /:(\s|$)/.test(s)) falha(linha, `${FORA}: «${s}»; escreva entre aspas`);
  if (emFluxo && /[[\]{},]/.test(s)) falha(linha, `${FORA}: «${s}»; escreva entre aspas`);
  if (/^[{[]/.test(s)) falha(linha, `${FORA}: «${s}»`);
  if (/^(~|null|Null|NULL)?$/.test(s)) return null;
  if (/^(true|True|TRUE)$/.test(s)) return true;
  if (/^(false|False|FALSE)$/.test(s)) return false;
  if (/^(yes|no|on|off|y|n)$/i.test(s)) falha(linha, `«${s}» vira booleano em YAML 1.1; escreva entre aspas ou use true/false`);
  if (/^[-+]?(0x[0-9a-fA-F_]+|0o[0-7_]+|\.inf|\.nan)$/i.test(s)) falha(linha, `número «${s}» ${FORA}`);
  if (AMBIGUOS.some((r) => r.test(s))) falha(linha, `valor ambíguo entre YAML 1.1 e 1.2: «${s}»; escreva entre aspas`);
  if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)$/.test(s)) return Number(s);
  return s;
}

function chaveValida(chave: string, linha: number): string {
  if (RESERVADAS.has(chave)) falha(linha, `chave reservada: ${chave}`);
  return chave;
}

/** Divide o miolo de um fluxo pelas vírgulas fora das aspas; aninhar é erro. */
function itensDoFluxo(miolo: string, linha: number): string[] {
  const itens: string[] = [];
  let atual = "";
  for (let i = 0; i < miolo.length; i++) {
    const c = miolo[i];
    if ((c === '"' || c === "'") && (atual.trim() === "" || /:\s+$/.test(atual))) {
      const j = fimDasAspas(miolo, i);
      if (j < 0) falha(linha, `aspas sem fechar: ${miolo.slice(i)}`);
      atual += miolo.slice(i, j + 1);
      i = j;
    } else if (c === "{" || c === "[") falha(linha, `fluxo aninhado ${FORA}`);
    else if (c === ",") { itens.push(atual.trim()); atual = ""; }
    else atual += c;
  }
  itens.push(atual.trim());
  if (itens.at(-1) === "") itens.pop();
  if (itens.some((x) => x === "")) falha(linha, "item vazio no fluxo");
  return itens;
}

function valorEmLinha(s: string, linha: number): Valor {
  if (!s.startsWith("{") && !s.startsWith("[")) return escalar(s, linha);
  const fecha = s[0] === "{" ? "}" : "]";
  if (!s.endsWith(fecha)) falha(linha, `fluxo numa linha só: falta «${fecha}» (${FORA})`);
  const itens = itensDoFluxo(s.slice(1, -1), linha);
  if (fecha === "]") return itens.map((x) => escalar(x, linha, true));
  const mapa: Mapa = {};
  for (const item of itens) {
    const m = item.match(CHAVE);
    if (!m) return falha(linha, `item «${item}» ${FORA}; use { chave: valor, … }`);
    if (Object.hasOwn(mapa, chaveValida(m[1], linha))) falha(linha, `chave duplicada: ${m[1]}`);
    mapa[m[1]] = escalar(m[2] ?? "", linha, true);
  }
  return mapa;
}

/**
 * Lê o subconjunto de YAML do DESIGN.md. O documento é um mapa.
 * @param primeiraLinha número da primeira linha no arquivo, para as mensagens
 */
export function analisarYaml(texto: string, primeiraLinha = 1): Mapa {
  const linhas = texto.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  const num = (k: number) => k + primeiraLinha;
  const recuo = (s: string) => s.match(/^ */)![0].length;
  const vazia = (s: string) => /^\s*(#.*)?$/.test(s);
  linhas.forEach((s, k) => {
    if (/^ *\t/.test(s)) falha(num(k), "tabulação no recuo; use espaços");
    if (/^(---|\.\.\.)(\s|$)/.test(s)) falha(num(k), `vários documentos ${FORA}`);
  });
  const proxima = (): number => { while (i < linhas.length && vazia(linhas[i])) i++; return i < linhas.length ? i : -1; };

  function bloco(n: number): Valor {
    const k = proxima();
    return /^-(\s|$)/.test(linhas[k].slice(n)) ? lista(n) : mapa(n);
  }

  function lista(n: number): Valor[] {
    const out: Valor[] = [];
    for (let k = proxima(); k >= 0 && recuo(linhas[k]) >= n; k = proxima()) {
      if (recuo(linhas[k]) > n) falha(num(k), "recuo inesperado");
      const m = semComentario(linhas[k].slice(n)).match(/^-(?:\s+(.*))?$/);
      if (!m) break;
      if (!m[1]) falha(num(k), `item de lista vazio ou em bloco ${FORA}; use - valor ou - { chave: valor } numa linha`);
      if (/^[^"'{[]*:(\s|$)/.test(m[1])) falha(num(k), `mapa em bloco dentro da lista ${FORA}; use - { chave: valor } numa linha`);
      out.push(valorEmLinha(m[1], num(k)));
      i = k + 1;
    }
    return out;
  }

  function mapa(n: number): Mapa {
    const out: Mapa = {};
    for (let k = proxima(); k >= 0 && recuo(linhas[k]) >= n; k = proxima()) {
      if (recuo(linhas[k]) > n) falha(num(k), "recuo inesperado");
      const texto = semComentario(linhas[k].slice(n));
      if (/^-(\s|$)/.test(texto)) break;
      const m = texto.match(CHAVE);
      if (!m) return falha(num(k), `linha ${FORA}: «${texto}»`);
      const chave = chaveValida(m[1], num(k));
      const resto = m[2] ?? "";
      if (Object.hasOwn(out, chave)) falha(num(k), `chave duplicada: ${chave}`);
      i = k + 1;
      if (/^[|>]-?$/.test(resto)) out[chave] = blocoDeTexto(resto, n, k);
      else if (resto !== "") out[chave] = valorEmLinha(resto, num(k));
      else {
        const p = proxima();
        if (p >= 0 && recuo(linhas[p]) > n) out[chave] = bloco(recuo(linhas[p]));
        else if (p >= 0 && recuo(linhas[p]) === n && /^-(\s|$)/.test(linhas[p].slice(n))) out[chave] = lista(n);
        else out[chave] = null;
      }
    }
    return out;
  }

  function blocoDeTexto(cabeca: string, n: number, k: number): string {
    const corpo: string[] = [];
    let m = -1;
    while (i < linhas.length) {
      const s = linhas[i];
      if (s.trim() === "") { corpo.push(""); i++; continue; }
      const r = recuo(s);
      if (r <= n) break;
      if (m < 0) m = r;
      if (r < m) falha(num(i), "recuo menor dentro do bloco de texto");
      corpo.push(s.slice(m));
      i++;
    }
    while (corpo.length && corpo.at(-1) === "") corpo.pop();
    if (!corpo.length) falha(num(k), "bloco de texto vazio");
    let texto = "";
    if (cabeca[0] === "|") texto = corpo.join("\n");
    else for (const [j, s] of corpo.entries()) {
      if (s === "") texto += "\n";
      else {
        if (/^\s/.test(s)) falha(num(k + 1 + j), `linha mais recuada em bloco dobrado ${FORA}`);
        if (j > 0 && corpo[j - 1] !== "") texto += " ";
        texto += s;
      }
    }
    return cabeca.endsWith("-") ? texto : texto + "\n";
  }

  if (proxima() < 0) return {};
  if (recuo(linhas[i]) !== 0) falha(num(i), "o documento começa sem recuo");
  const doc = bloco(0);
  if (Array.isArray(doc) || doc === null || typeof doc !== "object") return falha(primeiraLinha, "o frontmatter é um mapa, não uma lista");
  if (proxima() >= 0) falha(num(i), `linha ${FORA}`);
  return doc;
}

// ---------------------------------------------------------------------------------------------------------------
// Validação dos tokens.

const CHAVES_TOPO = ["version", "name", "description", "colors", "typography", "spacing", "rounded", "components", "fonts", "logo", "motion", "voice"];
const CORES_OBRIGATORIAS = ["ground", "ink", "accent"];
const TIPOS_OBRIGATORIOS = ["display", "body"];
const SECOES_OBRIGATORIAS = ["Visão geral", "Tom de voz"];
const PROPRIEDADES_TIPO: Record<string, string> = { fontFamily: "family", fontWeight: "weight", fontSize: "size", lineHeight: "line-height", letterSpacing: "letter-spacing", fontFeature: "feature", fontVariation: "variation" };

const NOME = /^[a-z][a-z0-9-]*$/;
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const DIMENSAO = /^(0|-?(\d+(\.\d+)?|\.\d+)(px|rem|em|%|cqw|cqh|cqmin|cqmax|vw|vh|vmin|vmax))$/;
const TEMPO = /^(\d+(\.\d+)?|\.\d+)(ms|s)$/;
const IDIOMA = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;
const FAMILIA = /^[^"\\;{}<>\n\r]+$/;
const REFERENCIA = /\{([a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9-]+)+)\}/g;
const NUM = String.raw`\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*`;
const BEZIER = new RegExp(`^cubic-bezier\\(${NUM},${NUM},${NUM},${NUM}\\)$`);

const ehMapa = (v: unknown): v is Mapa => v !== null && typeof v === "object" && !Array.isArray(v);
const tem = (v: unknown, k: string): boolean => ehMapa(v) && Object.hasOwn(v, k);
const peso = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 1000;
/** Faixa de peso da fonte variável, "min max" (como no @font-face), com min < max. */
const faixaDePeso = (v: unknown): boolean => {
  const m = typeof v === "string" ? /^(\d{1,4}) (\d{1,4})$/.exec(v) : null;
  return m != null && peso(Number(m[1])) && peso(Number(m[2])) && Number(m[1]) < Number(m[2]);
};
const ehTexto = (v: unknown, r: RegExp): boolean => typeof v === "string" && r.test(v);

function curvaValida(s: unknown): boolean {
  if (typeof s !== "string") return false;
  if (/^(linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end)$/.test(s)) return true;
  if (/^steps\(\s*[1-9]\d*\s*(,\s*(jump-start|jump-end|jump-none|jump-both|start|end)\s*)?\)$/.test(s)) return true;
  const b = s.match(BEZIER);
  return Boolean(b) && [b![1], b![3]].every((x) => Number(x) >= 0 && Number(x) <= 1);
}

/**
 * Caminho local, relativo ao DESIGN.md e dentro do projeto do vídeo: sem URL (rede, R03), sem `..`, sem raiz e sem
 * os caracteres que fecham o url() do CSS. Devolve o problema, ou null.
 */
function caminhoLocal(s: unknown, extensoes: string[]): string | null {
  if (typeof s !== "string" || s === "") return "falta o caminho";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return "URL não: o arquivo fica no projeto do vídeo (render sem rede, R03)";
  if (/["'()\\;\n\r]/.test(s)) return "caminho sem aspas, parênteses, ponto e vírgula, \\ nem quebra de linha (vai para o url() do CSS)";
  if (s.startsWith("/") || s.split("/").includes("..")) return "caminho relativo ao DESIGN.md, dentro do projeto (sem / no começo nem ..)";
  if (!new RegExp(`\\.(${extensoes.join("|")})$`, "i").test(s)) return `extensão aceita: ${extensoes.join(", ")}`;
  return null;
}

function validarTokens(t: Mapa): { erros: Achado[]; avisos: Achado[] } {
  const erros: Achado[] = [], avisos: Achado[] = [];
  const erro = (caminho: string, mensagem: string) => { erros.push({ caminho, mensagem }); };
  const aviso = (caminho: string, mensagem: string) => { avisos.push({ caminho, mensagem }); };

  for (const k of Object.keys(t)) if (!CHAVES_TOPO.includes(k)) aviso(k, `chave desconhecida (conhecidas: ${CHAVES_TOPO.join(", ")})`);
  if (typeof t.name !== "string" || t.name.trim() === "") erro("name", "obrigatório: o nome da marca");
  for (const k of ["version", "description"]) if (t[k] != null && typeof t[k] !== "string") erro(k, "texto");

  /** Mapa de tokens com nome em kebab-case (vira variável CSS). */
  const tabela = (chave: string, obrigatoria: boolean, validar: (caminho: string, valor: Valor) => void) => {
    const v = t[chave];
    if (v == null) { if (obrigatoria) erro(chave, "obrigatório"); return; }
    if (!ehMapa(v)) { erro(chave, "mapa de nome: valor"); return; }
    for (const [nome, valor] of Object.entries(v)) {
      if (!NOME.test(nome)) erro(`${chave}.${nome}`, "nome em kebab-case: minúsculas, dígitos e hífen, começando por letra");
      validar(`${chave}.${nome}`, valor);
    }
  };

  tabela("colors", true, (c, v) => {
    if (v == null) erro(c, "vazio; em YAML, # começa comentário: escreva a cor entre aspas, como \"#1A2B3C\"");
    else if (!ehTexto(v, HEX)) erro(c, `cor em hexadecimal entre aspas (#rgb, #rrggbb ou #rrggbbaa), não ${JSON.stringify(v)}`);
  });
  if (ehMapa(t.colors)) for (const c of CORES_OBRIGATORIAS) if (!tem(t.colors, c)) erro(`colors.${c}`, "cor obrigatória (ground: fundo, ink: texto, accent: destaque)");

  tabela("typography", true, (c, v) => {
    if (!ehMapa(v)) { erro(c, "mapa { fontFamily, fontWeight, fontSize, lineHeight, letterSpacing }"); return; }
    for (const k of Object.keys(v)) if (!Object.hasOwn(PROPRIEDADES_TIPO, k)) aviso(`${c}.${k}`, `propriedade desconhecida (conhecidas: ${Object.keys(PROPRIEDADES_TIPO).join(", ")})`);
    if (!ehTexto(v.fontFamily, FAMILIA)) erro(`${c}.fontFamily`, "obrigatório: o nome da família, sem aspas nem ; { } \\");
    if (v.fontWeight != null && !peso(v.fontWeight)) erro(`${c}.fontWeight`, "número inteiro de 1 a 1000, sem aspas");
    if (v.fontSize != null && !ehTexto(v.fontSize, DIMENSAO)) erro(`${c}.fontSize`, "dimensão com unidade, como \"64px\"");
    if (v.lineHeight != null && typeof v.lineHeight !== "number" && !ehTexto(v.lineHeight, DIMENSAO)) erro(`${c}.lineHeight`, "número ou dimensão");
    if (v.letterSpacing != null && !ehTexto(v.letterSpacing, DIMENSAO)) erro(`${c}.letterSpacing`, "dimensão, como \"-0.02em\"");
    for (const k of ["fontFeature", "fontVariation"]) if (v[k] != null && !ehTexto(v[k], /^[^;{}<>\\\n\r]+$/)) erro(`${c}.${k}`, "texto CSS, sem ; { } \\");
  });
  if (ehMapa(t.typography)) for (const r of TIPOS_OBRIGATORIOS) if (!tem(t.typography, r)) erro(`typography.${r}`, "papel obrigatório (display: chamadas, body: texto)");

  const dimensaoOuNumero = (c: string, v: Valor) => { if (!(typeof v === "number" || ehTexto(v, DIMENSAO))) erro(c, "dimensão com unidade ou número"); };
  tabela("spacing", false, dimensaoOuNumero);
  tabela("rounded", false, dimensaoOuNumero);

  if (t.fonts != null) {
    if (!Array.isArray(t.fonts)) erro("fonts", "lista de { family, src, weight, style }");
    else t.fonts.forEach((f, k) => {
      const c = `fonts.${k}`;
      if (!ehMapa(f)) { erro(c, "{ family, src, weight, style }"); return; }
      if (!ehTexto(f.family, FAMILIA)) erro(`${c}.family`, "obrigatório: o nome da família");
      const p = caminhoLocal(f.src, ["woff2", "woff", "ttf", "otf"]);
      if (p) erro(`${c}.src`, p);
      if (f.weight != null && !peso(f.weight) && !faixaDePeso(f.weight)) {
        erro(`${c}.weight`, 'número inteiro de 1 a 1000, sem aspas; fonte variável: a faixa entre aspas, "100 900"');
      }
      if (f.style != null && f.style !== "normal" && f.style !== "italic") erro(`${c}.style`, "normal ou italic");
    });
  }

  const logo = t.logo;
  if (logo != null) {
    if (!ehMapa(logo)) erro("logo", "mapa { src, srcOnDark, minHeight, clearSpace }");
    else {
      const p = caminhoLocal(logo.src, ["svg", "png", "webp"]);
      if (p) erro("logo.src", p);
      if (logo.srcOnDark != null) { const q = caminhoLocal(logo.srcOnDark, ["svg", "png", "webp"]); if (q) erro("logo.srcOnDark", q); }
      for (const k of ["minHeight", "clearSpace"]) if (logo[k] != null && !ehTexto(logo[k], DIMENSAO)) erro(`logo.${k}`, "dimensão com unidade");
      for (const k of Object.keys(logo)) if (!["src", "srcOnDark", "minHeight", "clearSpace"].includes(k)) aviso(`logo.${k}`, "propriedade desconhecida");
    }
  }

  const motion = t.motion;
  if (motion != null) {
    if (!ehMapa(motion)) erro("motion", "mapa { duration, easing }");
    else {
      for (const k of Object.keys(motion)) if (!["duration", "easing"].includes(k)) aviso(`motion.${k}`, "chave desconhecida");
      const sub = (k: string, validar: (v: Valor) => boolean, msg: string) => {
        const v = motion[k];
        if (v == null) return;
        if (!ehMapa(v)) { erro(`motion.${k}`, "mapa de nome: valor"); return; }
        for (const [nome, valor] of Object.entries(v)) {
          if (!NOME.test(nome)) erro(`motion.${k}.${nome}`, "nome em kebab-case");
          if (!validar(valor)) erro(`motion.${k}.${nome}`, msg);
        }
      };
      sub("duration", (v) => ehTexto(v, TEMPO), "tempo com unidade, como \"400ms\" ou \"1.5s\"");
      sub("easing", curvaValida, "curva CSS: linear, ease, ease-in, ease-out, ease-in-out, cubic-bezier(x1, y1, x2, y2) ou steps(n)");
    }
  }

  const voice = t.voice;
  if (voice != null) {
    if (!ehMapa(voice)) erro("voice", "mapa { language, avoid }");
    else {
      if (voice.language != null && !ehTexto(voice.language, IDIOMA)) erro("voice.language", "idioma em BCP 47, como pt-BR");
      if (voice.avoid != null && !(Array.isArray(voice.avoid) && voice.avoid.every((x) => typeof x === "string" && x !== ""))) erro("voice.avoid", "lista de palavras ou expressões");
      for (const k of Object.keys(voice)) if (!["language", "avoid"].includes(k)) aviso(`voice.${k}`, "chave desconhecida");
    }
  }

  if (t.components != null) {
    if (!ehMapa(t.components)) erro("components", "mapa de componentes");
    else for (const [nome, v] of Object.entries(t.components)) {
      if (!NOME.test(nome)) erro(`components.${nome}`, "nome em kebab-case");
      if (!ehMapa(v)) erro(`components.${nome}`, "mapa de propriedade: valor");
    }
  }

  // Referências {grupo.nome} precisam existir (como o broken-ref do design.md do Google).
  const existe = (caminho: string) => {
    let v: Valor | undefined = t;
    for (const k of caminho.split(".")) v = tem(v, k) ? (v as Mapa)[k] : undefined;
    return v !== undefined;
  };
  const percorrer = (v: Valor, c: string): void => {
    if (typeof v === "string") { for (const [, ref] of v.matchAll(REFERENCIA)) if (!existe(ref)) erro(c, `referência quebrada: {${ref}}`); }
    else if (Array.isArray(v)) v.forEach((x, k) => percorrer(x, `${c}.${k}`));
    else if (ehMapa(v)) for (const [k, x] of Object.entries(v)) percorrer(x, `${c}.${k}`);
  };
  for (const [k, v] of Object.entries(t)) if (k !== "name" && k !== "description") percorrer(v, k);

  return { erros, avisos };
}

// ---------------------------------------------------------------------------------------------------------------
// Documento: frontmatter + prosa.

/** Seções `## Título` da prosa (fora de blocos de código), com o texto de cada uma. Objeto sem protótipo. */
function lerSecoes(corpo: string, primeiraLinha: number, erros: Achado[]): Record<string, string> {
  const secoes: Record<string, string> = Object.create(null);
  let atual: string | null = null, codigo = false;
  corpo.split("\n").forEach((s, k) => {
    if (/^(```|~~~)/.test(s)) codigo = !codigo;
    const m = codigo ? null : s.match(/^##\s+(.+?)\s*#*\s*$/);
    if (m) {
      atual = m[1];
      const linha = k + primeiraLinha;
      if (Object.hasOwn(secoes, atual)) erros.push({ caminho: `secoes.${atual}`, mensagem: `seção repetida (linha ${linha})`, linha });
      secoes[atual] = "";
    } else if (atual !== null) secoes[atual] += s + "\n";
  });
  for (const k of Object.keys(secoes)) secoes[k] = secoes[k].trim();
  for (const s of SECOES_OBRIGATORIAS) if (!Object.hasOwn(secoes, s)) erros.push({ caminho: `secoes.${s}`, mensagem: `seção obrigatória «## ${s}»` });
  return secoes;
}

/** Analisa o texto de um DESIGN.md: frontmatter normativo (tokens) e prosa (seções). Não lê arquivos. */
export function analisarDesignMd(bruto: string): Resultado {
  const texto = bruto.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const m = texto.match(/^---\n([\s\S]*?)\n---[ \t]*(\n|$)/);
  if (!m) return { ok: false, erros: [{ caminho: "frontmatter", mensagem: "o arquivo começa com o frontmatter YAML entre linhas ---" }], avisos: [], tokens: null, secoes: Object.create(null) };
  let tokens: Mapa;
  try {
    tokens = analisarYaml(m[1], 2);
  } catch (e) {
    if (!(e instanceof ErroYaml)) throw e;
    return { ok: false, erros: [{ caminho: "frontmatter", mensagem: e.message, linha: e.linha }], avisos: [], tokens: null, secoes: Object.create(null) };
  }
  const { erros, avisos } = validarTokens(tokens);
  const linhasFrontmatter = m[0].split("\n").length - (m[2] ? 1 : 0);
  const secoes = lerSecoes(texto.slice(m[0].length), linhasFrontmatter + 1, erros);
  return { ok: erros.length === 0, erros, avisos, tokens, secoes };
}

/** Lê um DESIGN.md do disco e confere, além do texto, que o logo e as fontes existem ao lado dele. */
export function lerDesignMd(caminho: string): Resultado & { dir: string } {
  const dir = dirname(resolve(caminho));
  const r = analisarDesignMd(readFileSync(caminho, "utf8"));
  const t = r.tokens;
  const conferir = (c: string, rel: unknown) => {
    if (typeof rel === "string" && !r.erros.some((e) => e.caminho === c) && !existsSync(join(dir, rel))) r.erros.push({ caminho: c, mensagem: `arquivo não encontrado: ${rel}` });
  };
  if (t && ehMapa(t.logo)) { conferir("logo.src", t.logo.src); if (t.logo.srcOnDark != null) conferir("logo.srcOnDark", t.logo.srcOnDark); }
  if (t && Array.isArray(t.fonts)) t.fonts.forEach((f: Valor, k: number) => { if (ehMapa(f)) conferir(`fonts.${k}.src`, f.src); });
  return { ...r, ok: r.erros.length === 0, dir };
}

const FORMATOS: Record<string, string> = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };
/** Texto entre aspas no CSS, com \ e " escapados e quebra de linha como \a. */
const textoCss = (s: string): string => `"${String(s).replace(/[\\"]/g, "\\$&").replace(/\r?\n|\r/g, "\\a ")}"`;

/**
 * Variáveis CSS (`--color-<nome>`, `--font-<papel>[-weight|-size|-line-height|-letter-spacing]`, `--spacing-<nome>`,
 * `--rounded-<nome>`, `--motion-duration-<nome>`, `--motion-easing-<nome>`) e um @font-face por fonte.
 * Feito para tokens validados (`analisarDesignMd(...).ok`); família e caminho saem escapados de qualquer jeito.
 * @param opcoes.base prefixo dos caminhos das fontes, do CSS até a pasta do DESIGN.md
 */
export function paraCss(tokens: Tokens, { base = "" }: { base?: string } = {}): string {
  const v: string[] = [];
  for (const [n, c] of Object.entries(tokens.colors ?? {})) v.push(`--color-${n}: ${c}`);
  for (const [papel, tipo] of Object.entries<Tokens>(tokens.typography ?? {})) {
    for (const [prop, sufixo] of Object.entries(PROPRIEDADES_TIPO)) {
      if (tipo[prop] == null) continue;
      v.push(prop === "fontFamily" ? `--font-${papel}: ${textoCss(tipo[prop])}` : `--font-${papel}-${sufixo}: ${tipo[prop]}`);
    }
  }
  for (const g of ["spacing", "rounded"]) for (const [n, x] of Object.entries(tokens[g] ?? {})) v.push(`--${g}-${n}: ${x}`);
  for (const g of ["duration", "easing"]) for (const [n, x] of Object.entries(tokens.motion?.[g] ?? {})) v.push(`--motion-${g}-${n}: ${x}`);
  let css = `:root {\n${v.map((x) => `  ${x};\n`).join("")}}\n`;
  for (const f of tokens.fonts ?? []) {
    const ext = String(f.src).split(".").pop()!.toLowerCase();
    css += `@font-face { font-family: ${textoCss(f.family)}; src: url(${textoCss(base + f.src)}) format("${FORMATOS[ext] ?? ext}"); ` +
      `font-weight: ${f.weight ?? 400}; font-style: ${f.style ?? "normal"}; font-display: block; }\n`;
  }
  return css;
}

// ---------------------------------------------------------------------------------------------------------------
// Linha de comando.

function principal([comando, arquivo, ...resto]: string[]): number {
  if (!["conferir", "css"].includes(comando) || !arquivo) {
    process.stderr.write("uso: node identidade/design-md.ts conferir|css <DESIGN.md> [--base <prefixo>]\n");
    return 2;
  }
  const r = lerDesignMd(arquivo);
  if (comando === "conferir") {
    process.stdout.write(JSON.stringify({ ok: r.ok, erros: r.erros, avisos: r.avisos }, null, 2) + "\n");
    return r.ok ? 0 : 1;
  }
  if (!r.ok || !r.tokens) { process.stderr.write(JSON.stringify(r.erros, null, 2) + "\n"); return 1; }
  const k = resto.indexOf("--base");
  process.stdout.write(paraCss(r.tokens, { base: k >= 0 ? resto[k + 1] ?? "" : "" }));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = principal(process.argv.slice(2));
