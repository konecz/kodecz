// Fontes do Google no render (captura/fontes.ts): do cache; a que faltar, da rede uma vez; sem rede, erro com a URL.
// Sem rede de verdade: o fetch é falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErroDeFonte, obterFonte } from './fontes.ts';

const URL_CSS = 'https://fonts.googleapis.com/css2?family=Sintetica';
const pasta = () => mkdtempSync(join(tmpdir(), 'fontes-'));
function buscarFalso(resposta: () => Response | Promise<Response>) {
  const pedidos: { url: string; ua: string }[] = [];
  const buscar = async (url: string, o: { headers: Record<string, string> }) => { pedidos.push({ url, ua: o.headers['user-agent'] }); return resposta(); };
  return { buscar, pedidos };
}
const ua = () => 'Chrome/156 sintetico';

test('fora do cache: baixa uma vez com o user-agent do navegador e grava; a segunda sai do cache', async () => {
  const cache = pasta();
  try {
    const { buscar, pedidos } = buscarFalso(() => new Response('@font-face{}', { headers: { 'content-type': 'text/css' } }));
    const a = await obterFonte(URL_CSS, { cache, preparar: true, buscar, userAgent: ua });
    assert.equal(a.origem, 'rede');
    assert.equal(a.tipo, 'text/css');
    assert.deepEqual(pedidos, [{ url: URL_CSS, ua: 'Chrome/156 sintetico' }]);
    const b = await obterFonte(URL_CSS, { cache, preparar: true, buscar, userAgent: ua });
    assert.equal(b.origem, 'cache');
    assert.equal(b.corpo.toString(), '@font-face{}');
    assert.equal(b.tipo, 'text/css');
    assert.equal(pedidos.length, 1, 'a segunda foi à rede');
    // O modo estrito lê o que já está no cache.
    const c = await obterFonte(URL_CSS, { cache, preparar: false, buscar, userAgent: ua });
    assert.equal(c.origem, 'cache');
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

test('modo estrito (M04_FONTES=cache): fora do cache derruba com a instrução, sem ir à rede nem gravar', async () => {
  const cache = pasta();
  try {
    const { buscar, pedidos } = buscarFalso(() => new Response('x'));
    await assert.rejects(obterFonte(URL_CSS, { cache, preparar: false, buscar, userAgent: ua }),
      (e: Error) => e instanceof ErroDeFonte && /fonte fora do cache/.test(e.message) && e.message.includes(URL_CSS) && /com rede/.test(e.message));
    assert.equal(pedidos.length, 0);
    assert.deepEqual(readdirSync(cache), []);
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

test('sem rede: erro claro com a URL e a causa, nada gravado', async () => {
  const cache = pasta();
  try {
    const { buscar } = buscarFalso(() => { throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND fonts.googleapis.com') }); });
    await assert.rejects(obterFonte(URL_CSS, { cache, preparar: true, buscar, userAgent: ua }),
      (e: Error) => e instanceof ErroDeFonte && /^fonte fora do cache/.test(e.message) && /sem rede/.test(e.message)
        && e.message.includes(URL_CSS) && /ENOTFOUND/.test(e.message));
    assert.deepEqual(readdirSync(cache), []);
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

test('resposta de erro do Google (404): erro com o código, nada gravado', async () => {
  const cache = pasta();
  try {
    const { buscar } = buscarFalso(() => new Response('não achou', { status: 404 }));
    await assert.rejects(obterFonte(URL_CSS, { cache, preparar: true, buscar, userAgent: ua }),
      (e: Error) => e instanceof ErroDeFonte && /404/.test(e.message) && e.message.includes(URL_CSS));
    assert.deepEqual(readdirSync(cache), []);
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

test('a conexão cai no meio do corpo: ErroDeFonte com a URL, nada gravado', async () => {
  const cache = pasta();
  try {
    const corpo = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.error(new Error('ECONNRESET')); } });
    const { buscar } = buscarFalso(() => new Response(corpo, { headers: { 'content-type': 'font/woff2' } }));
    await assert.rejects(obterFonte(URL_CSS, { cache, preparar: true, buscar, userAgent: ua }),
      (e: Error) => e instanceof ErroDeFonte && e.message.includes(URL_CSS) && /ECONNRESET/.test(e.message));
    assert.deepEqual(readdirSync(cache), []);
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

test('índice estragado ou corpo sem índice: vale como fora do cache (estrito derruba; preparar baixa de novo)', async () => {
  const cache = pasta();
  try {
    const { buscar, pedidos } = buscarFalso(() => new Response('@font-face{}', { headers: { 'content-type': 'text/css' } }));
    await obterFonte(URL_CSS, { cache, preparar: true, buscar, userAgent: ua });
    const indice = readdirSync(cache).find((f) => f.endsWith('.json'))!;
    writeFileSync(join(cache, indice), '{"tipo":"te');
    await assert.rejects(obterFonte(URL_CSS, { cache, preparar: false, buscar, userAgent: ua }), ErroDeFonte);
    assert.equal((await obterFonte(URL_CSS, { cache, preparar: true, buscar, userAgent: ua })).origem, 'rede');
    rmSync(join(cache, indice));
    assert.equal((await obterFonte(URL_CSS, { cache, preparar: true, buscar, userAgent: ua })).origem, 'rede');
    assert.equal(pedidos.length, 3);
    assert.equal((await obterFonte(URL_CSS, { cache, preparar: false, buscar, userAgent: ua })).origem, 'cache');
    assert.deepEqual(readdirSync(cache).filter((f) => f.endsWith('.tmp')), []);
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

test('cache sem permissão de escrita: ErroDeFonte dizendo que não gravou', { skip: process.getuid?.() === 0 ? 'root escreve em tudo' : false }, async () => {
  const cache = pasta();
  try {
    chmodSync(cache, 0o500);
    const { buscar } = buscarFalso(() => new Response('x', { headers: { 'content-type': 'text/css' } }));
    await assert.rejects(obterFonte(URL_CSS, { cache, preparar: true, buscar, userAgent: ua }),
      (e: Error) => e instanceof ErroDeFonte && /não gravada no cache/.test(e.message) && e.message.includes(URL_CSS));
  } finally { chmodSync(cache, 0o700); rmSync(cache, { recursive: true, force: true }); }
});

test('dois renders baixando a mesma fonte ao mesmo tempo: os dois recebem, o cache fica inteiro', async () => {
  const cache = pasta();
  try {
    const { buscar } = buscarFalso(async () => { await new Promise((ok) => setTimeout(ok, 5)); return new Response('@font-face{}', { headers: { 'content-type': 'text/css' } }); });
    const [a, b] = await Promise.all([1, 2].map(() => obterFonte(URL_CSS, { cache, preparar: true, buscar, userAgent: ua })));
    assert.equal(a.corpo.toString(), '@font-face{}');
    assert.equal(b.corpo.toString(), '@font-face{}');
    assert.equal(readdirSync(cache).length, 2);
    assert.equal((await obterFonte(URL_CSS, { cache, preparar: false, buscar, userAgent: ua })).origem, 'cache');
  } finally { rmSync(cache, { recursive: true, force: true }); }
});
