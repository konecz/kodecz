// The canonical contract between `kodecz assemble` (edicao/montar.ts) and the `montar.ts` of each block
// (blocos/<name>/montar.ts). Format of the edit: docs/formatos/edicao.md.
//
// A block's montar.ts may declare these same types locally (TypeScript typing is structural); this file is the
// reference. Changing a shape here changes the contract of every block.

/** One spoken word: text from the script (not from the transcription), start and end in seconds. */
export interface Palavra { texto: string; inicio: number; fim: number }

/** The words file (`kodecz prepare words`): `{ "palavras": [ { "texto", "inicio", "fim" } ] }`. */
export interface Falas { palavras: Palavra[] }

/**
 * A moment of the video. A plain number is seconds. `{ palavra }` is the start (or the end, with `borda: "fim"`) of
 * the `ocorrencia`-th (1-based, default 1) spoken word that matches, ignoring accents, punctuation and case, plus
 * `deslocamento` seconds. `{ fimDaFrase }` is the end of the sentence that contains the inner moment.
 */
export type Gatilho =
  | number
  | { segundo: number }
  | { palavra: string; ocorrencia?: number; borda?: "inicio" | "fim"; deslocamento?: number }
  | { fimDaFrase: Gatilho };

export interface ContextoMontagem {
  fps: number;
  largura: number;
  altura: number;
  palavras: Palavra[];
  /** round(segundos × fps), the frame of a moment. */
  q(segundos: number): number;
  /** The `ocorrencia`-th (1-based) word that matches; throws, listing the closest words, when there is none. */
  quando(palavra: string, ocorrencia?: number): Palavra;
  /** End of the last word of the sentence that contains the moment (`. ! ? …` close it, a comma does not) + 0.15 s. */
  fimDaFrase(segundos: number): number;
  /** A trigger resolved to seconds. */
  tempo(ref: Gatilho): number;
}

/**
 * What a block's montar() returns. `css` and `js` are paths relative to the block's folder (e.g. "bloco.css"); the
 * assembler copies them into the composition, links each one once and keeps the order in which they first appear.
 * `head` is extra markup for the <head> (deduplicated by exact text).
 */
export interface Montado { html: string; css?: string[]; js?: string[]; head?: string }

/**
 * One entry of `itens`. `bloco` is a folder of blocos/ (with a montar.ts) or a built-in type (`video`, `imagem`,
 * `audio`); `de`/`ate` are triggers; the rest are the block's parameters. `itens` nests children: the assembler
 * builds them first and hands their markup to the parent as `conteudo` (a string of HTML).
 */
export interface Item { bloco: string; de?: Gatilho; ate?: Gatilho; itens?: Item[]; [parametro: string]: unknown }

/** The signature of blocos/<name>/montar.ts. */
export type Montar = (item: Record<string, unknown>, ctx: ContextoMontagem) => Montado;
