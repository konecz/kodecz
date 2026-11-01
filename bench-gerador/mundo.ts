// Kodecz Bench (P12): o mundo dos casos gerados. Uma cena base CORRETA por caso (tipo de vídeo e eixos do caso), como
// modelo de dados (elementos, áudios, mídia, scripts), que vira a página em linha do tempo declarada
// (docs/formatos/linha-do-tempo.md). Cada classe do #79 é uma MUTAÇÃO desse modelo (bench-gerador/mutacoes.ts): a base
// é a «certa», a mutação é a «errada». Os oráculos (bench-gerador/motores.ts) só leem o que sai da página, do render, da
// mídia rotulada e da tarefa; nunca o modelo nem a mutação.
//
// Tudo inventado (R01): a marca fictícia Zunzum (identidade/fixtures/marca-ficticia/), frases inventadas em cinco
// escritas, voz e trilha feitas de tons, imagens de degradê, o retrato de domínio público do S04 como apresentador.
//
// A base cumpre ao mesmo tempo as regras de todas as classes (é o que a matriz cruzada prova): cortes nas batidas e nas
// pausas da fala, entradas com easing da marca e escalonadas, legendas em pedaços de leitura, faixa e legenda no mesmo
// eixo, nada sobre o rosto, nada fora da zona segura, trilha que abaixa sob a voz e entra e sai em fade, último quadro
// segurado.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gerarApresentador, RETRATO, type Caixa } from "../bench/molde.ts";
import { canonico } from "./catalogo.ts";

// ——— Tipos ———

export type Palavra = { t: string; ini: number; fim: number; bloco: number };
/** Um quadro-chave das Web Animations (propriedades de CSS em camelCase ou com hífen, como o element.animate aceita). */
export type Chave = Record<string, string | number>;
/** Animação na document.timeline, em quadros da composição. iter -1 = para sempre. */
export type Anim = { chaves: Chave[]; ini: number; dur: number; easing?: string; iter?: number; fill?: "both" | "forwards" | "backwards" | "none"; alternar?: boolean };
export type El = {
  id: string; tag: string;
  /** id do elemento pai (uma cena é uma <section id="cena-i">); sem pai, fica no body. */
  pai?: string;
  papel?: string; classes?: string[];
  texto?: string; html?: string;
  attrs: Record<string, string>;
  css: Record<string, string>;
  /** Visível do quadro de até o ate (as duas animações de duração zero do degrau 1). */
  de?: number; ate?: number;
  anims: Anim[];
};
export type Receita =
  | { tipo: "imagem"; largura: number; altura: number; c0: string; c1: string; formas?: boolean }
  | { tipo: "clipe"; largura: number; altura: number; segundos: number; qps: number; c0: string; c1: string; bloco: string; hdr?: boolean }
  | { tipo: "gif"; largura: number; altura: number; segundos: number }
  | { tipo: "apresentador"; largura: number; altura: number; segundos: number; escala: number; x: number; y: number }
  | { tipo: "wav"; segundos: number; partes: Tom[] }
  | { tipo: "copia"; de: string }
  | { tipo: "texto"; conteudo: string };
/** Um tom com envelope: trechos [ini, fim] em s, rampa em s. */
export type Tom = { hz: number; harm?: number; ganho: number; trechos: { ini: number; fim: number; rampa?: number }[] };

export type Paleta = { nome: string; fundo: string; tinta: string; acento: string; acento2: string; neutro: string; superficie: string; placa: string };
export type Tarefa = {
  /** id da composição (o bloco motor-video) */
  id: string;
  tipo: string; formato: string; resolucao: string | null; dim: { largura: number; altura: number }; qps: number; quadros: number; segundos: number;
  escrita: string; idioma: string; rtl: boolean; fonte: string; densidade: string; legenda: string; plataforma: string;
  paleta: Paleta; marca: string[]; fundo: string; midia: string; rosto: string; trilha: string; bpm: number;
  /** A grade de corte (s) e a fase das batidas. */
  batida: number; grade: number; fase: number;
  falas: Palavra[]; frases: string[]; velocidadeVoz: number;
  cortes: number[];
  /** Palavras de ênfase (índices nas falas) */
  enfase: number[];
  dados: string[];
  /** Textos de tela da marca e do briefing (além da fala): o vocabulário que a tela pode usar. */
  textos: string[];
  laco: boolean; transparente: boolean;
  duracaoMin: number; duracaoMax: number;
  /** O que o pedido permite mudar (para o diff antes/depois): seletores de id. */
  permitido: string[];
  /** Caso que o motor de hoje recusa (largura < 800). */
  bloqueio: string | null;
  /** Entrega de arquivo pedida (MP4 entregue pelo agente) */
  entrega: string | null;
  acessorios: string[];
};
export type Cena = {
  tarefa: Tarefa;
  decl: { id: string; largura: number; altura: number; qps: number; quadros: number };
  fundoPagina: string;
  head: string[]; css: string[]; els: El[]; scripts: string[];
  ativos: Record<string, Receita>;
  /** A biblioteca de mídia rotulada (midia/rotulos.json): o que cada arquivo é. */
  rotulos: Record<string, Record<string, unknown>>;
  /** Processamento do MP4 entregue (args do ffmpeg entre a entrada e a saída), quando a tarefa pede o arquivo. */
  entrega?: string[];
  /** Comentário (sem nada da mutação). */
  comentario: string;
};

// ——— Eixos em números ———

const LINHAS: Record<string, number> = { "720p": 720, "1080p": 1080, "4K": 2160 };
const par = (x: number) => 2 * Math.round(x / 2);
/** Tamanho: com a resolução, ela é o lado menor; sem ela, o menor tamanho de prova que o motor aceita (largura ≥ 800). */
export function dimensoes(formato: string, resolucao: string | null): { largura: number; altura: number } {
  const [a, b] = formato.split(":").map(Number);
  if (resolucao) {
    const l = LINHAS[resolucao];
    return a >= b ? { largura: par((l * a) / b), altura: l } : { largura: l, altura: par((l * b) / a) };
  }
  const PROVA: Record<string, { largura: number; altura: number }> = {
    "9:16": { largura: 810, altura: 1440 }, "16:9": { largura: 960, altura: 540 }, "1:1": { largura: 800, altura: 800 }, "4:5": { largura: 800, altura: 1000 },
  };
  return PROVA[formato];
}
export const segundosDe = (duracao: string) => duracao === "3 min" ? 180 : Number(duracao.replace(" s", ""));
const VERTICAIS = new Set(["reel", "anuncio", "lyric", "evento"]);
export const formatoPadrao = (tipo: string, plataforma?: string) => plataforma ? (plataforma === "YouTube" ? "16:9" : "9:16") : VERTICAIS.has(tipo) ? "9:16" : "16:9";
const COM_APRESENTADOR = new Set(["apresentador", "podcast", "reel", "anuncio", "tutorial", "explicativo", "documental", "evento"]);

export const PALETAS: Record<string, Paleta> = {
  "clara": { nome: "clara", fundo: "#F7F4EC", tinta: "#1B1F2A", acento: "#E4572E", acento2: "#2E86AB", neutro: "#6B6F7A", superficie: "#FFFFFF", placa: "#1B1F2A" },
  "escura": { nome: "escura", fundo: "#1B1F2A", tinta: "#F7F4EC", acento: "#E4572E", acento2: "#2E86AB", neutro: "#6B6F7A", superficie: "#FFFFFF", placa: "#1B1F2A" },
  "saturada": { nome: "saturada", fundo: "#2E86AB", tinta: "#FFFFFF", acento: "#E4572E", acento2: "#1B1F2A", neutro: "#F7F4EC", superficie: "#FFFFFF", placa: "#1B1F2A" },
  "marca com acento de baixo contraste": { nome: "marca com acento de baixo contraste", fundo: "#F7F4EC", tinta: "#1B1F2A", acento: "#E4572E", acento2: "#2E86AB", neutro: "#6B6F7A", superficie: "#FFFFFF", placa: "#1B1F2A" },
};
/** As cores do manual da marca fictícia (identidade/fixtures/marca-ficticia/DESIGN.md). */
export const MARCA = ["#F7F4EC", "#1B1F2A", "#E4572E", "#2E86AB", "#6B6F7A", "#FFFFFF"];

// ——— Textos inventados por escrita ———

type Lingua = { idioma: string; rtl?: boolean; juntar?: boolean; frases: string[]; titulo: string; chamada: string; rotulos: string[]; familia?: string };
/** As frases têm as palavras separadas por espaço (o japonês, por «|», sem espaço na tela). Cada frase tem um substantivo
 * rotulado (rotulos[i]) para a mídia de cobertura da cena. */
export const LINGUAS: Record<string, Lingua> = {
  "português": { idioma: "pt-BR", titulo: "Torra da semana", chamada: "Peça já",
    frases: ["A torra nova chega na sexta.", "Os grãos vêm do sul de Minas.", "A moagem é feita na hora do pedido.", "A entrega sai no mesmo dia.",
      "Peça até as dez da manhã.", "O pacote é de papel reciclado.", "Cada lote tem um número próprio.", "O cheiro chega antes da caixa."],
    rotulos: ["torra", "grãos", "moagem", "entrega", "manhã", "pacote", "lote", "cheiro"] },
  "inglês": { idioma: "en", titulo: "This week's roast", chamada: "Order now",
    frases: ["The new roast arrives on Friday.", "The beans come from the south.", "We grind every order fresh.", "Delivery leaves the same day.",
      "Order before ten in the morning.", "The bag is made of recycled paper.", "Every batch has its own number.", "The smell arrives before the box."],
    rotulos: ["roast", "beans", "grind", "delivery", "morning", "bag", "batch", "smell"] },
  "alemão (palavras longas)": { idioma: "de", titulo: "Röstung der Woche", chamada: "Jetzt bestellen",
    frases: ["Die neue Röstung kommt am Freitag.", "Die Kaffeebohnen kommen aus dem Süden.", "Wir mahlen jede Bestellung frisch.", "Die Lieferung geht am selben Tag raus.",
      "Bestellen Sie vor zehn Uhr morgens.", "Die Verpackungstüte ist aus Recyclingpapier.", "Jede Röstcharge hat eine eigene Nummer.", "Der Duft kommt vor dem Paket an."],
    rotulos: ["Röstung", "Kaffeebohnen", "Bestellung", "Lieferung", "morgens", "Verpackungstüte", "Röstcharge", "Duft"] },
  "árabe (direita para a esquerda)": { idioma: "ar", rtl: true, familia: "Noto Sans Arabic", titulo: "تحميص الأسبوع", chamada: "اطلب الآن",
    frases: ["التحميص الجديد يصل يوم الجمعة.", "الحبوب تأتي من الجنوب.", "نطحن كل طلب في وقته.", "التوصيل يخرج في نفس اليوم.",
      "اطلب قبل العاشرة صباحا.", "الكيس مصنوع من ورق معاد.", "لكل دفعة رقم خاص.", "الرائحة تصل قبل الصندوق."],
    rotulos: ["التحميص", "الحبوب", "نطحن", "التوصيل", "صباحا", "الكيس", "دفعة", "الرائحة"] },
  "japonês (sem espaços)": { idioma: "ja", juntar: true, familia: "Droid Sans Fallback", titulo: "今週の焙煎", chamada: "今すぐ注文",
    frases: ["新しい|焙煎は|金曜日に|届きます。", "豆は|南から|来ます。", "注文ごとに|挽きます。", "配送は|当日に|出ます。",
      "朝|十時までに|ご注文ください。", "袋は|再生紙です。", "ロットごとに|番号が|あります。", "香りが|箱より|先に|届きます。"],
    rotulos: ["焙煎は", "豆は", "注文ごとに", "配送は", "朝", "袋は", "番号が", "香りが"] },
};
const palavrasDe = (l: Lingua, f: string) => f.split(l.juntar ? "|" : /\s+/).filter(Boolean);
export const juntar = (l: Lingua, ps: string[]) => ps.join(l.juntar ? "" : " ");
export const lingua = (escrita: string) => LINGUAS[escrita] ?? LINGUAS["português"];

const RITMO: Record<string, number> = { "lenta (cerca de 2 palavras/s)": 0.42, "média (cerca de 3)": 0.28, "rápida (4 ou mais)": 0.2 };
const DENSIDADE: Record<string, number> = { "1 a 3 palavras": 2, "4 a 8": 6, "9 a 15": 12, "16 ou mais": 18 };

// ——— A tarefa (o briefing) ———

export type CasoMin = { id: string; classe: string; eixos: Record<string, string>; tipo: string; grau: string };
const h32 = (s: string) => parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16);

export function tarefaDe(caso: CasoMin, acessorios: string[] = []): Tarefa {
  const e = caso.eixos, tipo = caso.tipo;
  const plataforma = e.plataforma ?? (VERTICAIS.has(tipo) ? "Reels" : "YouTube");
  const formato = e.formato ?? formatoPadrao(tipo, e.plataforma);
  const resolucao = e.resolucao ?? null;
  const dim = dimensoes(formato, resolucao);
  const qps = Number(e.fps ?? 30);
  const DUR: Record<string, [number, number]> = { Reels: [3, 90], TikTok: [3, 180], Shorts: [3, 180], YouTube: [3, 3600] };
  // O vídeo longo para o destino curto já vem cortado ao máximo do destino (K-EDI-11 é a errada).
  const segundos = Math.min(e.duracao ? segundosDe(e.duracao) : 10, DUR[plataforma][1]);
  const escrita = e.escrita ?? "português";
  const l = lingua(escrita);
  const paleta = PALETAS[e.paleta ?? "clara"];
  const bpm = Number(e.bpm ?? 100);
  const batida = 60 / bpm, fase = 0.2;
  const nCenas = Number(e.cenas ?? 3);
  // A grade de corte: a batida, ou a metade, o quarto… até caber o número de cenas.
  let grade = batida;
  while (segundos / grade < nCenas * 1.6 && grade > 0.1) grade /= 2;
  const cortes: number[] = [];
  for (let i = 1; i < nCenas; i++) {
    const ideal = (segundos * i) / nCenas;
    let c = fase + Math.round((ideal - fase) / grade) * grade;
    if (cortes.length && c <= cortes.at(-1)! + grade * 0.5) c = cortes.at(-1)! + grade;
    cortes.push(+c.toFixed(4));
  }
  const rosto = e.rosto ?? (COM_APRESENTADOR.has(tipo) ? "centro" : "sem rosto");
  // A fala: as frases em laço, palavra a palavra, sem atravessar um corte (pausa de 0,1 s em volta de cada um), até
  // 0,9 s antes do fim (o respiro do fim).
  const porPalavra = RITMO[e.fala ?? "média (cerca de 3)"];
  const falas: Palavra[] = [];
  const frases: string[] = [];
  let t = 0.35, fi = 0;
  const fimFala = segundos - 0.9;
  // Folga entre a palavra e o corte: 0,1 s, menos com cortes densos.
  const mg = Math.min(0.1, grade * 0.2);
  while (t < fimFala - 0.3) {
    const f = l.frases[fi % l.frases.length];
    const ps = palavrasDe(l, f);
    const usadas: string[] = [];
    for (const p of ps) {
      let d = porPalavra * Math.max(0.7, Math.min(1.5, [...p].length / (l.juntar ? 3 : 6)));
      // A palavra não atravessa corte: cabe no vão até o próximo (encurtada até 0,18 s, com cortes densos) ou vai
      // para depois dele.
      for (;;) {
        const c = cortes.find((x) => x + mg > t);
        if (c === undefined || t + d <= c - mg) break;
        if (c - mg - t >= 0.12) { d = c - mg - t; break; }
        t = c + mg;
      }
      if (t + d > fimFala) break;
      falas.push({ t: p, ini: +t.toFixed(3), fim: +(t + d).toFixed(3), bloco: fi });
      usadas.push(p);
      t += d + 0.06;
    }
    if (usadas.length) frases.push(juntar(l, usadas));
    if (usadas.length < ps.length) break;
    t += 0.45;
    fi++;
  }
  // Ênfase: uma palavra longa num take do apresentador (cena par, fora do cartão final), de preferência na 2.ª frase.
  const cenaDe = (s: number) => cortes.filter((c) => c <= s).length;
  const nC = cortes.length + 1;
  const boa = (p: Palavra) => { const k = cenaDe(p.ini); return k % 2 === 0 && (nC < 3 || k < nC - 1) && [...p.t].length >= 4; };
  let alvoEnfase = falas.findIndex((p) => p.bloco >= 1 && boa(p));
  if (alvoEnfase < 0) alvoEnfase = falas.findIndex(boa);
  const enfase = alvoEnfase >= 0 ? [alvoEnfase] : falas.length ? [0] : [];
  const id = `Caso${(h32(caso.id) >>> 0).toString(16).padStart(8, "0")}`;
  return {
    id, tipo, formato, resolucao, dim, qps, quadros: Math.round(segundos * qps), segundos, escrita, idioma: l.idioma, rtl: !!l.rtl,
    fonte: e.fonte ?? "fonte do sistema", densidade: e.densidade ?? "4 a 8", legenda: e.legenda ?? "linha única", plataforma,
    paleta, marca: MARCA, fundo: e.fundo ?? "liso", midia: e.midia ?? "imagem", rosto, trilha: e.trilha ?? "trilha baixa", bpm,
    batida, grade: +grade.toFixed(5), fase, falas, frases, velocidadeVoz: 1, cortes, enfase,
    dados: ["38 %", "62 %", "1.200"], textos: ["Zunzum Torrefação", "Zunzum", "Novo", "Sim", "Não", "dos pedidos"], laco: false, transparente: false, duracaoMin: DUR[plataforma][0], duracaoMax: DUR[plataforma][1],
    permitido: [], entrega: null, acessorios,
    bloqueio: dim.largura < 800 ? `largura ${dim.largura} < 800, o mínimo do motor (cli/regras.ts, faixa da marca)` : null,
  };
}

// ——— A cena base ———

const q = (t: Tarefa, s: number) => Math.round(s * t.qps);
const px = (v: number) => `${Math.round(v)}px`;
const EASE_ENTRADA = "cubic-bezier(0.16, 1, 0.3, 1)";

/** Tamanhos de letra por papel, em fração do lado menor (o vertical lê-se no celular: maiores). */
export function tamanhos(t: Tarefa) {
  const S = Math.min(t.dim.largura, t.dim.altura), v = t.dim.altura > t.dim.largura;
  const k = v ? { titulo: 0.08, corpo: 0.045, legenda: 0.05, faixa: 0.038, rotulo: 0.034, chamada: 0.05 }
    : { titulo: 0.09, corpo: 0.05, legenda: 0.05, faixa: 0.042, rotulo: 0.038, chamada: 0.06 };
  return Object.fromEntries(Object.entries(k).map(([p, f]) => [p, Math.round(S * f)])) as Record<keyof typeof k, number>;
}
/** Onde fica cada coisa (y em px): abaixo da margem do rosto (≤ 0,375 da altura) e acima da zona da interface. */
export function leiaute(t: Tarefa) {
  const { largura: L, altura: A } = t.dim, v = A > L;
  let m = Math.round(Math.min(L, A) * (v ? 0.09 : 0.07));
  let faixa = Math.round(A * (v ? 0.53 : 0.71)), legenda = Math.round(A * (v ? 0.585 : 0.84));
  // Plataforma vertical (Reels, TikTok, Shorts) com quadro que não é 9:16: o vídeo fica no meio da tela do celular e a
  // interface cobre a base da tela (G19 na tela de 1080 × 1920): legenda e faixa sobem até caber e as laterais folgam.
  if (t.plataforma !== "YouTube" && !v) {
    const esc = 1080 / L, y0 = (1920 - A * esc) / 2, fundo = (0.65 * 1920 - y0) / esc;
    const tam = tamanhos(t);
    legenda = Math.min(legenda, Math.round(fundo - tam.legenda * 1.6 - A * 0.01));
    faixa = Math.min(faixa, Math.round(legenda - tam.faixa * 2.2));
    // 6 % da tela mais os 3 % que o corpo anda na entrada.
    m = Math.max(m, Math.ceil(0.095 * L));
  }
  return { m, titulo: Math.round(A * 0.41), corpo: Math.round(A * (v ? 0.47 : 0.53)), faixa, legenda,
    midia: { x: m, y: Math.round(A * (v ? 0.14 : 0.1)), w: L - 2 * m, h: Math.round(A * (v ? 0.24 : 0.27)) } };
}

/** O apresentador: o retrato em escala da altura, com o rosto no lugar do eixo. Caixa do rosto em px do vídeo. */
export function apresentadorDe(t: Tarefa) {
  const { largura: L, altura: A } = t.dim;
  const escala = A / RETRATO.altura;
  const [rx, ry, rw, rh] = RETRATO.rosto;
  const desl = { "centro": 0, "terço superior": 0, "esquerda": -0.22 * L, "direita": 0.22 * L, "sem rosto": 0 }[t.rosto] ?? 0;
  const y = t.rosto === "terço superior" ? -Math.round(A * 0.06) : 0;
  const x = Math.round(L / 2 - (rx + rw / 2) * escala + desl);
  const rosto: Caixa = [rx * escala + x, ry * escala + y, rw * escala, rh * escala];
  return { escala, x, y, rosto };
}

/** As fontes embutidas (as do #93, cli/fixtures/fonte-padrao: a DejaVu recortada para o latino), copiadas para a pasta da
 * página: o quadro não depende das fontes da máquina (o fontconfig dava Noto numa e DejaVu noutra). */
const FONTE_PADRAO = new URL("../cli/fixtures/fonte-padrao/", import.meta.url).pathname;
const SANS = `"Teste Sans", sans-serif`;
const EMBUTIDAS = {
  head: [`@font-face { font-family: "Teste Sans"; src: url("fontes/teste-sans.woff2") format("woff2"); font-weight: 400; }`,
    `@font-face { font-family: "Teste Sans"; src: url("fontes/teste-sans-negrito.woff2") format("woff2"); font-weight: 700; }`,
    `@font-face { font-family: "Teste Serif"; src: url("fontes/teste-serif.woff2") format("woff2"); font-weight: 400; }`,
    `@font-face { font-family: "Teste Serif"; src: url("fontes/teste-serif-negrito.woff2") format("woff2"); font-weight: 700; }`],
  ativos: {
    "fontes/teste-sans.woff2": { tipo: "copia", de: join(FONTE_PADRAO, "DejaVuSans.woff2") },
    "fontes/teste-sans-negrito.woff2": { tipo: "copia", de: join(FONTE_PADRAO, "DejaVuSans-Bold.woff2") },
    "fontes/teste-serif.woff2": { tipo: "copia", de: join(FONTE_PADRAO, "DejaVuSerif.woff2") },
    "fontes/teste-serif-negrito.woff2": { tipo: "copia", de: join(FONTE_PADRAO, "DejaVuSerif-Bold.woff2") },
  } as Record<string, Receita>,
};

const fonteDe = (t: Tarefa) => {
  const l = lingua(t.escrita);
  const f = { titulo: `"Teste Serif", serif`, corpo: SANS, head: [...EMBUTIDAS.head], ativos: { ...EMBUTIDAS.ativos } };
  // Árabe e japonês: a família da escrita e a reserva continuam da máquina (sem recorte embutido para elas).
  if (l.familia) return { ...f, titulo: `"${l.familia}", sans-serif`, corpo: `"${l.familia}", sans-serif` };
  if (t.fonte === "arquivo local" || t.fonte === "Google Fonts pela rede") {
    f.titulo = `"Zunzum Serif", serif`;
    f.head.push(`@font-face { font-family: "Zunzum Serif"; src: url("fontes/zunzum-serif.woff2") format("woff2"); font-weight: 700; }`);
    f.ativos["fontes/zunzum-serif.woff2"] = { tipo: "copia", de: join(FONTE_PADRAO, "DejaVuSerif-Bold.woff2") };
  }
  if (t.fonte === "fonte variável") {
    f.titulo = f.corpo = `"Zunzum Var", sans-serif`;
    f.head.push(`@font-face { font-family: "Zunzum Var"; src: url("fontes/zunzum-var.ttf"); font-weight: 100 900; }`);
    f.ativos["fontes/zunzum-var.ttf"] = { tipo: "copia", de: "/usr/share/fonts/truetype/ubuntu/Ubuntu[wdth,wght].ttf" };
  }
  return f;
};

/** Trechos de fala (palavras juntas com vão < 0,4 s), para a trilha abaixar sob a voz. */
export function trechosDeFala(falas: Palavra[], vao = 0.4) {
  const r: { ini: number; fim: number }[] = [];
  for (const p of falas) {
    if (r.length && p.ini - r.at(-1)!.fim < vao) r.at(-1)!.fim = p.fim; else r.push({ ini: p.ini, fim: p.fim });
  }
  return r;
}

/** Pedaços de legenda: palavras juntas até ~0,8 s na tela, sem passar do limite de letras e sem atravessar corte. */
export function pedacosDeLegenda(t: Tarefa) {
  const l = lingua(t.escrita), v = t.dim.altura > t.dim.largura;
  const fs = tamanhos(t).legenda;
  const max = Math.floor(((t.dim.largura - 2 * leiaute(t).m) / (fs * (l.juntar ? 1.05 : 0.62))) * 0.9);
  const r: { texto: string; ini: number; fim: number; palavras: number[] }[] = [];
  let atual: number[] = [];
  const cortaEntre = (a: number, b: number) => t.cortes.some((c) => a < c && b > c);
  const fechar = () => { if (atual.length) r.push({ texto: juntar(l, atual.map((i) => t.falas[i].t)), ini: t.falas[atual[0]].ini, fim: t.falas[atual.at(-1)!].fim, palavras: atual }); atual = []; };
  t.falas.forEach((p, i) => {
    if (t.legenda === "palavra a palavra") { atual = [i]; fechar(); return; }
    const lim = t.legenda === "duas linhas" ? max * 2 : max;
    if (atual.length && (juntar(l, [...atual.map((j) => t.falas[j].t), p.t]).length > lim || cortaEntre(t.falas[atual.at(-1)!].fim, p.ini)
      || t.falas[atual.at(-1)!].bloco !== p.bloco || (p.fim - t.falas[atual[0]].ini > 1.6 && !v))) fechar();
    atual.push(i);
    if (/[.!?,。]$/.test(p.t) && t.falas[atual.at(-1)!].fim - t.falas[atual[0]].ini >= 0.8) fechar();
  });
  fechar();
  // Cada pedaço fica até o próximo começar (no máximo 0,6 s depois da última palavra): leitura sem buraco.
  return r.map((p, i) => ({ ...p, ate: Math.min(r[i + 1]?.ini ?? Infinity, p.fim + 0.6, t.segundos) }));
}

/** Liga a palavra curta (artigo, preposição) à seguinte com espaço que não quebra, e a última palavra à penúltima: nenhuma
 * linha termina em artigo e nenhuma palavra fica sozinha na última linha (K-DES-04). */
export function semQuebraRuim(texto: string): string {
  const ps = texto.split(" ");
  if (ps.length < 2) return texto;
  let r = "";
  ps.forEach((p, i) => { r += p; if (i < ps.length - 1) r += CURTAS.has(p.toLowerCase()) || i === ps.length - 2 ? "\u00a0" : " "; });
  return r;
}
/** Quebra um texto de duas linhas no meio, sem deixar artigo ou preposição no fim da 1.ª linha. */
const CURTAS = new Set(["a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "na", "no", "um", "uma", "the", "of", "a", "an", "in", "on", "to", "die", "der", "das", "den", "dem", "am", "im", "vor", "aus", "eine", "jede"]);
function duasLinhas(texto: string): string {
  const ps = texto.split(" ");
  if (ps.length < 4) return texto;
  let k = Math.ceil(ps.length / 2);
  while (k > 1 && CURTAS.has(ps[k - 1].toLowerCase())) k--;
  return `${ps.slice(0, k).join(" ")}<br>${ps.slice(k).join(" ")}`;
}

export function novoEl(id: string, tag: string, o: Partial<El> = {}): El {
  return { id, tag, attrs: {}, css: {}, anims: [], ...o };
}

/** A cena base de uma tarefa. `acessorios`: peças a mais que algumas classes precisam (marcadores, número, efeito sonoro…). */
export function cenaBase(t: Tarefa): Cena {
  const { largura: L, altura: A } = t.dim;
  const l = lingua(t.escrita), tam = tamanhos(t), lay = leiaute(t), pal = t.paleta;
  const fontes = fonteDe(t);
  const els: El[] = [];
  const ativos: Record<string, Receita> = { ...fontes.ativos };
  const rotulos: Cena["rotulos"] = {};
  const N = t.cortes.length + 1;
  const limites = [0, ...t.cortes.map((c) => q(t, c)), t.quadros];
  const temAp = t.rosto !== "sem rosto";
  const ap = apresentadorDe(t);
  const fimFala = t.falas.length ? t.falas.at(-1)!.fim : 0;
  const dir = t.rtl ? { direction: "rtl", "text-align": "right" } : {};
  const ent = (s: number) => Math.max(1, Math.round(0.4 * t.qps));
  const fala0 = (de: number, ate: number) => {
    const p = t.falas.find((f) => q(t, f.ini) >= de && q(t, f.ini) < ate);
    return p ? q(t, p.ini) : de + 2;
  };
  // Último quadro segurado: a cena final (com 3 cenas ou mais) é o cartão da marca.
  const comCartao = N >= 3;
  if (temAp) {
    // O take em 1,2× a resolução do quadro: o punch-in de 1,15 dos takes alternados não amplia o raster (K-COD-11).
    const K = 1.2;
    ativos["midia/apresentador.mp4"] = { tipo: "apresentador", largura: par(L * K), altura: par(A * K), segundos: t.segundos, escala: ap.escala * K, x: Math.round(ap.x * K), y: Math.round(ap.y * K) };
    rotulos["midia/apresentador.mp4"] = { tipo: "apresentador", rosto: ap.rosto.map((v) => +(v * K).toFixed(2)), origem: [par(L * K), par(A * K)] };
  }
  // Fundo da página.
  const fundoPagina = pal.fundo;
  if (t.fundo === "gradiente") {
    els.push(novoEl("fundo", "div", { css: { position: "absolute", inset: "0", "background-image": `linear-gradient(180deg, ${pal.acento2} 0%, ${pal.placa} 100%)` } }));
  } else if (t.fundo === "foto") {
    ativos["midia/fundo.png"] = { tipo: "imagem", largura: L, altura: A, c0: "#3a5a8c", c1: "#d9a441", formas: true };
    rotulos["midia/fundo.png"] = { tipo: "foto", rotulo: "cafezal" };
    els.push(novoEl("fundo", "img", { attrs: { src: "midia/fundo.png", alt: "" }, css: { position: "absolute", inset: "0", width: "100%", height: "100%", "object-fit": "cover" } }));
  } else if (t.fundo === "vídeo em movimento") {
    ativos["midia/fundo.mp4"] = { tipo: "clipe", largura: L, altura: A, segundos: t.segundos, qps: t.qps, c0: "#22305e", c1: "#4a6fa8", bloco: "#E4572E" };
    rotulos["midia/fundo.mp4"] = { tipo: "clipe", rotulo: "movimento" };
    els.push(novoEl("fundo", "video", { attrs: { src: "midia/fundo.mp4", muted: "", "data-inicio": "0" }, css: { position: "absolute", inset: "0", width: "100%", height: "100%", "object-fit": "cover" } }));
  }
  // Texto sobre fundo com detalhe leva placa (K-DES-09): a cor do texto e a placa dependem do fundo.
  const sobreDetalhe = t.fundo !== "liso";
  const corTexto = sobreDetalhe ? "#FFFFFF" : pal.tinta;
  const placa = (cor = pal.placa) => sobreDetalhe ? { background: cor, padding: "0.15em 0.4em", "border-radius": "8px" } : {};

  for (let i = 0; i < N; i++) {
    const de = limites[i], ate = limites[i + 1];
    const cid = `cena-${i}`;
    const cartao = comCartao && i === N - 1;
    const tipoCena = cartao ? "cartao" : temAp && i % 2 === 0 ? "A" : "B";
    els.push(novoEl(cid, "section", { classes: ["cena"], de, ate: i === N - 1 ? undefined : ate, css: { position: "absolute", inset: "0" } }));
    const f0 = fala0(de, ate);
    if (tipoCena === "A") {
      // O take do apresentador: escala alternada entre takes (1 e 1,15 no rosto), para o corte não ser jump cut.
      const s = (i / 2) % 2 === 1 ? 1.15 : 1;
      const [x, y, w, h] = ap.rosto;
      els.push(novoEl(`take-${i}`, "video", { pai: cid, papel: "apresentador", attrs: { src: "midia/apresentador.mp4", muted: "", "data-inicio": String(de), "data-recorte": String(de), "data-quadros": String(ate - de) },
        css: { position: "absolute", left: "0", top: "0", width: "100%", height: "100%", "object-fit": "cover", "transform-origin": `${px(x + w / 2)} ${px(y + h / 2)}`, ...(s !== 1 ? { transform: `scale(${s})` } : {}) } }));
    } else if (tipoCena === "B") {
      // A cobertura: a mídia do eixo, rotulada com a palavra da frase falada na cena.
      // As palavras faladas na cena (com 0,3 s de folga): a cena curta sem fala própria usa a vizinha.
      const falada = t.falas.filter((p) => p.ini >= de / t.qps - 0.3 && p.ini <= ate / t.qps + 0.3).map((p) => p.t.replace(/[.,!?。]$/, ""));
      const rot = l.rotulos.find((r) => falada.includes(r)) ?? [...falada].sort((a, b) => [...b].length - [...a].length)[0] ?? l.rotulos[i % l.rotulos.length];
      const nome = `cobertura-${i}`;
      const { x, y, w, h } = lay.midia;
      const caixa = { position: "absolute", left: px(x), top: px(y), width: px(w), height: px(h), "object-fit": "cover", "border-radius": "6px" };
      let src: string;
      if (t.midia === "vídeo") {
        src = `midia/${nome}.mp4`;
        ativos[src] = { tipo: "clipe", largura: par(w * 1.1), altura: par(h * 1.1), segundos: Math.max(1, (ate - de) / t.qps + 0.5), qps: t.qps, c0: "#22305e", c1: "#4a6fa8", bloco: "#E4572E" };
        els.push(novoEl(nome, "video", { pai: cid, papel: "cobertura", attrs: { src, muted: "", "data-inicio": String(de) }, css: caixa }));
      } else if (t.midia === "canvas ou 3D") {
        src = `#${nome}`;
        els.push(novoEl(nome, "canvas", { pai: cid, papel: "cobertura", attrs: { width: String(par(w * 1.1)), height: String(par(h * 1.1)) }, css: caixa }));
      } else {
        src = `midia/${nome}.${t.midia === "GIF ou Lottie" ? "gif" : "png"}`;
        ativos[src] = t.midia === "GIF ou Lottie" ? { tipo: "gif", largura: par(w * 1.1), altura: par(h * 1.1), segundos: 2 }
          : { tipo: "imagem", largura: par(w * 1.1), altura: par(h * 1.1), c0: ["#3a5a8c", "#8c5a3a", "#3a8c5a"][i % 3], c1: "#d9a441", formas: true };
        els.push(novoEl(nome, "img", { pai: cid, papel: "cobertura", attrs: { src, alt: rot }, css: caixa }));
      }
      rotulos[src] = { tipo: "cobertura", rotulo: rot };
      // Movimento lento de câmera (Ken Burns) com entrada e saída suaves: parado nos cortes.
      els.at(-1)!.anims.push({ chaves: [{ transform: "scale(1)" }, { transform: "scale(1.04)" }], ini: de, dur: Math.max(2, ate - de), easing: "ease-in-out" });
      // Rótulo da cena (cabeçalho curto) e o corpo, escalonados.
      const rotulo = rot.charAt(0).toUpperCase() + rot.slice(1);
      // Na primeira cena, o título do vídeo fica no lugar do rótulo e o corpo desce o quanto o título ocupa.
      const linhasTitulo = Math.ceil(([...l.titulo].length * 0.72 * tam.titulo) / (L - 2 * lay.m));
      const yCorpo = i === 0 ? lay.titulo + linhasTitulo * tam.titulo * 1.1 + tam.corpo * 0.7 : lay.titulo + tam.rotulo * 1.8;
      if (i !== 0) els.push(novoEl(`rotulo-${i}`, "div", { pai: cid, papel: "rotulo", texto: rotulo,
        css: { position: "absolute", left: px(lay.m), top: px(lay.titulo), color: sobreDetalhe ? "#FFFFFF" : pal.acento2, font: `700 ${tam.rotulo}px ${fontes.corpo}`, ...placa(), ...dir, ...(t.rtl ? { right: px(lay.m), left: "auto" } : {}) },
        anims: [{ chaves: [{ opacity: 0 }, { opacity: 1 }], ini: f0, dur: ent(0.4), easing: "ease-out" }] }));
      const n = DENSIDADE[t.densidade];
      const fonteCorpo = l.frases.flatMap((f) => palavrasDe(l, f.replace(/[.。]$/, "")));
      const palavras = fonteCorpo.slice((i * 3) % 8, ((i * 3) % 8) + n);
      while (palavras.length < n) palavras.push(...fonteCorpo.slice(0, n - palavras.length));
      // Até 12 palavras por tela; na 1.ª cena, sem espaço entre o título e a legenda (formato baixo), o corpo sai.
      const linhasCorpo = Math.ceil((Math.min(n, 12) * 6 * 0.55 * tam.corpo) / (L - 2 * lay.m));
      const cabe = i !== 0 || yCorpo + linhasCorpo * tam.corpo * 1.3 <= lay.legenda - tam.legenda * 0.6;
      const pedacos = !cabe ? [] : n > 12 ? [palavras.slice(0, Math.ceil(n / 2)), palavras.slice(Math.ceil(n / 2))] : [palavras];
      pedacos.forEach((ps, k) => {
        const meio = de + Math.round(((ate - de) * k) / pedacos.length);
        const ini = k === 0 ? f0 + Math.max(2, Math.round(0.25 * t.qps)) : meio;
        const fim = k < pedacos.length - 1 ? de + Math.round(((ate - de) * (k + 1)) / pedacos.length) : undefined;
        const saida: Anim[] = fim !== undefined ? [{ chaves: [{ opacity: 1 }, { opacity: 0 }], ini: fim - Math.round(0.25 * t.qps), dur: Math.round(0.25 * t.qps), easing: "ease-in", fill: "forwards" }] : [];
        els.push(novoEl(`corpo-${i}-${k}`, "div", { pai: cid, papel: "corpo", html: semQuebraRuim(juntar(l, ps)), de: pedacos.length > 1 ? meio : undefined, ate: fim,
          css: { position: "absolute", left: px(lay.m), top: px(yCorpo), width: px(L - 2 * lay.m), color: corTexto, font: `400 ${tam.corpo}px/1.3 ${fontes.corpo}`, ...dir,
            ...(sobreDetalhe ? { "text-shadow": "0 2px 6px rgba(0, 0, 0, 0.8)" } : {}) },
          anims: [{ chaves: [{ opacity: 0, transform: `translateX(${t.rtl ? "" : "-"}${Math.round(L * 0.03)}px)` }, { opacity: 1, transform: "none" }], ini: Math.min(ini, (fim ?? ate) - 2), dur: ent(0.4), easing: EASE_ENTRADA }, ...saida] }));
      });
    } else {
      // Cartão final: logo grande e a chamada, segurados até o fim.
      ativos["midia/logo.svg"] = { tipo: "copia", de: join(RAIZ_MARCA, "marca", "logo.svg") };
      rotulos["midia/logo.svg"] = { tipo: "logo" };
      const lw = Math.round(L * 0.5);
      els.push(novoEl("logo-fim", "img", { pai: cid, papel: "logo", attrs: { src: "midia/logo.svg", alt: "Zunzum" },
        css: { position: "absolute", left: px(lay.m), top: px(A * 0.36), width: px(lw) },
        anims: [{ chaves: [{ opacity: 0, transform: "scale(0.92)" }, { opacity: 1, transform: "none" }], ini: de + 1, dur: ent(0.4), easing: EASE_ENTRADA }] }));
      els.push(novoEl("chamada", "div", { pai: cid, papel: "chamada", texto: l.chamada,
        css: { position: "absolute", left: px(lay.m), top: px(A * 0.36 + lw * 0.3 + tam.chamada), color: pal.acento, font: `700 ${tam.chamada}px ${fontes.corpo}`, ...placa(pal.placa), ...dir },
        anims: [{ chaves: [{ opacity: 0, transform: `translateY(${Math.round(A * 0.02)}px)` }, { opacity: 1, transform: "none" }], ini: de + Math.round(0.3 * t.qps), dur: ent(0.4), easing: EASE_ENTRADA }] }));
    }
    if (i === 0 && tipoCena !== "cartao") {
      // O título do vídeo, na primeira cena, com uma palavra em destaque (um destaque só no vídeo inteiro).
      const ps = l.juntar ? [l.titulo] : l.titulo.split(" ");
      const html = ps.length > 1 ? `${ps.slice(0, -1).join(" ")} <span class="destaque" style="color: ${pal.acento};">${ps.at(-1)}</span>` : l.titulo;
      // Com a cobertura, o título fica no lugar do rótulo e o rótulo desce.
      const y = lay.titulo;
      els.push(novoEl("titulo", "h1", { pai: cid, papel: "titulo", html,
        css: { position: "absolute", margin: "0", left: px(lay.m), top: px(Math.max(y, A * 0.3)), "max-width": px(L - 2 * lay.m), color: tipoCena === "A" || sobreDetalhe ? "#FFFFFF" : pal.tinta, font: `700 ${tam.titulo}px/1.1 ${fontes.titulo}`, "letter-spacing": "-0.02em",
          ...(tipoCena === "A" || sobreDetalhe ? { background: pal.placa, padding: "0.1em 0.35em", "border-radius": "8px" } : {}), ...dir },
        anims: [{ chaves: [{ opacity: 0, transform: `translateY(${Math.round(A * 0.03)}px)` }, { opacity: 1, transform: "none" }], ini: de + 2, dur: ent(0.4), easing: EASE_ENTRADA }] }));
    }
  }
  // Faixa (lower third) nos takes do apresentador, centrada logo acima da legenda (K-DES-02).
  if (temAp) {
    for (let i = 0; i < N; i++) {
      const cartao = comCartao && i === N - 1;
      if (cartao || i % 2 !== 0) continue;
      const de = Math.max(limites[i] + 1, fala0(limites[i], limites[i + 1])), ate = limites[i + 1];
      els.push(novoEl(`faixa-${i}`, "div", { papel: "faixa", texto: "Zunzum Torrefação", de, ate: i === N - 1 ? undefined : ate,
        css: { position: "absolute", left: "50%", translate: "-50% 0", top: px(lay.faixa), "white-space": "nowrap", color: "#FFFFFF", background: pal.acento2, font: `700 ${tam.faixa}px ${fontes.corpo}`, padding: "0.25em 0.7em", "border-radius": "8px" },
        anims: [{ chaves: [{ transform: "scaleX(0.85)" }, { transform: "scaleX(1)" }], ini: de, dur: ent(0.3), easing: EASE_ENTRADA }] }));
    }
  }
  // Legenda: pedaços sincronizados com a fala (data-papel="legenda"), centrada, numa linha (ou duas, quebradas no meio).
  pedacosDeLegenda(t).forEach((p, k) => {
    const de = q(t, p.ini), ate = Math.max(de + 1, q(t, p.ate));
    els.push(novoEl(`legenda-${k}`, "div", { papel: "legenda", classes: ["legenda"], html: t.legenda === "duas linhas" ? duasLinhas(p.texto) : p.texto, de, ate: ate >= t.quadros ? undefined : ate,
      css: { position: "absolute", left: "50%", translate: "-50% 0", top: px(lay.legenda), "text-align": "center", color: "#FFFFFF", font: `700 ${tam.legenda}px/1.2 ${fontes.corpo}`,
        background: "rgba(27, 31, 42, 0.82)", padding: "0.1em 0.45em", "border-radius": "8px", "white-space": "nowrap", ...(t.rtl ? { direction: "rtl" } : {}) } }));
  });
  // Áudio: a voz (tons) e a trilha, que abaixa sob a voz e entra e sai em fade.
  ativos["midia/voz.wav"] = { tipo: "wav", segundos: t.segundos, partes: [{ hz: 220, harm: 0.4, ganho: 0.5, trechos: t.falas.map((p) => ({ ini: p.ini, fim: p.fim, rampa: 0.015 })) }] };
  rotulos["midia/voz.wav"] = { tipo: "voz", hz: 220 };
  els.push(novoEl("voz", "audio", { papel: "voz", attrs: { src: "midia/voz.wav", "data-inicio": "0" } }));
  if (t.trilha !== "sem trilha") {
    const ganho = t.trilha === "trilha alta" ? 0.3 : 0.15;
    const batidas: { ini: number; fim: number; rampa: number }[] = [];
    for (let b = t.fase; b < t.segundos; b += t.batida) batidas.push({ ini: b, fim: b + 0.07, rampa: 0.005 });
    ativos["midia/trilha.wav"] = { tipo: "wav", segundos: t.segundos, partes: [
      { hz: 165, ganho, trechos: [{ ini: 0, fim: t.segundos, rampa: 0.005 }] },
      { hz: 990, ganho: ganho * 0.6, trechos: batidas }] };
    rotulos["midia/trilha.wav"] = { tipo: "trilha", hz: 165, batidaHz: 990, bpm: t.bpm, fase: t.fase };
    els.push(novoEl("trilha", "audio", { papel: "trilha", attrs: { src: "midia/trilha.wav", "data-inicio": "0", "data-volume": volumeDaTrilha(t) } }));
  }
  const c: Cena = {
    tarefa: t, decl: { id: t.id, largura: L, altura: A, qps: t.qps, quadros: t.quadros }, fundoPagina,
    head: fontes.head, css: [], els, scripts: [], ativos, rotulos,
    comentario: "Kodecz Bench, caso gerado (bench-gerador/). Conteúdo inventado: a marca fictícia Zunzum.",
  };
  for (const a of t.acessorios) ACESSORIOS[a]?.(c);
  if (t.midia === "canvas ou 3D") desenharCanvas(c);
  return c;
}
export const RAIZ_MARCA = new URL("../identidade/fixtures/marca-ficticia/", import.meta.url).pathname;

/** Pontos de volume da trilha (C02): fade de entrada e saída de 0,5 s e 40 % sob a fala, em rampas de 0,15 s. */
export function volumeDaTrilha(t: Tarefa, sob = 0.4, fade = 0.5): string {
  const pts: [number, number][] = [[0, 0], [q(t, fade), 1]];
  for (const tr of trechosDeFala(t.falas)) {
    const a = q(t, Math.max(fade + 0.05, tr.ini - 0.2)), b = q(t, Math.min(t.segundos - fade - 0.05, tr.fim + 0.2));
    if (b <= a) continue;
    pts.push([a, 1], [a + q(t, 0.15), sob], [Math.max(a + q(t, 0.15), b - q(t, 0.15)), sob], [b, 1]);
  }
  pts.push([t.quadros - q(t, fade), 1], [t.quadros, 0]);
  const ok: [number, number][] = [];
  for (const p of pts) if (!ok.length || p[0] > ok.at(-1)![0]) ok.push(p);
  return ok.map(([n, v]) => `${n}:${v}`).join(" ");
}

/** O canvas da cobertura: desenhado pelo gancho motor_quadro, só função de n (determinístico). */
function desenharCanvas(c: Cena) {
  c.scripts.push(`{
  const antes = window.motor_quadro;
  window.motor_quadro = (n, ms) => {
    if (antes) antes(n, ms);
    for (const cv of document.querySelectorAll('canvas[data-papel="cobertura"]')) {
      const g = cv.getContext('2d');
      g.fillStyle = '#22305e'; g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = '#d9a441'; g.beginPath(); g.arc(cv.width * (0.3 + 0.002 * (n % 100)), cv.height / 2, cv.height / 4, 0, 2 * Math.PI); g.fill();
    }
  };
}`);
}

// ——— Acessórios: peças a mais que algumas classes precisam, feitas do jeito certo ———

const naCena = (c: Cena, i: number) => c.els.find((e) => e.id === `cena-${i}`) ? `cena-${i}` : undefined;
const ultimaCenaB = (c: Cena) => {
  const bs = c.els.filter((e) => e.papel === "rotulo").map((e) => e.pai!);
  return bs[0] ?? "cena-0";
};
export const ACESSORIOS: Record<string, (c: Cena) => void> = {
  /** Dois itens de gráfico com cor E rótulo (K-ACE-05), no lugar do corpo da cena. */
  marcadores(c) {
    const t = c.tarefa, lay = leiaute(t), tam = tamanhos(t), pai = ultimaCenaB(c);
    const ini = (c.els.find((e) => e.id === pai)?.de ?? 0) + Math.round(0.3 * t.qps);
    c.els = c.els.filter((e) => !(e.pai === pai && e.papel === "corpo"));
    const y0 = lay.titulo + tam.rotulo * 1.8 + (c.els.some((e) => e.id === "numero") ? tam.corpo * 1.8 : 0);
    [["#2E86AB", "Sim", t.dados[0]], ["#E4572E", "Não", "62 %"]].forEach(([cor, rot, val], k) => {
      const y = y0 + k * tam.corpo * 1.8;
      c.els.push(novoEl(`marca-${k}`, "div", { pai, papel: "marcador", attrs: { "data-celula": `item-${k}` },
        css: { position: "absolute", left: px(lay.m), top: px(y), width: px(tam.corpo * 0.8), height: px(tam.corpo * 0.8), background: cor, "border-radius": k ? "0" : "50%" },
        anims: [{ chaves: [{ opacity: 0 }, { opacity: 1 }], ini: ini + k * 3, dur: 6, easing: "ease-out" }] }));
      c.els.push(novoEl(`marca-rotulo-${k}`, "div", { pai, papel: "rotulo-marcador", texto: `${rot}: ${val}`,
        css: { position: "absolute", left: px(lay.m + tam.corpo * 1.2), top: px(y - tam.corpo * 0.1), color: t.fundo !== "liso" ? "#FFFFFF" : t.paleta.tinta, font: `700 ${tam.corpo * 0.9}px ${SANS}` },
        anims: [{ chaves: [{ opacity: 0 }, { opacity: 1 }], ini: ini + k * 3, dur: 6, easing: "ease-out" }] }));
    });
  },
  /** Um número dos dados da tarefa, com rótulo (K-IA-11), no lugar do corpo da cena. */
  numero(c) {
    const t = c.tarefa, lay = leiaute(t), tam = tamanhos(t), pai = ultimaCenaB(c);
    const ini = (c.els.find((e) => e.id === pai)?.de ?? 0) + Math.round(0.5 * t.qps);
    c.els = c.els.filter((e) => !(e.pai === pai && e.papel === "corpo"));
    for (const m of c.els.filter((e) => e.pai === pai && /^marca/.test(e.id))) m.css.top = px(parseFloat(m.css.top) + tam.corpo * 1.8);
    c.els.push(novoEl("numero", "div", { pai, papel: "numero", texto: `${t.dados[0]} dos pedidos`,
      css: { position: "absolute", left: px(lay.m), top: px(lay.titulo + tam.rotulo * 1.8), color: t.fundo !== "liso" ? "#FFFFFF" : t.paleta.acento2, font: `700 ${tam.corpo}px ${SANS}` },
      anims: [{ chaves: [{ opacity: 0 }, { opacity: 1 }], ini, dur: 8, easing: "ease-out" }] }));
  },
  /** Um efeito sonoro (pop) na entrada de um selo, no mesmo quadro (K-ANI-10). */
  efeito(c) {
    const t = c.tarefa, lay = leiaute(t), tam = tamanhos(t);
    const s = t.cortes[0] !== undefined ? Math.max(0.6, t.cortes[0] - 0.4) : Math.min(1.2, t.segundos / 2);
    const n = q(t, s);
    c.els.push(novoEl("selo", "div", { papel: "selo", texto: "Novo",
      css: { position: "absolute", right: px(lay.m), top: px(lay.titulo - tam.titulo * 1.2), color: "#FFFFFF", background: t.paleta.acento, font: `700 ${tam.rotulo}px ${SANS}`, padding: "0.2em 0.6em", "border-radius": "999px" },
      anims: [{ chaves: [{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "scale(1)" }], ini: n, dur: 4, easing: "ease-out" }] }));
    c.ativos["midia/efeito.wav"] = { tipo: "wav", segundos: 0.3, partes: [{ hz: 1500, ganho: 0.4, trechos: [{ ini: 0, fim: 0.12, rampa: 0.003 }] }] };
    c.rotulos["midia/efeito.wav"] = { tipo: "efeito", hz: 1500, duracao: 0.12 };
    c.els.push(novoEl("efeito", "audio", { papel: "efeito", attrs: { src: "midia/efeito.wav", "data-inicio": String(n) } }));
  },
  /** Ambiente de som por cena, que entra 6 quadros antes do corte (corte em J, K-EDI-13). */
  ambiente(c) {
    const t = c.tarefa;
    const limites = [0, ...t.cortes.map((x) => q(t, x)), t.quadros];
    const antes = Math.max(2, Math.round(0.2 * t.qps));
    for (let i = 0; i < limites.length - 1; i++) {
      const hz = 600 + 70 * i, ini = Math.max(0, limites[i] - (i ? antes : 0)), fim = limites[i + 1];
      const arq = `midia/ambiente-${i}.wav`;
      c.ativos[arq] = { tipo: "wav", segundos: (fim - ini) / t.qps, partes: [{ hz, ganho: 0.06, trechos: [{ ini: 0, fim: (fim - ini) / t.qps, rampa: 0.01 }] }] };
      c.rotulos[arq] = { tipo: "ambiente", hz, cena: i };
      c.els.push(novoEl(`ambiente-${i}`, "audio", { papel: "ambiente", attrs: { src: arq, "data-inicio": String(ini) } }));
    }
  },
  /** Elemento decorativo que se move com causa: entra na batida de um corte e para (K-ANI-03). */
  decoracao(c) {
    const t = c.tarefa, lay = leiaute(t);
    const ini = t.cortes.length ? q(t, t.cortes[0]) : q(t, t.fase + t.batida);
    c.els.push(novoEl("forma", "div", { papel: "decoracao",
      css: { position: "absolute", right: px(lay.m), top: px(t.dim.altura * 0.9), width: px(t.dim.largura * 0.05), height: px(t.dim.largura * 0.05), background: t.paleta.acento2, "border-radius": "50%" },
      anims: [{ chaves: [{ transform: "translateY(20px)", opacity: 0 }, { transform: "none", opacity: 1 }], ini, dur: Math.round(0.4 * t.qps), easing: EASE_ENTRADA }] }));
  },
  /** O trecho em laço: tudo sai no fim e o último quadro volta ao primeiro (K-ANI-05). */
  laco(c) {
    const t = c.tarefa;
    t.laco = true;
    const fim = t.quadros - 1, saida = Math.round(0.3 * t.qps);
    // A primeira cena entra com fade a partir do fundo; no fim, tudo o que está no body sai com fade (keyframe só com o
    // destino: parte do valor de baixo, então o que já estava escondido continua escondido).
    const secoes = c.els.filter((e) => e.classes?.includes("cena"));
    // fill «backwards»: depois do fade a seção volta ao mostrar/esconder dela (com «both» ficaria visível para sempre).
    secoes[0].anims.push({ chaves: [{ opacity: 0 }, { opacity: 1 }], ini: 0, dur: saida, easing: "ease-out", fill: "backwards" });
    for (const e of c.els) {
      if (e.pai || e.tag === "audio" || e.id === "fundo") continue;
      e.anims.push({ chaves: [{ opacity: 0 }], ini: fim - saida, dur: saida, easing: "ease-in", fill: "forwards" });
    }
  },
  /** A voz veio na velocidade normal e o pedido é 1,25×: o áudio toca acelerado e todo o tempo da página segue a voz
   * acelerada (as falas da tarefa já são as da voz acelerada; o arquivo tem os tempos × 1,25). K-AUD-07. */
  vozRapida(c) {
    const t = c.tarefa, v = 1.25;
    t.velocidadeVoz = v;
    c.ativos["midia/voz.wav"] = { tipo: "wav", segundos: t.segundos * v + 0.5, partes: [{ hz: 220, harm: 0.4, ganho: 0.5, trechos: t.falas.map((p) => ({ ini: p.ini * v, fim: p.fim * v, rampa: 0.015 })) }] };
    c.rotulos["midia/voz.wav"] = { tipo: "voz", hz: 220, velocidadePedida: v };
    const voz = c.els.find((e) => e.id === "voz")!;
    voz.attrs["data-velocidade"] = String(v);
    voz.attrs["data-quadros"] = String(t.quadros);
  },
  /** Mídia a mais na biblioteca, rotulada com palavras que não estão na fala (K-EDI-05). */
  biblioteca(c) {
    const t = c.tarefa, lay = leiaute(t);
    ["montanha", "bicicleta", "chuva"].forEach((r, k) => {
      const arq = `midia/extra-${k}.png`;
      c.ativos[arq] = { tipo: "imagem", largura: par(lay.midia.w), altura: par(lay.midia.h), c0: ["#5a3a8c", "#3a8c8c", "#8c8c3a"][k], c1: "#202020", formas: true };
      c.rotulos[arq] = { tipo: "cobertura", rotulo: r };
    });
  },
  /** A transcrição automática ruim que veio com a voz (palavras sem sentido e marcas de música): a base usa o roteiro. K-AUD-06. */
  transcricao(c) {
    const ruido = ["[música]", "♪", "tora", "nuvão", "grausso", "[inaudível]"];
    const palavras = c.tarefa.falas.map((p, i) => ({ ...p, t: i % 3 === 1 ? ruido[i % ruido.length] : p.t }));
    c.ativos["transcricao.json"] = { tipo: "texto", conteudo: JSON.stringify(palavras, null, 1) + "\n" };
    c.rotulos["transcricao.json"] = { tipo: "transcricao", ruido };
  },
  /** O take do apresentador veio horizontal (16:9) e o vídeo é vertical: a base reenquadra pelo rosto. K-PLA-02. */
  takeHorizontal(c) {
    const t = c.tarefa, { largura: L, altura: A } = t.dim;
    if (A <= L) return;
    const H = A, W = par((A * 16) / 9);
    const escala = H / RETRATO.altura;
    const [rx, ry, rw, rh] = RETRATO.rosto;
    const x = Math.round(W * 0.62 - (rx + rw / 2) * escala);
    c.ativos["midia/apresentador-h.mp4"] = { tipo: "apresentador", largura: W, altura: H, segundos: t.segundos, escala, x, y: 0 };
    const rosto = [rx * escala + x, ry * escala, rw * escala, rh * escala];
    c.rotulos["midia/apresentador-h.mp4"] = { tipo: "apresentador", rosto, origem: [W, H] };
    // object-position em % que põe o centro do rosto no meio da tela vertical.
    const cx = rosto[0] + rosto[2] / 2, livre = W * (A / H) - L;
    const pos = Math.max(0, Math.min(100, ((cx * (A / H) - L / 2) / livre) * 100));
    for (const e of c.els.filter((x) => x.papel === "apresentador")) {
      e.attrs.src = "midia/apresentador-h.mp4";
      e.css["object-position"] = `${pos.toFixed(1)}% 50%`;
      delete e.css["transform-origin"]; delete e.css.transform;
    }
    delete c.ativos["midia/apresentador.mp4"]; delete c.rotulos["midia/apresentador.mp4"];
  },
  /** Uma transição pensada no primeiro corte: a cena sai para a esquerda e a próxima entra pela direita. K-EDI-08. */
  deslize(c) {
    const t = c.tarefa;
    if (!t.cortes.length) return;
    const n = q(t, t.cortes[0]), d = Math.max(4, Math.round(0.25 * t.qps));
    const [a, b] = c.els.filter((e) => e.classes?.includes("cena"));
    a.ate = n + d;
    a.anims.push({ chaves: [{ transform: "none" }, { transform: `translateX(-${t.dim.largura}px)` }], ini: n, dur: d, easing: "ease-in", fill: "forwards" });
    b.anims.push({ chaves: [{ transform: `translateX(${t.dim.largura}px)` }, { transform: "none" }], ini: n, dur: d, easing: "ease-out", fill: "both" });
  },
  /** Pedido de revisão: o título deve entrar 0,2 s antes; o resto fica como foi aprovado (K-COR-06, K-EDI-14). */
  revisao(c) {
    c.tarefa.permitido = ["titulo"];
  },
  /** O vídeo pedido com fundo transparente (K-FER-11). */
  transparente(c) {
    c.tarefa.transparente = true;
    c.fundoPagina = "transparent";
    // Vídeo com fundo transparente é sobreposição (faixa, legenda, títulos): sai o que cobre o quadro inteiro.
    c.els = c.els.filter((e) => e.id !== "fundo" && e.papel !== "apresentador");
  },
  /** Mídia HDR da biblioteca já convertida para SDR (a certa) e o original HDR (K-COR-05). */
  hdr(c) {
    const t = c.tarefa, lay = leiaute(t);
    const { x, y, w, h } = lay.midia;
    const secB = c.els.find((e) => e.id === ultimaCenaB(c));
    const dur = Math.max(2, ((secB?.ate ?? t.quadros) - (secB?.de ?? 0)) / t.qps + 0.5);
    c.ativos["midia/clipe-hdr.mp4"] = { tipo: "clipe", largura: par(w), altura: par(h), segundos: dur, qps: t.qps, c0: "#22305e", c1: "#4a6fa8", bloco: "#E4572E", hdr: true };
    c.rotulos["midia/clipe-hdr.mp4"] = { tipo: "clipe", rotulo: "torra", transferencia: "smpte2084" };
    c.ativos["midia/clipe-sdr.mp4"] = { tipo: "clipe", largura: par(w), altura: par(h), segundos: dur, qps: t.qps, c0: "#22305e", c1: "#4a6fa8", bloco: "#E4572E" };
    c.rotulos["midia/clipe-sdr.mp4"] = { tipo: "clipe", rotulo: "torra", transferencia: "bt709", convertidoDe: "midia/clipe-hdr.mp4" };
    const pai = ultimaCenaB(c);
    c.els = c.els.filter((e) => !(e.pai === pai && e.papel === "cobertura"));
    c.els.push(novoEl("clipe", "video", { pai, papel: "cobertura", attrs: { src: "midia/clipe-sdr.mp4", muted: "", "data-inicio": String(c.els.find((e) => e.id === pai)?.de ?? 0) },
      css: { position: "absolute", left: px(x), top: px(y), width: px(w), height: px(h), "object-fit": "cover" } }));
  },
  /** Cartão final mesmo com poucas cenas (K-IA-10). */
  cartao(c) {
    if (c.els.some((e) => e.id === "chamada")) return;
    const t = c.tarefa, lay = leiaute(t), tam = tamanhos(t), A = t.dim.altura, L = t.dim.largura;
    const de = t.quadros - Math.round(1.5 * t.qps);
    const ultimo = c.els.filter((e) => e.classes?.includes("cena")).at(-1)!;
    ultimo.ate = de;
    c.els.push(novoEl("cena-fim", "section", { classes: ["cena"], de, css: { position: "absolute", inset: "0", background: t.paleta.fundo } }));
    c.ativos["midia/logo.svg"] = { tipo: "copia", de: join(RAIZ_MARCA, "marca", "logo.svg") };
    c.rotulos["midia/logo.svg"] = { tipo: "logo" };
    const lw = Math.round(L * 0.5);
    c.els.push(novoEl("logo-fim", "img", { pai: "cena-fim", papel: "logo", attrs: { src: "midia/logo.svg", alt: "Zunzum" }, css: { position: "absolute", left: px(lay.m), top: px(A * 0.36), width: px(lw) } }));
    c.els.push(novoEl("chamada", "div", { pai: "cena-fim", papel: "chamada", texto: lingua(t.escrita).chamada,
      css: { position: "absolute", left: px(lay.m), top: px(A * 0.36 + lw * 0.3 + tam.chamada), color: t.paleta.acento, font: `700 ${tam.chamada}px ${SANS}` } }));
  },
};

/** O briefing da tarefa em texto (vai no pedido): tudo o que as regras leem da tarefa, para o agente saber também. */
export function briefing(t: Tarefa): string {
  const l = lingua(t.escrita), enf = t.falas[t.enfase[0]];
  const linhas = [
    `- Formato ${t.formato}, ${t.dim.largura} × ${t.dim.altura}, ${t.qps} qps; destino: ${t.plataforma} (de ${t.duracaoMin} a ${t.duracaoMax} s).`,
    `- Idioma: ${l.idioma}. A fala e os tempos estão em saida/roteiro.md e saida/tempos.json${t.velocidadeVoz !== 1 ? ` (a voz tem de tocar a ${String(t.velocidadeVoz).replace(".", ",")}×; os tempos já são os da voz acelerada)` : ""}.`,
    `- Trilha a ${t.bpm} bpm, primeira batida em ${String(t.fase).replace(".", ",")} s; os cortes caem na grade ${t.grade < t.batida ? "da subdivisão da batida" : "da batida"}, a cada ${t.grade.toFixed(3).replace(".", ",")} s.`,
    ...(enf ? [`- Palavra de ênfase da fala: «${enf.t}» (${enf.ini.toFixed(2).replace(".", ",")} s).`] : []),
    `- Dados que podem aparecer na tela: ${t.dados.join("; ")}.`,
    `- Cores da marca: ${t.marca.join(", ")}. A biblioteca de mídia rotulada está em saida/midia/rotulos.json.`,
    ...(t.laco ? ["- O vídeo roda em laço: o último quadro tem de voltar ao primeiro."] : []),
    ...(t.transparente ? ["- O vídeo é sobreposição com fundo transparente."] : []),
    ...(t.permitido.length ? [`- É uma revisão: só pode mudar ${t.permitido.join(", ")}; o resto já foi aprovado.`] : []),
    `- O id da composição é ${t.id}.`,
  ];
  return linhas.join("\n");
}

// ——— A página ———

const kebab = (p: string) => p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
const estilo = (css: Record<string, string>) => Object.entries(css).map(([k, v]) => `${kebab(k)}: ${v}`).join("; ");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const VAZIOS = new Set(["img", "audio", "video", "canvas"]);

function elHtml(e: El, filhos: string): string {
  const attrs: string[] = [`id="${e.id}"`];
  if (e.classes?.length) attrs.push(`class="${e.classes.join(" ")}"`);
  if (e.papel) attrs.push(`data-papel="${e.papel}"`);
  if (e.de !== undefined) attrs.push(`data-de="${e.de}"`);
  if (e.ate !== undefined) attrs.push(`data-ate="${e.ate}"`);
  for (const [k, v] of Object.entries(e.attrs)) attrs.push(v === "" ? k : `${k}="${v.replace(/"/g, "&quot;")}"`);
  const st = estilo(e.css);
  if (st) attrs.push(`style="${st.replace(/"/g, "'")}"`);
  const dentro = (e.html ?? (e.texto !== undefined ? esc(e.texto) : "")) + filhos;
  if (e.tag === "img") return `<img ${attrs.join(" ")}>`;
  return `<${e.tag} ${attrs.join(" ")}>${dentro}</${e.tag}>`;
}

/** A página em linha do tempo declarada. */
export function paraHtml(c: Cena): string {
  const filhosDe = new Map<string | undefined, El[]>();
  for (const e of c.els) { const k = e.pai; if (!filhosDe.has(k)) filhosDe.set(k, []); filhosDe.get(k)!.push(e); }
  const arvore = (pai: string | undefined, nivel: number): string => (filhosDe.get(pai) ?? [])
    .map((e) => `${"  ".repeat(nivel)}${elHtml(e, VAZIOS.has(e.tag) || !filhosDe.has(e.id) ? "" : `\n${arvore(e.id, nivel + 1)}\n${"  ".repeat(nivel)}`)}`).join("\n");
  const anims = c.els.flatMap((e) => e.anims.map((a) => `A(${JSON.stringify(e.id)}, ${JSON.stringify(a.chaves)}, ${a.ini}, ${a.dur}, ${JSON.stringify(a.easing ?? "linear")}, ${a.iter ?? 1}, ${JSON.stringify(a.fill ?? "both")}${a.alternar ? ", true" : ""});`));
  const d = c.decl;
  return `<!doctype html>
<html lang="${c.tarefa.idioma}">
<meta charset="utf-8">
<title>${d.id}</title>
<!-- ${c.comentario} -->
<script type="application/json" id="motor-video">
{ "id": "${d.id}", "largura": ${d.largura}, "altura": ${d.altura}, "qps": ${d.qps}, "quadros": ${d.quadros} }
</script>
<style>
${c.head.join("\n")}
  html, body { margin: 0; width: ${d.largura}px; height: ${d.altura}px; overflow: hidden; background: ${c.fundoPagina}; font-family: "Teste Sans", sans-serif; }
  [data-de] { opacity: 0; }
${c.css.join("\n")}
</style>
${arvore(undefined, 0)}
<script>
window.motor_falas = ${JSON.stringify(c.tarefa.falas)};
const Q = ${d.qps};
// Mostra o elemento do quadro «de» ao quadro «ate», exatos (duas animações de meio milissegundo que acabam no quadro; a de depois vence).
function mostrar(el, de, ate) {
  el.animate([{ opacity: 0 }, { opacity: 1 }], { delay: (de * 1000) / Q - 0.5, duration: 0.5, fill: 'forwards' });
  if (ate !== undefined) el.animate([{ opacity: 1 }, { opacity: 0 }], { delay: (ate * 1000) / Q - 0.5, duration: 0.5, fill: 'forwards' });
}
for (const el of document.querySelectorAll('[data-de]')) mostrar(el, Number(el.dataset.de), el.dataset.ate ? Number(el.dataset.ate) : undefined);
// Animação do quadro ini ao ini + dur (em quadros).
function A(id, chaves, ini, dur, easing, iter, fill, alternar) {
  document.getElementById(id).animate(chaves, { delay: (ini * 1000) / Q, duration: (dur * 1000) / Q, easing, iterations: iter < 0 ? Infinity : iter, fill, direction: alternar ? 'alternate' : 'normal' });
}
${anims.join("\n")}
${c.scripts.join("\n")}
</script>
`;
}

// ——— A mídia ———

function ffmpeg(args: string[]) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg falhou: ${r.stderr}`);
}
const hex = (c: string) => `0x${c.replace("#", "")}`;

/** WAV PCM 16 bits, 48 kHz, mono: soma de tons com envelope (rampa linear). */
export function wav(segundos: number, partes: Tom[]): Buffer {
  const taxa = 48000, n = Math.max(1, Math.round(segundos * taxa));
  const acc = new Float32Array(n);
  for (const p of partes) for (const tr of p.trechos) {
    const a = Math.max(0, Math.floor(tr.ini * taxa)), b = Math.min(n, Math.ceil(tr.fim * taxa)), r = tr.rampa ?? 0.015;
    for (let i = a; i < b; i++) {
      const s = i / taxa, env = Math.min(1, (s - tr.ini) / r, (tr.fim - s) / r);
      acc[i] += p.ganho * Math.max(0, env) * (Math.sin(2 * Math.PI * p.hz * s) + (p.harm ?? 0) * Math.sin(4 * Math.PI * p.hz * s));
    }
  }
  const dados = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) dados.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(acc[i] * 32767))), i * 2);
  const cab = Buffer.alloc(44);
  cab.write("RIFF", 0); cab.writeUInt32LE(36 + dados.length, 4); cab.write("WAVE", 8); cab.write("fmt ", 12);
  cab.writeUInt32LE(16, 16); cab.writeUInt16LE(1, 20); cab.writeUInt16LE(1, 22); cab.writeUInt32LE(taxa, 24);
  cab.writeUInt32LE(taxa * 2, 28); cab.writeUInt16LE(2, 32); cab.writeUInt16LE(16, 34); cab.write("data", 36); cab.writeUInt32LE(dados.length, 40);
  return Buffer.concat([cab, dados]);
}

export function gerar(r: Receita, arq: string) {
  mkdirSync(dirname(arq), { recursive: true });
  if (r.tipo === "wav") writeFileSync(arq, wav(r.segundos, r.partes));
  else if (r.tipo === "texto") writeFileSync(arq, r.conteudo);
  else if (r.tipo === "copia") copyFileSync(r.de, arq);
  else if (r.tipo === "apresentador") gerarApresentador(arq, { largura: r.largura, altura: r.altura, segundos: r.segundos, escala: r.escala, x: r.x, y: r.y });
  else if (r.tipo === "imagem") {
    const formas = r.formas ? `,drawbox=x=iw*0.15:y=ih*0.2:w=iw*0.25:h=ih*0.5:color=0x1b1f2a@0.6:t=fill,drawbox=x=iw*0.55:y=ih*0.35:w=iw*0.3:h=ih*0.4:color=0xf7f4ec@0.5:t=fill` : "";
    ffmpeg(["-f", "lavfi", "-i", `gradients=s=${r.largura}x${r.altura}:c0=${hex(r.c0)}:c1=${hex(r.c1)}:x0=0:y0=0:x1=${r.largura}:y1=${r.altura}:d=1`,
      "-vf", `format=rgb24${formas}`, "-frames:v", "1", arq]);
  } else if (r.tipo === "clipe") {
    const vf = `drawbox=x='-iw*0.2+t*iw*1.2/${r.segundos}':y=ih*0.55:w=iw*0.18:h=ih*0.25:color=${hex(r.bloco)}@1:t=fill`;
    // O «HDR» da biblioteca: etiquetado PQ / BT.2020 (o que o agente tem de ler), em H.264 de 8 bits que o navegador abre.
    const cor = r.hdr ? ["-vf", `${vf},format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc"]
      : ["-vf", `${vf},scale=out_color_matrix=bt709,format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"];
    ffmpeg(["-f", "lavfi", "-i", `gradients=s=${r.largura}x${r.altura}:r=${r.qps}:d=${r.segundos}:c0=${hex(r.c0)}:c1=${hex(r.c1)}:speed=0.03`, ...cor, "-g", String(r.qps), "-an", arq]);
  } else if (r.tipo === "gif") {
    ffmpeg(["-f", "lavfi", "-i", `testsrc2=s=${r.largura}x${r.altura}:r=10:d=${r.segundos}`, "-loop", "0", arq]);
  }
}

/** Escreve a cena na pasta da tarefa: saida/index.html, a mídia e a biblioteca rotulada (saida/midia/rotulos.json). */
export function materializar(c: Cena, tarefa: string, o: { midia?: boolean } = {}) {
  const saida = join(tarefa, "saida");
  mkdirSync(join(saida, "midia"), { recursive: true });
  if (o.midia !== false) for (const [arq, r] of Object.entries(c.ativos)) {
    const destino = join(saida, arq);
    if (!existsSync(destino)) gerar(r, destino);
  }
  writeFileSync(join(saida, "midia", "rotulos.json"), JSON.stringify(c.rotulos, null, 1) + "\n");
  writeFileSync(join(saida, "tempos.json"), JSON.stringify(c.tarefa.falas, null, 1) + "\n");
  writeFileSync(join(saida, "roteiro.md"), `# Roteiro\n\n${c.tarefa.frases.join("\n\n")}\n`);
  writeFileSync(join(saida, "index.html"), paraHtml(c));
}

/** Impressão digital da mídia de uma cena (para reaproveitar a mídia entre variações do mesmo caso). */
export const chaveDaMidia = (c: Cena) => createHash("sha256").update(canonico(c.ativos)).digest("hex").slice(0, 16);
