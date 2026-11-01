// Kodecz Bench (P12): roda as provas das classes (bench-gerador/provas.ts) e a matriz cruzada, na placa, sob a trava
// compartilhada (cada render pega flock -s sozinho; rode o comando inteiro sob flock -s para a coleta também).
//
//   node bench-gerador/provar.ts --classes K-DES-07,K-COR-01 [--max 12] [--sem-graus]   # dois sentidos e graus
//   node bench-gerador/provar.ts --todas [--de 0 --ate 20]                              # um bloco das classes
//   node bench-gerador/provar.ts --matriz [--saida <pasta>]                              # 106 × 106 (do cache)
//
// Resultados em tmp/bench-provas/provas/<classe>.json (uma linha por página) e, na matriz, matriz.json e matriz.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { deClasse, lerManifesto } from "./expandir.ts";
import { avaliarRegra, MEDIDAS } from "./motores.ts";
import { CACHE, cenaDe, evidenciaDe, lerEspecificacoes, pairwise, provarClasse, type Prova } from "./provas.ts";
import type { Especificacao } from "./mutacoes.ts";
import { tarefaDe } from "./mundo.ts";

/** Os casos da classe para as provas: um por combinação de eixos (o grau único ou o «no»), sem os bloqueados. */
export function casosDe(classe: string, max: number) {
  const vistos = new Set<string>();
  const cs = deClasse(lerManifesto()).filter((c) => c.classe === classe && (c.grau === "unico" || c.grau === "no"))
    .filter((c) => { const k = JSON.stringify(c.eixos); if (vistos.has(k)) return false; vistos.add(k); return true; })
    .filter((c) => !tarefaDe(c, []).bloqueio);
  return pairwise(cs, max);
}

export async function provar(e: Especificacao, o: { max: number; graus: boolean; log?: (s: string) => void }) {
  const casos = casosDe(e.classe, o.max);
  const provas = await provarClasse(e, casos, { graus: o.graus, log: o.log });
  mkdirSync(join(CACHE, "provas"), { recursive: true });
  writeFileSync(join(CACHE, "provas", `${e.classe}.json`), JSON.stringify(provas, null, 1));
  return provas;
}

export const resumir = (ps: Prova[]) => ({ total: ps.length, ok: ps.filter((p) => p.ok).length, falhas: ps.filter((p) => !p.ok).map((p) => `${p.caso} ${p.variante}: ${p.r.status} (${p.r.motivo})`) });

/** A matriz cruzada: a regra de cada classe (linha) sobre a errada e a base de cada classe (coluna), no 1.º caso pairwise. */
export async function matriz(es: Record<string, Especificacao>, log: (s: string) => void) {
  const classes = Object.keys(es).sort();
  const celulas: Record<string, Record<string, { errada: string; base: string }>> = {};
  for (const b of classes) {
    const caso = casosDe(b, 1)[0];
    if (!caso) continue;
    let base, errada;
    try {
      base = await evidenciaDe(cenaDe(caso, es[b], "base"));
      base.antes = base;
      errada = await evidenciaDe(cenaDe(caso, es[b], "errada"), { antes: base });
    } catch (err) { log(`  ${b}: não montou (${(err as Error).message})`); continue; }
    for (const a of classes) {
      if (es[a].rodada) continue;
      celulas[a] ??= {};
      celulas[a][b] = { errada: avaliarRegra(es[a].regra, errada).status, base: avaliarRegra(es[a].regra, base).status };
    }
    log(`  coluna ${b}: ${classes.filter((a) => a !== b && celulas[a]?.[b]?.errada === "erro").join(", ") || "sem falso positivo"}`);
  }
  return celulas;
}

/** Os números e a lista legível da matriz: diagonal (a regra acusa a própria errada), falsos positivos na errada de
 * outra classe e na base de qualquer classe. */
export function resumoDaMatriz(m: Awaited<ReturnType<typeof matriz>>, es: Record<string, Especificacao>) {
  const linhas = Object.keys(m).sort(), colunas = [...new Set(linhas.flatMap((a) => Object.keys(m[a])))].sort();
  const fpErrada: string[] = [], fpBase: string[] = [];
  let diag = 0, diagTotal = 0, celulas = 0, nc = 0;
  for (const a of linhas) for (const b of colunas) {
    const c = m[a][b];
    if (!c) continue;
    celulas++;
    if (c.errada === "nao-conferivel") nc++;
    if (a === b) { diagTotal++; if (c.errada === "erro") diag++; continue; }
    if (c.errada === "erro") fpErrada.push(`${a} acusa a errada de ${b}`);
    if (c.base === "erro") fpBase.push(`${a} acusa a base de ${b}`);
  }
  for (const a of linhas) if (m[a][a]?.base === "erro") fpBase.push(`${a} acusa a própria base`);
  const md = `# Matriz cruzada (${linhas.length} regras × ${colunas.length} classes)\n\n` +
    `Cada célula: a regra da linha sobre a errada (e a base) do 1.º caso pairwise da coluna. ${celulas} células; ` +
    `diagonal ${diag}/${diagTotal}; não conferível ${nc}.\n\n## Falsos positivos na errada de outra classe (${fpErrada.length})\n\n` +
    (fpErrada.map((x) => `- ${x}`).join("\n") || "nenhum") + `\n\n## Acusações na base (${fpBase.length})\n\n` + (fpBase.map((x) => `- ${x}`).join("\n") || "nenhuma") + "\n";
  return { md, numeros: { regras: linhas.length, classes: colunas.length, celulas, diagonal: `${diag}/${diagTotal}`, fpErrada: fpErrada.length, fpBase: fpBase.length, naoConferivel: nc } };
}

async function principal() {
  const { values: v } = parseArgs({ options: { classes: { type: "string" }, todas: { type: "boolean" }, de: { type: "string" }, ate: { type: "string" },
    max: { type: "string", default: "12" }, "sem-graus": { type: "boolean" }, matriz: { type: "boolean" }, saida: { type: "string" } } });
  const es = lerEspecificacoes();
  const log = (s: string) => process.stderr.write(`${s}\n`);
  if (v.matriz) {
    const m = await matriz(es, log);
    const dir = v.saida ?? join(CACHE);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "matriz.json"), JSON.stringify(m));
    const r = resumoDaMatriz(m, es);
    writeFileSync(join(dir, "matriz.md"), r.md);
    process.stdout.write(`${JSON.stringify({ matriz: join(dir, "matriz.json"), ...r.numeros })}\n`);
    return;
  }
  let lista = v.todas ? Object.keys(es).sort() : (v.classes ?? "").split(",").filter(Boolean);
  lista = lista.slice(Number(v.de ?? 0), v.ate ? Number(v.ate) : undefined);
  const sumario: Record<string, ReturnType<typeof resumir>> = {};
  for (const c of lista) {
    const e = es[c];
    if (!e) { log(`${c}: sem especificação`); continue; }
    if (e.rodada) { log(`${c}: métrica da rodada, sem prova por caso`); continue; }
    if (!MEDIDAS[e.regra.medida]) { log(`${c}: medida desconhecida ${e.regra.medida}`); continue; }
    log(`${c} (${e.regra.medida})`);
    const t0 = performance.now();
    sumario[c] = resumir(await provar(e, { max: Number(v.max), graus: !v["sem-graus"], log }));
    log(`${c}: ${sumario[c].ok}/${sumario[c].total} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  }
  process.stdout.write(`${JSON.stringify(sumario)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await principal();
