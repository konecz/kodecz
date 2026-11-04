// H02 v2: monta um take do apresentador no padrão aprovado. Aproximação lenta ao longo do take (1 → 1,06) somada a um
// punch-in de 12 % por ênfase, que entra com mola (damping 18, overshoot leve) na palavra e acaba de sair no fim da
// frase dela (G21); recorte da fonte (16:9 ou 9:16) na caixa, centrado no foco e preso às bordas (o vídeo sempre cobre
// a caixa); passagem opcional da tela cheia para um cartão.
//
// O zoom mexe na CAIXA do vídeo (left, top, width, height), nunca em `transform` num ancestral: escala num ancestral
// manda o quadro da placa (NVDEC, por baixo da página) para o canvas (composicao/take-placa.js). As contas são feitas
// aqui, por quadro, e saem como @keyframes lineares amostrados nos quadros (os pontos que a interpolação linear já
// reproduz são tirados); o motor põe currentTime = N / fps, então cada quadro cai num valor calculado aqui (R03).
//
// Contrato com o `kodecz assemble`: `montar(item, ctx)` devolve { html, css }. `css` são caminhos relativos a blocos/
// (o bloco.css); os @keyframes gerados vão num <style> dentro do `html`. Tempos do item e das palavras em segundos na
// linha do tempo da composição.
//
// Uso solto: node blocos/zoom-ate-o-fim-da-frase/montar.ts exemplo > blocos/zoom-ate-o-fim-da-frase/exemplo-apresentador.html

export interface Palavra { texto: string; inicio: number; fim: number } // segundos
export interface ContextoMontagem { fps: number; largura: number; altura: number; palavras: Palavra[]; q(segundos: number): number; quando(palavra: string, ocorrencia?: number): Palavra; fimDaFrase(segundos: number): number; tempo(ref: unknown): number }
export interface Montado { html: string; css?: string[]; js?: string[]; head?: string }

export type Ponto = { x: number; y: number };
export type Enfase = string | { palavra: string; ocorrencia?: number };
export interface Cartao {
  x: number; y: number; w: number; h: number;
  /** Raio dos cantos no cartão (px). Padrão 32. */
  raio?: number;
  /** Contorno (outline) no cartão, em px, na cor --color-accent. Padrão 4; 0 sem contorno. */
  contorno?: number;
  /** Quando sai da tela cheia para o cartão (referência de tempo); sem ele, o take já começa no cartão. */
  em?: unknown;
  /** Foco no cartão (px da fonte); padrão, o foco do take. */
  foco?: Ponto;
}
export interface ItemTake {
  src: string;
  /** Início e fim do take na composição (referências de tempo: segundos ou o que ctx.tempo aceitar). */
  de: unknown; ate: unknown;
  /** Segundo do vídeo-fonte que aparece no início do take. Padrão 0. */
  inicioNoVideo?: number;
  formatoFonte?: "16:9" | "9:16";
  /** Ponto de interesse em px da fonte (G23), entre o rosto e as mãos. Padrão: o centro. */
  foco?: Ponto;
  /** Onde o foco fica na caixa, em fração da caixa. Padrão { x: 0.5, y: 0.45 } (o aprovado). */
  ancora?: Ponto;
  /** Aproximação lenta ao longo do take. Padrão { de: 1, ate: 1.06 }. */
  aproximacao?: { de: number; ate: number };
  /** Palavras de ênfase: cada uma faz um punch-in da palavra até o fim da frase dela. */
  enfases?: Enfase[];
  /** Escala do punch-in (soma escala − 1 à aproximação). Padrão 1.12. */
  escala?: number;
  /** Quadros da saída do punch-in, que termina no fim da frase. Padrão 0,4 s. */
  saida?: number;
  cartao?: Cartao;
  /** Sem o som do take. */
  mudo?: boolean;
}

const FONTES = { "16:9": [1920, 1080], "9:16": [1080, 1920] } as const;

/** Mola fechada (massa 1, rigidez 100, partindo do repouso), como o `spring()` de skills/remotion-to-kodecz. */
export function mola(segundos: number, damping: number): number {
  const t = Math.max(0, segundos), w0 = 10, z = damping / 20;
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
  }
  if (z === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const s = Math.sqrt(z * z - 1), r1 = -w0 * (z - s), r2 = -w0 * (z + s);
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}
const assentos = new Map<number, number>();
/** Segundos até a mola ficar a menos de 0,5 % de 1 para sempre. */
function assento(damping: number): number {
  if (!assentos.has(damping)) {
    let t = 20;
    while (t > 0 && Math.abs(1 - mola(t, damping)) < 0.005) t -= 0.001;
    assentos.set(damping, t + 0.001);
  }
  return assentos.get(damping)!;
}
/** A mola esticada para assentar em `quadros` quadros (1 exato dali em diante). */
export function molaEm(quadro: number, quadros: number, damping: number): number {
  if (quadro <= 0) return 0;
  if (quadro >= quadros) return 1;
  return mola((quadro / quadros) * assento(damping), damping);
}

export type Enquadramento = {
  /** Caixa do take no quadro (px inteiros) e o quanto já passou para o cartão (0..1). */
  caixa: { x: number; y: number; w: number; h: number; raio: number; contorno: number; e: number };
  /** Retângulo do vídeo inteiro, relativo à caixa (passa das bordas; o que passa fica escondido). */
  video: { x: number; y: number; w: number; h: number };
  /** Zoom total (1 = o vídeo cobrindo a caixa) e a parte do punch-in nele. */
  zoom: number; punch: number;
};
type Plano = { inicio: number; n: number; enfases: { inicio: number; fim: number }[]; quadro(f: number): Enquadramento };

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** As contas do take: quadro inicial, duração em quadros, ênfases em quadros e o enquadramento de cada quadro. */
export function planejar(item: ItemTake, ctx: ContextoMontagem): Plano {
  const inicio = ctx.q(ctx.tempo(item.de)), fim = ctx.q(ctx.tempo(item.ate)), n = fim - inicio;
  if (!(n > 0)) throw new Error(`zoom-ate-o-fim-da-frase: o fim do take (${fim}) tem de vir depois do início (${inicio})`);
  const [W0, H0] = FONTES[item.formatoFonte ?? "16:9"];
  const foco = item.foco ?? { x: W0 / 2, y: H0 / 2 };
  const ancora = item.ancora ?? { x: 0.5, y: 0.45 };
  const aprox = item.aproximacao ?? { de: 1, ate: 1.06 };
  const amplitude = (item.escala ?? 1.12) - 1;
  const saida = Math.max(1, Math.round(item.saida ?? 0.4 * ctx.fps));
  const enfases = (item.enfases ?? []).map((en) => {
    const { palavra, ocorrencia } = typeof en === "string" ? { palavra: en, ocorrencia: undefined } : en;
    const p = ctx.quando(palavra, ocorrencia);
    // A frase que passa do corte do take acaba no último quadro dele: o zoom volta antes do corte (zoom.take-volta).
    return { palavra, inicio: ctx.q(p.inicio), fim: Math.min(fim - 1, ctx.q(ctx.fimDaFrase(p.inicio))) };
  }).sort((a, b) => a.inicio - b.inicio);
  enfases.forEach((e, i) => {
    if (e.inicio < inicio) throw new Error(`zoom-ate-o-fim-da-frase: «${e.palavra}» (${e.inicio}) é antes do take (${inicio})`);
    if (!(e.fim > e.inicio)) throw new Error(`zoom-ate-o-fim-da-frase: a frase de «${e.palavra}» acaba (${e.fim}) antes da palavra (${e.inicio})`);
    const a = enfases[i - 1];
    if (a && a.fim > e.inicio) throw new Error(`zoom-ate-o-fim-da-frase: «${a.palavra}» e «${e.palavra}» na mesma frase (um zoom por frase, G21)`);
  });
  const c = item.cartao;
  const emCartao = c?.em === undefined ? null : ctx.q(ctx.tempo(c.em));
  const L = ctx.largura, A = ctx.altura;

  const quadro = (f: number): Enquadramento => {
    // Punch-in: a mola entra na palavra; a de saída acaba no fim da frase, e dali em diante é 0 exato.
    let punch = 0;
    for (const e of enfases) {
      if (f < e.inicio || f >= e.fim) continue;
      const s = Math.min(saida, e.fim - e.inicio);
      punch += amplitude * mola((f - e.inicio) / ctx.fps, 18) * (1 - molaEm(f - (e.fim - s), s, 18));
    }
    const lenta = aprox.de + (aprox.ate - aprox.de) * (f - inicio) / n;
    const zoom = Math.max(1, lenta + punch);
    // A caixa: tela cheia, o cartão, ou a passagem (mola damping 200 em 22 quadros), sempre no pixel inteiro.
    const e = !c ? 0 : emCartao === null ? 1 : molaEm(f - emCartao, 22, 200);
    const mix = (a: number, b: number) => Math.round(a + (b - a) * e);
    const caixa = c
      ? { x: mix(0, c.x), y: mix(0, c.y), w: mix(L, c.w), h: mix(A, c.h), raio: mix(0, c.raio ?? 32), contorno: mix(0, c.contorno ?? 4), e }
      : { x: 0, y: 0, w: L, h: A, raio: 0, contorno: 0, e };
    if (caixa.raio === 0) caixa.contorno = 0; // contorno só no cartão arredondado (o que vai pela placa)
    const fc = c?.foco ? { x: foco.x + (c.foco.x - foco.x) * e, y: foco.y + (c.foco.y - foco.y) * e } : foco;
    const s = Math.max(caixa.w / W0, caixa.h / H0) * zoom;
    const w = Math.ceil(W0 * s * 1000) / 1000, h = Math.ceil(H0 * s * 1000) / 1000;
    // Trava nas bordas: o vídeo nunca deixa à mostra o que está fora dele.
    const preso = (v: number, min: number) => Math.min(0, Math.max(min, r3(v)));
    return {
      caixa,
      video: { x: preso(caixa.w * ancora.x - fc.x * s, caixa.w - w), y: preso(caixa.h * ancora.y - fc.y * s, caixa.h - h), w, h },
      zoom, punch,
    };
  };
  return { inicio, n, enfases, quadro };
}

/** @keyframes linear amostrado nos quadros 0..n, sem os pontos que a interpolação linear dos vizinhos já dá. */
function keyframes(nome: string, amostras: Record<string, number>[], tolerancia: Record<string, number>, unidade: Record<string, string>): string {
  const n = amostras.length - 1, manter = [0];
  let a = 0;
  for (let j = 2; j <= n; j++) {
    // Do último mantido (a) até j: todos os do meio na reta?
    const reta = (i: number) => Object.keys(amostras[0]).every((k) => {
      const v = amostras[a][k] + (amostras[j][k] - amostras[a][k]) * (i - a) / (j - a);
      return Math.abs(v - amostras[i][k]) <= tolerancia[k];
    });
    let ok = true;
    for (let i = a + 1; i < j && ok; i++) ok = reta(i);
    if (!ok) { a = j - 1; manter.push(a); }
  }
  if (n > 0) manter.push(n);
  const pct = (i: number) => `${+((i / n) * 100).toFixed(10)}%`;
  const linhas = manter.map((i) => `  ${pct(i)} { ${Object.entries(amostras[i]).map(([k, v]) => `${k}: ${+v.toFixed(6)}${unidade[k] ?? ""}`).join("; ")} }`);
  return `@keyframes ${nome} {\n${linhas.join("\n")}\n}`;
}

/** Nome curto e estável para os keyframes do take (o mesmo item dá o mesmo nome). */
function nomeDoTake(item: ItemTake, inicio: number): string {
  let h = 0;
  for (const ch of `${item.src}|${inicio}`) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return `kz-take-${inicio}-${h.toString(36)}`;
}

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function montar(item: ItemTake, ctx: ContextoMontagem): Montado {
  const p = planejar(item, ctx);
  const nome = nomeDoTake(item, p.inicio);
  const quadros = Array.from({ length: p.n + 1 }, (_, i) => p.quadro(p.inicio + i));
  const px = { left: "px", top: "px", width: "px", height: "px", "border-radius": "px", "outline-width": "px" };
  const tol = { left: 0.01, top: 0.01, width: 0.01, height: 0.01, "border-radius": 0, "outline-width": 0, "--kz-punch": 1e-6 };
  const caixa = quadros.map((q) => ({
    ...(item.cartao ? { left: q.caixa.x, top: q.caixa.y, width: q.caixa.w, height: q.caixa.h, "border-radius": q.caixa.raio, "outline-width": q.caixa.contorno } : {}),
    "--kz-punch": q.punch,
  }));
  const video = quadros.map((q) => ({ left: q.video.x, top: q.video.y, width: q.video.w, height: q.video.h }));
  const recorte = ctx.q(item.inicioNoVideo ?? 0);
  const marcas = p.enfases.map((e) => `    <i class="kz-take-enfase" style="--inicio: ${e.inicio}; --fim: ${e.fim}" data-valor="0"></i>`);
  const html = `<style>
${keyframes(`${nome}-caixa`, caixa, tol, px)}
${keyframes(`${nome}-video`, video, tol, px)}
</style>
<div class="kz-take" data-bloco="zoom-ate-o-fim-da-frase" style="--inicio: ${p.inicio}; --fim: ${p.inicio + p.n}; --kz-n: ${p.n}; --kz-caixa: ${nome}-caixa; --kz-video: ${nome}-video">
  <div class="kz-take-caixa${item.cartao ? " kz-take-cartao" : ""}" data-valor="0">
    <video class="kz-take-video" data-papel="apresentador" src="${escapar(item.src)}" data-inicio="${p.inicio}" data-recorte="${recorte}" data-quadros="${p.n}"${item.mudo ? " muted" : ""}></video>
${marcas.join("\n")}
  </div>
</div>`;
  return { html, css: ["bloco.css"] };
}

// --- Exemplo (apresentador sintético de blocos/gerar-midia.sh, sem pessoa e sem cliente) --------------------------

/** Contexto de montagem de exemplo: palavras sintéticas com tempos fixos; a frase fecha em . ! ? ou …, +0,15 s. */
export function contextoDeExemplo(largura = 1080, altura = 1920, fps = 30): ContextoMontagem {
  const texto = "Hoje a gente mostra três passos simples. O segundo passo muda tudo, e quase ninguém conta isso.";
  const palavras: Palavra[] = texto.split(" ").map((t, i) => ({ texto: t, inicio: r3(0.3 + i * 0.33), fim: r3(0.3 + i * 0.33 + 0.3) }));
  const limpa = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  const ctx: ContextoMontagem = {
    fps, largura, altura, palavras,
    q: (s) => Math.round(s * fps),
    quando(palavra, ocorrencia = 1) {
      const achadas = palavras.filter((p) => limpa(p.texto) === limpa(palavra));
      const p = achadas[ocorrencia - 1];
      if (!p) throw new Error(`palavra não encontrada: ${palavra} (${ocorrencia}ª)`);
      return p;
    },
    fimDaFrase(segundos) {
      const p = palavras.find((x) => x.inicio >= segundos && /[.!?…]$/.test(x.texto)) ?? palavras[palavras.length - 1];
      return r3(p.fim + 0.15);
    },
    tempo: (ref) => Number(ref),
  };
  return ctx;
}

export const ITEM_DE_EXEMPLO: ItemTake = {
  src: "../midia/apresentador.mp4", de: 0, ate: 6.5, inicioNoVideo: 0, formatoFonte: "16:9",
  foco: { x: 960, y: 480 }, aproximacao: { de: 1, ate: 1.06 }, enfases: ["três", "tudo"], escala: 1.12,
};

/** A página do exemplo-apresentador.html: 9:16, o take 16:9 recortado, duas ênfases e a aproximação lenta. */
export function paginaDeExemplo(): string {
  const ctx = contextoDeExemplo();
  const m = montar(ITEM_DE_EXEMPLO, ctx);
  return `<!doctype html>
<meta charset="utf-8">
<title>zoom-ate-o-fim-da-frase · exemplo do apresentador</title>
<!-- H02 v2, gerado por: node blocos/zoom-ate-o-fim-da-frase/montar.ts exemplo. Apresentador sintético 16:9
     (blocos/gerar-midia.sh) recortado para 9:16 no foco, aproximação lenta 1 → 1,06 e punch-in de 12 % em «três» e
     «tudo», cada um até o fim da frase (a vírgula depois de «tudo» não fecha a frase). Servir a pasta blocos/. -->
<script type="application/json" id="kodecz">
{ "id": "ExemploApresentador", "width": ${ctx.largura}, "height": ${ctx.altura}, "fps": ${ctx.fps}, "frames": ${ctx.q(6.5)} }
</script>
<link rel="stylesheet" href="../marca/marca.css">
${(m.css ?? []).map((c) => `<link rel="stylesheet" href="${c.replace("zoom-ate-o-fim-da-frase/", "")}">`).join("\n")}
<style>
  :root { --fps: ${ctx.fps}; }
  html, body { margin: 0; width: ${ctx.largura}px; height: ${ctx.altura}px; overflow: hidden; background: var(--color-ground); }
</style>
${m.html}
`;
}

if (process.argv[1] === new URL(import.meta.url).pathname && process.argv[2] === "exemplo") process.stdout.write(paginaDeExemplo());
