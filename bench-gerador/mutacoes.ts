// Kodecz Bench (P12): as mutações. Cada classe do #79 é descrita como DADO (bench-gerador/especificacoes.json): as
// primitivas que injetam o defeito na cena base (a «errada»), as que fazem o pedido do jeito certo (a «certa», quando o
// pedido muda algo), a intensidade por grau e a regra do oráculo (medida, parâmetros e limiar; bench-gerador/motores.ts).
// As primitivas são poucas e reutilizáveis: estilo, texto, animação, tempo, inserir, remover, atributos, mídia, script,
// declaração, entrega e «sobre o rosto». Valores que começam com «=» (ou trechos «{=…}» num texto) são contas sobre a cena (g = a intensidade do grau,
// L, A, S, qps, quadros, segundos, rostoX, rostoY…), para a mesma mutação valer em todo tamanho e duração.
import { apresentadorDe, juntar, leiaute, lingua, novoEl, tamanhos, type Anim, type Cena, type El, type Receita, type Tarefa } from "./mundo.ts";

/** Quem a primitiva atinge. */
export type Seletor = { id?: string; papel?: string; tag?: string; cena?: number | "ultima" | "meio" | "B" | "A"; pai?: string; n?: number | "ultimo"; texto?: boolean; todos?: boolean;
  /** Seletores alternativos, na ordem, quando este não acha nada (a cena muda com os eixos). */
  ou?: Seletor[] };
export type Primitiva =
  | { op: "estilo"; alvo: Seletor; css: Record<string, string> }
  | { op: "dados"; kb: string | number }
  | { op: "texto"; alvo: Seletor; palavras?: string | number; texto?: string; html?: string; acrescentar?: string; trocar?: [string, string]; quebrarAntesDaUltima?: boolean; maiusculas?: boolean; destacar?: string }
  | { op: "animar"; alvo: Seletor; anim: Anim & { iniS?: string | number; durS?: string | number }; alinhar?: boolean | "fim" }
  | { op: "anims"; alvo: Seletor; easing?: string; dur?: string | number; ini?: string | number; deslocar?: string | number; iter?: number; fill?: Anim["fill"]; chaves?: Anim["chaves"]; remover?: boolean; alinhar?: boolean }
  | { op: "tempo"; alvo: Seletor; deslocar?: string | number; de?: string | number | null; ate?: string | number | null; fracao?: boolean; encurtar?: string | number }
  | { op: "inserir"; el: Partial<El> & { id: string; tag: string }; pai?: string | Seletor; antes?: Seletor }
  | { op: "remover"; alvo: Seletor }
  | { op: "attrs"; alvo: Seletor; attrs?: Record<string, string | null>; trocar?: Record<string, [string, string]>; escalarVolume?: string | number }
  | { op: "midia"; arquivo: string; receita: Receita; rotulo?: Record<string, unknown> }
  | { op: "script"; js: string }
  | { op: "css"; regra: string }
  | { op: "head"; css: string }
  | { op: "declaracao"; quadros?: string | number; largura?: string | number; altura?: string | number; id?: string; qps?: number }
  | { op: "entrega"; ffmpeg: string[] }
  | { op: "sobreRosto"; alvo: Seletor }
  | { op: "fundoPagina"; cor: string }
  | { op: "cortes"; deslocar?: string | number; paraPalavra?: boolean }
  | { op: "acessorio"; nome: string };

export type Regra = { medida: string; p?: Record<string, unknown>; op: ">" | ">=" | "<" | "<=" | "=" | "!="; limite: number };
export type Especificacao = {
  classe: string;
  /** De onde veio: «modelo» (proposta do modelo barato aceita pelas provas) ou «mao» (escrita à mão). */
  origem: "modelo" | "mao";
  /** O pedido do grau único (arma a armadilha sem dizer qual é). {…} é trocado pelos textos da cena. */
  pedido: string;
  /** O pedido de revisão dos graus (a partida já traz o defeito na intensidade do grau). */
  pedidoRevisao?: string;
  acessorios?: string[];
  /** Campos da tarefa sobrescritos antes de montar a base (midia, fundo, trilha, rosto, permitido, transparente…). */
  tarefa?: Partial<Tarefa>;
  certa?: Primitiva[];
  errada: Primitiva[];
  /** Intensidade (g) por grau; `padrao` é a da errada do grau único. Sem graus: classe binária. */
  graus?: { padrao: number; abaixo?: number; no?: number; acima?: number; unidade?: string; fonte?: string };
  regra: Regra;
  /** Eixo → valor → valor usado na cena, para os valores em que a base não tem a peça da armadilha. */
  substituir?: Record<string, Record<string, string>>;
  /** Proxy que ainda depende da calibração com os rótulos do responsável. */
  calibrar?: boolean;
  /** Rodada de rótulos do responsável (bench-gerador/rotulos.ts): pares, quantos ele escolheu a base, «tanto faz» e
   *  a versão com o defeito. */
  rotulos?: { data: string; pares: number; base: number; igual: number; mutacao: number };
  /** Medida e somada na rodada, sem tirar nota do caso: o motivo (ex.: o responsável achou «tanto faz»). */
  aviso?: string;
  /** Fora da nota até a regra ser reescrita: o motivo (ex.: o responsável preferiu a versão «com defeito»). */
  desligada?: string;
  /** K-IA-09: métrica da rodada, não oráculo por caso. */
  rodada?: boolean;
  /** Valores de eixo em que a classe não se aplica (a cena base não tem a armadilha). */
  nota?: string;
  /** A regra também roda na conferência dos vídeos reais (cli/conferir.ts), com este código no relatório (G15, G19…); na
   * forma de objeto, com uma situação só da conferência por cima da da classe (ex.: G20 aviso lá, automática no bench). */
  conferencia?: NaConferencia;
};

export type NaConferencia = string | { codigo: string; situacao?: "automatica" | "aviso" | "desligada" };
/** O código da regra na conferência (null se ela não roda lá). */
export const codigoNaConferencia = (e: { conferencia?: NaConferencia }) => typeof e.conferencia === "string" ? e.conferencia : e.conferencia?.codigo ?? null;
/** A situação na conferência: a sobreposta no campo `conferencia`, ou a da regra (situacaoDe). */
export function situacaoNaConferencia(e: Especificacao | RegraDaConferencia): Situacao {
  return typeof e.conferencia === "object" && e.conferencia.situacao ? e.conferencia.situacao : situacaoDe(e);
}

/**
 * Regra do conjunto único que ainda não é classe do bench (sem pedido nem mutação): só a conferência a aplica. Fica no
 * mesmo arquivo (especificacoes.json), com a chave igual ao código; virar classe pede a mutação e as provas.
 */
export type RegraDaConferencia = Pick<Especificacao, "regra" | "aviso" | "desligada" | "nota"> & {
  classe: string; conferencia: NaConferencia; so: "conferencia";
};
export type Situacao = "automatica" | "automatica-a-calibrar" | "aviso" | "desligada" | "rodada" | "pendente";

/**
 * A situação de uma regra, a mesma no bench e na conferência: «automatica» (conta na nota; na conferência, falha);
 * «automatica-a-calibrar» (proxy à espera dos rótulos do responsável; conta como automática); «aviso» (medida, fora da
 * nota; na conferência, aviso); «desligada» (não roda até ser reescrita); «rodada» (K-IA-09, métrica da rodada).
 */
export function situacaoDe(e: Especificacao | RegraDaConferencia | undefined): Situacao {
  if (!e) return "pendente";
  if ("rodada" in e && e.rodada) return "rodada";
  if (e.desligada) return "desligada";
  if (e.aviso) return "aviso";
  return "calibrar" in e && e.calibrar ? "automatica-a-calibrar" : "automatica";
}

// ——— Contas ———

export function variaveis(c: Cena, g: number): Record<string, number> {
  const t = c.tarefa, { largura: L, altura: A } = t.dim, ap = apresentadorDe(t), lay = leiaute(t), tam = tamanhos(t);
  const ultima = t.falas.at(-1);
  return { g, L, A, S: Math.min(L, A), qps: t.qps, quadros: c.decl.quadros, segundos: c.decl.quadros / t.qps,
    rostoX: ap.rosto[0] + ap.rosto[2] / 2, rostoY: ap.rosto[1] + ap.rosto[3] / 2, rostoW: ap.rosto[2], rostoH: ap.rosto[3],
    falaFim: ultima?.fim ?? 0, falaUltimaIni: ultima?.ini ?? 0, corte0: t.cortes[0] ?? t.segundos / 2, cortes: t.cortes.length,
    m: lay.m, yTitulo: lay.titulo, yLegenda: lay.legenda, yFaixa: lay.faixa, fsTitulo: tam.titulo, fsCorpo: tam.corpo, fsLegenda: tam.legenda,
    batida: t.batida, grade: t.grade, trilhaGanho: t.trilha === "trilha alta" ? 0.3 : 0.15, enfaseIni: t.falas[t.enfase[0]]?.ini ?? 1, enfaseFim: t.falas[t.enfase[0]]?.fim ?? 1.5 };
}
/** Um valor da especificação: número, texto, ou «=conta» com as variáveis. Em texto, «{=conta}» é trocado. */
export function valor(v: unknown, vars: Record<string, number>): any {
  if (typeof v === "number" || v === null || v === undefined) return v;
  if (typeof v !== "string") return v;
  const conta = (e: string) => {
    if (!/^[\w\s+\-*/().,?:<>=!]+$/.test(e)) throw new Error(`conta com caractere não permitido: ${e}`);
    const nomes = Object.keys(vars);
    // Só as variáveis da cena, Math.<função> e cinza: nada de process, globalThis, constructor…
    if (/(^|[^=!<>])=(?!=)/.test(e)) throw new Error(`conta com atribuição: ${e}`);
    for (const m of e.matchAll(/(\.?)\b([A-Za-z_]\w*)/g)) {
      const [, ponto, id] = m;
      if (ponto ? !Object.hasOwn(Math, id) || id === "random" || !/Math\s*$/.test(e.slice(0, m.index)) : !(nomes.includes(id) || id === "Math" || id === "cinza")) throw new Error(`conta com nome não permitido: ${id}`);
    }
    return Function(...nomes, "Math", "cinza", `"use strict"; return (${e});`)(...nomes.map((k) => vars[k]), Math, cinza);
  };
  if (v.startsWith("=")) return conta(v.slice(1));
  return v.replace(/\{=([^{}]+)\}/g, (_, e) => { const r = conta(e); return typeof r === "number" ? String(+r.toFixed(4)) : String(r); });
}
/** O cinza (#vvvvvv) mais claro que tem contraste `razao` (WCAG) com um fundo de luminância `lf`. */
export function cinza(lf: number, razao: number): string {
  const L = Math.min(1, razao * (lf + 0.05) - 0.05);
  const c = L <= 0.0031308 ? L * 12.92 : 1.055 * L ** (1 / 2.4) - 0.055;
  const v = Math.max(0, Math.min(255, Math.round(c * 255))).toString(16).padStart(2, "0");
  return `#${v}${v}${v}`;
}
const num = (v: unknown, vars: Record<string, number>) => Number(valor(v, vars));
const valores = (o: Record<string, unknown>, vars: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, valor(v, vars)]));

// ——— Seleção ———

export function selecionar(c: Cena, s: Seletor): El[] {
  const r = selecionar1(c, s);
  if (r.length || !s.ou) return r;
  for (const alt of s.ou) { const x = selecionar(c, alt); if (x.length) return x; }
  return [];
}
function selecionar1(c: Cena, s: Seletor): El[] {
  const secoes = c.els.filter((e) => e.classes?.includes("cena"));
  const cenaId = (k: Seletor["cena"]) => {
    if (k === undefined) return undefined;
    if (k === "ultima") return secoes.at(-1)?.id;
    if (k === "meio") return secoes[Math.floor((secoes.length - 1) / 2)]?.id;
    if (k === "B") return c.els.find((e) => e.papel === "rotulo")?.pai ?? secoes[0]?.id;
    if (k === "A") return c.els.find((e) => e.papel === "apresentador")?.pai ?? secoes[0]?.id;
    return secoes[k]?.id;
  };
  const cid = cenaId(s.cena);
  let r = c.els.filter((e) => (s.id === undefined || e.id === s.id) && (s.papel === undefined || e.papel === s.papel) && (s.tag === undefined || e.tag === s.tag)
    && (cid === undefined || e.pai === cid || (s.papel === undefined && s.tag === undefined && s.id === undefined && e.id === cid))
    && (s.pai === undefined || e.pai === s.pai) && (!s.texto || e.texto !== undefined || e.html !== undefined));
  if (s.n !== undefined) r = s.n === "ultimo" ? r.slice(-1) : r.slice(s.n, s.n + 1);
  else if (!s.todos) r = r.slice(0, 1);
  return r;
}

// ——— Aplicação ———

/** Uma cópia funda da cena (o modelo é só dado). */
export const copiar = (c: Cena): Cena => structuredClone(c);

/** Aplica as primitivas numa cópia da cena; `g` é a intensidade. */
export function aplicar(base: Cena, prims: Primitiva[], g: number): Cena {
  const c = copiar(base);
  const t = c.tarefa;
  /** O quadro em que a cena (seção) do elemento começa: «alinhar» conta o começo da animação a partir dela. */
  const cenaDo = (e: El) => { let x: El | undefined = e; while (x && !x.classes?.includes("cena")) x = c.els.find((y) => y.id === x!.pai); return x; };
  const inicioDaCena = (e: El) => cenaDo(e)?.de ?? 0;
  const fimDaCena = (e: El) => cenaDo(e)?.ate;
  const quadro = (v: unknown, vars: Record<string, number>, fracao = false) => { const x = num(v, vars) * t.qps; return fracao ? +x.toFixed(3) : Math.round(x); };
  for (const p of prims) {
    const vars = variaveis(c, g);
    const alvos = "alvo" in p ? selecionar(c, p.alvo) : [];
    if ("alvo" in p && !alvos.length) throw new Error(`primitiva ${p.op}: nenhum elemento para ${JSON.stringify(p.alvo)}`);
    switch (p.op) {
      case "estilo":
        for (const e of alvos) for (const [k, v] of Object.entries(valores(p.css, vars))) { if (v === "" || v === null) delete e.css[k]; else e.css[k] = String(v); }
        break;
      case "texto":
        for (const e of alvos) {
          if (p.texto !== undefined) { e.texto = valor(p.texto, vars); delete e.html; }
          if (p.html !== undefined) { e.html = valor(p.html, vars); delete e.texto; }
          const atual = () => e.html ?? e.texto ?? "";
          if (p.palavras !== undefined) {
            // Enche o texto com n palavras da fala (texto demais na tela).
            const n = Math.round(num(p.palavras, vars)), fala = t.falas.map((x) => x.t.replace(/[.,!?。]$/, ""));
            e.texto = Array.from({ length: n }, (_, i) => fala[i % Math.max(1, fala.length)] ?? "café").join(" "); delete e.html;
          }
          if (p.acrescentar) e.html = `${atual()}${valor(p.acrescentar, vars)}`;
          if (p.trocar) { const s = atual(); if (!s.includes(p.trocar[0])) throw new Error(`texto: «${p.trocar[0]}» não está em ${e.id}`); e.html = s.replace(p.trocar[0], p.trocar[1]); delete e.texto; }
          if (p.quebrarAntesDaUltima) { const s = atual(); const k = s.lastIndexOf(" "); if (k > 0) { e.html = `${s.slice(0, k)}<br>${s.slice(k + 1)}`; delete e.texto; } }
          if (p.maiusculas) { if (e.texto !== undefined) e.texto = e.texto.toUpperCase(); else e.html = atual().replace(/>([^<]+)</g, (_, x) => `>${x.toUpperCase()}<`).replace(/^([^<]+)/, (x) => x.toUpperCase()); }
          if (p.destacar) {
            const s = e.texto ?? e.html ?? "";
            const ps = s.split(" ");
            const k = Math.floor(ps.length / 2);
            ps[k] = `<span style="color: ${valor(p.destacar, vars)};">${ps[k]}</span>`;
            e.html = ps.join(" "); delete e.texto;
          }
        }
        break;
      case "animar":
        for (const e of alvos) {
          const a = { ...p.anim };
          if (a.iniS !== undefined) a.ini = quadro(a.iniS, vars);
          if (a.durS !== undefined) a.dur = Math.max(1, quadro(a.durS, vars));
          if (p.alinhar === "fim" && fimDaCena(e) === undefined) continue;
          a.ini = num(a.ini, vars) + (p.alinhar === "fim" ? fimDaCena(e)! : p.alinhar ? inicioDaCena(e) : 0); a.dur = num(a.dur, vars);
          a.chaves = a.chaves.map((k) => valores(k, vars));
          delete a.iniS; delete a.durS;
          e.anims.push(a);
        }
        break;
      case "anims":
        for (const e of alvos) {
          if (p.remover) { e.anims = []; continue; }
          for (const a of e.anims) {
            if (p.easing !== undefined) a.easing = valor(p.easing, vars);
            if (p.dur !== undefined) a.dur = Math.max(1, quadro(p.dur, vars));
            if (p.ini !== undefined) a.ini = quadro(p.ini, vars) + (p.alinhar ? inicioDaCena(e) : 0);
            else if (p.alinhar) a.ini = inicioDaCena(e) + 2;
            if (p.deslocar !== undefined) a.ini = Math.max(0, a.ini + quadro(p.deslocar, vars));
            if (p.iter !== undefined) a.iter = p.iter;
            if (p.fill !== undefined) a.fill = p.fill;
            if (p.chaves) a.chaves = p.chaves.map((k) => valores(k, vars));
          }
        }
        break;
      case "tempo":
        for (const e of alvos) {
          if (p.deslocar !== undefined) {
            const d = quadro(p.deslocar, vars, p.fracao);
            if (e.de !== undefined) e.de = Math.max(0, e.de + d);
            if (e.ate !== undefined) e.ate = Math.max(1, e.ate + d);
            for (const a of e.anims) a.ini = Math.max(0, a.ini + d);
            if (e.attrs["data-inicio"] !== undefined) e.attrs["data-inicio"] = String(Math.max(0, Number(e.attrs["data-inicio"]) + Math.round(d)));
          }
          if (p.encurtar !== undefined) { e.ate = Math.max((e.de ?? 0) + 1, (e.ate ?? c.decl.quadros) - quadro(p.encurtar, vars)); e.de ??= 0; }
          if (p.de !== undefined) e.de = p.de === null ? undefined : quadro(p.de, vars, p.fracao);
          if (p.ate !== undefined) e.ate = p.ate === null ? undefined : quadro(p.ate, vars, p.fracao);
        }
        break;
      case "inserir": {
        const el = novoEl(p.el.id, p.el.tag, structuredClone(p.el) as Partial<El>);
        el.css = valores(el.css ?? {}, vars) as Record<string, string>;
        el.attrs = valores(el.attrs ?? {}, vars) as Record<string, string>;
        if (el.texto) el.texto = valor(el.texto, vars);
        if (el.html) el.html = valor(el.html, vars);
        if (el.de !== undefined) el.de = num(el.de, vars);
        if (el.ate !== undefined) el.ate = num(el.ate, vars);
        el.anims = (el.anims ?? []).map((a: any) => ({ ...a, ini: a.iniS !== undefined ? quadro(a.iniS, vars) : num(a.ini, vars), dur: a.durS !== undefined ? Math.max(1, quadro(a.durS, vars)) : num(a.dur, vars), chaves: a.chaves.map((k: any) => valores(k, vars)) }));
        if (p.pai) el.pai = typeof p.pai === "string" ? p.pai : selecionar(c, p.pai)[0]?.id;
        // «antes»: na ordem do documento, antes do primeiro elemento do seletor (fica por baixo dele).
        const ref = p.antes ? selecionar(c, p.antes)[0] : undefined;
        if (ref) c.els.splice(c.els.indexOf(ref), 0, el); else c.els.push(el);
        break;
      }
      case "remover": {
        const fora = new Set(alvos.map((e) => e.id));
        c.els = c.els.filter((e) => !fora.has(e.id) && !(e.pai && fora.has(e.pai)));
        break;
      }
      case "attrs":
        for (const e of alvos) {
          for (const [k, v] of Object.entries(p.attrs ?? {})) { if (v === null) delete e.attrs[k]; else e.attrs[k] = String(valor(v, vars)); }
          for (const [k, [de, para]] of Object.entries(p.trocar ?? {})) if (e.attrs[k] !== undefined) e.attrs[k] = e.attrs[k].replace(new RegExp(de), String(valor(para, vars)));
          if (p.escalarVolume !== undefined) {
            // Multiplica o volume (fixo ou em pontos «quadro:volume»).
            const k = num(p.escalarVolume, vars), v = e.attrs["data-volume"] ?? "1";
            e.attrs["data-volume"] = v.includes(":") ? v.split(/\s+/).map((x) => { const [n, y] = x.split(":"); return `${n}:${+(Number(y) * k).toFixed(4)}`; }).join(" ") : String(+(Number(v) * k).toFixed(4));
          }
        }
        break;
      case "midia":
        c.ativos[p.arquivo] = valores(p.receita as Record<string, unknown>, vars) as Receita;
        if (p.rotulo) c.rotulos[p.arquivo] = p.rotulo;
        break;
      case "script": c.scripts.push(valor(p.js, vars)); break;
      case "dados": c.scripts.push(`window.dadosEmbutidos = "${"A".repeat(Math.round(num(p.kb, vars) * 1024))}";`); break;
      case "css": c.css.push(valor(p.regra, vars)); break;
      case "head": c.head.push(valor(p.css, vars)); break;
      case "declaracao":
        if (p.quadros !== undefined) c.decl.quadros = Math.max(1, Math.round(num(p.quadros, vars)));
        if (p.largura !== undefined) c.decl.largura = 2 * Math.round(num(p.largura, vars) / 2);
        if (p.altura !== undefined) c.decl.altura = 2 * Math.round(num(p.altura, vars) / 2);
        if (p.id !== undefined) c.decl.id = valor(p.id, vars);
        if (p.qps !== undefined) c.decl.qps = p.qps;
        break;
      case "entrega": c.entrega = p.ffmpeg.map((a) => String(valor(a, vars))); break;
      case "sobreRosto":
        for (const e of alvos) {
          e.css.left = `${Math.round(vars.rostoX)}px`; e.css.top = `${Math.round(vars.rostoY - vars.rostoH * 0.2)}px`;
          e.css.translate = "-50% 0"; delete e.css.right;
        }
        break;
      case "fundoPagina": c.fundoPagina = valor(p.cor, vars); break;
      case "cortes": {
        // Desloca todos os cortes de cena (o fim de cada cena e o começo da seguinte, com o que está dentro dela); com
        // paraPalavra, cada corte vai para o meio da primeira palavra que começa depois dele.
        const secoes = c.els.filter((e) => e.classes?.includes("cena"));
        const meioDaPalavra = (n: number) => { const w = t.falas.find((f) => f.ini * t.qps >= n - 0.5); return w ? Math.round(((w.ini + w.fim) / 2) * t.qps) - n : 0; };
        const fixo = quadro(p.deslocar ?? 0, vars);
        const dDe = (i: number) => p.paraPalavra ? (secoes[i]?.de !== undefined ? meioDaPalavra(secoes[i].de!) : 0) : fixo;
        // O fim de cada cena (quadro) → o deslocamento do corte que começa ali.
        const limites = new Map(secoes.map((x, i) => [x.ate, dDe(i + 1)] as const).filter(([a]) => a !== undefined));
        for (const e of c.els) if (!e.pai && !e.classes?.includes("cena") && e.ate !== undefined && limites.has(e.ate)) e.ate += limites.get(e.ate)!;
        secoes.forEach((sec, i) => {
          const d = i > 0 ? dDe(i) : 0, dFim = sec.ate !== undefined ? dDe(i + 1) : 0;
          for (const e of c.els.filter((x) => x.pai === sec.id)) if (e.attrs["data-quadros"] !== undefined) e.attrs["data-quadros"] = String(Number(e.attrs["data-quadros"]) + dFim - d);
          if (i > 0) {
            sec.de = (sec.de ?? 0) + d;
            for (const a of sec.anims) a.ini += d;
            for (const e of c.els.filter((x) => x.pai === sec.id)) {
              for (const a of e.anims) a.ini += d;
              if (e.de !== undefined) e.de += d;
              if (e.ate !== undefined) e.ate += d;
              for (const k of ["data-inicio", "data-recorte"]) if (e.attrs[k] !== undefined) e.attrs[k] = String(Number(e.attrs[k]) + d);
            }
          }
          if (sec.ate !== undefined) sec.ate += dFim;
        });
        break;
      }
      case "acessorio": throw new Error("acessório é da especificação (campo acessorios), não primitiva");
    }
  }
  return c;
}

/** Lista as palavras de toda a fala e dos textos da marca (o vocabulário da tarefa: K-DES-14). */
export function vocabulario(t: Tarefa): string[] {
  const l = lingua(t.escrita);
  return [...t.falas.map((p) => p.t), ...juntar(l, [l.titulo, l.chamada]).split(/\s+/), ...l.rotulos, "Zunzum", "Torrefação", "Sim", "Não", "dos", "pedidos", "Novo", ...t.dados];
}
