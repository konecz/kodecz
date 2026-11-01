// Quadros de referência (S05): guardar o quadro aprovado sem perda e comparar o render novo com ele.
//
// O quadro do motor é BGRA com alfa pré-multiplicado (o do Chromium, gravado por `cli/render.ts --gravar`). A
// referência vai em PNG RGBA de 8 bits (alfa direto, como o PNG pede), escrito e lido aqui com o zlib do Node, sem
// dependência: abre em qualquer visualizador para quem aprova, e a ida e volta é exata (`paraPng` confere; ver abaixo).
// A régua é a do R03 (docs/domain.md): igual, ou diferença invisível de até 2 níveis por canal com SSIM ≥ 0,999.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync, inflateSync } from "node:zlib";

export type Regua = { nivel: number | null; ssim: number; fundo: "gray" | "black" };
/** R03: até 2 níveis por canal e SSIM ≥ 0,999 sobre cinza (a régua do diferenca.mjs do M04). */
export const REGUA_R03: Regua = { nivel: 2, ssim: 0.999, fundo: "gray" };
/**
 * Placa contra CPU (outra rasterização: antisserrilhado, gradiente e texto saem diferentes em muitos níveis, sem ser
 * regressão). Só o SSIM conta, com as duas imagens sobre preto, que é o que o MP4 mostra (o modo CPU desenha sobre
 * preto). 0,997 é o piso de ruído do render em camadas contra o render atual (pesquisa/render-camadas.md).
 */
export const REGUA_CRUZADA: Regua = { nivel: null, ssim: 0.997, fundo: "black" };

const ASSINATURA = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pedaco(tipo: string, dados: Buffer): Buffer {
  const cab = Buffer.alloc(8);
  cab.writeUInt32BE(dados.length, 0);
  cab.write(tipo, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(dados, crc32(Buffer.from(tipo, "latin1"))) >>> 0, 0);
  return Buffer.concat([cab, dados, crc]);
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Filtra uma linha (RGBA, 4 bytes por pixel) com o filtro `f` do PNG. */
function filtrar(f: number, linha: Buffer, acima: Buffer | null, saida: Buffer, o: number) {
  for (let i = 0; i < linha.length; i++) {
    const a = i >= 4 ? linha[i - 4] : 0, b = acima ? acima[i] : 0, c = acima && i >= 4 ? acima[i - 4] : 0;
    const x = linha[i];
    saida[o + i] = (f === 0 ? x : f === 1 ? x - a : f === 2 ? x - b : f === 3 ? x - ((a + b) >> 1) : x - paeth(a, b, c)) & 255;
  }
}

/**
 * BGRA pré-multiplicado → PNG RGBA (alfa direto). Desfazer a pré-multiplicação arredondando volta ao mesmo valor ao
 * refazê-la (o erro do arredondamento é ≤ ½ · a/255 < ½ para a < 255), então a referência é sem perda; a conta é
 * conferida pixel a pixel e um quadro que não volta igual (cor maior que o alfa) é recusado.
 */
export function paraPng(bgra: Buffer, largura: number, altura: number): Buffer {
  if (bgra.length !== largura * altura * 4) throw new Error(`quadro com ${bgra.length} bytes, esperado ${largura}×${altura}×4`);
  const rgba = Buffer.alloc(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    const a = bgra[i + 3];
    for (const [de, para] of [[2, 0], [1, 1], [0, 2]]) {
      const c = bgra[i + de];
      const u = a === 0 ? 0 : Math.round((c * 255) / a);
      if (u > 255 || Math.round((u * a) / 255) !== c) {
        throw new Error(`pixel ${(i / 4) % largura},${Math.floor(i / 4 / largura)} não é pré-multiplicado válido (cor ${c}, alfa ${a})`);
      }
      rgba[i + para] = u;
    }
    rgba[i + 3] = a;
  }
  // Filtro por linha: o de menor soma dos valores com sinal (a heurística da especificação do PNG).
  const passo = largura * 4, filtrado = Buffer.alloc((passo + 1) * altura), teste = Buffer.alloc(passo);
  for (let y = 0; y < altura; y++) {
    const linha = rgba.subarray(y * passo, (y + 1) * passo), acima = y ? rgba.subarray((y - 1) * passo, y * passo) : null;
    let melhor = 0, menor = Infinity;
    for (let f = 0; f < 5; f++) {
      filtrar(f, linha, acima, teste, 0);
      let soma = 0;
      for (let i = 0; i < passo && soma < menor; i++) soma += teste[i] < 128 ? teste[i] : 256 - teste[i];
      if (soma < menor) { menor = soma; melhor = f; }
    }
    filtrado[y * (passo + 1)] = melhor;
    filtrar(melhor, linha, acima, filtrado, y * (passo + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, deflate, filtro adaptativo, sem entrelaçamento
  return Buffer.concat([ASSINATURA, pedaco("IHDR", ihdr), pedaco("IDAT", deflateSync(filtrado, { level: 9 })), pedaco("IEND", Buffer.alloc(0))]);
}

/** PNG RGBA de 8 bits sem entrelaçamento (o que `paraPng` escreve) → BGRA pré-multiplicado. */
export function dePng(png: Buffer): { largura: number; altura: number; bgra: Buffer } {
  if (!png.subarray(0, 8).equals(ASSINATURA)) throw new Error("não é PNG");
  let o = 8, largura = 0, altura = 0;
  const idat: Buffer[] = [];
  while (o < png.length) {
    const n = png.readUInt32BE(o), tipo = png.toString("latin1", o + 4, o + 8), dados = png.subarray(o + 8, o + 8 + n);
    if ((crc32(dados, crc32(Buffer.from(tipo, "latin1"))) >>> 0) !== png.readUInt32BE(o + 8 + n)) throw new Error(`PNG corrompido (CRC do ${tipo})`);
    if (tipo === "IHDR") {
      largura = dados.readUInt32BE(0); altura = dados.readUInt32BE(4);
      if (dados[8] !== 8 || dados[9] !== 6 || dados[12] !== 0) throw new Error("só PNG RGBA de 8 bits sem entrelaçamento (o das referências)");
    } else if (tipo === "IDAT") idat.push(dados);
    else if (tipo === "IEND") break;
    o += 12 + n;
  }
  const passo = largura * 4, cru = inflateSync(Buffer.concat(idat));
  if (cru.length !== (passo + 1) * altura) throw new Error("PNG com tamanho de dados errado");
  const rgba = Buffer.alloc(passo * altura);
  for (let y = 0; y < altura; y++) {
    const f = cru[y * (passo + 1)], de = y * (passo + 1) + 1, l = y * passo;
    for (let i = 0; i < passo; i++) {
      const a = i >= 4 ? rgba[l + i - 4] : 0, b = y ? rgba[l - passo + i] : 0, c = y && i >= 4 ? rgba[l - passo + i - 4] : 0;
      const x = cru[de + i];
      rgba[l + i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
  }
  const bgra = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    bgra[i] = Math.round((rgba[i + 2] * a) / 255);
    bgra[i + 1] = Math.round((rgba[i + 1] * a) / 255);
    bgra[i + 2] = Math.round((rgba[i] * a) / 255);
    bgra[i + 3] = a;
  }
  return { largura, altura, bgra };
}

/** Maior diferença por canal (níveis, 0 a 255) e quantos pixels têm alguma diferença. */
export function diferenca(a: Buffer, b: Buffer): { nivel: number; pixels: number } {
  if (a.length !== b.length) throw new Error(`quadros de tamanhos diferentes (${a.length} e ${b.length} bytes)`);
  let nivel = 0, pixels = 0;
  for (let i = 0; i < a.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(a[i + k] - b[i + k]));
    if (d) { pixels++; if (d > nivel) nivel = d; }
  }
  return { nivel, pixels };
}

/**
 * Imagem da diferença, ampliada: a referência apagada (cinza a 25 %) ao fundo e, por cima, em vermelho, a diferença
 * de cada pixel multiplicada por `ampliar` (1 nível já aparece). BGRA opaco, para o `paraPng`.
 */
export function imagemDiferenca(ref: Buffer, atual: Buffer, ampliar = 32): Buffer {
  const saida = Buffer.alloc(ref.length);
  for (let i = 0; i < ref.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(ref[i + k] - atual[i + k]));
    const cinza = Math.round((ref[i] * 0.114 + ref[i + 1] * 0.587 + ref[i + 2] * 0.299) / 4);
    if (d) { saida[i] = 0; saida[i + 1] = 0; saida[i + 2] = Math.min(255, 64 + d * ampliar); }
    else saida[i] = saida[i + 1] = saida[i + 2] = cinza;
    saida[i + 3] = 255;
  }
  return saida;
}

/**
 * SSIM (o «All» do filtro ssim do ffmpeg) das duas imagens compostas sobre `fundo`, desfeita a pré-multiplicação: o
 * mesmo grafo do diferenca.mjs do M04. O ffmpeg do sistema já é pré-requisito do motor.
 */
export function ssim(a: Buffer, b: Buffer, largura: number, altura: number, fundo: Regua["fundo"] = "gray"): number {
  const pasta = mkdtempSync(join(tmpdir(), "motor-ssim-"));
  try {
    const fa = join(pasta, "a.bgra"), fb = join(pasta, "b.bgra");
    writeFileSync(fa, a); writeFileSync(fb, b);
    const entrada = (f: string) => ["-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${largura}x${altura}`, "-i", f];
    const grafo = "[0]unpremultiply=inplace=1[a0];[1]unpremultiply=inplace=1[b0];[2]split[g1][g2];"
      + "[g1][a0]overlay=format=auto,format=rgb24[a];[g2][b0]overlay=format=auto,format=rgb24[b];[a][b]ssim=stats_file=-";
    const saida = execFileSync("ffmpeg", ["-v", "error", ...entrada(fa), ...entrada(fb), "-f", "lavfi", "-i",
      `color=c=${fundo}:s=${largura}x${altura}`, "-filter_complex", grafo, "-frames:v", "1", "-f", "null", "-"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const s = Number(/All:([0-9.]+)/.exec(saida)?.[1]);
    if (!Number.isFinite(s)) throw new Error(`ffmpeg não deu o SSIM: ${saida.slice(0, 200)}`);
    return s;
  } finally { rmSync(pasta, { recursive: true, force: true }); }
}

export const dentroDaRegua = (m: { nivel: number; ssim: number }, r: Regua) => (r.nivel === null || m.nivel <= r.nivel) && m.ssim >= r.ssim;

const tempoMs = (t: string): number | null => {
  const m = /^(-?(?:\d+\.?\d*|\.\d+))(ms|s)$/.exec(t.trim());
  return m ? Number(m[1]) * (m[2] === "s" ? 1000 : 1) : null;
};

/**
 * Quadros de início e de fim das animações que a página declara com valores literais (linha do tempo, P10): o
 * `animation:` (e `animation-duration`/`-delay`/`-iteration-count`) do CSS em `<style>` e em `style="…"`, e o
 * `element.animate(…, { delay, duration, iterations })` com números escritos no código. O que é calculado (variável,
 * template) ou repete para sempre fica de fora: é amostragem, não prova. O quadro de início é o primeiro com
 * t ≥ delay e o de fim, o primeiro com t ≥ delay + duração × repetições, os dois dentro de 0…quadros − 1.
 */
export function marcosDaLinha(html: string, qps: number, quadros: number): number[] {
  const semComentario = html.replace(/<!--[\s\S]*?-->/g, "");
  const intervalos: [number, number][] = [];
  const somar = (delay: number, duracao: number, repeticoes: number) => {
    if (Number.isFinite(delay) && Number.isFinite(duracao) && duracao >= 0 && Number.isFinite(repeticoes)) intervalos.push([delay, delay + duracao * repeticoes]);
  };
  // CSS: declarações dentro de <style> e de style="…".
  const css = [...semComentario.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1])
    .concat([...semComentario.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1]))
    .join(";").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const regra of css.split(/[{}]/)) {
    const decl = new Map<string, string>();
    for (const d of regra.split(";")) {
      const i = d.indexOf(":");
      if (i > 0) decl.set(d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim());
    }
    const curta = decl.get("animation");
    if (curta) {
      // Sem as funções (cubic-bezier(…), steps(…)), as vírgulas que sobram separam as animações.
      for (const parte of curta.replace(/[\w-]+\([^)]*\)/g, " ").split(",")) {
        const fichas = parte.trim().split(/\s+/);
        const tempos = fichas.map(tempoMs).filter((t): t is number => t !== null);
        const rep = fichas.find((f) => /^(\d+\.?\d*|infinite)$/.test(f));
        if (tempos.length) somar(tempos[1] ?? 0, tempos[0], rep === undefined ? 1 : rep === "infinite" ? Infinity : Number(rep));
      }
    }
    const dur = decl.get("animation-duration");
    if (dur && decl.has("animation-name")) {
      const rep = decl.get("animation-iteration-count");
      somar(tempoMs(decl.get("animation-delay") ?? "0s") ?? NaN, tempoMs(dur) ?? NaN, rep === undefined ? 1 : rep === "infinite" ? Infinity : Number(rep));
    }
  }
  // JS: element.animate(keyframes, opções) com números literais.
  const scripts = [...semComentario.matchAll(/<script\b(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");
  for (const m of scripts.matchAll(/\.animate\(\s*\[[\s\S]*?\]\s*,\s*(\{[^{}]*\}|\d+(?:\.\d+)?)\s*\)/g)) {
    if (/^\d/.test(m[1])) { somar(0, Number(m[1]), 1); continue; }
    const campo = (nome: string) => {
      const c = new RegExp(`\\b${nome}\\s*:\\s*([^,}]+)`).exec(m[1]);
      return c ? (c[1].trim() === "Infinity" ? Infinity : /^-?\d+(\.\d+)?$/.test(c[1].trim()) ? Number(c[1]) : NaN) : undefined;
    };
    somar(campo("delay") ?? 0, campo("duration") ?? NaN, campo("iterations") ?? 1);
  }
  const quadro = (ms: number) => Math.min(quadros - 1, Math.max(0, Math.ceil(Math.round((ms * qps) / 1000 * 1e6) / 1e6)));
  return [...new Set(intervalos.flatMap(([i, f]) => [quadro(i), quadro(f)]))].sort((a, b) => a - b);
}

/** Amostragem automática: o primeiro, o último, um a cada `cada` e os `marcos`, sem repetir, em ordem. */
export function amostrar(quadros: number, cada: number, marcos: number[] = []): number[] {
  const s = new Set([0, quadros - 1, ...marcos.filter((n) => n >= 0 && n < quadros)]);
  for (let n = 0; n < quadros; n += cada) s.add(n);
  return [...s].sort((a, b) => a - b);
}
