// Gerador de casos do Kodecz Bench (P12): a base das 106 classes colhidas na web (#79,
// docs/pesquisa/erros-de-agentes.json), lida como está. Só leitura: quem regenera a base é o varredura/erros-contar.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const RAIZ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
export const BASE = join(RAIZ, "docs", "pesquisa", "erros-de-agentes.json");

export type Verificador = "sim" | "parcial" | "nao";
export type Classe = {
  id: string; area: string; titulo: string; verificador: Verificador; tipos: string[]; gravidade: number;
  eixos: string[]; frequencia: number; relatos: number; casos: number;
};
export type Catalogo = { tiposDeVideo: Record<string, string>; eixos: Record<string, { valores: string[] }>; classes: Classe[] };

export function lerCatalogo(arquivo = BASE): Catalogo {
  return JSON.parse(readFileSync(arquivo, "utf8"));
}

/** Peso de uma classe: gravidade × frequência (#79, seção 3). */
export const peso = (c: Pick<Classe, "gravidade" | "frequencia">) => c.gravidade * c.frequencia;

/** A ordem do bench: peso, depois relatos (como o erros-contar.ts), depois o id (para não depender da ordem da base). */
export function porPeso<C extends Pick<Classe, "id" | "gravidade" | "frequencia" | "relatos">>(classes: C[]): C[] {
  return [...classes].sort((a, b) => peso(b) - peso(a) || b.relatos - a.relatos || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Os valores nominais de um eixo para a classe: `tipo` são os tipos de vídeo da classe. */
export function valoresNominais(cat: Catalogo, c: Pick<Classe, "tipos">, eixo: string): string[] {
  if (eixo === "tipo") return c.tipos;
  const e = cat.eixos[eixo];
  if (!e) throw new Error(`eixo desconhecido: ${eixo}`);
  return e.valores;
}

/** JSON com as chaves em ordem: o mesmo objeto dá sempre o mesmo texto. */
export function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
