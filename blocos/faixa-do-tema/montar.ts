// H14 faixa-do-tema: monta o trecho HTML de uma faixa a partir de um item da composição (contrato do `kodecz assemble`).
// Os gatilhos `de` e `ate` são resolvidos por ctx.tempo (segundos) e viram quadros por ctx.q. Sem `ate`, a faixa sai no
// fim da frase da palavra do `de` (ctx.fimDaFrase), que é onde o zoom (H02) volta: o --fim da faixa é o quadro em que
// ela começa a sair, como o --fim do zoom (G21).
//
// Uma faixa por vez (decisão do responsável, 2026-11): as faixas já montadas ficam guardadas por contexto e por
// `grupo`. A nova que entraria antes de a anterior terminar de sair é atrasada até o quadro em que a anterior saiu
// (`sobreposicao: "ajustar"`, o padrão) ou recusada (`"recusar"`); o ajuste que não deixa a faixa parada na tela
// pelo menos meio segundo depois de entrar também é recusado. Recusada, a faixa não ocupa lugar.

export interface Palavra { texto: string; inicio: number; fim: number } // segundos
export interface ContextoMontagem { fps: number; largura: number; altura: number; palavras: Palavra[]; q(segundos: number): number; quando(palavra: string, ocorrencia?: number): Palavra; fimDaFrase(segundos: number): number; tempo(ref: unknown): number }
export interface Montado { html: string; css?: string[]; js?: string[]; head?: string }

export type Estilo = "cartao" | "barra";
export type Entrada = "mola" | "cortina";
export interface ItemFaixa {
  /** O tema, numa linha só (o texto longo encolhe; não quebra). */
  texto: string;
  /** Gatilho de entrada (ctx.tempo). */
  de: unknown;
  /** Gatilho do começo da saída (ctx.tempo); sem ele, o fim da frase da palavra do `de`. */
  ate?: unknown;
  estilo?: Estilo;
  entrada?: Entrada;
  /** Faixas do mesmo grupo nunca ficam juntas na tela (padrão "tema"). */
  grupo?: string;
  sobreposicao?: "ajustar" | "recusar";
  /** --faixa-teto: a linha do queixo, do topo do quadro, em px ou vh. */
  teto?: string;
  /** --faixa-folga: o espaço entre a faixa e o topo da legenda, em px. */
  folga?: string;
  /** --faixa-base: a distância da base do quadro, quando a legenda não está no lugar do H01. */
  base?: string;
}

const ESTILOS: Estilo[] = ["cartao", "barra"];
const ENTRADAS: Entrada[] = ["mola", "cortina"];
type Ocupada = { texto: string; inicio: number; livre: number };
const ocupadas = new WeakMap<object, Map<string, Ocupada[]>>();

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function comprimento(nome: string, valor: string | undefined, unidades: RegExp, quais: string): string | undefined {
  if (valor === undefined) return undefined;
  if (!unidades.test(valor.trim())) throw new Error(`faixa-do-tema: ${nome} "${valor}" → em ${quais}`);
  return valor.trim();
}

export function montar(item: ItemFaixa, ctx: ContextoMontagem): Montado {
  const texto = String(item.texto ?? "").trim();
  if (!texto) throw new Error("faixa-do-tema: texto vazio → o tema do trecho, em poucas palavras");
  if (/[\r\n]/.test(texto)) throw new Error(`faixa-do-tema: «${texto}» tem quebra de linha → a faixa é uma linha só; encurtar o tema`);
  const estilo = item.estilo ?? "cartao", entrada = item.entrada ?? "mola";
  if (!ESTILOS.includes(estilo)) throw new Error(`faixa-do-tema: estilo "${estilo}" → ${ESTILOS.join(" ou ")}`);
  if (!ENTRADAS.includes(entrada)) throw new Error(`faixa-do-tema: entrada "${entrada}" → ${ENTRADAS.join(" ou ")}`);
  const teto = comprimento("teto", item.teto, /^\d*\.?\d+(px|vh)$/, "px ou vh (do topo do quadro)");
  const folga = comprimento("folga", item.folga, /^\d*\.?\d+px$/, "px");
  const base = comprimento("base", item.base, /^\d*\.?\d+(px|vh|%)$/, "px, vh ou %");

  const de = ctx.tempo(item.de);
  const ate = item.ate === undefined ? ctx.fimDaFrase(de) : ctx.tempo(item.ate);
  if (!(ate > de)) throw new Error(`faixa-do-tema: «${texto}»: ate (${ate} s) tem de vir depois do de (${de} s)`);
  const quadros = (s: number) => Math.max(1, Math.round(s * ctx.fps));
  const duracaoEntrada = quadros(0.5), duracaoSaida = quadros(0.3), parada = quadros(0.5);
  let inicio = ctx.q(de);
  const fim = ctx.q(ate);

  const grupo = item.grupo ?? "tema";
  const porGrupo = ocupadas.get(ctx) ?? new Map<string, Ocupada[]>();
  const lista = porGrupo.get(grupo) ?? [];
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const o of lista) {
      if (inicio < o.livre && o.inicio < fim + duracaoSaida) {
        if (item.sobreposicao === "recusar") {
          throw new Error(`faixa-do-tema: «${texto}» (quadro ${inicio}) cruza com «${o.texto}», que só termina de sair no quadro ${o.livre} → começar depois, ou sobreposicao: "ajustar"`);
        }
        inicio = o.livre;
        mudou = true;
      }
    }
  }
  if (inicio + duracaoEntrada + parada > fim) {
    throw new Error(`faixa-do-tema: «${texto}»: depois de esperar a faixa anterior sair (quadro ${inicio}), não sobra tempo até o --fim ${fim} (precisa de ${duracaoEntrada + parada} quadros) → juntar os dois temas ou tirar um`);
  }
  lista.push({ texto, inicio, livre: fim + duracaoSaida });
  porGrupo.set(grupo, lista);
  ocupadas.set(ctx, porGrupo);

  const variaveis = [`--inicio: ${inicio}`, `--fim: ${fim}`, `--faixa-entrada: ${duracaoEntrada}`, `--faixa-saida: ${duracaoSaida}`,
    `--faixa-letras: ${[...texto].length}`, ...(teto ? [`--faixa-teto: ${teto}`] : []), ...(folga ? [`--faixa-folga: ${folga}`] : []),
    ...(base ? [`--faixa-base: ${base}`] : [])];
  const html = `<div class="kz-faixa" data-bloco="faixa-do-tema" data-estilo="${estilo}" data-entrada="${entrada}" style="${variaveis.join("; ")}">` +
    `<p class="kz-faixa-cartao" data-papel="faixa"><span class="kz-faixa-texto">${escapar(texto)}</span></p>` +
    `<i class="kz-faixa-cortina"></i><i class="kz-faixa-teto"></i></div>`;
  return { html, css: ["faixa-do-tema/bloco.css"] };
}
