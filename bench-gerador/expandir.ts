// Gerador de casos do Kodecz Bench (P12): expande cada uma das 106 classes (#79) no produto dos seus eixos efetivos
// (bench-gerador/efetivo.ts) e põe os três graus de intensidade nas classes de verificador «sim» de maior peso, até a
// meta de 5.000 (decisão do responsável, 2026-10-31). A saída é o manifesto bench-gerador/casos.jsonl, um caso por
// linha, na ordem do peso. A mesma base dá o mesmo manifesto, byte a byte; o id de um caso é o hash do conteúdo dele.
//
//   node bench-gerador/expandir.ts             # escreve o casos.jsonl e o resumo
//   node bench-gerador/expandir.ts --conferir  # sai com 1 se o casos.jsonl não é o que a base dá
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonico, lerCatalogo, peso, porPeso, RAIZ, type Catalogo, type Classe, type Verificador } from "./catalogo.ts";
import { SEM_GRAU, valoresEfetivos, type Efetivo } from "./efetivo.ts";
import { ORACULOS_DEGRAU1 } from "./adaptador.ts";
import { MEDIDAS } from "./motores.ts";
import { situacaoDe, type Especificacao } from "./mutacoes.ts";

const ESPECIFICACOES_JSON: Record<string, Especificacao> = JSON.parse(readFileSync(join(RAIZ, "bench-gerador", "especificacoes.json"), "utf8"));
import { compostas, type Composta } from "./compostas.ts";

export const META = 5000;
export const MANIFESTO = join(RAIZ, "bench-gerador", "casos.jsonl");

/** abaixo: logo do lado permitido do limiar (não é erro); no: o menor erro além dele; acima: bem além. */
export type Grau = "unico" | "abaixo" | "no" | "acima";
export const GRAUS: Grau[] = ["abaixo", "no", "acima"];
export type Caso = {
  id: string; forma: "classe"; classe: string; titulo: string; area: string;
  eixos: Record<string, string>;
  /** Valores nominais que este caso representa (juntados pelas regras do efetivo.ts), por eixo. */
  equivale?: Record<string, string[]>;
  grau: Grau;
  /**
   * Nos graus, o que o verificador tem de dizer da partida como ela é entregue ao agente (a calibração): «certo» no
   * abaixo, «erro» no e acima. No grau único a partida ainda não tem o elemento da armadilha: null.
   * Depois do agente, o certo é sempre «certo».
   */
  esperado: "erro" | "certo" | null;
  tipo: string; peso: number;
  verificador: { automatico: Verificador; oraculo: string | null; medida?: string; motor?: string | null; situacao: string; degrau1?: string };
};

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export { canonico };

/** O conteúdo que define um caso, e só ele: classe, valores efetivos dos eixos, grau e tipo de vídeo. */
export const conteudo = (c: Pick<Caso, "classe" | "eixos" | "grau" | "tipo">) =>
  canonico({ classe: c.classe, eixos: c.eixos, grau: c.grau, tipo: c.tipo });
export const idDe = (c: Pick<Caso, "classe" | "eixos" | "grau" | "tipo">) => `${c.classe}-${hash(conteudo(c)).slice(0, 10)}`;

/** Produto cartesiano dos valores efetivos, na ordem dos eixos da classe (o último eixo varia mais rápido). */
function produto(listas: Efetivo[][]): Efetivo[][] {
  return listas.reduce<Efetivo[][]>((acc, l) => acc.flatMap((a) => l.map((v) => [...a, v])), [[]]);
}

/** Os casos de grau único de uma classe. Sem o eixo `tipo`, o tipo de vídeo sai do hash dos eixos (estável). */
export function casosDaClasse(cat: Catalogo, c: Classe): Omit<Caso, "id" | "forma" | "grau" | "esperado">[] {
  const listas = c.eixos.map((e) => valoresEfetivos(cat, c, e));
  return produto(listas).map((vs) => {
    const eixos: Record<string, string> = {};
    const equivale: Record<string, string[]> = {};
    c.eixos.forEach((e, i) => { eixos[e] = vs[i].valor; if (vs[i].equivale.length) equivale[e] = vs[i].equivale; });
    const tipo = eixos.tipo ?? c.tipos[parseInt(hash(canonico({ classe: c.id, eixos })).slice(0, 8), 16) % c.tipos.length];
    return {
      classe: c.id, titulo: c.titulo, area: c.area, eixos, ...(Object.keys(equivale).length ? { equivale } : {}),
      tipo, peso: peso(c), verificador: verificadorDe(c),
    };
  });
}

/**
 * O verificador do caso: o do #79 («sim», «parcial», «não»), o oráculo (a especificação da classe e a medida dela, com
 * o motor) e a situação: «automatica»; «automatica-a-calibrar» (proxy que entra como automática quando concordar em
 * ≥ 90 % com os rótulos do responsável); «aviso» (medida e somada na rodada, sem tirar nota: o responsável achou
 * «tanto faz»); «desligada» (fora da nota até a regra ser reescrita: o responsável preferiu a versão «com defeito»);
 * «rodada» (K-IA-09: métrica da rodada, não oráculo por caso); «pendente».
 */
export function verificadorDe(c: Classe): Caso["verificador"] {
  const e = ESPECIFICACOES_JSON[c.id];
  const situacao = situacaoDe(e);
  return { automatico: c.verificador, oraculo: e && !e.rodada ? `bench-gerador/especificacoes.json#${c.id}` : null,
    ...(e && !e.rodada ? { medida: e.regra.medida, motor: MEDIDAS[e.regra.medida]?.motor ?? null } : {}), situacao,
    ...(ORACULOS_DEGRAU1[c.id] ? { degrau1: ORACULOS_DEGRAU1[c.id] } : {}) };
}

/** As classes que podem ter os três graus: verificador «sim» e fora do SEM_GRAU. */
export const graduavel = (c: Classe) => c.verificador === "sim" && !(c.id in SEM_GRAU);

export type Expansao = { casos: Caso[]; compostas: Composta[]; base: number; comGrau: string[] };

/**
 * A expansão inteira. Os graus entram classe a classe, em ordem de peso, nas graduáveis, até o total passar da meta
 * (cada classe com grau troca o caso único por três). Ordem do manifesto: peso da classe, depois os eixos, depois o grau.
 */
export function expandir(cat: Catalogo, meta = META): Expansao {
  const ordem = porPeso(cat.classes);
  const unicos = new Map(ordem.map((c) => [c.id, casosDaClasse(cat, c)]));
  const base = [...unicos.values()].reduce((s, l) => s + l.length, 0);
  const comGrau: string[] = [];
  let total = base;
  for (const c of ordem) {
    if (total >= meta) break;
    if (!graduavel(c)) continue;
    comGrau.push(c.id);
    total += 2 * unicos.get(c.id)!.length;
  }
  const casos: Caso[] = [];
  for (const c of ordem) for (const u of unicos.get(c.id)!) {
    const graus: Grau[] = comGrau.includes(c.id) ? GRAUS : ["unico"];
    for (const grau of graus) {
      const esperado = grau === "unico" ? null : grau === "abaixo" ? "certo" as const : "erro" as const;
      const { classe, titulo, area, eixos, equivale, tipo, peso, verificador } = u;
      const id = idDe({ classe, eixos, grau, tipo });
      casos.push({ id, forma: "classe", classe, titulo, area, eixos, ...(equivale ? { equivale } : {}), grau, esperado, tipo, peso, verificador });
    }
  }
  const pesos = new Map(cat.classes.map((c) => [c.id, peso(c)]));
  return { casos, compostas: compostas((id) => pesos.get(id)!), base, comGrau };
}

/** O manifesto: um caso por linha (os de classe, depois as tarefas compostas), fim de linha \n. */
export function serializar(casos: Caso[], comp: Composta[] = []): string {
  return [...casos, ...comp].map((c) => JSON.stringify(c)).join("\n") + "\n";
}

export function lerManifesto(arquivo = MANIFESTO): (Caso | Composta)[] {
  return readFileSync(arquivo, "utf8").trim().split("\n").map((l) => JSON.parse(l));
}
export const deClasse = (l: (Caso | Composta)[]) => l.filter((c): c is Caso => c.forma === "classe");

/** Os números do manifesto: por classe, por tipo de vídeo, por grau e por área. */
export function resumo(e: Expansao) {
  const contar = (f: (c: Caso) => string) => {
    const m: Record<string, number> = {};
    for (const c of e.casos) m[f(c)] = (m[f(c)] ?? 0) + 1;
    return m;
  };
  return { total: e.casos.length, compostas: e.compostas.length, base: e.base, comGrau: e.comGrau, porGrau: contar((c) => c.grau), porTipo: contar((c) => c.tipo),
    porArea: contar((c) => c.area), porClasse: contar((c) => c.classe) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const e = expandir(lerCatalogo());
  const texto = serializar(e.casos, e.compostas);
  if (process.argv.includes("--conferir")) {
    let atual = "";
    try { atual = readFileSync(MANIFESTO, "utf8"); } catch { /* falta */ }
    if (atual !== texto) { console.error("bench-gerador/casos.jsonl não é o que a base dá: rode node bench-gerador/expandir.ts"); process.exit(1); }
    console.log(`casos.jsonl confere: ${e.casos.length} casos de classe e ${e.compostas.length} compostas`);
  } else {
    writeFileSync(MANIFESTO, texto);
    const r = resumo(e);
    console.log(JSON.stringify({ total: r.total, compostas: r.compostas, base: r.base, comGrau: r.comGrau, porGrau: r.porGrau, porArea: r.porArea, porTipo: r.porTipo }, null, 1));
  }
}
