// RÉGUA CONGELADA (só teste): a conferência de antes do conjunto único de regras, como estava na main em 2026-11-01
// (184fc28, conferencia/regras.ts). O teste de paridade (conferencia/paridade.test.ts) compara a conferência de hoje com
// esta, nas mesmas coletas sintéticas. Não mudar: é a referência.

// Regras da conferência automática dos quadros (S04): funções puras sobre a geometria lida do DOM (geometria.js), os
// rostos achados nos quadros limpos (rosto.ts) e as falas da composição (falas.ts). Sem Electron, sem disco.
//   G15: nenhum texto sobre o rosto do apresentador (com margem), em nenhum quadro, inclusive no zoom;
//   G17: a legenda numa linha só, sem sair do quadro;
//   G21: o punch-in vai até o fim da frase e volta na pausa seguinte; a faixa sai junto.
// Mais os avisos: sem rosto onde há apresentador, sem legenda marcada, zona segura do 9:16 (G19), zoom sem fala, frase
// sem pausa, texto tremendo e texto fora do DOM (canvas ou imagem sobre o apresentador). Formato do relatório em
// docs/formatos/conferencia.md; limites calibrados nos vídeos reais em docs/experimentos/2026-11-s04-calibrar.md.
// TypeScript só com sintaxe apagável (roda direto no Node 24).

/** [x, y, largura, altura] em px da composição. */
export type Caixa = [number, number, number, number];
/** Uma palavra da fala, no tempo do vídeo (s): o texto do roteiro, com a pontuação, e o tempo do Whisper (G11). */
export type Fala = { t: string; ini: number; fim: number; bloco: number | string };
/** opacidade: a efetiva (produto dos ancestrais) do texto, a maior entre os nós dele; sem ela, 1. */
export type Texto = { texto: string; papel: string | null; caixas: Caixa[]; opacidade?: number };
export type Legenda = { texto: string; caixas: Caixa[]; estouro: boolean };
/** O que o geometria.js lê no quadro n. */
export type Geometria = {
  n: number;
  apresentador: Caixa | null;
  /** O take do apresentador (mídia e início): trocar de take é corte, não zoom. Sem ele, o take só recomeça quando o apresentador some. */
  take?: string | null;
  textos: Texto[];
  legendas: Legenda[];
  /** chave: a ordem do elemento e o texto; opacidade e caixa: para ver quando ela começa a sair (faixaSaindo). */
  faixas: { chave: string; texto: string; opacidade?: number; caixa?: Caixa }[];
  naoConferidos: { tipo: string; caixa: Caixa }[];
};
export type Composicao = { id: string; largura: number; altura: number; qps: number; quadros: number };
export type Amostra = { n: number; rel: Caixa | null };
export type Zoom = { entrada: number; pico: number; saida: number; corte: boolean };
export type Falha = {
  regra: "G15" | "G17" | "G21"; de: number; ate: number; pior: number; motivo: string;
  texto?: string; papel?: string | null; caixa?: Caixa; rosto?: Caixa; zoom?: Zoom; frase?: string;
};
export type Aviso = { regra: string; motivo: string; de?: number; ate?: number };

/**
 * Limites aprovados pelo responsável em 2026-10-30 (plano do S04, decisão 10.4), numa tabela só, para calibrar no
 * primeiro vídeo real.
 */
export const LIMITES = {
  /** A caixa do detector vai das sobrancelhas ao queixo: margem para testa e cabelo, queixo e lados. */
  margemRosto: { cima: 0.25, baixo: 0.10, lados: 0.10 },
  /** Texto com opacidade efetiva abaixo disto não conta (entrando ou saindo). */
  opacidadeMin: 0.05,
  /**
   * G15 e G19: só conta o texto legível, com opacidade efetiva de pelo menos 0,5. Calibrado em 2026-11 nos vídeos reais:
   * o título que entra em fade enquanto a apresentadora encolhe para o cartão passa pela testa dela em 3 quadros com
   * 0,11, 0,30 e 0,49 (vídeo aprovado); a faixa reprovada fica sobre o rosto com 1 por 4 s.
   */
  opacidadeLegivel: 0.5,
  /** Punch-in: subida da escala do apresentador de pelo menos 5 % em no máximo 12 quadros; a saída, a descida igual. */
  punchIn: { subida: 0.05, quadros: 12 },
  /** Variação por quadro abaixo disto é parada (ou aproximação lenta): não abre nem continua um punch-in. */
  variacaoMin: 0.001,
  /** A saída pode cair 1 quadro antes do fim da frase e 1 quadro depois do início da palavra seguinte. */
  toleranciaSaida: 1,
  /**
   * A faixa visível no zoom tem de começar a sair até 3 quadros depois do início da saída do zoom: sumir, cair abaixo
   * de 90 % da opacidade do último quadro do zoom ou andar 2 % do tamanho dela. Calibrado em 2026-11: a faixa aprovada
   * começa o fade (mola) no próprio quadro da saída e leva 13 quadros para sumir; contar até sumir acusava todas.
   */
  faixaQuadros: 3,
  faixaSaida: { opacidade: 0.9, anda: 0.02 },
  /** E tem de sumir até 30 quadros (1 s a 30 qps) depois da saída: a faixa que só flutua não «sai». A aprovada some em 13. */
  faixaSome: 30,
  /** Rosto amostrado a cada K quadros com o apresentador na tela (mais as entradas e saídas de zoom). */
  amostraRosto: 10,
  /**
   * Texto tremendo (aviso): a caixa de um texto legível muda pouco (mais de 0,05 e menos de 1,5 px por quadro) em
   * quadros seguidos por mais de 5 s: zoom lento, flutuação ou respiração da câmera numa tela com texto. Calibrado em
   * 2026-11: nos vídeos aprovados a maior corrida é 3,5 s (frase que flutua no reel) e a cauda de uma mola fica em
   * 0,5 s; na versão reprovada por tremor, o maior trecho tem 24 s.
   */
  tremor: { pxMin: 0.05, pxMax: 1.5, segundos: 5 },
  /** G19, Reels e anúncio: livres 14 % no topo, 35 % na base e 6 % nos lados. Aviso em todo vídeo vertical. */
  zonaSegura: { cima: 0.14, baixo: 0.35, lados: 0.06 },
};

const recorte = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);

/** Quantas linhas as caixas de linha formam: mesma linha quando os intervalos verticais se sobrepõem em mais da metade da menor altura. */
export function linhas(caixas: Caixa[]): number {
  const grupos: [number, number][] = [];
  for (const [, y, , h] of [...caixas].sort((a, b) => a[1] - b[1])) {
    const g = grupos.find(([y0, y1]) => Math.min(y1, y + h) - Math.max(y0, y) > Math.min(h, y1 - y0) / 2);
    if (g) { g[0] = Math.min(g[0], y); g[1] = Math.max(g[1], y + h); } else grupos.push([y, y + h]);
  }
  return grupos.length;
}

export function comMargem([x, y, w, h]: Caixa, m = LIMITES.margemRosto): Caixa {
  return [x - w * m.lados, y - h * m.cima, w * (1 + 2 * m.lados), h * (1 + m.cima + m.baixo)];
}

/** Área da interseção (0 se não se tocam). */
export function intersecao(a: Caixa, b: Caixa): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

/** O rosto em frações da caixa do apresentador: assim ele anda com o zoom e o movimento do elemento. */
export function rostoRelativo([x, y, w, h]: Caixa, [ax, ay, aw, ah]: Caixa): Caixa {
  return [(x - ax) / aw, (y - ay) / ah, w / aw, h / ah];
}

export function rostoNaTela([rx, ry, rw, rh]: Caixa, [ax, ay, aw, ah]: Caixa): Caixa {
  return [ax + rx * aw, ay + ry * ah, rw * aw, rh * ah];
}

/** O rosto relativo no quadro n: linear entre as amostras com rosto que o cercam; fora delas, a mais próxima. */
export function interpolarRosto(amostras: Amostra[], n: number): Caixa | null {
  const com = amostras.filter((a) => a.rel).sort((a, b) => a.n - b.n) as { n: number; rel: Caixa }[];
  if (!com.length) return null;
  const depois = com.findIndex((a) => a.n >= n);
  if (depois === -1) return com[com.length - 1].rel;
  if (depois === 0 || com[depois].n === n) return com[depois].rel;
  const a = com[depois - 1], b = com[depois], k = (n - a.n) / (b.n - a.n);
  return a.rel.map((v, i) => v + (b.rel[i] - v) * k) as Caixa;
}

/**
 * Os punch-ins na escala do apresentador por quadro (largura da caixa dele sobre a do primeiro quadro do take; null
 * sem apresentador). Entrada: o primeiro quadro de uma subida de pelo menos 5 % em até 12 quadros; saída: o primeiro
 * de uma descida igual, ou o quadro em que o apresentador sai (corte), ou o fim do vídeo (corte). O que anda mais
 * devagar que isso (aproximação lenta) não é punch-in.
 */
export function zooms(escalas: (number | null)[], lim = LIMITES): Zoom[] {
  const total = escalas.length;
  const d = (n: number) => (n > 0 && escalas[n] !== null && escalas[n - 1] !== null ? escalas[n]! / escalas[n - 1]! - 1 : null);
  // Procura, a partir de n, o primeiro quadro i de uma corrida de variação no sentido pedido que chega à subida (ou
  // descida) do limite em até lim.punchIn.quadros quadros. Devolve [i, quadro em que chegou] ou null.
  const achar = (de: number, ate: number, sinal: 1 | -1): [number, number] | null => {
    for (let i = Math.max(1, de); i < ate; i++) {
      const di = d(i);
      if (di === null || di * sinal <= lim.variacaoMin) continue;
      const base = escalas[i - 1]!;
      for (let j = i; j < Math.min(ate, i + lim.punchIn.quadros); j++) {
        const dj = d(j);
        if (dj === null || dj * sinal <= 0) break;
        const r = escalas[j]! / base;
        if (sinal === 1 ? r >= 1 + lim.punchIn.subida : r <= 1 / (1 + lim.punchIn.subida)) return [i, j];
      }
    }
    return null;
  };
  const saida: Zoom[] = [];
  let n = 1;
  while (n < total) {
    const entrou = achar(n, total, 1);
    if (!entrou) break;
    const [entrada] = entrou;
    let pico = entrou[1];
    while (pico + 1 < total && (d(pico + 1) ?? 0) > lim.variacaoMin) pico++;
    // Fim do take (o apresentador sai) com o zoom ativo: conta como saída.
    let fimTake = pico + 1;
    while (fimTake < total && escalas[fimTake] !== null) fimTake++;
    const saiu = achar(pico + 1, fimTake, -1);
    if (saiu) {
      saida.push({ entrada, pico, saida: saiu[0], corte: false });
      n = saiu[1] + 1;
    } else {
      saida.push({ entrada, pico, saida: fimTake, corte: true });
      n = fimTake + 1;
    }
  }
  return saida;
}

const FIM_DE_FRASE = /[.!?…]["'”»)\]]*$/;

export type FaixaNoQuadro = { chave: string; opacidade?: number; caixa?: Caixa };

/** A faixa começou a sair em relação à referência (último quadro do zoom): sumiu, apagou ou andou (LIMITES.faixaSaida). */
export function faixaSaindo(ref: FaixaNoQuadro, agora: FaixaNoQuadro | undefined, lim = LIMITES): boolean {
  if (!agora) return true;
  if ((agora.opacidade ?? 1) < (ref.opacidade ?? 1) * lim.faixaSaida.opacidade) return true;
  if (ref.caixa && agora.caixa) {
    const [x, y, w, h] = ref.caixa, [x2, y2, w2, h2] = agora.caixa;
    const k = lim.faixaSaida.anda;
    if (Math.abs(x2 - x) > k * w || Math.abs(y2 - y) > k * h || Math.abs(w2 - w) > k * w || Math.abs(h2 - h) > k * h) return true;
  }
  return false;
}

/**
 * G21 num zoom: a palavra de ênfase é a que está sendo dita na entrada (ou a última que começou antes); o fim da frase
 * é o fim da primeira palavra dali em diante que termina em . ! ou ?; a pausa vai dele ao início da palavra seguinte
 * (ou ao fim do vídeo). A saída tem de cair em [fim da frase − 1 quadro, início da próxima + 1 quadro]. A faixa
 * visível no zoom tem de começar a sair até 3 quadros depois do início da saída (faixaSaindo).
 */
export function conferirZoom(z: Zoom, falas: Fala[], faixasPorQuadro: (string | FaixaNoQuadro)[][], qps: number, total: number, lim = LIMITES) {
  const falhas: Falha[] = [], avisos: string[] = [];
  const eps = 1e-6;
  const q = (s: number) => s * qps; // segundos → quadros (fracionário)
  const palavras = [...falas].sort((a, b) => a.ini - b.ini);
  const base = { de: z.entrada, ate: z.saida, zoom: z };
  const naFala = palavras.some((p) => q(p.fim) > z.entrada + eps && q(p.ini) < z.saida - eps);
  if (!naFala) {
    avisos.push(`G21: zoom dos quadros ${z.entrada}–${z.saida} sem fala (nenhuma palavra no intervalo)`);
  } else {
    let i = palavras.findLastIndex((p) => q(p.ini) <= z.entrada + eps);
    if (i === -1) i = 0;
    let f = palavras.findIndex((p, k) => k >= i && FIM_DE_FRASE.test(p.t));
    if (f === -1) f = palavras.length - 1;
    let comeco = f;
    while (comeco > 0 && !FIM_DE_FRASE.test(palavras[comeco - 1].t)) comeco--;
    const frase = palavras.slice(comeco, f + 1).map((p) => p.t).join(" ");
    const fimFrase = q(palavras[f].fim);
    const proxima = palavras[f + 1] ?? null;
    const proxIni = proxima ? q(proxima.ini) : total;
    const tol = lim.toleranciaSaida;
    const ms = (quadros: number) => Math.round((quadros * 1000) / qps);
    if (z.saida < fimFrase - tol - eps) {
      falhas.push({ regra: "G21", ...base, pior: z.saida, frase: recorte(frase),
        motivo: `zoom volta ${ms(fimFrase - z.saida)} ms antes do fim da frase «${recorte(frase)}»` });
    } else if (z.saida > proxIni + tol + eps) {
      falhas.push({ regra: "G21", ...base, pior: z.saida, frase: recorte(frase),
        motivo: `zoom volta já na frase seguinte, ${ms(z.saida - proxIni)} ms depois do início de «${proxima?.t ?? ""}» (a frase «${recorte(frase)}» acaba antes)` });
    }
    if (proxIni - fimFrase < 1 - eps) avisos.push(`G21: a frase «${recorte(frase)}» acaba sem pausa antes da seguinte (zoom dos quadros ${z.entrada}–${z.saida})`);
  }
  // Faixa: as que estão na tela no último quadro do zoom têm de começar a sair até faixaQuadros depois do início da
  // saída (sumir, apagar ou andar; faixaSaindo).
  const comoFaixa = (f: string | FaixaNoQuadro): FaixaNoQuadro => (typeof f === "string" ? { chave: f } : f);
  const ultimo = z.saida - 1;
  for (const ref of (faixasPorQuadro[ultimo] ?? []).map(comoFaixa)) {
    let sai = z.saida;
    while (sai < faixasPorQuadro.length && !faixaSaindo(ref, (faixasPorQuadro[sai] ?? []).map(comoFaixa).find((f) => f.chave === ref.chave), lim)) sai++;
    let some = z.saida;
    while (some < faixasPorQuadro.length && (faixasPorQuadro[some] ?? []).map(comoFaixa).some((f) => f.chave === ref.chave)) some++;
    const depois = sai - z.saida;
    if (depois <= lim.faixaQuadros && some - z.saida > lim.faixaSome) {
      falhas.push({ regra: "G21", ...base, pior: z.saida + lim.faixaSome + 1 < total ? z.saida + lim.faixaSome + 1 : z.saida,
        texto: ref.chave, motivo: `faixa ainda na tela ${some - z.saida} quadros depois do início da saída do zoom (limite ${lim.faixaSome})` });
    }
    if (depois > lim.faixaQuadros) {
      falhas.push({ regra: "G21", ...base, pior: z.saida + lim.faixaQuadros + 1 < total ? z.saida + lim.faixaQuadros + 1 : z.saida,
        texto: ref.chave, motivo: `faixa só começa a sair ${depois} quadros depois do início da saída do zoom (limite ${lim.faixaQuadros})` });
    }
  }
  return { falhas, avisos };
}

/** Agrupa quebras por chave em trechos de quadros seguidos, com o pior quadro (maior valor; no empate, o primeiro). */
export function trechos<T extends { n: number; chave: string; valor: number }>(quebras: T[]) {
  const porChave = new Map<string, T[]>();
  for (const q of quebras) porChave.set(q.chave, [...(porChave.get(q.chave) ?? []), q]);
  const saida: { chave: string; de: number; ate: number; pior: number; item: T }[] = [];
  for (const [chave, lista] of porChave) {
    lista.sort((a, b) => a.n - b.n);
    let atual: (typeof saida)[number] | null = null;
    for (const q of lista) {
      if (atual && q.n === atual.ate + 1) {
        atual.ate = q.n;
        if (q.valor > atual.item.valor) { atual.pior = q.n; atual.item = q; }
      } else {
        atual = { chave, de: q.n, ate: q.n, pior: q.n, item: q };
        saida.push(atual);
      }
    }
  }
  return saida.sort((a, b) => a.de - b.de || a.chave.localeCompare(b.chave));
}

/** O take mudou do quadro anterior para este (corte de uma mídia para outra com o apresentador na tela). */
const trocouTake = (geometrias: Geometria[], i: number) =>
  i > 0 && !!geometrias[i].apresentador && !!geometrias[i - 1].apresentador && (geometrias[i].take ?? null) !== (geometrias[i - 1].take ?? null);

/**
 * Escala do apresentador por quadro: largura sobre a do primeiro quadro do take. O take recomeça quando ele volta e
 * quando a mídia dele troca (corte de um take para outro): o salto de tamanho no corte não é punch-in. No corte, o
 * quadro vale null, para nenhum zoom atravessar dois takes.
 */
export function escalasDoApresentador(geometrias: Geometria[]): (number | null)[] {
  let base: number | null = null;
  return geometrias.map((g, i) => {
    if (!g.apresentador || g.apresentador[2] <= 0) { base = null; return null; }
    if (trocouTake(geometrias, i)) { base = null; return null; }
    base ??= g.apresentador[2];
    return g.apresentador[2] / base;
  });
}

/** Quadros em que o rosto é procurado: um a cada K com o apresentador na tela, mais a volta de cada zoom. */
export function quadrosAmostrados(geometrias: Geometria[], zs: Zoom[], k = LIMITES.amostraRosto): number[] {
  const com = new Set<number>();
  geometrias.forEach((g, i) => { if (g.apresentador && i % k === 0) com.add(i); });
  // O primeiro e o último quadro de cada take, para o rosto não ficar só extrapolado (nem interpolado entre dois takes).
  geometrias.forEach((g, i) => {
    if (g.apresentador && (!geometrias[i - 1]?.apresentador || !geometrias[i + 1]?.apresentador || trocouTake(geometrias, i)
      || (i + 1 < geometrias.length && trocouTake(geometrias, i + 1)))) com.add(i);
  });
  for (const z of zs) for (const n of [z.entrada - 1, z.entrada, z.pico, z.saida - 1, z.saida]) {
    if (geometrias[n]?.apresentador) com.add(n);
  }
  return [...com].sort((a, b) => a - b);
}

/**
 * Texto que se move devagar sem parar: por texto legível (papel e texto), a corrida de quadros seguidos em que a
 * primeira caixa dele muda entre pxMin e pxMax px (posição ou tamanho). Corrida acima de `segundos` vira aviso; as
 * corridas que se sobrepõem no tempo (a tela inteira respirando) viram um aviso só.
 */
export function textosTremendo(geometrias: Geometria[], qps: number, lim = LIMITES): Aviso[] {
  const t = lim.tremor, minimo = Math.round(t.segundos * qps);
  const antes = new Map<string, { caixa: Caixa; de: number; corrida: number; texto: string }>();
  const corridas: { de: number; ate: number; texto: string }[] = [];
  const fechar = (e: { de: number; corrida: number; texto: string }, ate: number) => {
    if (e.corrida > minimo) corridas.push({ de: e.de, ate, texto: e.texto });
  };
  for (const g of geometrias) {
    const vistos = new Set<string>();
    for (const tx of g.textos) {
      if ((tx.opacidade ?? 1) < lim.opacidadeLegivel || !tx.caixas.length) continue;
      const k = `${tx.papel ?? ""}\u0000${tx.texto}`;
      vistos.add(k);
      const c = tx.caixas[0], e = antes.get(k);
      if (!e) { antes.set(k, { caixa: c, de: g.n, corrida: 0, texto: tx.texto }); continue; }
      const dv = Math.max(...c.map((v, i) => Math.abs(v - e.caixa[i])));
      if (dv > t.pxMin && dv < t.pxMax) {
        if (!e.corrida) e.de = g.n - 1;
        e.corrida++;
      } else {
        fechar(e, g.n - 1);
        e.corrida = 0;
      }
      e.caixa = c;
    }
    for (const [k, e] of antes) if (!vistos.has(k)) { fechar(e, g.n - 1); antes.delete(k); }
  }
  for (const e of antes.values()) fechar(e, geometrias.length - 1);
  const grupos: { de: number; ate: number; textos: string[] }[] = [];
  for (const c of corridas.sort((a, b) => a.de - b.de)) {
    const g = grupos.at(-1);
    if (g && c.de <= g.ate) { g.ate = Math.max(g.ate, c.ate); if (!g.textos.includes(c.texto)) g.textos.push(c.texto); } else grupos.push({ de: c.de, ate: c.ate, textos: [c.texto] });
  }
  return grupos.map((g) => ({ regra: "tremor", de: g.de, ate: g.ate,
    motivo: `${g.textos.length === 1 ? `texto «${recorte(g.textos[0])}»` : `${g.textos.length} textos (como «${recorte(g.textos[0])}»)`} `
      + `andando devagar sem parar (menos de ${String(t.pxMax).replace(".", ",")} px por quadro) por ${((g.ate - g.de + 1) / qps).toFixed(1)} s: treme; texto só anda na entrada e na saída` }));
}

/** A conferência inteira de uma composição: falhas (G15, G17, G21) e avisos. */
export function conferir({ comp, geometrias, rostos, falas }: { comp: Composicao; geometrias: Geometria[]; rostos: Amostra[]; falas: Fala[] }, lim = LIMITES) {
  const falhas: Falha[] = [], avisos: Aviso[] = [];
  const { largura: L, altura: A } = comp;

  // G15: texto sobre o rosto (com margem), em cada quadro, com o rosto levado pela caixa do apresentador do quadro.
  const g15: { n: number; chave: string; valor: number; texto: Texto; caixa: Caixa; rosto: Caixa }[] = [];
  const rostoDo = (g: Geometria) => {
    if (!g.apresentador) return null;
    const rel = interpolarRosto(rostos, g.n);
    return rel ? rostoNaTela(rel, g.apresentador) : null;
  };
  for (const g of geometrias) {
    const rosto = rostoDo(g);
    if (!rosto) continue;
    const zona = comMargem(rosto, lim.margemRosto);
    for (const t of g.textos) {
      if ((t.opacidade ?? 1) < lim.opacidadeLegivel) continue;
      let pior = 0, caixa: Caixa | null = null;
      for (const c of t.caixas) { const a = intersecao(c, zona); if (a > pior) { pior = a; caixa = c; } }
      if (caixa) g15.push({ n: g.n, chave: `${t.papel ?? ""}\u0000${t.texto}`, valor: pior, texto: t, caixa, rosto });
    }
  }
  for (const t of trechos(g15)) {
    const { texto, caixa, rosto } = t.item;
    falhas.push({ regra: "G15", de: t.de, ate: t.ate, pior: t.pior, texto: recorte(texto.texto), papel: texto.papel, caixa, rosto,
      motivo: `texto sobre o rosto do apresentador (com a margem), ${Math.round(t.item.valor)} px² no pior quadro` });
  }

  // G17: legenda numa linha só e dentro do quadro.
  const g17: { n: number; chave: string; valor: number; motivo: string; texto: string; caixa: Caixa }[] = [];
  for (const g of geometrias) for (const l of g.legendas) {
    const n = linhas(l.caixas);
    const uniao = l.caixas.reduce<Caixa | null>((u, c) => (u ? [Math.min(u[0], c[0]), Math.min(u[1], c[1]),
      Math.max(u[0] + u[2], c[0] + c[2]) - Math.min(u[0], c[0]), Math.max(u[1] + u[3], c[1] + c[3]) - Math.min(u[1], c[1])] : c), null);
    if (!uniao) continue;
    if (n > 1) g17.push({ n: g.n, chave: `linhas\u0000${l.texto}`, valor: n, motivo: `legenda em ${n} linhas`, texto: l.texto, caixa: uniao });
    const fora = l.caixas.some(([x, , w]) => x < -0.5 || x + w > L + 0.5);
    if (fora || l.estouro) g17.push({ n: g.n, chave: `cortada\u0000${l.texto}`, valor: 1, texto: l.texto, caixa: uniao,
      motivo: `legenda cortada (${fora ? "sai do quadro" : "estoura a caixa dela"})` });
  }
  for (const t of trechos(g17)) {
    falhas.push({ regra: "G17", de: t.de, ate: t.ate, pior: t.pior, texto: recorte(t.item.texto), papel: "legenda", caixa: t.item.caixa,
      motivo: t.item.motivo });
  }

  // G21: cada punch-in contra as falas.
  const zs = zooms(escalasDoApresentador(geometrias), lim);
  const faixas = geometrias.map((g) => g.faixas);
  const nomeFaixa = new Map(geometrias.flatMap((g) => g.faixas.map((f) => [f.chave, f.texto] as const)));
  for (const z of zs) {
    const r = conferirZoom(z, falas, faixas, comp.qps, comp.quadros, lim);
    for (const f of r.falhas) falhas.push(f.texto !== undefined ? { ...f, texto: recorte(nomeFaixa.get(f.texto) ?? f.texto), papel: "faixa" } : f);
    for (const a of r.avisos) avisos.push({ regra: "G21", motivo: a, de: z.entrada, ate: z.saida });
  }
  if (zs.length && !falas.length) avisos.push({ regra: "G21", motivo: "há zoom, mas a composição não publicou window.motor_falas (nem veio --falas): G21 não conferida" });

  // Avisos: rosto não achado com o apresentador na tela (falha de detecção não vira aprovação).
  for (const t of trechos(rostos.filter((r) => !r.rel && geometrias[r.n]?.apresentador).map((r) => ({ n: r.n, chave: "", valor: 0 })))) {
    avisos.push({ regra: "G15", de: t.de, ate: t.ate, motivo: `apresentador na tela sem rosto encontrado (quadro ${t.de}${t.ate !== t.de ? ` a ${t.ate}` : ""} da amostra): G15 conferida pelas amostras vizinhas` });
  }
  if (!rostos.some((r) => r.rel) && geometrias.some((g) => g.apresentador)) {
    avisos.push({ regra: "G15", motivo: "nenhum rosto encontrado no apresentador: G15 não conferida" });
  }
  const comTexto = geometrias.some((g) => g.textos.length);
  if (comTexto && !geometrias.some((g) => g.textos.some((t) => t.papel === "legenda"))) {
    avisos.push({ regra: "G41", motivo: 'texto na tela, mas nenhum elemento com data-papel="legenda": G17 não conferida' });
  }
  if (!geometrias.some((g) => g.apresentador)) {
    avisos.push({ regra: "G41", motivo: 'nenhum elemento com data-papel="apresentador" visível: G15 e G21 não conferidas' });
  }
  // G19 no 9:16 (todo vídeo vertical): texto e rosto dentro da zona segura. Aviso.
  if (A > L) {
    const z = lim.zonaSegura;
    const segura: Caixa = [L * z.lados, A * z.cima, L * (1 - 2 * z.lados), A * (1 - z.cima - z.baixo)];
    const dentro = (c: Caixa) => c[0] >= segura[0] - 0.5 && c[1] >= segura[1] - 0.5 && c[0] + c[2] <= segura[0] + segura[2] + 0.5
      && c[1] + c[3] <= segura[1] + segura[3] + 0.5;
    // Um aviso por trecho de quadros seguidos (texto ou rosto), não por texto: a palavra que entra letra a letra ou o
    // número que conta não viram um aviso por estado. Só texto legível (opacidadeLegivel).
    const fora: { n: number; chave: string; valor: number; textos: string[] }[] = [];
    for (const g of geometrias) {
      const textos = g.textos.filter((t) => (t.opacidade ?? 1) >= lim.opacidadeLegivel && t.caixas.some((c) => !dentro(c))).map((t) => t.texto);
      if (textos.length) fora.push({ n: g.n, chave: "texto", valor: 0, textos });
      const rosto = rostoDo(g);
      if (rosto && !dentro(rosto)) fora.push({ n: g.n, chave: "rosto", valor: 0, textos: [] });
    }
    const pct = (v: number) => Math.round(v * 100);
    const zonaTxt = `${pct(z.cima)} % em cima, ${pct(z.baixo)} % embaixo, ${pct(z.lados)} % nos lados`;
    for (const t of trechos(fora)) {
      const nomes = [...new Set(fora.filter((f) => f.chave === t.chave && f.n >= t.de && f.n <= t.ate).flatMap((f) => f.textos))];
      const quem = t.chave === "rosto" ? "rosto" : nomes.length === 1 ? `texto «${recorte(nomes[0])}»` : `${nomes.length} textos (como «${recorte(nomes[0])}»)`;
      avisos.push({ regra: "G19", de: t.de, ate: t.ate, motivo: `${quem} fora da zona segura do 9:16 (${zonaTxt})` });
    }
  }
  // Texto tremendo (aviso): movimento lento e contínuo da caixa de um texto legível (LIMITES.tremor).
  for (const a of textosTremendo(geometrias, comp.qps, lim)) avisos.push(a);
  // Texto fora do DOM não é visto: canvas e imagem sobre o apresentador ficam como não conferidos.
  for (const t of trechos(geometrias.flatMap((g) => g.naoConferidos.map((c) => ({ n: g.n, chave: c.tipo, valor: 0 }))))) {
    avisos.push({ regra: "G15", de: t.de, ate: t.ate, motivo: `<${t.chave}> sobre o apresentador: texto desenhado nele não é conferido` });
  }
  return { falhas: falhas.sort((a, b) => a.de - b.de || a.regra.localeCompare(b.regra)), avisos, zooms: zs };
}
