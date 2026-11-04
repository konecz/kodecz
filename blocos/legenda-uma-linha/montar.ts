// legenda-uma-linha (H01): a preparação que o KODECZ.md descreve, para o `kodecz assemble`. Recebe as palavras com o
// tempo do Whisper (o texto já do roteiro, G07), monta as frases pela largura medida na fonte da legenda (fonte.ts) e
// devolve o trecho do bloco: um .kz-legenda por frase, um .kz-palavra por palavra, com --inicio e --fim em quadros,
// a caixa posicionada pelo formato e dentro da zona segura (G19). Nada de relógio nem sorteio (R03): a mesma entrada
// dá o mesmo HTML.
import { abrirFonte, arquivoDaFonte, estimativa, type Medidor } from "./fonte.ts";

export interface Palavra { texto: string; inicio: number; fim: number } // segundos
export interface ContextoMontagem { fps: number; largura: number; altura: number; palavras: Palavra[]; q(segundos: number): number; quando(palavra: string, ocorrencia?: number): Palavra; fimDaFrase(segundos: number): number; tempo(ref: unknown): number }
export interface Montado { html: string; css?: string[]; js?: string[]; head?: string } // css/js relativos à pasta do bloco

/** Parâmetros do bloco (KODECZ.md, «Parâmetros do montar.ts»). Todos opcionais. */
export interface ItemLegenda {
  /** As palavras desta legenda (padrão: ctx.palavras), recortadas por `de` e `ate` (refs de ctx.tempo). */
  palavras?: Palavra[]; de?: unknown; ate?: unknown;
  destaque?: "falada" | "progresso"; entrada?: "subir" | "nenhuma";
  /** A fonte da legenda: a typography.caption do DESIGN.md (o montar mede com ela e a escreve no bloco). */
  familia?: string; peso?: number; tamanho?: number; alturaLinha?: number; espacamento?: number;
  /** Arquivo .ttf/.otf da fonte (padrão: o do fontconfig) ou, em vez dele, a estimativa por largura média em em. */
  arquivoFonte?: string; larguraEm?: number;
  /** Caixa: largura em px, respiro em px, topo (px ou "NN%"; padrão 75 % no 9:16) ou base (px, padrão 56 no 16:9). */
  largura?: number; respiroX?: number; respiroY?: number; topo?: number | string; base?: number;
  /** Zona segura em px (o --spacing-safe da marca, padrão 64) e o destino ("reels", "anuncio"…: 14/35/6 % livres). */
  seguro?: number; destino?: string;
  /** Tempos em segundos: folga do destaque depois da palavra, antecipação e cauda da frase. */
  folga?: number; antecipa?: number; cauda?: number;
  /** Regras de quebra: palavras fracas, palavras curtas que não fecham a frase sozinhas e os limites em caracteres. */
  fracas?: string[]; naoFecham?: string[]; curtaMax?: number; curtaFecha?: number;
}

/** Artigo, preposição, conjunção e o «R$»: nunca no fim da frase (descem para a seguinte). */
export const FRACAS = new Set(["o", "a", "os", "as", "um", "uma", "de", "do", "da", "dos", "das", "em", "no", "na", "nos",
  "nas", "num", "numa", "ao", "aos", "à", "às", "pelo", "pela", "pelos", "pelas", "por", "pra", "para", "com", "sem", "e",
  "ou", "mas", "nem", "que", "se", "seu", "sua", "seus", "suas", "até", "sobre", "r$"]);
/** Interjeição ou marcador que, sozinho com vírgula ou dois-pontos, não vira frase («Ó,», «Um:»). */
export const NAO_FECHAM = ["ó", "ah", "oh", "ei", "eh", "um", "olha"];
const DESTINOS_DE_APP = new Set(["reels", "instagram", "anuncio", "tiktok", "shorts"]);

const limpa = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}$]/gu, "");
/** O texto na tela: sem a vírgula e o ponto e vírgula do fim (a pausa já está no corte da frase). */
const exibido = (t: string) => t.replace(/[,;]$/, "");
const caracteres = (t: string) => [...t].length;

export interface OpcoesFrases {
  disponivel: number; tamanho: number; espacamentoEm: number; medidor: Medidor;
  fracas?: Iterable<string>; naoFecham?: Iterable<string>; curtaMax?: number; curtaFecha?: number;
}
export interface Frase { palavras: Palavra[]; tamanho: number; largura: number }

/**
 * As frases da legenda, cada uma numa linha de `disponivel` px: junta palavras enquanto cabe, toda pontuação fecha a
 * frase (menos a palavra curta sozinha com `, : ;`, da lista `naoFecham` ou de até `curtaMax` caracteres), as fracas
 * do fim descem para a seguinte, a palavra curta (até `curtaFecha` caracteres) que fecha com `. ! ? …` leva a
 * anterior junto, e a frase que ainda não cabe (palavra longa) encolhe a fonte.
 */
export function montarFrases(palavras: Palavra[], o: OpcoesFrases): Frase[] {
  const fracas = new Set([...(o.fracas ?? FRACAS)].map(limpa));
  const naoFecham = new Set([...(o.naoFecham ?? NAO_FECHAM)].map(limpa));
  const curtaMax = o.curtaMax ?? 3, curtaFecha = o.curtaFecha ?? 5;
  const largura = (g: Palavra[], tamanho = o.tamanho) => o.medidor.largura(g.map((p) => exibido(p.texto)).join(" "), tamanho, o.espacamentoEm);
  const fraca = (p: Palavra) => fracas.has(limpa(p.texto));
  const frases: Frase[] = [];
  const fechar = (g: Palavra[]) => {
    const w = largura(g);
    const tamanho = w > o.disponivel ? Math.floor((o.tamanho * o.disponivel / w) * 10) / 10 : o.tamanho;
    frases.push({ palavras: g, tamanho, largura: largura(g, tamanho) });
  };
  let atual: Palavra[] = [];
  for (const p of palavras) {
    if (atual.length && largura([...atual, p]) > o.disponivel) {
      const desce: Palavra[] = [];
      if (atual.length > 1 && caracteres(p.texto) <= curtaFecha && /[.!?…]$/.test(p.texto)) desce.unshift(atual.pop()!);
      while (atual.length > 1 && fraca(atual[atual.length - 1])) desce.unshift(atual.pop()!);
      fechar(atual);
      atual = desce;
    }
    atual.push(p);
    const final = /[.!?…]["»”)]*$/.test(p.texto);
    const excecao = !final && atual.length === 1 && (naoFecham.has(limpa(p.texto)) || caracteres(p.texto) <= curtaMax);
    if ((final || /[,:;]$/.test(p.texto)) && !excecao) {
      fechar(atual);
      atual = [];
    }
  }
  if (atual.length) fechar(atual);
  return frases;
}

const html = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const px = (n: number) => `${Math.round(n * 10) / 10}px`;

function medidorDe(item: ItemLegenda, familia: string, peso: number): Medidor {
  if (item.larguraEm !== undefined) return estimativa(item.larguraEm);
  const arquivo = item.arquivoFonte ?? arquivoDaFonte(familia, peso);
  if (arquivo) {
    try { return abrirFonte(arquivo); } catch { /* WOFF, coleção…: cai na estimativa */ }
  }
  return estimativa(0.6);
}

export function montar(item: ItemLegenda, ctx: ContextoMontagem): Montado {
  const destaque = item.destaque ?? "falada", entrada = item.entrada ?? "nenhuma";
  if (destaque !== "falada" && destaque !== "progresso") throw new Error(`legenda-uma-linha: destaque "${destaque}" (falada ou progresso)`);
  if (entrada !== "subir" && entrada !== "nenhuma") throw new Error(`legenda-uma-linha: entrada "${entrada}" (subir ou nenhuma)`);
  const { largura: W, altura: H } = ctx;
  const vertical = H > W;
  const de = item.de === undefined ? -Infinity : ctx.tempo(item.de);
  const ate = item.ate === undefined ? Infinity : ctx.tempo(item.ate);
  const palavras = (item.palavras ?? ctx.palavras).filter((p) => p.inicio >= de && p.inicio < ate).sort((a, b) => a.inicio - b.inicio);
  if (!palavras.length) throw new Error("legenda-uma-linha: nenhuma palavra no trecho (de/ate)");

  const familia = item.familia ?? "Inter", peso = item.peso ?? 700, tamanho = item.tamanho ?? (vertical ? 56 : 52);
  const alturaLinha = item.alturaLinha ?? 1.15, espacamento = item.espacamento ?? 0;
  const medidor = medidorDe(item, familia, peso);

  // Zona segura (G19): o --spacing-safe em volta de tudo; com destino de aplicativo, 14 % no topo, 35 % na base e 6 %
  // nos lados livres.
  const seguro = item.seguro ?? 64, app = DESTINOS_DE_APP.has(item.destino ?? "");
  const lados = Math.max(seguro, app ? Math.ceil(0.06 * W) : 0);
  const caixa = Math.min(item.largura ?? (vertical ? W : Math.round(0.78 * W)), W - 2 * lados);
  const respiroX = item.respiroX ?? (vertical ? 28 : 26), respiroY = item.respiroY ?? (vertical ? 16 : 12);
  const alturaCaixa = Math.ceil(tamanho * alturaLinha + 2 * respiroY);
  const baixo = Math.max(seguro, app ? Math.ceil(0.35 * H) : 0), cima = Math.max(seguro, app ? Math.ceil(0.14 * H) : 0);

  const estilo = [`--font-caption: '${familia.replace(/['"]/g, "")}'`, `--font-caption-weight: ${peso}`, `--legenda-tamanho: ${px(tamanho)}`,
    `--font-caption-line-height: ${alturaLinha}`, `--legenda-largura: ${caixa}px`, `--legenda-respiro-x: ${respiroX}px`,
    `--legenda-respiro-y: ${respiroY}px`];
  if (espacamento) estilo.push(`--font-caption-letter-spacing: ${espacamento}em`);
  if (item.folga !== undefined) estilo.push(`--legenda-folga: ${item.folga}`);
  const attrs = [`class="kz-legendas"`, `data-bloco="legenda-uma-linha"`];
  if (destaque === "progresso") attrs.push(`data-destaque="progresso"`);
  if (entrada === "subir") attrs.push(`data-entrada="subir"`);
  if (vertical || item.topo !== undefined) {
    const pedido = typeof item.topo === "string" ? (H * parseFloat(item.topo)) / 100 : item.topo ?? 0.75 * H;
    const topo = Math.max(cima, Math.min(Math.round(pedido), H - baixo - alturaCaixa));
    attrs.push(`data-ancora="topo"`);
    estilo.push(`--legenda-topo: ${topo}px`);
  } else {
    estilo.push(`--legenda-base: ${Math.max(item.base ?? 56, baixo)}px`);
  }

  // A medida tira 2 px de reserva para o arredondamento do Chromium (sem kerning, ela já sobra).
  const frases = montarFrases(palavras, { disponivel: caixa - 2 * respiroX - 2, tamanho, espacamentoEm: espacamento, medidor,
    fracas: item.fracas, naoFecham: item.naoFecham, curtaMax: item.curtaMax, curtaFecha: item.curtaFecha });

  const folga = item.folga ?? 0.15, antecipa = item.antecipa ?? 0.05, cauda = item.cauda ?? 0.6;
  const q = ctx.q;
  const inicios = frases.map((f) => q(Math.max(0, f.palavras[0].inicio - antecipa)));
  const linhas = frases.map((f, i) => {
    const ultima = f.palavras[f.palavras.length - 1];
    const fim = Math.max(inicios[i] + 1, i + 1 < frases.length ? inicios[i + 1] : q(Math.min(ultima.fim + cauda, ate)));
    const tam = f.tamanho < tamanho ? `; --legenda-tamanho: ${px(f.tamanho)}` : "";
    const spans = f.palavras.map((p) => {
      const k = palavras.indexOf(p), seguinte = palavras[k + 1];
      // Só a palavra falada acende: a folga depois dela acaba quando a seguinte começa.
      const apaga = seguinte && seguinte.inicio < p.fim + folga ? `; --apaga: ${q(seguinte.inicio)}` : "";
      const t = exibido(p.texto) === p.texto ? "" : ` data-t="${html(p.texto)}"`;
      return `<span class="kz-palavra"${t} style="--inicio: ${q(p.inicio)}; --fim: ${q(p.fim)}${apaga}">${html(exibido(p.texto))}</span>`;
    });
    return `  <p class="kz-legenda" data-papel="legenda" style="--inicio: ${inicios[i]}; --fim: ${fim}${tam}">${spans.join(" ")}</p>`;
  });
  return {
    html: `<!-- legenda-uma-linha: ${medidor.origem} -->\n<div ${attrs.join(" ")} style="${estilo.join("; ")}">\n${linhas.join("\n")}\n</div>`,
    css: ["bloco.css"],
    js: ["bloco.js"],
  };
}
