// Kodecz Bench (P12): o material sintético das tarefas. Tudo inventado (R01): a marca fictícia Zunzum
// (identidade/fixtures/marca-ficticia/), falas e tempos fictícios, um «apresentador» (o retrato de domínio público
// dos testes do S04, com a caixa do rosto conhecida), voz feita de tons (uma «palavra» é um trecho de tom) e clipes de formas. Nada disso entra no git como
// mídia (*.mp4, *.wav, *.png estão no .gitignore): é gerado na pasta da tarefa pelo ffmpeg.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Caixa = [number, number, number, number];
export type Palavra = { t: string; ini: number; fim: number; bloco: number };
export const QPS = 30;
const FONTE = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

function ffmpeg(args: string[]) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg falhou: ${r.stderr}`);
}
const garantir = (arquivo: string) => mkdirSync(dirname(arquivo), { recursive: true });

/** Página em linha do tempo declarada (docs/formatos/linha-do-tempo.md). */
export function pagina(o: { id: string; largura: number; altura: number; quadros: number; titulo: string; css: string; corpo: string;
  script?: string; comentario?: string }): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>${o.titulo}</title>${o.comentario ? `\n<!-- ${o.comentario} -->` : ""}
<script type="application/json" id="motor-video">
{ "id": "${o.id}", "largura": ${o.largura}, "altura": ${o.altura}, "qps": ${QPS}, "quadros": ${o.quadros} }
</script>
<style>
  html, body { margin: 0; width: ${o.largura}px; height: ${o.altura}px; overflow: hidden; background: #1B1F2A; font-family: "DejaVu Sans", sans-serif; }
${o.css}
</style>
${o.corpo}
<script>
${o.script ?? ""}
</script>
`;
}

/** A fala publicada para a conferência (window.motor_falas, docs/formatos/conferencia.md). */
export const falasJs = (falas: Palavra[]) => `window.motor_falas = ${JSON.stringify(falas)};`;

/** Palavras com tempos a partir de frases: ~0,28 s por palavra, 0,05 s entre palavras, 0,5 s entre frases. */
export function falar(frases: string[], { inicio = 0.4, bloco = 1, porPalavra = 0.28, entre = 0.05, pausa = 0.5 } = {}): Palavra[] {
  const r: Palavra[] = [];
  let t = inicio;
  for (const f of frases) {
    for (const p of f.split(/\s+/).filter(Boolean)) {
      const d = porPalavra * Math.max(0.6, Math.min(1.6, p.length / 6));
      r.push({ t: p, ini: +t.toFixed(3), fim: +(t + d).toFixed(3), bloco });
      t += d + entre;
    }
    t += pausa;
  }
  return r;
}

/**
 * O retrato de domínio público que a conferência do S04 já usa nos testes (NASA, S69-31741; conferencia/preparar.ts
 * baixa e confere o SHA-256): 720 × 900, rosto achado pelo YuNet do S04 em [380, 168, 117, 153] (sobrancelha ao
 * queixo). É uma pessoa real de foto pública, não cliente (R01), e o detector da conferência o acha, então o agente do
 * modo 1 pode usar a conferência automática como usaria num vídeo de verdade.
 */
export const RETRATO = { arquivo: join(homedir(), ".cache", "motor-video", "teste", "retrato-720.jpg"), largura: 720, altura: 900,
  rosto: [380, 168, 117, 153] as Caixa };

/**
 * O «apresentador»: o retrato, em escala `escala` e posto em (`x`, `y`), sobre um fundo em degradê, parado (a caixa
 * do rosto é exata). `logo`: um selo da marca fictícia «na parede», por cima. Devolve a caixa do rosto em px do vídeo.
 */
export function gerarApresentador(arquivo: string, o: { largura: number; altura: number; segundos: number; escala: number; x: number; y?: number; logo?: Caixa }): Caixa {
  if (!existsSync(RETRATO.arquivo)) throw new Error(`falta ${RETRATO.arquivo}: node conferencia/preparar.ts (uma vez, com rede)`);
  garantir(arquivo);
  const y = o.y ?? 0;
  const f = [`[1:v]scale=${Math.round(RETRATO.largura * o.escala)}:${Math.round(RETRATO.altura * o.escala)}[r]`, `[0:v][r]overlay=x=${o.x}:y=${y}:shortest=1`];
  if (o.logo) {
    const [lx, ly, lw, lh] = o.logo;
    f[1] += `,drawbox=x=${lx}:y=${ly}:w=${lw}:h=${lh}:color=0x2e86ab@1:t=fill,`
      + `drawtext=fontfile=${FONTE}:text='ZUNZUM':fontsize=${Math.round(lh * 0.34)}:fontcolor=white:x=${lx}+(${lw}-tw)/2:y=${ly}+(${lh}-th)/2`;
  }
  f[1] += ",format=yuv420p[v]";
  ffmpeg(["-f", "lavfi", "-i", `gradients=s=${o.largura}x${o.altura}:r=${QPS}:d=${o.segundos}:c0=0x22305e:c1=0x4a6fa8:x0=0:y0=0:x1=${o.largura}:y1=${o.altura}:speed=0.01`,
    "-loop", "1", "-framerate", String(QPS), "-i", RETRATO.arquivo, "-filter_complex", f.join(";"), "-map", "[v]", "-t", String(o.segundos),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "30", "-an", arquivo]);
  const [rx, ry, rw, rh] = RETRATO.rosto;
  return [rx * o.escala + o.x, ry * o.escala + y, rw * o.escala, rh * o.escala];
}

/** Voz sintética: cada palavra é um trecho de tom (`freq`, com o 2.º harmônico), com 15 ms de rampa. */
export function gerarVoz(arquivo: string, palavras: { ini: number; fim: number }[], o: { segundos: number; freq?: number }) {
  garantir(arquivo);
  const f = o.freq ?? 220;
  const env = palavras.map((p) => `min(1\\,min((t-${p.ini})/0.015\\,(${p.fim}-t)/0.015))*between(t\\,${p.ini}\\,${p.fim})`).join("+");
  ffmpeg(["-f", "lavfi", "-i", `aevalsrc=0.25*(sin(2*PI*${f}*t)+0.4*sin(4*PI*${f}*t))*(${env || "0"}):s=48000:d=${o.segundos}`,
    "-c:a", "pcm_s16le", arquivo]);
}

/** Clipe de formas («vídeo vivo» fictício): degradê que anda e um bloco que atravessa a tela. */
export function gerarClipe(arquivo: string, o: { largura: number; altura: number; segundos: number; c0: string; c1: string; bloco: string }) {
  garantir(arquivo);
  ffmpeg(["-f", "lavfi", "-i", `gradients=s=${o.largura}x${o.altura}:r=${QPS}:d=${o.segundos}:c0=${o.c0}:c1=${o.c1}:speed=0.03`,
    "-vf", `drawbox=x='-200+t*${(o.largura + 200) / o.segundos}':y=${o.altura * 0.55}:w=${o.largura * 0.18}:h=${o.altura * 0.25}:color=${o.bloco}@1:t=fill,format=yuv420p`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "30", "-an", arquivo]);
}

/** Uma imagem parada (PNG) a partir do primeiro quadro de um clipe, ou de um degradê (o «céu»). */
export function gerarImagem(arquivo: string, o: { largura: number; altura: number; c0: string; c1: string }) {
  garantir(arquivo);
  ffmpeg(["-f", "lavfi", "-i", `gradients=s=${o.largura}x${o.altura}:c0=${o.c0}:c1=${o.c1}:x0=0:y0=0:x1=0:y1=${o.altura}:d=1`,
    "-frames:v", "1", arquivo]);
}

export function escrever(arquivo: string, conteudo: string) {
  garantir(arquivo);
  writeFileSync(arquivo, conteudo);
}

/** A marca fictícia: logo novo (aprovado) e o antigo (verde-oliva e rosa, da base velha). */
export const LOGO_NOVO = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="72" viewBox="0 0 240 72"><rect width="240" height="72" rx="14" fill="#2E86AB"/><text x="120" y="48" font-family="DejaVu Sans" font-weight="700" font-size="34" fill="#FFFFFF" text-anchor="middle">zunzum</text></svg>\n`;
export const LOGO_VELHO = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="72" viewBox="0 0 240 72"><rect width="240" height="72" rx="36" fill="#6B8E23"/><text x="120" y="48" font-family="DejaVu Serif" font-size="34" fill="#F4C2C2" text-anchor="middle">Zunzum</text></svg>\n`;
/** Cores da identidade velha que não podem voltar (X1). */
export const CORES_VELHAS: [number, number, number][] = [[0x6b, 0x8e, 0x23], [0xf4, 0xc2, 0xc2]];
