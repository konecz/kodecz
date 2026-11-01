// Gerador de casos (P12): o encaixe no formato do degrau 1 do bench (bench/, PR #85). É a única peça que conhece
// aquele formato (o `Item` de bench/itens.ts). Todo caso de classe vira Item pela cena base do mundo
// (bench-gerador/mundo.ts) e pela especificação da classe (bench-gerador/especificacoes.json): a partida é a base (grau
// único, com o pedido que arma a armadilha) ou a mutação na intensidade do grau (pedido de revisão); as soluções à mão
// são a base (certa) e a mutação (errada); o oráculo é a regra da classe, avaliada pelos motores genéricos
// (bench-gerador/motores.ts) sobre a evidência da entrega (`avaliarProprio`, que o bench/avaliar.ts usa no lugar da
// coleta do degrau 1).
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { renderizar } from "../bench/coletar.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Categoria, Item } from "../bench/itens.ts";
import type { Dados, Resultado } from "../bench/oraculos.ts";
import type { Caso } from "./expandir.ts";
import type { TarefaComposta } from "./compostas.ts";
import { evidencia } from "./evidencia.ts";
import { avaliarRegra, precisaDe } from "./motores.ts";
import { briefing, paraHtml, type Cena } from "./mundo.ts";
import type { Especificacao } from "./mutacoes.ts";
import { cenaDe, escreverPagina, lerEspecificacoes, type Variante } from "./provas.ts";

/**
 * Os oráculos do degrau 1 para as classes que um item dele instancia de verdade (CLASSIFICACAO de bench/itens.ts com
 * `parente: false`). Ficam como referência cruzada; o oráculo dos casos gerados é a regra da especificação.
 */
export const ORACULOS_DEGRAU1: Record<string, string> = {
  "K-DES-08": "bench/oraculos.ts#rostoLivre (e1)",
  "K-DES-04": "bench/oraculos.ts#legendaUmaLinha (e2)",
  "K-DES-02": "bench/oraculos.ts#mesmoEixo (e3, e4)",
  "K-PLA-02": "bench/oraculos.ts#logoInteira (e5)",
  "K-COR-01": "bench/oraculos.ts#contraste (e6)",
  "K-PLA-01": "bench/oraculos.ts#zonaSegura (e7)",
  "K-AUD-05": "bench/oraculos.ts#blocosInteiros (t2)",
  "K-AUD-07": "bench/oraculos.ts#velocidadeDaFala (t5)",
  "K-ANI-04": "bench/oraculos.ts#textoSemTremor (m1)",
  "K-EDI-14": "bench/oraculos.ts#semIdentidadeVelha (x1)",
};

/** A categoria do degrau 1 a partir da área do #79. */
const CATEGORIA: Record<string, Categoria> = {
  codigo: "contexto", plataforma: "espaço", cor: "espaço", design: "espaço", acessibilidade: "espaço", "cara-de-ia": "espaço",
  audio: "tempo da fala", animacao: "movimento", edicao: "movimento",
};
const CATEGORIA_COMPONENTE: Record<string, Categoria> = { zoom: "tempo da fala", clarao: "movimento", tremor: "movimento" };

/** O caso gerado no feitio do Item do degrau 1, mais o que o rodador precisa saber do gerador. */
export type ItemGerado = Item & {
  /** Caso que o motor de hoje recusa (o rodador pula, em vez de contar como erro do agente). */
  bloqueio?: string;
  /** Nos graus: o que o oráculo tem de dizer da partida antes do agente. */
  esperado: "erro" | "certo" | null;
  /** Classe, área, grau, forma (para o filtro do rodador). */
  classe?: string; area?: string; grau?: string; forma?: "classe" | "composta";
  /** O oráculo dos casos gerados: a evidência da entrega inteira (coleta com o estilo, render, mídia rotulada, tarefa). */
  avaliarProprio?(tarefa: string): Promise<Resultado>;
  /** Classe sem oráculo por caso (K-IA-09, métrica da rodada), desligada ou sem especificação: o motivo. */
  semOraculo?: string;
  /** Classe de aviso: o oráculo roda, mas o resultado vai para os avisos da rodada, não para a nota. O motivo. */
  aviso?: string;
};

/** Escreve a solução; quando a tarefa pede o arquivo, renderiza e entrega o MP4 (com o pós-processo da errada). */
function escrever(c: Cena, tarefa: string) {
  const saida = escreverPagina(c, tarefa);
  if (!c.tarefa.entrega) return;
  const mp4 = join(tarefa, c.tarefa.entrega), bruto = join(tarefa, "render-bruto.mp4");
  const r = renderizar(saida, bruto);
  if (!r.ok) throw new Error(`o render da solução falhou: ${r.erro}`);
  const f = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", bruto, ...(c.entrega?.length ? c.entrega : ["-c", "copy"]), mp4]);
  rmSync(bruto, { force: true });
  if (f.status !== 0) throw new Error(`a entrega da solução falhou: ${f.stderr}`);
}

const nomeArquivoDaEntrega = "saida/video.mp4";

/** A partida e o pedido do caso. */
function partida(caso: Caso, e: Especificacao): { v: Variante; pedido: string } {
  if (caso.grau === "unico") return { v: "base", pedido: e.pedido };
  return { v: caso.grau as Variante, pedido: e.pedidoRevisao ?? `Revise este vídeo e corrija o que estiver errado. ${e.pedido}` };
}

export function paraItem(caso: Caso, es: Record<string, Especificacao> = lerEspecificacoes()): ItemGerado {
  const e = es[caso.classe];
  const comum = { id: caso.id, categoria: CATEGORIA[caso.area] ?? "contexto", erro: caso.titulo, regra: caso.classe, esperado: caso.esperado,
    classe: caso.classe, area: caso.area, grau: caso.grau, forma: "classe" as const };
  const sem = (motivo: string): ItemGerado => ({ ...comum, pedido: "", precisa: { geometria: false, render: false }, semOraculo: motivo,
    preparar: () => { throw new Error(motivo); }, errada: () => { throw new Error(motivo); }, certa: () => { throw new Error(motivo); },
    oraculo: () => ({ status: "nao-conferivel", motivo }) });
  if (!e) return sem(`${caso.classe} sem especificação`);
  if (e.rodada) return sem(`${caso.classe}: métrica da rodada (semelhança entre as saídas do agente), não oráculo por caso`);
  if (e.desligada) return sem(`${caso.classe}: desligada da nota (${e.desligada})`);
  // O manifesto gradua a classe pelo catálogo; se a especificação ainda não tem o grau, o caso não monta: fica pulado
  // com o motivo, sem derrubar a rodada.
  if (caso.grau !== "unico" && e.graus?.[caso.grau as "abaixo" | "no" | "acima"] === undefined)
    return sem(`${caso.classe}: a especificação não tem o grau ${caso.grau}`);
  const { v, pedido } = partida(caso, e);
  const base = cenaDe(caso, e, "base");
  const p = precisaDe(e.regra);
  const entregue = base.tarefa.entrega ? nomeArquivoDaEntrega : undefined;
  return {
    ...comum,
    pedido: `${entregue ? `${pedido} Entregue também o vídeo renderizado em ${entregue}.` : pedido}\n\nBriefing:\n${briefing(base.tarefa)}`,
    precisa: { geometria: true, render: p.render, ...(entregue ? { mp4Entregue: entregue } : {}) },
    ...(base.tarefa.bloqueio ? { bloqueio: base.tarefa.bloqueio } : {}),
    ...(e.aviso ? { aviso: e.aviso } : {}),
    preparar: (tarefa) => { escrever(cenaDe(caso, e, v), tarefa); },
    certa: (tarefa) => { escrever(cenaDe(caso, e, "certa"), tarefa); },
    errada: (tarefa) => { escrever(cenaDe(caso, e, "errada"), tarefa); },
    oraculo: () => ({ status: "nao-conferivel", motivo: "caso gerado: o oráculo é o avaliarProprio" }),
    async avaliarProprio(tarefa) {
      const c = cenaDe(caso, e, v);
      // Pediu o arquivo e ele não veio: é erro da entrega, não «não conferível».
      if (entregue && !existsSync(join(tarefa, entregue))) return { status: "erro", motivo: `a entrega não tem ${entregue}` };
      let antes = null;
      if (p.antes) {
        // A partida como foi dada, numa pasta à parte.
        const tmp = mkdtempSync(join(tmpdir(), "kodecz-bench-antes-"));
        try { antes = await evidencia(escreverPagina(c, tmp), c.tarefa, c.rotulos, { render: false, mp4Destino: join(tmp, "r.mp4") }); }
        finally { rmSync(tmp, { recursive: true, force: true }); }
      }
      const tmp = mkdtempSync(join(tmpdir(), "kodecz-bench-ev-"));
      try {
        const ev = await evidencia(join(tarefa, "saida"), c.tarefa, c.rotulos, { render: p.render, memoria: p.memoria, duas: p.duas,
          mp4Entregue: entregue ? join(tarefa, entregue) : null, mp4Destino: join(tmp, "render.mp4") });
        ev.antes = antes;
        return avaliarRegra(e.regra, ev);
      } finally { rmSync(tmp, { recursive: true, force: true }); }
    },
  };
}

/** A tarefa composta como Item: as soluções à mão são as de todos os componentes; o oráculo é a soma. */
export function compostaParaItem(t: TarefaComposta): ItemGerado {
  return {
    id: t.composta.id, categoria: CATEGORIA_COMPONENTE[t.composta.componentes[0]] ?? "espaço", erro: `tarefa composta: ${t.composta.componentes.join(", ")}`, regra: t.composta.classes.join(" + "),
    pedido: t.pedido, precisa: t.precisa, forma: "composta", grau: "unico", classe: t.composta.classes.join("+"), area: "composta",
    preparar: (tarefa) => t.preparar(tarefa),
    errada: (tarefa) => t.resolver(tarefa, t.composta.componentes),
    certa: (tarefa) => t.resolver(tarefa, []),
    oraculo: (d: Dados) => t.oraculo(d),
    esperado: null,
  };
}

export { paraHtml };
