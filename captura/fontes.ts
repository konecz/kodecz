// Fontes do Google no render (adr.md, seção 9): saem de um cache local fora do repositório (R01: a lista de fontes é
// da composição). A que faltar no cache é baixada uma vez, com o user-agent do navegador (o CSS do Google muda com
// ele), e gravada; daí em diante, o render dela não vai à rede. Sem rede, o render cai já no primeiro pedido, com a
// URL e o motivo. `preparar: false` (M04_FONTES=cache) é o modo estrito: fonte fora do cache derruba o render.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const HOSTS_FONTES = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

export class ErroDeFonte extends Error {}

type Buscar = (url: string, opcoes: { headers: Record<string, string> }) => Promise<Response>;
export type OpcoesFontes = { cache: string; preparar: boolean; buscar: Buscar; userAgent: () => string };
export type Fonte = { corpo: Buffer; tipo: string; origem: 'cache' | 'rede' };

const chave = (cache: string, url: string) => join(cache, createHash('sha256').update(url).digest('hex'));

/** O que está no cache para `url`, ou null (ausente, sem índice ou com o índice estragado: vale como fora do cache). */
function doCache(k: string): Fonte | null {
  try {
    const { tipo, bytes } = JSON.parse(readFileSync(`${k}.json`, 'utf8'));
    const corpo = readFileSync(`${k}.corpo`);
    if (typeof tipo !== 'string' || (Number.isInteger(bytes) && bytes !== corpo.length)) return null;
    return { corpo, tipo, origem: 'cache' };
  } catch { return null; }
}

/** Grava por renomeação, com nome temporário próprio: renders em paralelo e um render interrompido no meio não deixam
 *  arquivo pela metade. O corpo vai antes do índice, que é o que torna a fonte visível no cache. */
function gravar(destino: string, dados: Buffer | string) {
  const tmp = `${destino}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try { writeFileSync(tmp, dados); renameSync(tmp, destino); } finally { rmSync(tmp, { force: true }); }
}

/** A fonte de `url`, do cache ou (com `preparar`) da rede, gravada no cache. Qualquer falha vira ErroDeFonte, com a
 *  URL e a instrução: o render não segue com a fonte de reserva. */
export async function obterFonte(url: string, o: OpcoesFontes): Promise<Fonte> {
  const k = chave(o.cache, url);
  const salva = doCache(k);
  if (salva) return salva;
  if (!o.preparar) throw new ErroDeFonte(`fonte fora do cache (${o.cache}): ${url} — rode uma vez com rede, pelo comando de render sem M04_FONTES=cache (ou com M04_FONTES=preparar)`);
  let corpo: Buffer, tipo: string;
  try {
    const r = await o.buscar(url, { headers: { 'user-agent': o.userAgent() } });
    if (!r.ok) throw new ErroDeFonte(`fonte fora do cache (${o.cache}): ${url} respondeu ${r.status}`);
    corpo = Buffer.from(await r.arrayBuffer());
    tipo = r.headers.get('content-type') ?? 'application/octet-stream';
  } catch (erro) {
    if (erro instanceof ErroDeFonte) throw erro;
    const causa = (erro as Error & { cause?: Error }).cause?.message ?? (erro as Error).message;
    throw new ErroDeFonte(`fonte fora do cache (${o.cache}) e sem rede para baixá-la: ${url} (${causa}). Rode uma vez com rede; depois o render dela não precisa de rede`);
  }
  try {
    mkdirSync(o.cache, { recursive: true });
    gravar(`${k}.corpo`, corpo);
    gravar(`${k}.json`, JSON.stringify({ url, tipo, bytes: corpo.length }));
  } catch (erro) {
    throw new ErroDeFonte(`fonte baixada, mas não gravada no cache (${o.cache}): ${url} (${(erro as Error).message})`);
  }
  return { corpo, tipo, origem: 'rede' };
}
