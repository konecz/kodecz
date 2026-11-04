// legenda-uma-linha (H01): largura do texto fora do navegador, pelas métricas do próprio arquivo da fonte (TrueType ou
// OpenType sem compressão): `cmap` (caractere → glifo), `hmtx` (avanço de cada glifo) e `head` (unidades por em).
// Sem dependência (R02). Não lê o `kern` nem o `GPOS`: o par de kerning quase sempre aperta o texto, então a largura
// daqui fica igual ou um pouco maior que a do Chromium (o lado seguro para «nunca passa da linha»). WOFF, WOFF2 e
// coleção (.ttc) não abrem: quem chama cai na estimativa por largura média em em (`estimativa`).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

export interface Medidor {
  /** Largura em px do texto no tamanho dado (px), com o espaçamento entre letras em em (CSS letter-spacing). */
  largura(texto: string, tamanho: number, espacamentoEm?: number): number;
  /** De onde veio a medida: o nome do arquivo da fonte (sem a pasta) ou a estimativa. */
  origem: string;
}

/** Abre o arquivo da fonte e devolve o medidor; erro se não for TrueType/OpenType sem compressão. */
export function abrirFonte(arquivo: string): Medidor {
  const b = readFileSync(arquivo);
  const tipo = b.readUInt32BE(0);
  if (tipo !== 0x00010000 && tipo !== 0x4f54544f && tipo !== 0x74727565) throw new Error(`${arquivo}: não é TrueType/OpenType sem compressão`);
  const tabelas = new Map<string, number>();
  for (let i = 0, n = b.readUInt16BE(4); i < n; i++) {
    const r = 12 + 16 * i;
    tabelas.set(b.toString("latin1", r, r + 4), b.readUInt32BE(r + 8));
  }
  const tabela = (t: string) => {
    const o = tabelas.get(t);
    if (o === undefined) throw new Error(`${arquivo}: sem a tabela ${t}`);
    return o;
  };
  const unidades = b.readUInt16BE(tabela("head") + 18);
  const metricas = b.readUInt16BE(tabela("hhea") + 34);
  const hmtx = tabela("hmtx");
  const avancoDoGlifo = (g: number) => b.readUInt16BE(hmtx + 4 * Math.min(g, metricas - 1));
  const glifo = lerCmap(b, tabela("cmap"), arquivo);
  const cache = new Map<number, number>();
  const avanco = (cp: number) => {
    let a = cache.get(cp);
    if (a === undefined) cache.set(cp, (a = avancoDoGlifo(glifo(cp))));
    return a;
  };
  return {
    origem: `métricas de ${basename(arquivo)}`,
    largura(texto, tamanho, espacamentoEm = 0) {
      let u = 0, n = 0;
      for (const c of texto) { u += avanco(c.codePointAt(0)!); n++; }
      return (u / unidades) * tamanho + n * espacamentoEm * tamanho;
    },
  };
}

/** O `cmap` Unicode da fonte: formato 12 (3/10 ou 0/4) se houver, senão formato 4 (3/1 ou 0/3). */
function lerCmap(b: Buffer, cmap: number, arquivo: string): (cp: number) => number {
  const subtabelas: { plataforma: number; codificacao: number; o: number }[] = [];
  for (let i = 0, n = b.readUInt16BE(cmap + 2); i < n; i++) {
    const r = cmap + 4 + 8 * i;
    subtabelas.push({ plataforma: b.readUInt16BE(r), codificacao: b.readUInt16BE(r + 2), o: cmap + b.readUInt32BE(r + 4) });
  }
  const f12 = subtabelas.find((s) => b.readUInt16BE(s.o) === 12 && (s.plataforma === 0 || (s.plataforma === 3 && s.codificacao === 10)));
  if (f12) {
    const grupos = b.readUInt32BE(f12.o + 12);
    return (cp) => {
      let lo = 0, hi = grupos - 1;
      while (lo <= hi) {
        const m = (lo + hi) >> 1, r = f12.o + 16 + 12 * m;
        const ini = b.readUInt32BE(r), fim = b.readUInt32BE(r + 4);
        if (cp < ini) hi = m - 1; else if (cp > fim) lo = m + 1; else return b.readUInt32BE(r + 8) + cp - ini;
      }
      return 0;
    };
  }
  const f4 = subtabelas.find((s) => b.readUInt16BE(s.o) === 4 && (s.plataforma === 0 || (s.plataforma === 3 && s.codificacao === 1)));
  if (!f4) throw new Error(`${arquivo}: sem cmap Unicode (formato 4 ou 12)`);
  const o = f4.o, seg = b.readUInt16BE(o + 6) / 2;
  const fins = o + 14, inis = fins + 2 * seg + 2, deltas = inis + 2 * seg, offs = deltas + 2 * seg;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let i = 0; i < seg; i++) {
      if (cp > b.readUInt16BE(fins + 2 * i)) continue;
      const ini = b.readUInt16BE(inis + 2 * i);
      if (cp < ini) return 0;
      const delta = b.readInt16BE(deltas + 2 * i), off = b.readUInt16BE(offs + 2 * i);
      if (off === 0) return (cp + delta) & 0xffff;
      const g = b.readUInt16BE(offs + 2 * i + off + 2 * (cp - ini));
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
}

/** Medidor por largura média: cada caractere vale `larguraEm` em (o aprovado usava 0,58 a 0,62, conforme a fonte). */
export function estimativa(larguraEm: number): Medidor {
  return {
    origem: `estimativa de ${larguraEm} em por caractere`,
    largura: (texto, tamanho, espacamentoEm = 0) => [...texto].length * (larguraEm + espacamentoEm) * tamanho,
  };
}

const PESOS: Record<number, string> = { 100: "thin", 200: "extralight", 300: "light", 400: "regular", 500: "medium",
  600: "semibold", 700: "bold", 800: "extrabold", 900: "black" };

/**
 * O arquivo da família e do peso pelo fontconfig (o mesmo que o Chromium do motor usa para achar a fonte), ou null se
 * o fontconfig não acha essa família (ele devolveria outra no lugar) ou não está instalado.
 */
export function arquivoDaFonte(familia: string, peso: number): string | null {
  const nome = PESOS[Math.round(peso / 100) * 100] ?? "regular";
  try {
    const [familias, arquivo] = execFileSync("fc-match", ["-f", "%{family}|%{file}", `${familia}:${nome}`], { encoding: "utf8" }).split("|");
    const achou = familias.split(",").some((f) => f.trim().toLowerCase() === familia.trim().toLowerCase());
    return achou && arquivo ? arquivo : null;
  } catch {
    return null;
  }
}
