// Kodecz Bench (P12): os oráculos. Cada um recebe o que foi coletado da entrega (geometria do S04 com a sonda do
// bench, o MP4 renderizado) e diz se o erro do item aconteceu. Objetivos: medem e comparam com um limite. Onde a
// regra já existe na conferência do S04, ela é reaproveitada (margem do rosto, linhas da legenda, zoom × frase).
import { existsSync } from "node:fs";
import { audio, lumas, luminancia, quadrosRgb, rms, saiuDoX264, tom } from "./analise.ts";
import type { Coletado, Quadro } from "./coletar.ts";
import { comMargem, conferirZoom, escalasDoApresentador, intersecao, linhas, zooms, type Caixa, type Fala } from "../conferencia/regras.ts";

export type Status = "erro" | "certo" | "nao-conferivel";
export type Resultado = { status: Status; motivo: string; quadro?: number };
export type Dados = { col: Coletado | null; mp4: string | null; referencia?: Record<string, Float32Array> };

const erro = (motivo: string, quadro?: number): Resultado => ({ status: "erro", motivo, quadro });
const certo = (motivo: string): Resultado => ({ status: "certo", motivo });
const naoConferivel = (motivo: string): Resultado => ({ status: "nao-conferivel", motivo });

const uniao = (cs: Caixa[]): Caixa | null => cs.reduce<Caixa | null>((u, c) => (u ? [Math.min(u[0], c[0]), Math.min(u[1], c[1]),
  Math.max(u[0] + u[2], c[0] + c[2]) - Math.min(u[0], c[0]), Math.max(u[1] + u[3], c[1] + c[3]) - Math.min(u[1], c[1])] : c), null);
const area = (c: Caixa) => Math.max(0, c[2]) * Math.max(0, c[3]);
/** A interseção de duas caixas, ou null. */
const recorte = (a: Caixa, b: Caixa): Caixa | null => {
  const x = Math.max(a[0], b[0]), y = Math.max(a[1], b[1]);
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - x, h = Math.min(a[1] + a[3], b[1] + b[3]) - y;
  return w > 0 && h > 0 ? [x, y, w, h] : null;
};
const precisa = (d: Dados) => { if (!d.col) throw new Error("oráculo sem a coleta da composição"); return d.col; };
const segundosParaQuadro = (s: number, qps: number) => Math.round(s * qps);

/** O apresentador: a mídia marcada (data-papel) ou a que tem `nome` no src. Caixa do conteúdo na tela. */
function midiaDe(q: Quadro, nome: string) {
  return q.extra.midias.find((m) => m.papel === "apresentador" && m.src.includes(nome)) ?? q.extra.midias.find((m) => m.src.includes(nome)) ?? null;
}
/** Uma caixa em px do vídeo de origem (largura × altura) levada à tela pela caixa do conteúdo da mídia. */
function naTela([x, y, w, h]: Caixa, [ow, oh]: [number, number], c: number[]): Caixa {
  const ex = c[2] / ow, ey = c[3] / oh;
  return [c[0] + x * ex, c[1] + y * ey, w * ex, h * ey];
}

/** Fim de cada frase (G21: `.`, `!`, `?` ou `…`, com aspas depois) como [início da 1.ª palavra, fim da última]. */
export function frases(falas: Fala[]): { ini: number; fim: number; texto: string; palavras: number[] }[] {
  const r: { ini: number; fim: number; texto: string; palavras: number[] }[] = [];
  let atual: number[] = [];
  falas.forEach((f, i) => {
    atual.push(i);
    if (/[.!?…]["'»”)\]]*$/.test(f.t)) { r.push({ ini: falas[atual[0]].ini, fim: f.fim, texto: atual.map((j) => falas[j].t).join(" "), palavras: atual }); atual = []; }
  });
  if (atual.length) r.push({ ini: falas[atual[0]].ini, fim: falas[atual.at(-1)!].fim, texto: atual.map((j) => falas[j].t).join(" "), palavras: atual });
  return r;
}

// ——— Espaço ———

/** E1 (G15): nenhum texto sobre o rosto (caixa conhecida no vídeo do apresentador), com a margem do S04. */
export const rostoLivre = (o: { midia: string; origem: [number, number]; rosto: Caixa }) => (d: Dados): Resultado => {
  const col = precisa(d);
  let visto = false;
  for (const q of col.quadros) {
    const m = midiaDe(q, o.midia);
    if (!m) continue;
    visto = true;
    const zona = comMargem(naTela(o.rosto, o.origem, m.conteudo));
    for (const t of q.textos) for (const c of t.caixas) {
      const a = intersecao(c, zona);
      if (a > 0) return erro(`texto «${t.texto.slice(0, 40)}» sobre o rosto (${Math.round(a)} px² com a margem)`, q.n);
    }
  }
  return visto ? certo("nenhum texto encosta no rosto") : naoConferivel(`o apresentador (${o.midia}) não aparece`);
};

/** E2 (G17): a legenda numa linha só e dentro do quadro. */
export const legendaUmaLinha = () => (d: Dados): Resultado => {
  const col = precisa(d);
  let vistas = 0;
  for (const q of col.quadros) for (const l of q.legendas) {
    vistas++;
    const n = linhas(l.caixas);
    if (n > 1) return erro(`legenda em ${n} linhas: «${l.texto.slice(0, 40)}»`, q.n);
    if (l.caixas.some(([x, , w]) => x < -0.5 || x + w > col.decl.largura + 0.5) || l.estouro) return erro(`legenda cortada: «${l.texto.slice(0, 40)}»`, q.n);
  }
  return vistas ? certo("legenda sempre numa linha") : naoConferivel("nenhuma legenda marcada (data-papel=\"legenda\") com texto na tela");
};

/** E3, E4 (G16): faixa e legenda no mesmo eixo, a faixa logo acima da legenda. */
export const mesmoEixo = () => (d: Dados): Resultado => {
  const col = precisa(d);
  const L = col.decl.largura, A = col.decl.altura;
  let juntas = 0;
  for (const q of col.quadros) {
    const faixa = uniao(q.textos.filter((t) => t.papel === "faixa").flatMap((t) => t.caixas));
    const legenda = uniao(q.legendas.flatMap((l) => l.caixas));
    if (!faixa || !legenda) continue;
    juntas++;
    const dx = Math.abs(faixa[0] + faixa[2] / 2 - (legenda[0] + legenda[2] / 2));
    if (dx > 0.03 * L) return erro(`faixa e legenda em eixos diferentes (centros a ${Math.round(dx)} px)`, q.n);
    const vao = legenda[1] - (faixa[1] + faixa[3]);
    if (vao < -2 || vao > 0.2 * A) return erro(`faixa não está logo acima da legenda (vão de ${Math.round(vao)} px)`, q.n);
  }
  return juntas ? certo("faixa centrada logo acima da legenda") : naoConferivel("faixa (data-papel=\"faixa\") e legenda nunca na tela juntas");
};

/** E5 (G23): a logo do fundo do take nunca cortada pela borda: inteira (≥ 95 %) ou fora (≤ 5 %). */
export const logoInteira = (o: { midia: string; origem: [number, number]; logo: Caixa }) => (d: Dados): Resultado => {
  const col = precisa(d);
  const tela: Caixa = [0, 0, col.decl.largura, col.decl.altura];
  let visto = false;
  for (const q of col.quadros) {
    const m = midiaDe(q, o.midia);
    if (!m) continue;
    visto = true;
    const logo = naTela(o.logo, o.origem, m.conteudo);
    // A parte visível: dentro do quadro e da caixa do elemento (o que corta o conteúdo da mídia).
    const janela = recorte(tela, m.caixa as Caixa);
    const f = janela ? intersecao(logo, janela) / area(logo) : 0;
    if (f > 0.05 && f < 0.95) return erro(`logo do fundo cortada pela borda (${Math.round(f * 100)} % visível)`, q.n);
  }
  return visto ? certo("logo inteira ou fora do quadro") : naoConferivel(`o take (${o.midia}) não aparece`);
};

/** 2-médias na luminância: as duas cores do trecho (o texto e o fundo atrás dele). */
export function duasLuminancias(ls: number[]): [number, number] {
  let a = Math.min(...ls), b = Math.max(...ls);
  for (let i = 0; i < 20; i++) {
    let sa = 0, na = 0, sb = 0, nb = 0;
    for (const l of ls) { if (Math.abs(l - a) <= Math.abs(l - b)) { sa += l; na++; } else { sb += l; nb++; } }
    const a2 = na ? sa / na : a, b2 = nb ? sb / nb : b;
    if (a2 === a && b2 === b) break;
    a = a2; b = b2;
  }
  return [a, b];
}
export const razaoContraste = (l1: number, l2: number) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

/** E6 (G20): o título legível sobre a imagem clara: contraste entre o texto e o fundo atrás dele ≥ 3:1 no render. */
export const contraste = (o: { texto: string; minimo?: number }) => (d: Dados): Resultado => {
  const col = precisa(d);
  if (!d.mp4) return naoConferivel("sem render");
  const ns = col.quadros.filter((q) => q.textos.some((t) => t.texto.includes(o.texto))).map((q) => q.n);
  if (!ns.length) return naoConferivel(`o texto «${o.texto}» não aparece`);
  // O título já entrado: quadros da metade final do trecho em que ele aparece, cinco amostras.
  const fim = ns.slice(Math.floor(ns.length / 2));
  const amostras = [0, 0.25, 0.5, 0.75, 1].map((p) => fim[Math.min(fim.length - 1, Math.round(p * (fim.length - 1)))]);
  const rgb = quadrosRgb(d.mp4, amostras);
  const L = col.decl.largura, A = col.decl.altura;
  const razoes: number[] = [];
  for (const n of amostras) {
    const px = rgb.get(n);
    const c = uniao(col.quadros[n].textos.filter((t) => t.texto.includes(o.texto)).flatMap((t) => t.caixas));
    if (!px || !c) continue;
    const ls: number[] = [];
    for (let y = Math.max(0, Math.floor(c[1])); y < Math.min(A, Math.ceil(c[1] + c[3])); y++)
      for (let x = Math.max(0, Math.floor(c[0])); x < Math.min(L, Math.ceil(c[0] + c[2])); x++) {
        const i = (y * L + x) * 3;
        ls.push(luminancia(px[i], px[i + 1], px[i + 2]));
      }
    if (ls.length) { const [a, b] = duasLuminancias(ls); razoes.push(razaoContraste(a, b)); }
  }
  if (!razoes.length) return naoConferivel("sem quadro do render com o texto");
  const pior = Math.min(...razoes), minimo = o.minimo ?? 3;
  return pior < minimo ? erro(`contraste ${pior.toFixed(2)}:1 entre o título e o fundo (mínimo ${minimo}:1)`) : certo(`contraste ${pior.toFixed(2)}:1`);
};

/** E7 (G19): no Reels, todo texto na zona segura: 14 % livres em cima, 35 % embaixo, 6 % dos lados. */
export const zonaSegura = () => (d: Dados): Resultado => {
  const col = precisa(d);
  const L = col.decl.largura, A = col.decl.altura;
  const zona: Caixa = [0.06 * L, 0.14 * A, 0.88 * L, 0.51 * A];
  let algum = false;
  for (const q of col.quadros) for (const t of q.textos) for (const c of t.caixas) {
    algum = true;
    if (c[0] < zona[0] - 0.5 || c[1] < zona[1] - 0.5 || c[0] + c[2] > zona[0] + zona[2] + 0.5 || c[1] + c[3] > zona[1] + zona[3] + 0.5) {
      return erro(`texto «${t.texto.slice(0, 40)}» fora da zona segura do Reels (caixa ${c.map(Math.round).join(", ")})`, q.n);
    }
  }
  return algum ? certo("todo texto na zona segura") : naoConferivel("nenhum texto na tela");
};

// ——— Tempo da fala ———

/** T1 (G21): o punch-in vai até o fim da frase e volta na pausa (a regra do S04). */
export const zoomAteOFimDaFrase = () => (d: Dados): Resultado => {
  const col = precisa(d);
  const zs = zooms(escalasDoApresentador(col.quadros));
  if (!zs.length) return naoConferivel("nenhum punch-in no apresentador (data-papel=\"apresentador\")");
  if (!col.falas.length) return naoConferivel("sem window.motor_falas");
  const faixas = col.quadros.map((q) => q.faixas.map((f) => f.chave));
  for (const z of zs) {
    const r = conferirZoom(z, col.falas, faixas, col.decl.qps, col.decl.quadros);
    if (r.falhas.length) return erro(r.falhas[0].motivo, z.saida);
  }
  return certo(`${zs.length} punch-in até o fim da frase`);
};

/**
 * T2 (G09): cada bloco de voz inteiro no vídeo, até o fim real da voz. A voz de cada bloco é um tom próprio; o tempo
 * com voz no render (janelas de 10 ms com o tom) tem de ser o da referência, com 60 ms de folga.
 */
export const blocosInteiros = (blocos: { nome: string; freq: number }[]) => (d: Dados): Resultado => {
  if (!d.mp4) return naoConferivel("sem render");
  const som = audio(d.mp4);
  if (!som.length) return erro("o vídeo saiu sem áudio");
  const comVoz = (a: Float32Array, f: number) => tom(a, f).filter((p) => p > 0.002).length * 0.01;
  for (const b of blocos) {
    const ref = d.referencia?.[b.nome];
    if (!ref) throw new Error(`sem a referência do ${b.nome}`);
    const esperado = comVoz(ref, b.freq), achado = comVoz(som, b.freq);
    if (achado < esperado - 0.06) return erro(`${b.nome}: ${(esperado - achado).toFixed(2)} s de voz cortados (${achado.toFixed(2)} de ${esperado.toFixed(2)} s)`);
  }
  return certo("os blocos de voz estão inteiros");
};

/** T4: a câmera do documento muda por frase, não por palavra: no máximo um movimento começa em cada frase. */
export const cameraPorFrase = () => (d: Dados): Resultado => {
  const col = precisa(d);
  const qps = col.decl.qps;
  const caixas = col.quadros.map((q) => q.extra.els.find((e) => e.papel === "documento")?.caixa ?? null);
  if (!caixas.some(Boolean)) return naoConferivel("sem o documento (data-papel=\"documento\")");
  const inicios: number[] = [];
  let parado = 99;
  for (let n = 1; n < caixas.length; n++) {
    const a = caixas[n - 1], b = caixas[n];
    const anda = !!a && !!b && a.some((v, i) => Math.abs(v - b[i]) > 0.5);
    if (anda && parado >= 4) inicios.push(n);
    parado = anda ? 0 : parado + 1;
  }
  if (!inicios.length) return naoConferivel("a câmera do documento não se move");
  for (const f of frases(col.falas)) {
    const de = segundosParaQuadro(f.ini - 0.3, qps), ate = segundosParaQuadro(f.fim + 0.2, qps);
    const dentro = inicios.filter((n) => n >= de && n <= ate);
    if (dentro.length > 1) return erro(`${dentro.length} movimentos de câmera na frase «${f.texto.slice(0, 40)}» (quadros ${dentro.join(", ")})`, dentro[1]);
  }
  return certo(`${inicios.length} movimentos, no máximo um por frase`);
};

/** T5: a fala acelerada no máximo 1,10× (o ponto aprovado). `fala`: duração original do primeiro ao último som. */
export const velocidadeDaFala = (o: { fala: number; maximo?: number }) => (d: Dados): Resultado => {
  if (!d.mp4) return naoConferivel("sem render");
  const som = audio(d.mp4);
  const janelas = rms(som);
  const com = janelas.map((v, i) => (v > 0.02 ? i : -1)).filter((i) => i >= 0);
  if (!com.length) return erro("o vídeo saiu sem voz");
  const duracao = (com.at(-1)! - com[0] + 1) * 0.01;
  const fator = o.fala / duracao, maximo = o.maximo ?? 1.1;
  if (fator > maximo + 0.005) return erro(`fala acelerada ${fator.toFixed(3)}× (máximo ${maximo}×)`);
  if (fator < 1.02) return naoConferivel(`a fala não foi acelerada (${fator.toFixed(3)}×)`);
  return certo(`fala a ${fator.toFixed(3)}×`);
};

// ——— Movimento ———

/** M1: texto não se move continuamente (escala lenta, flutuação): só na entrada e na saída, até 0,8 s seguidos. */
export const textoSemTremor = (o: { maximo?: number } = {}) => (d: Dados): Resultado => {
  const col = precisa(d);
  const maximo = o.maximo ?? 24;
  const ultimo = new Map<string, Caixa>(), corrida = new Map<string, number>();
  if (!col.quadros.some((q) => q.textos.length)) return naoConferivel("nenhum texto na tela");
  for (const q of col.quadros) {
    const vistos = new Set<string>();
    for (const t of q.textos) {
      const k = `${t.papel}\u0000${t.texto}`, c = uniao(t.caixas)!;
      vistos.add(k);
      const a = ultimo.get(k);
      const anda = !!a && a.some((v, i) => Math.abs(v - c[i]) > 0.02);
      const r = anda ? (corrida.get(k) ?? 0) + 1 : 0;
      corrida.set(k, r);
      ultimo.set(k, c);
      if (r > maximo) return erro(`texto «${t.texto.slice(0, 40)}» em movimento contínuo por mais de ${maximo} quadros (treme)`, q.n);
    }
    for (const k of [...ultimo.keys()]) if (!vistos.has(k)) { ultimo.delete(k); corrida.delete(k); }
  }
  return certo("texto só se move na entrada e na saída");
};

/** M2: as frases fluem uma na outra: sem quadro vazio entre elas e com pelo menos 2 quadros em que as duas aparecem. */
export const frasesEmFluxo = (o: { frases: string[] }) => (d: Dados): Resultado => {
  const col = precisa(d);
  const chave = (s: string) => s.slice(0, 14);
  const visiveis = col.quadros.map((q) => o.frases.map((f) => q.textos.some((t) => t.texto.includes(chave(f)))));
  const primeiro = visiveis.findIndex((v) => v[0]), ultimo = visiveis.findLastIndex((v) => v[o.frases.length - 1]);
  if (primeiro < 0 || ultimo < 0) return naoConferivel("as frases não aparecem todas");
  for (let n = primeiro; n <= ultimo; n++) if (!visiveis[n].some(Boolean)) return erro(`tela sem frase no quadro ${n}: cada frase entra, para e some`, n);
  for (let i = 0; i + 1 < o.frases.length; i++) {
    const juntas = visiveis.filter((v) => v[i] && v[i + 1]).length;
    if (juntas < 2) return erro(`a frase ${i + 2} só entra depois que a ${i + 1} sai (${juntas} quadro junto)`);
  }
  return certo("as frases se transformam uma na outra");
};

/** M3: nada parado: nenhum trecho de 1,5 s sem mudança na tela (até 10 pixels de 320 × 180 mudando 12 níveis: o ruído do quadro-chave). */
export const semTelaParada = (o: { maximo?: number } = {}) => (d: Dados): Resultado => {
  if (!d.mp4) return naoConferivel("sem render");
  const ls = lumas(d.mp4), maximo = o.maximo ?? 45;
  if (ls.length <= maximo) return naoConferivel(`o vídeo tem ${ls.length} quadros, menos que a janela de ${maximo}`);
  let corrida = 0;
  for (let n = 1; n < ls.length; n++) {
    corrida = ls[n].mudados <= 10 ? corrida + 1 : 0;
    if (corrida >= maximo) return erro(`tela parada por ${maximo} quadros seguidos (até o quadro ${n})`, n);
  }
  return certo("sempre há movimento na tela");
};

/** M4 (G22): nada de foto parada no lugar do vídeo vivo: nenhuma <img> cobrindo 40 % do quadro por 0,5 s. */
export const semFotoParada = () => (d: Dados): Resultado => {
  const col = precisa(d);
  const L = col.decl.largura, A = col.decl.altura, tela: Caixa = [0, 0, L, A];
  if (!col.quadros.some((q) => q.extra.midias.length)) return naoConferivel("nenhuma mídia na tela");
  let corrida = 0;
  for (const q of col.quadros) {
    const grande = q.extra.midias.some((m) => m.tag === "img" && m.op >= 0.5 && intersecao(m.conteudo as Caixa, tela) >= 0.4 * L * A);
    corrida = grande ? corrida + 1 : 0;
    if (corrida >= 15) return erro("foto parada em tela cheia no lugar do vídeo vivo", q.n);
  }
  return certo("só vídeo vivo em tela cheia");
};

/** M5 (G22): sem clarão branco: nenhum quadro com luma média acima de 190 ou mais de 35 % quase branco. */
export const semClarao = () => (d: Dados): Resultado => {
  if (!d.mp4) return naoConferivel("sem render");
  const ls = lumas(d.mp4);
  const n = ls.findIndex((l) => l.media > 190 || l.branco > 0.35);
  return n >= 0 ? erro(`clarão no quadro ${n} (luma média ${ls[n].media.toFixed(0)}, ${Math.round(ls[n].branco * 100)} % quase branco)`, n) : certo("sem clarão");
};

// ——— Contexto e regressão ———

/** X1: a identidade aprovada, não a da base velha: nenhuma das cores velhas em mais de 0,3 % de um quadro. */
export const semIdentidadeVelha = (o: { cores: [number, number, number][] }) => (d: Dados): Resultado => {
  if (!d.mp4) return naoConferivel("sem render");
  const ls = lumas(d.mp4);
  const ns = ls.map((_, i) => i).filter((i) => i % 10 === 0);
  for (const [n, px] of quadrosRgb(d.mp4, ns)) {
    let velhos = 0;
    const total = px.length / 3;
    for (let i = 0; i < px.length; i += 3) {
      for (const [r, g, b] of o.cores) if ((px[i] - r) ** 2 + (px[i + 1] - g) ** 2 + (px[i + 2] - b) ** 2 < 30 * 30) { velhos++; break; }
    }
    if (velhos / total > 0.003) return erro(`cores da identidade velha em ${(100 * velhos / total).toFixed(1)} % do quadro ${n}`, n);
  }
  return certo("nenhuma cor da identidade velha");
};

/** X3 (G33): o vídeo entregue saiu da placa (NVENC), não do modo só CPU (x264). */
export const renderNaPlaca = () => (d: Dados): Resultado => {
  if (!d.mp4 || !existsSync(d.mp4)) return naoConferivel("o vídeo não foi entregue");
  return saiuDoX264(d.mp4) ? erro("o vídeo saiu do x264: render na CPU") : certo("render na placa");
};

// ——— Cobertura ———

/**
 * C1, C2: cada célula citada pela fala aparece no quadro e ganha realce enquanto é dita (da palavra − 0,5 s ao fim da
 * frase + 1 s). Realce: a célula muda de cor, fundo ou peso em relação ao quadro 0, ou um elemento que pinta (e que
 * não estava assim no quadro 0) cobre metade dela sem ser muito maior que ela.
 */
export const celulasRealcadas = (o: { celulas: { celula: string; palavra: number }[] }) => (d: Dados): Resultado => {
  const col = precisa(d);
  const qps = col.decl.qps, tela: Caixa = [0, 0, col.decl.largura, col.decl.altura];
  if (!col.falas.length) return naoConferivel("sem window.motor_falas");
  const fs = frases(col.falas);
  const q0 = col.quadros[0];
  const base = new Map(q0.extra.pintados.map((p) => [p.k, p.sig]));
  const estilo0 = new Map(q0.extra.els.filter((e) => e.celula).map((e) => [e.celula!, `${e.cor}|${e.fundo}|${e.peso}`]));
  const faltam: string[] = [];
  for (const { celula, palavra } of o.celulas) {
    const fala = col.falas[palavra];
    const frase = fs.find((f) => f.palavras.includes(palavra));
    const de = Math.max(0, segundosParaQuadro(fala.ini - 0.5, qps)), ate = Math.min(col.quadros.length - 1, segundosParaQuadro((frase?.fim ?? fala.fim) + 1, qps));
    let achou = false;
    for (let n = de; n <= ate && !achou; n++) {
      const q = col.quadros[n];
      const el = q.extra.els.find((e) => e.celula === celula);
      if (!el || el.op < 0.5) continue;
      const c = el.caixa as Caixa;
      if (intersecao(c, tela) < 0.9 * area(c)) continue;
      if (`${el.cor}|${el.fundo}|${el.peso}` !== estilo0.get(celula)) { achou = true; break; }
      achou = q.extra.pintados.some((p) => base.get(p.k) !== p.sig && p.celulas.every((x) => x === celula) && (p.dentro === null || p.dentro === celula)
        && intersecao(p.caixa as Caixa, c) >= 0.5 * area(c) && area(p.caixa as Caixa) <= 8 * area(c));
    }
    if (!achou) faltam.push(`${celula} («${fala.t}»)`);
  }
  return faltam.length ? erro(`sem realce enquanto a fala cita: ${faltam.join(", ")}`) : certo("todas as células citadas realçadas");
};
