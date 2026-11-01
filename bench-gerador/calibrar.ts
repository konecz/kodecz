// Kodecz Bench (P12): calibração das regras de geometria com os vídeos reais da calibração do S04 (aprovados e
// reprovados pelo responsável). Lê os `*-dados.json` da conferência (`--dados`: geometria por quadro e falas) de uma
// pasta FORA do repositório e imprime SÓ números agregados por grupo (R01: os dados têm texto de cliente; nada deles é
// impresso nem gravado). As regras que dependem só da geometria do S04 e da fala entram; as de estilo, sinal e mídia
// rotulada precisam da coleta nova e do render, que esses arquivos não têm.
//
//   node bench-gerador/calibrar.ts <pasta com a-*/ (aprovados) e x-*/ (reprovados)>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { avaliarRegra } from "./motores.ts";
import { lerEspecificacoes } from "./provas.ts";
import type { Evidencia } from "./evidencia.ts";

/** As classes cuja regra lê só a geometria do S04 e a fala. */
export const SO_GEOMETRIA = ["coberturaLegenda", "tempoDeLeitura", "legendaAtrasada", "foraDaZonaSegura", "tremor", "fimSeco", "falaCortada", "duracaoDestino"];

function evidenciaDe(d: any): Evidencia {
  const vertical = d.comp.altura > d.comp.largura;
  const tarefa: any = { id: d.comp.id, qps: d.comp.qps, quadros: d.comp.quadros, dim: { largura: d.comp.largura, altura: d.comp.altura }, falas: d.falas ?? [],
    plataforma: vertical ? "Reels" : "YouTube", duracaoMin: 3, duracaoMax: vertical ? 90 : 3600, permitido: [], textos: [], dados: [], escrita: "português" };
  return { tarefa, rotulos: {}, fonte: "", arquivos: {}, col: { decl: d.comp, falas: d.falas ?? [], quadros: d.geometrias }, col2: null, travou: false, console: [], mp4: null, render: null, antes: null, cache: new Map() } as any;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pasta = process.argv[2];
  const es = Object.values(lerEspecificacoes()).filter((e) => !e.rodada && SO_GEOMETRIA.includes(e.regra.medida));
  let falhas = 0;
  const r: Record<string, { grupo: string; erro: number; certo: number; nc: number; valores: number[] }> = {};
  for (const sub of readdirSync(pasta, { withFileTypes: true }).filter((x) => x.isDirectory() && /^[ax]-/.test(x.name)).map((x) => x.name)) {
    const grupo = sub.startsWith("a-") ? "aprovado" : "reprovado";
    for (const f of readdirSync(join(pasta, sub)).filter((x) => x.endsWith("-dados.json"))) {
      // R01: a mensagem de erro do JSON cita o conteúdo; só a contagem de falhas sai.
      let ev: Evidencia;
      try { ev = evidenciaDe(JSON.parse(readFileSync(join(pasta, sub, f), "utf8"))); } catch { falhas++; continue; }
      for (const e of es) {
        const k = `${e.classe} ${grupo}`;
        r[k] ??= { grupo, erro: 0, certo: 0, nc: 0, valores: [] };
        const x = avaliarRegra(e.regra, ev);
        if (x.status === "erro") r[k].erro++; else if (x.status === "certo") r[k].certo++; else r[k].nc++;
        if (typeof x.valor === "number") r[k].valores.push(+x.valor.toFixed(3));
      }
    }
  }
  // Só contagens e valores numéricos.
  process.stdout.write(`${JSON.stringify({ ...r, arquivosIlegiveis: falhas })}\n`);
}
