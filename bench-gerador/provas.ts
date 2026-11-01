// Kodecz Bench (P12): as provas de cada classe (bench-gerador/especificacoes.json). Para uma classe aceita:
//   1. dois sentidos: a regra acusa a errada e passa a base e a certa, numa amostra dos casos da classe que cobre
//      todo par de valores de eixos (pairwise), e nos graus (abaixo: certo; no e acima: erro);
//   2. a matriz cruzada: a regra de cada classe sobre a errada (e a base) de todas as outras;
//   3. a regra só lê a evidência (página, render, mídia rotulada, tarefa): a página da errada não traz o id da classe
//      nem o nome da mutação.
// Cada página vira evidência uma vez (cache por conteúdo em tmp/bench-provas/); a mídia é gerada uma vez por receita.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonico, RAIZ } from "./catalogo.ts";
import { deJson, evidencia, paraJson, type Evidencia } from "./evidencia.ts";
import { avaliarRegra, precisaDe, type Resultado } from "./motores.ts";
import { cenaBase, gerar, paraHtml, tarefaDe, type CasoMin, type Cena, type Receita } from "./mundo.ts";
import { aplicar, type Especificacao, type RegraDaConferencia } from "./mutacoes.ts";

export const ESPECIFICACOES = join(RAIZ, "bench-gerador", "especificacoes.json");
export const CACHE = process.env.KODECZ_PROVAS ?? join(RAIZ, "tmp", "bench-provas");

/** O conjunto único de regras (especificacoes.json): as classes do bench e as regras só da conferência. */
export function lerRegras(arquivo = ESPECIFICACOES): Record<string, Especificacao | RegraDaConferencia> {
  if (!existsSync(arquivo)) return {};
  return JSON.parse(readFileSync(arquivo, "utf8"));
}

/** Só as classes do bench (sem as regras que só a conferência aplica). */
export function lerEspecificacoes(arquivo = ESPECIFICACOES): Record<string, Especificacao> {
  return Object.fromEntries(Object.entries(lerRegras(arquivo)).filter(([, e]) => !("so" in e))) as Record<string, Especificacao>;
}

export type Variante = "base" | "certa" | "errada" | "abaixo" | "no" | "acima";

/** A cena de um caso numa variante. A base já tem os acessórios e os ajustes de tarefa da classe. */
export function cenaDe(caso: CasoMin, e: Especificacao, v: Variante): Cena {
  // Valor de eixo em que a cena não tem a peça da armadilha vira o mais perto que tem (ex.: «sem trilha» na trilha que
  // cobre a voz): o caso fica com o mesmo id, a cena com a peça.
  const eixos = { ...caso.eixos };
  for (const [eixo, troca] of Object.entries(e.substituir ?? {})) if (eixos[eixo] in troca) eixos[eixo] = troca[eixos[eixo]];
  const t = tarefaDe({ ...caso, eixos }, e.acessorios ?? []);
  if (e.tarefa) Object.assign(t, e.tarefa);
  const base = cenaBase(t);
  if (v === "base") return base;
  const g = v === "certa" || v === "errada" ? e.graus?.padrao ?? 1 : e.graus?.[v];
  if (g === undefined) throw new Error(`${e.classe}: sem o grau ${v}`);
  const certa = aplicar(base, e.certa ?? [], g);
  return v === "certa" ? certa : aplicar(certa, e.errada, g);
}

/** O que se espera da regra da classe em cada variante. */
export const ESPERADO: Record<Variante, "erro" | "certo"> = { base: "certo", certa: "certo", errada: "erro", abaixo: "certo", no: "erro", acima: "erro" };

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** Hash do arquivo, uma vez por caminho na execução. */
const conteudos = new Map<string, string>();
const hashDoArquivo = (arq: string) => {
  if (!conteudos.has(arq)) conteudos.set(arq, createHash("sha256").update(readFileSync(arq)).digest("hex"));
  return conteudos.get(arq)!;
};
/** A receita pelo conteúdo: a cópia vale pelo hash do arquivo, não pelo caminho (o cache serve a outra worktree). */
const porConteudo = (r: Receita) => (r.tipo === "copia" ? { tipo: "copia", sha256: hashDoArquivo(r.de) } : r);
export const chaveDaMidia = (r: Receita) => hash(canonico(porConteudo(r)));

/** A chave da página: o HTML, a biblioteca rotulada, a entrega, a tarefa e a mídia, tudo pelo conteúdo. */
export const chaveDaPagina = (c: Cena) => hash(canonico({ html: paraHtml(c), rotulos: c.rotulos, entrega: c.entrega ?? null, tarefa: c.tarefa,
  ativos: Object.fromEntries(Object.entries(c.ativos).map(([arq, r]) => [arq, porConteudo(r)])), v: 5 }));

/** A mídia gerada uma vez por receita, copiada para a pasta da página. */
function midia(c: Cena, saida: string) {
  for (const [arq, r] of Object.entries(c.ativos)) {
    const chave = chaveDaMidia(r);
    const ext = arq.split(".").pop();
    const guardado = join(CACHE, "midia", `${chave}.${ext}`);
    if (!existsSync(guardado)) {
      mkdirSync(join(CACHE, "midia"), { recursive: true });
      const tmp = `${guardado}.parcial.${ext}`;
      gerar(r, tmp);
      renameSync(tmp, guardado);
    }
    const destino = join(saida, arq);
    mkdirSync(join(destino, ".."), { recursive: true });
    copyFileSync(guardado, destino);
  }
}

/** Escreve a página na pasta (saida/ dentro de `dir`), com a mídia. */
export function escreverPagina(c: Cena, dir: string) {
  const saida = join(dir, "saida");
  rmSync(saida, { recursive: true, force: true });
  mkdirSync(join(saida, "midia"), { recursive: true });
  midia(c, saida);
  writeFileSync(join(saida, "midia", "rotulos.json"), JSON.stringify(c.rotulos, null, 1) + "\n");
  writeFileSync(join(saida, "tempos.json"), JSON.stringify(c.tarefa.falas, null, 1) + "\n");
  writeFileSync(join(saida, "roteiro.md"), `# Roteiro\n\n${c.tarefa.frases.join("\n\n")}\n`);
  writeFileSync(join(saida, "index.html"), paraHtml(c));
  return saida;
}

/** A evidência completa de uma página (coleta duas vezes, render com memória), do cache se já houver. */
export async function evidenciaDe(c: Cena, o: { antes?: Evidencia | null; render?: boolean } = {}): Promise<Evidencia> {
  const k = chaveDaPagina(c), dir = join(CACHE, "paginas", k), arq = join(dir, "evidencia.json");
  if (existsSync(arq)) {
    const j = JSON.parse(readFileSync(arq, "utf8"));
    if (o.render === false || j.render?.ok || j.travou || (j.render && !/os error 4/.test(j.render.erro ?? ""))) return deJson(j, o.antes ?? null);
  }
  mkdirSync(dir, { recursive: true });
  const saida = escreverPagina(c, dir);
  const ev = await evidencia(saida, c.tarefa, c.rotulos, { render: o.render !== false, memoria: true, duas: true, entrega: c.entrega ?? null, mp4Destino: join(dir, "render.mp4") });
  writeFileSync(arq, JSON.stringify(paraJson(ev)));
  // A pasta da página fica só com a evidência e o MP4 (a mídia é recriável).
  rmSync(join(saida, "midia"), { recursive: true, force: true });
  ev.antes = o.antes ?? null;
  return ev;
}

/** A regra da classe nunca lê a identidade da mutação: a página da errada não cita a classe. */
export function semIdentidade(c: Cena, e: Especificacao): boolean {
  const html = paraHtml(c);
  return !html.includes(e.classe) && !/muta(ção|cao)|errad[ao]|K-[A-Z]{2,3}-\d\d/.test(html);
}

export type Prova = { classe: string; caso: string; variante: Variante; esperado: "erro" | "certo"; r: Resultado; ok: boolean };

/** Prova uma classe em alguns casos: dois sentidos e graus. */
export async function provarClasse(e: Especificacao, casos: CasoMin[], o: { graus?: boolean; log?: (s: string) => void } = {}): Promise<Prova[]> {
  const r: Prova[] = [];
  const p = precisaDe(e.regra);
  for (const [i, caso] of casos.entries()) {
    const vs: Variante[] = ["base", "errada", ...(e.certa?.length ? ["certa" as Variante] : [])];
    if (o.graus !== false && i === 0 && e.graus?.abaixo !== undefined) vs.push("abaixo", "no", "acima");
    let base: Evidencia | null = null;
    for (const v of vs) {
      let c: Cena;
      try { c = cenaDe(caso, e, v); } catch (err) {
        r.push({ classe: e.classe, caso: caso.id, variante: v, esperado: ESPERADO[v], r: { status: "nao-conferivel", motivo: `não montou: ${(err as Error).message}` }, ok: false });
        continue;
      }
      if (v !== "base" && !semIdentidade(c, e)) throw new Error(`${e.classe}: a página da ${v} cita a classe ou a mutação`);
      const ev = await evidenciaDe(c, { antes: v === "base" ? null : base });
      // A partida da base é ela mesma (o diff antes/depois dá zero).
      if (v === "base") { base = ev; ev.antes = ev; }
      const res = avaliarRegra(e.regra, ev);
      const ok = res.status === ESPERADO[v];
      r.push({ classe: e.classe, caso: caso.id, variante: v, esperado: ESPERADO[v], r: res, ok });
      o.log?.(`  ${e.classe} ${caso.id} ${v}: ${res.status}${ok ? "" : " ✗"} (${res.motivo})`);
    }
  }
  return r;
}

/** Amostra pairwise: casos que cobrem todo par de valores de eixos (gulosa, determinística), no máximo `max`. */
export function pairwise<T extends { eixos: Record<string, string> }>(casos: T[], max = 12): T[] {
  if (casos.length <= 1) return casos;
  const eixos = Object.keys(casos[0].eixos);
  const pares = (c: T) => {
    const r: string[] = [];
    if (eixos.length === 1) r.push(`${eixos[0]}=${c.eixos[eixos[0]]}`);
    for (let a = 0; a < eixos.length; a++) for (let b = a + 1; b < eixos.length; b++) r.push(`${eixos[a]}=${c.eixos[eixos[a]]}|${eixos[b]}=${c.eixos[eixos[b]]}`);
    return r;
  };
  const falta = new Set(casos.flatMap(pares)), r: T[] = [];
  while (falta.size && r.length < max) {
    let melhor = casos[0], mx = -1;
    for (const c of casos) { if (r.includes(c)) continue; const n = pares(c).filter((x) => falta.has(x)).length; if (n > mx) { mx = n; melhor = c; } }
    if (mx <= 0) break;
    r.push(melhor);
    for (const x of pares(melhor)) falta.delete(x);
  }
  return r;
}

/** Na CPU, sem placa: todo caso da classe monta a base, a errada e os graus, e a errada difere da base e não cita a
 * classe. Devolve as falhas (vazio: tudo monta). */
export function montaTodos(e: Especificacao, casos: CasoMin[]): string[] {
  const falhas: string[] = [];
  for (const c of casos) {
    try {
      const base = cenaDe(c, e, "base");
      if (base.tarefa.bloqueio || e.rodada) continue;
      const errada = cenaDe(c, e, "errada");
      if (chaveDaPagina(errada) === chaveDaPagina(base) && JSON.stringify(errada.entrega ?? null) === "null") falhas.push(`${c.id}: a errada é igual à base (eixos ${JSON.stringify(c.eixos)})`);
      if (!semIdentidade(errada, e)) falhas.push(`${c.id}: a página cita a classe ou a mutação`);
      for (const g of ["abaixo", "no", "acima"] as const) if (e.graus?.[g] !== undefined) cenaDe(c, e, g);
    } catch (err) { falhas.push(`${c.id}: não montou (${(err as Error).message.slice(0, 160)}; eixos ${JSON.stringify(c.eixos)})`); }
  }
  return falhas;
}
