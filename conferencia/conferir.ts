// A conferência automática dos quadros (S04) sobre o conjunto único de regras: as do Kodecz Bench
// (bench-gerador/especificacoes.json) marcadas com `conferencia`, medidas pelos mesmos motores (bench-gerador/motores.ts)
// sobre a coleta da composição real (geometria do DOM, rostos do detector, falas, destino e fundo real dos textos). O
// que a IA aprende no bench é o que a conferência cobra; regra nova com `conferencia` serve aos dois.
// Situação (situacaoNaConferencia): a da especificação, ou a sobreposta só na conferência no campo `conferencia`
// ({ codigo, situacao }); automática acusa falha; aviso acusa aviso; desligada não roda.
// Além das regras, os avisos de cobertura: o que não deu para conferir (sem rosto, sem papel, texto fora do DOM).
// Função pura: sem Electron e sem disco (as regras são lidas uma vez do arquivo, ou passadas em `regras`).
import { readFileSync } from "node:fs";
import { avaliarRegra, destinoDe, DESTINOS_COM_INTERFACE } from "../bench-gerador/motores.ts";
import { codigoNaConferencia, situacaoNaConferencia, type Especificacao, type RegraDaConferencia } from "../bench-gerador/mutacoes.ts";
import type { Evidencia } from "../bench-gerador/evidencia.ts";
import type { Tarefa } from "../bench-gerador/mundo.ts";
import { trechos, zooms as acharZooms, escalasDoApresentador, LIMITES, type Amostra, type Aviso, type Composicao, type Falha, type Fala,
  type Fundo, type Geometria } from "./regras.ts";

export { destinoDe };

export type Dados = {
  comp: Composicao; geometrias: Geometria[]; rostos: Amostra[]; falas: Fala[];
  /** data-destino do <html> (reels, anuncio, tiktok, shorts, youtube…); sem ele, a G19 não acusa. */
  destino?: string | null;
  /** O fundo real dos textos (comando «fundos» da coleta), para a G20; sem ele, a G20 não acusa. */
  fundos?: Fundo[];
};
export type RegraAplicada = { regra: string; classe: string; medida: string; op: string; limite: number; situacao: string;
  status: string; motivo: string; valor?: number | null };

const ARQUIVO = new URL("../bench-gerador/especificacoes.json", import.meta.url);
let padrao: Record<string, Especificacao | RegraDaConferencia> | null = null;
/** As regras da conferência no conjunto único, na ordem do código (o arquivo é lido direto, sem puxar o resto do bench). */
export function regrasDaConferencia(regras = (padrao ??= JSON.parse(readFileSync(ARQUIVO, "utf8")))) {
  return Object.values(regras).filter((e) => codigoNaConferencia(e)).sort((a, b) => codigoNaConferencia(a)!.localeCompare(codigoNaConferencia(b)!));
}

/** A evidência do bench (bench-gerador/evidencia.ts) montada da coleta da conferência. */
export function evidenciaDaConferencia(d: Dados): Evidencia {
  const { comp } = d;
  const decl = { id: comp.id, largura: comp.largura, altura: comp.altura, qps: comp.qps, quadros: comp.quadros };
  const tarefa = { id: comp.id, qps: comp.qps, quadros: comp.quadros, segundos: comp.quadros / comp.qps, dim: { largura: comp.largura, altura: comp.altura },
    falas: d.falas, plataforma: destinoDe(d.destino) } as unknown as Tarefa;
  return { tarefa, rotulos: {}, fonte: "", arquivos: {}, col: { decl, falas: d.falas, quadros: d.geometrias as any }, col2: null, travou: false, console: [],
    mp4: null, render: null, antes: null, cache: new Map(), rostos: d.rostos, ...(d.fundos ? { fundos: d.fundos } : {}) };
}

/** A conferência inteira de uma composição: falhas, avisos, os zooms e as regras aplicadas (com a situação e o resultado). */
export function conferir(d: Dados, o: { regras?: Record<string, Especificacao | RegraDaConferencia> } = {}) {
  const falhas: Falha[] = [], avisos: Aviso[] = [], aplicadas: RegraAplicada[] = [];
  const ev = evidenciaDaConferencia(d);
  for (const e of regrasDaConferencia(o.regras)) {
    const situacao = situacaoNaConferencia(e), regra = codigoNaConferencia(e)!;
    if (situacao === "desligada" || situacao === "rodada") continue;
    const r = avaliarRegra(e.regra, ev, { detalhe: true });
    // Medida que quebrou não vira aprovação calada: a conferência sai com erro, como antes.
    if (r.status === "nao-conferivel" && /^(a medida falhou|medida desconhecida)/.test(r.motivo)) throw new Error(`${regra} (${e.regra.medida}): ${r.motivo}`);
    aplicadas.push({ regra, classe: e.classe, medida: e.regra.medida, op: e.regra.op, limite: e.regra.limite, situacao, status: r.status, motivo: r.motivo,
      ...(r.valor !== undefined ? { valor: r.valor } : {}) });
    for (const { valor: _, ...oc } of r.ocorrencias ?? []) {
      // O aviso leva o texto e a caixa quando a ocorrência tem (G20); sem eles (tremor), fica como era.
      if (situacao === "aviso") avisos.push({ regra, de: oc.de, ate: oc.ate, motivo: oc.motivo,
        ...(oc.texto !== undefined ? { texto: oc.texto, papel: oc.papel ?? null } : {}), ...(oc.caixa ? { caixa: oc.caixa } : {}) });
      else falhas.push({ regra, ...oc });
    }
    for (const n of r.notas ?? []) avisos.push({ regra, motivo: n.motivo, ...(n.de !== undefined ? { de: n.de, ate: n.ate } : {}) });
  }
  avisos.push(...cobertura(d));
  return { falhas: falhas.sort((a, b) => a.de - b.de || a.regra.localeCompare(b.regra)), avisos, zooms: acharZooms(escalasDoApresentador(d.geometrias), LIMITES),
    regras: aplicadas };
}

/** O que a conferência não conseguiu ver: rosto não achado, papéis que faltam e texto fora do DOM sobre o apresentador. */
function cobertura({ comp, geometrias, rostos, destino }: Dados): Aviso[] {
  const avisos: Aviso[] = [];
  const d = destinoDe(destino);
  if (d && d !== "youtube" && !DESTINOS_COM_INTERFACE.has(d)) {
    avisos.push({ regra: "G19", motivo: `data-destino «${destino}» desconhecido (reels, instagram, anuncio, tiktok, shorts ou youtube): G19 não conferida` });
  } else if (!d && comp.altura > comp.largura) {
    avisos.push({ regra: "G19", motivo: "vídeo vertical sem data-destino no <html>: G19 (zona segura do Reels e do anúncio) não conferida" });
  }
  for (const t of trechos(rostos.filter((r) => !r.rel && geometrias[r.n]?.apresentador).map((r) => ({ n: r.n, chave: "", valor: 0 })))) {
    avisos.push({ regra: "G15", de: t.de, ate: t.ate, motivo: `apresentador na tela sem rosto encontrado (quadro ${t.de}${t.ate !== t.de ? ` a ${t.ate}` : ""} da amostra): G15 conferida pelas amostras vizinhas` });
  }
  if (!rostos.some((r) => r.rel) && geometrias.some((g) => g.apresentador)) {
    avisos.push({ regra: "G15", motivo: "nenhum rosto encontrado no apresentador: G15 não conferida" });
  }
  if (geometrias.some((g) => g.textos.length) && !geometrias.some((g) => g.textos.some((t) => t.papel === "legenda"))) {
    avisos.push({ regra: "G41", motivo: 'texto na tela, mas nenhum elemento com data-papel="legenda": G17 não conferida' });
  }
  if (!geometrias.some((g) => g.apresentador)) {
    avisos.push({ regra: "G41", motivo: 'nenhum elemento com data-papel="apresentador" visível: G15 e G21 não conferidas' });
  }
  for (const t of trechos(geometrias.flatMap((g) => g.naoConferidos.map((c) => ({ n: g.n, chave: c.tipo, valor: 0 }))))) {
    avisos.push({ regra: "G15", de: t.de, ate: t.ate, motivo: `<${t.chave}> sobre o apresentador: texto desenhado nele não é conferido` });
  }
  return avisos;
}
