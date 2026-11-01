// Gerador de casos (P12): as tarefas compostas. Várias armadilhas de classes diferentes no mesmo vídeo, porque no modo
// «só documentos» do degrau 1 o item isolado foi fácil demais (3 erros em 20) para separar os modos do bench.
//
// Uma composta é um conjunto de componentes sobre a mesma cena com o apresentador (o retrato e a voz de tons do degrau
// 1, bench/molde.ts). Cada componente é a armadilha de uma classe do #79 que já tem oráculo no degrau 1
// (bench/oraculos.ts), com a parte dele no pedido, na partida e nas soluções errada e certa; o oráculo da composta é a
// soma dos oráculos dos componentes. Só entram classes com oráculo, porque a soma tem de ser conferível. Duas usam o
// oráculo da classe parente no degrau 1 (zoom, K-EDI-03, e clarão, K-ACE-01, marcados `parente: true` lá): o
// `semClarao` acusa um quadro claro, não o critério de piscadas do K-ACE-01.
// Limites conhecidos: o contraste amostra a metade final do título, depois do clarão (que cai entre as frases); e a
// prova de «só o oráculo dele acusa» é de uma composta por componente, não das 255 (a legenda errada no 9:16 com a
// zona, por exemplo, pode sair da zona segura também).
//
// A regra de combinação (determinística, a mesma para o manifesto e para os testes):
//   1. de 3 a 4 componentes, cada um de uma classe diferente;
//   2. formato 9:16 ou 16:9, rosto à esquerda, no centro ou à direita (o retrato posto em três lugares);
//   3. «zona» (zona segura do Reels) só no 9:16 e só com outro texto na tela (faixa, legenda ou título);
//   4. «eixo» (faixa e legenda no mesmo eixo) só com «faixa» e «legenda» juntas;
//   5. «zoom» não entra com «faixa»: a regra do zoom do S04 (conferirZoom) quer a faixa fora junto com a saída do
//      punch-in, e o pedido da faixa é que ela fique até o fim; juntos, os dois pedidos se contradizem;
//   6. o conjunto vai em ordem fixa (a de COMPONENTES), então cada combinação aparece uma vez.
// As posições certas de cada texto ficam num leiaute por formato que cumpre todos os oráculos ao mesmo tempo (fora da
// margem do rosto do S04, mesmo com o punch-in, dentro da zona segura, faixa logo acima da legenda).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { falar, falasJs, gerarApresentador, gerarVoz, pagina, QPS, RETRATO, type Caixa, type Palavra } from "../bench/molde.ts";
import * as O from "../bench/oraculos.ts";
import type { Dados, Resultado } from "../bench/oraculos.ts";
import { canonico } from "./catalogo.ts";

export type Contexto = {
  formato: "9:16" | "16:9"; rosto: "esquerda" | "centro" | "direita";
  dim: { largura: number; altura: number }; ap: { escala: number; x: number }; caixaRosto: Caixa;
  falas: Palavra[]; quadros: number; leiaute: Leiaute;
};
type Leiaute = { titulo: number; rotulo: number; faixa: number; legenda: number; chamada: number; fonte: { titulo: number; rotulo: number; faixa: number; legenda: number } };
type Parte = { css?: string; corpo?: string; script?: string };

export type Componente = {
  nome: string; classe: string; oraculoRef: string;
  /** O que o agente lê no pedido (uma linha da lista). */
  pedido(c: Contexto): string;
  /** O que já está na partida (o que o pedido cita). */
  partida?(c: Contexto): Parte;
  /** A solução escrita à mão: certa ou errada (o erro da classe). */
  solucao(c: Contexto, certa: boolean): Parte;
  oraculo(c: Contexto): (d: Dados) => Resultado;
  precisa: { geometria: boolean; render: boolean };
};

const q = (s: number) => Math.round(s * QPS);
const FALA = ["Cada grão que chega aqui passa por três provas de sabor.", "Só o que passa nas três vira o nosso café."];
const LEIAUTES: Record<Contexto["formato"], Leiaute> = {
  // 810 × 1440: a margem do rosto vai até y ≈ 540 (até ≈ 570 com o punch-in); a zona segura do Reels até y 936.
  "9:16": { titulo: 580, rotulo: 660, faixa: 720, legenda: 790, chamada: 860, fonte: { titulo: 52, rotulo: 30, faixa: 30, legenda: 40 } },
  // 960 × 540: a margem do rosto vai até y ≈ 202 (≈ 212 com o punch-in).
  "16:9": { titulo: 225, rotulo: 285, faixa: 410, legenda: 470, chamada: 0, fonte: { titulo: 36, rotulo: 22, faixa: 22, legenda: 26 } },
};
const DESLOCAMENTO = { esquerda: -200, centro: 0, direita: 200 };

export function contexto(formato: Contexto["formato"], rosto: Contexto["rosto"]): Contexto {
  const vertical = formato === "9:16";
  const dim = vertical ? { largura: 810, altura: 1440 } : { largura: 960, altura: 540 };
  const base = vertical ? { escala: 1.6, x: -297 } : { escala: 0.6, x: 264 };
  const ap = { escala: base.escala, x: base.x + DESLOCAMENTO[rosto] * (vertical ? 1 : 0.6) };
  const [rx, ry, rw, rh] = RETRATO.rosto;
  const caixaRosto: Caixa = [rx * ap.escala + ap.x, ry * ap.escala, rw * ap.escala, rh * ap.escala];
  const falas = falar(FALA);
  const quadros = q(Math.ceil((falas.at(-1)!.fim + 0.8) * 2) / 2);
  return { formato, rosto, dim, ap, caixaRosto, falas, quadros, leiaute: LEIAUTES[formato] };
}

const meio = "left: 50%; translate: -50% 0;";
const indice = (c: Contexto, p: string, depois = -1) => c.falas.findIndex((f, j) => j > depois && f.t.toLowerCase().startsWith(p));
const frasesDe = (c: Contexto) => O.frases(c.falas.map((f) => ({ ...f })));

/** Legenda em pedaços de até 20 letras (o jeito certo do degrau 1, e2). */
function pedacos(c: Contexto) {
  const r: { texto: string; de: number; ate: number }[] = [];
  let atual: Palavra[] = [];
  const fechar = () => { if (atual.length) r.push({ texto: atual.map((p) => p.t).join(" "), de: q(atual[0].ini), ate: q(atual.at(-1)!.fim + 0.05) }); atual = []; };
  for (const p of c.falas) {
    if ([...atual, p].map((x) => x.t).join(" ").length > 20) fechar();
    atual.push(p);
    if (/[.!?,]$/.test(p.t)) fechar();
  }
  fechar();
  return r;
}
const legendaHtml = (ps: { texto: string; de: number; ate: number }[]) =>
  ps.map((p) => `<div class="legenda" data-papel="legenda" data-de="${p.de}" data-ate="${p.ate}">${p.texto}</div>`).join("\n");

/** Os componentes, em ordem de peso da classe (gravidade × frequência no #79) e, no empate, pelo nome. */
export const COMPONENTES: Componente[] = [
  {
    nome: "contraste", classe: "K-COR-01", oraculoRef: "bench/oraculos.ts#contraste (e6)", precisa: { geometria: true, render: true },
    pedido: () => "ponha o título «Três provas» sobre a tarja creme, na cor de destaque da marca (#F2B49B), do começo ao fim;",
    partida: (c) => ({ css: `  .tarja { position: absolute; ${meio} top: ${c.leiaute.titulo - 12}px; width: ${Math.round(c.dim.largura * 0.7)}px; height: ${Math.round(c.leiaute.fonte.titulo * 1.6)}px; background: #F7F4EC; border-radius: 16px; z-index: 1; }`,
      corpo: `<div class="tarja"></div>` }),
    solucao: (c, certa) => ({ corpo: `<div class="titulo-k" data-de="0" style="position: absolute; ${meio} top: ${c.leiaute.titulo}px; z-index: 2; white-space: nowrap; opacity: 0; font: 700 ${c.leiaute.fonte.titulo}px 'DejaVu Sans', sans-serif; color: ${certa ? "#1B1F2A" : "#F2B49B"};">Três provas</div>` }),
    oraculo: () => O.contraste({ texto: "Três provas", minimo: 3 }),
  },
  {
    nome: "legenda", classe: "K-DES-04", oraculoRef: "bench/oraculos.ts#legendaUmaLinha (e2)", precisa: { geometria: true, render: false },
    pedido: () => "ponha a legenda da fala, sincronizada com saida/tempos.json, no estilo .legenda que já está no CSS;",
    partida: (c) => ({ css: `  .legenda { position: absolute; top: ${c.leiaute.legenda}px; left: ${c.formato === "9:16" ? 40 : 120}px; right: ${c.formato === "9:16" ? 40 : 120}px; text-align: center; color: #fff; font: 700 ${c.leiaute.fonte.legenda}px "DejaVu Sans", sans-serif; text-shadow: 0 2px 8px rgba(0, 0, 0, .7); opacity: 0; z-index: 2; }` }),
    solucao: (c, certa) => ({ corpo: certa ? legendaHtml(pedacos(c)).replaceAll('class="legenda"', 'class="legenda" style="white-space: nowrap;"')
      : legendaHtml(frasesDe(c).map((f) => ({ texto: f.texto, de: q(f.ini), ate: q(f.fim + 0.3) }))) }),
    oraculo: () => O.legendaUmaLinha(),
  },
  {
    nome: "zona", classe: "K-PLA-01", oraculoRef: "bench/oraculos.ts#zonaSegura (e7)", precisa: { geometria: true, render: false },
    pedido: () => "isto vai para o Reels: ponha também a chamada «Peça já» perto do fim, do jeito de sempre;",
    solucao: (c, certa) => ({ corpo: `<div class="chamada" data-de="${q(c.falas.at(-1)!.ini)}" style="position: absolute; ${meio} top: ${certa ? c.leiaute.chamada : 1340}px; z-index: 2; opacity: 0; white-space: nowrap; color: #fff; background: #E4572E; font: 700 26px 'DejaVu Sans', sans-serif; padding: 6px 20px; border-radius: 999px;">Peça já</div>` }),
    oraculo: () => O.zonaSegura(),
  },
  {
    nome: "zoom", classe: "K-EDI-03", oraculoRef: "bench/oraculos.ts#zoomAteOFimDaFrase (t1, classe parente)", precisa: { geometria: true, render: false },
    pedido: () => "dê um zoom de ênfase (punch-in) no apresentador na palavra «três»;",
    solucao: (c, certa) => {
      const de = q(c.falas[indice(c, "três")].ini), N = c.quadros;
      // A errada volta no meio da frase (no «de» de «provas de sabor»), como o punch-in de duração fixa do t1.
      const ate = certa ? q(c.falas[indice(c, "sabor")].fim) : q(c.falas[indice(c, "de", indice(c, "três"))].ini);
      const k = (n: number, s: number) => `{ transform: 'scale(${s})', offset: ${(n / N).toFixed(6)} }`;
      const [x, y, w, h] = c.caixaRosto;
      return { css: `  .take { transform-origin: ${Math.round(x + w / 2)}px ${Math.round(y + h / 2)}px; }`,
        script: `document.querySelector('.take').animate([${k(0, 1)}, ${k(de, 1)}, ${k(de + 4, 1.2)}, ${k(ate, 1.2)}, ${k(ate + 4, 1)}, ${k(N, 1)}], { duration: (${N} * 1000) / Q, fill: 'both' });` };
    },
    oraculo: () => O.zoomAteOFimDaFrase(),
  },
  {
    nome: "eixo", classe: "K-DES-02", oraculoRef: "bench/oraculos.ts#mesmoEixo (e3, e4)", precisa: { geometria: true, render: false },
    pedido: () => "a faixa e a legenda formam um bloco só: alinhe as duas;",
    // O eixo não põe elemento: mexe na posição da faixa (o componente faixa escreve com a classe .faixa-k).
    solucao: (_c, certa) => ({ css: certa ? "" : "  .faixa-k { left: 48px !important; translate: 0 0 !important; }" }),
    oraculo: () => O.mesmoEixo(),
  },
  {
    nome: "faixa", classe: "K-DES-08", oraculoRef: "bench/oraculos.ts#rostoLivre (e1)", precisa: { geometria: true, render: false },
    pedido: () => "falta a faixa com o tema do bloco, «Café de origem», aparecendo junto com a fala e ficando até o fim;",
    solucao: (c, certa) => {
      const [x, y, w] = c.caixaRosto;
      const pos = certa ? `${meio} top: ${c.leiaute.faixa}px;` : `left: ${Math.round(x + w / 2)}px; translate: -50% 0; top: ${Math.round(y + 20)}px;`;
      return { corpo: `<div class="faixa-k" data-papel="faixa" data-de="${q(c.falas[0].ini)}" style="position: absolute; ${pos} z-index: 2; opacity: 0; white-space: nowrap; color: #fff; background: #2E86AB; font: 700 ${c.leiaute.fonte.faixa}px 'DejaVu Sans', sans-serif; padding: 8px 22px; border-radius: 12px;">Café de origem</div>` };
    },
    oraculo: (c) => O.rostoLivre({ midia: "apresentador", origem: [c.dim.largura, c.dim.altura], rosto: c.caixaRosto }),
  },
  {
    nome: "clarao", classe: "K-ACE-01", oraculoRef: "bench/oraculos.ts#semClarao (m5, classe parente)", precisa: { geometria: false, render: true },
    pedido: () => "ponha uma transição marcante na pausa entre as duas frases;",
    solucao: (c, certa) => {
      const de = q(c.falas[indice(c, "sabor")].fim);
      return { corpo: `<div class="clarao" style="position: absolute; inset: 0; z-index: 3; opacity: 0; background: ${certa ? "#1B1F2A" : "#FFFFFF"};"></div>`,
        script: `document.querySelector('.clarao').animate([{ opacity: 0 }, { opacity: ${certa ? 0.6 : 1} }, { opacity: 0 }], { delay: (${de} * 1000) / Q, duration: (8 * 1000) / Q, fill: 'none' });` };
    },
    oraculo: () => O.semClarao(),
  },
  {
    nome: "tremor", classe: "K-ANI-04", oraculoRef: "bench/oraculos.ts#textoSemTremor (m1)", precisa: { geometria: true, render: false },
    pedido: () => "a linha «Aroma, doçura e final» está parada demais: dê vida a ela;",
    partida: (c) => ({ corpo: `<div class="rotulo" style="position: absolute; ${meio} top: ${c.leiaute.rotulo}px; z-index: 2; white-space: nowrap; color: #fff; font: 400 ${c.leiaute.fonte.rotulo}px 'DejaVu Sans', sans-serif;">Aroma, doçura e final</div>` }),
    solucao: (c, certa) => certa
      ? { corpo: `<div class="anel" style="position: absolute; left: ${Math.round(c.dim.largura * 0.08)}px; top: ${c.leiaute.rotulo - 4}px; width: 24px; height: 24px; border: 4px solid #E4572E; border-top-color: transparent; border-radius: 50%; z-index: 2;"></div>`,
        script: `document.querySelector('.anel').animate([{ rotate: '0deg' }, { rotate: '360deg' }], { duration: 5000, iterations: Infinity });` }
      : { script: `document.querySelector('.rotulo').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }], { duration: 5000, fill: 'both' });` },
    oraculo: () => O.textoSemTremor(),
  },
];

const porNome = new Map(COMPONENTES.map((c) => [c.nome, c]));
export const FORMATOS: Contexto["formato"][] = ["9:16", "16:9"];
export const ROSTOS: Contexto["rosto"][] = ["esquerda", "centro", "direita"];

/** A regra de combinação (itens 3 a 5 do cabeçalho). */
export function combinacaoValida(nomes: string[], formato: Contexto["formato"]): boolean {
  const tem = (n: string) => nomes.includes(n);
  if (tem("zona") && (formato !== "9:16" || !(tem("faixa") || tem("legenda") || tem("contraste")))) return false;
  if (tem("eixo") && !(tem("faixa") && tem("legenda"))) return false;
  if (tem("zoom") && tem("faixa")) return false;
  return new Set(nomes.map((n) => porNome.get(n)!.classe)).size === nomes.length;
}

/** Subconjuntos de tamanho k, na ordem de COMPONENTES. */
function subconjuntos<T>(xs: T[], k: number): T[][] {
  if (k === 0) return [[]];
  return xs.flatMap((x, i) => subconjuntos(xs.slice(i + 1), k - 1).map((r) => [x, ...r]));
}

export type Composta = {
  id: string; forma: "composta"; classes: string[]; componentes: string[]; eixos: { formato: string; rosto: string };
  grau: "unico"; esperado: null; tipo: string; peso: number; verificador: { automatico: "sim"; oraculos: string[] };
};

/** Todas as compostas da regra, em ordem de peso (soma dos pesos das classes) e depois do id. */
export function compostas(pesoDe: (classe: string) => number): Composta[] {
  const r: Composta[] = [];
  const nomes = COMPONENTES.map((c) => c.nome);
  for (const k of [3, 4]) for (const s of subconjuntos(nomes, k)) for (const formato of FORMATOS) for (const rosto of ROSTOS) {
    if (!combinacaoValida(s, formato)) continue;
    const cs = s.map((n) => porNome.get(n)!);
    const eixos = { formato, rosto };
    const id = `KC-${createHash("sha256").update(canonico({ componentes: s, eixos })).digest("hex").slice(0, 10)}`;
    r.push({ id, forma: "composta", classes: cs.map((c) => c.classe), componentes: s, eixos, grau: "unico", esperado: null,
      tipo: formato === "9:16" ? "reel" : "apresentador", peso: cs.reduce((p, c) => p + pesoDe(c.classe), 0),
      verificador: { automatico: "sim", oraculos: cs.map((c) => c.oraculoRef) } });
  }
  return r.sort((a, b) => b.peso - a.peso || (a.id < b.id ? -1 : 1));
}

// ——— Montagem da composta ———

/** Soma dos oráculos: erro se algum acusa; não conferível se algum não confere e nenhum acusa; certo se todos passam. */
export function somar(rs: { nome: string; r: Resultado }[]): Resultado {
  const motivo = rs.map(({ nome, r }) => `${nome}: ${r.status} (${r.motivo})`).join("; ");
  const e = rs.find(({ r }) => r.status === "erro");
  if (e) return { status: "erro", motivo, quadro: e.r.quadro };
  if (rs.some(({ r }) => r.status === "nao-conferivel")) return { status: "nao-conferivel", motivo };
  return { status: "certo", motivo };
}

export type TarefaComposta = {
  composta: Composta; contexto: Contexto; pedido: string; id: string;
  precisa: { geometria: boolean; render: boolean };
  preparar(tarefa: string): void;
  /** A solução à mão: `erradas` são os componentes que saem errados (o resto, certo). */
  resolver(tarefa: string, erradas: string[]): void;
  oraculos(d: Dados): { nome: string; r: Resultado }[];
  oraculo(d: Dados): Resultado;
};

const CSS_BASE = `  .palco { position: absolute; inset: 0; overflow: hidden; }
  .take { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; }`;
const AJUDA = `const Q = ${QPS};
function mostrar(el, de, ate) {
  el.animate([{ opacity: 0 }, { opacity: 1 }], { delay: (de * 1000) / Q, duration: 1, fill: 'forwards' });
  if (ate !== undefined) el.animate([{ opacity: 1 }, { opacity: 0 }], { delay: (ate * 1000) / Q, duration: 1, fill: 'forwards' });
}
for (const el of document.querySelectorAll('[data-de]')) mostrar(el, Number(el.dataset.de), el.dataset.ate ? Number(el.dataset.ate) : undefined);`;

export function montarComposta(k: Composta): TarefaComposta {
  const c = contexto(k.eixos.formato as Contexto["formato"], k.eixos.rosto as Contexto["rosto"]);
  const cs = k.componentes.map((n) => porNome.get(n)!);
  const id = `Composta${k.id.slice(3, 11)}`;
  const vertical = c.formato === "9:16";
  const pedido = `Este é um vídeo ${vertical ? "vertical" : "horizontal"} com o apresentador (saida/index.html; a fala está em saida/roteiro.md e os tempos em saida/tempos.json). Nesta versão:\n${cs.map((x, i) => `${i + 1}. ${x.pedido(c)}`).join("\n")}\nEntregue em saida/index.html.`;
  const html = (solucoes: Parte[]) => {
    const partes = [...cs.map((x) => x.partida?.(c) ?? {}), ...solucoes];
    return pagina({ id, ...c.dim, quadros: c.quadros, titulo: `Composta ${k.id}`,
      comentario: `Kodecz Bench, tarefa composta gerada (bench-gerador/compostas.ts): ${k.componentes.join(", ")}. Conteúdo inventado: a marca fictícia Zunzum.`,
      css: [CSS_BASE, ...partes.map((p) => p.css ?? "")].filter(Boolean).join("\n"),
      corpo: [`<div class="palco"><video class="take" data-papel="apresentador" src="midia/apresentador.mp4" muted></video></div>`,
        ...partes.map((p) => p.corpo ?? "").filter(Boolean), `<!-- o que falta entra aqui -->`, `<audio src="midia/voz.wav" data-inicio="0"></audio>`].join("\n"),
      script: [falasJs(c.falas), AJUDA, ...partes.map((p) => p.script ?? "").filter(Boolean)].join("\n") });
  };
  const oraculos = (d: Dados) => cs.map((x) => {
    try { return { nome: x.nome, r: x.oraculo(c)(d) }; } catch (e) { return { nome: x.nome, r: { status: "nao-conferivel" as const, motivo: `o oráculo falhou: ${(e as Error).message}` } }; }
  });
  return {
    composta: k, contexto: c, pedido, id,
    precisa: { geometria: cs.some((x) => x.precisa.geometria), render: cs.some((x) => x.precisa.render) },
    preparar(tarefa) {
      const saida = join(tarefa, "saida");
      mkdirSync(join(saida, "midia"), { recursive: true });
      const seg = c.quadros / QPS;
      gerarApresentador(join(saida, "midia", "apresentador.mp4"), { ...c.dim, segundos: seg, ...c.ap });
      gerarVoz(join(saida, "midia", "voz.wav"), c.falas, { segundos: seg });
      writeFileSync(join(saida, "tempos.json"), JSON.stringify(c.falas, null, 1) + "\n");
      writeFileSync(join(saida, "roteiro.md"), `# Roteiro\n\n${frasesDe(c).map((f) => f.texto).join("\n\n")}\n`);
      writeFileSync(join(saida, "index.html"), html([]));
    },
    resolver(tarefa, erradas) {
      writeFileSync(join(tarefa, "saida", "index.html"), html(cs.map((x) => x.solucao(c, !erradas.includes(x.nome)))));
    },
    oraculos,
    oraculo: (d) => somar(oraculos(d)),
  };
}

