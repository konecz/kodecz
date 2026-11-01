// Kodecz Bench (P12): a rodada de rótulos do responsável para as classes de proxy (as «automática, a calibrar»). Pares
// A/B (a base × a mutação da classe, em ordem sorteada), num HTML local e autocontido com os dois quadros ou vídeos lado
// a lado e a pergunta «qual está melhor?»; as respostas saem num JSON. Uma classe de proxy passa a «automática» quando
// a escolha do responsável concorda em ≥ 90 % com a regra (a base é a melhor).
//
//   node bench-gerador/rotulos.ts html [--pares 50] [--semente 3] [--saida tmp/rotulos-ab.html]   # na placa (renders do cache)
//   node bench-gerador/rotulos.ts conferir <respostas.json>                                        # concordância por classe
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { RAIZ } from "./catalogo.ts";
import { casosDe } from "./provar.ts";
import { cenaDe, evidenciaDe, lerEspecificacoes } from "./provas.ts";

/** As classes de proxy mais discutíveis (o plano de 2026-11-01). */
export const PROXIES = ["K-IA-01", "K-IA-02", "K-IA-03", "K-IA-04", "K-IA-05", "K-IA-06", "K-IA-07", "K-IA-08", "K-IA-10", "K-IA-11", "K-IA-12", "K-IA-13",
  "K-DES-01", "K-DES-03", "K-DES-05", "K-DES-06", "K-DES-10", "K-DES-11", "K-EDI-04", "K-EDI-07", "K-ANI-03"];
/** Classes de movimento: o par vai em vídeo curto, não em quadro. */
const EM_VIDEO = new Set(["K-EDI-04", "K-EDI-07", "K-ANI-03"]);
export const CONCORDANCIA_MINIMA = 0.9;

function sorteio(semente: number) {
  let a = semente >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Um quadro (JPEG) ou um trecho (MP4 de 360 px) do render, em base64. */
function midia(mp4: string, video: boolean, quadro: number, qps: number): string {
  const args = video ? ["-ss", String(Math.max(0, quadro / qps - 1)), "-t", "4", "-i", mp4, "-vf", "scale=-2:360", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-an", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "-"]
    : ["-i", mp4, "-vf", `select=eq(n\\,${quadro}),scale=-2:540`, "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "-q:v", "4", "-"];
  const r = spawnSync("ffmpeg", ["-v", "error", ...args], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  return `data:${video ? "video/mp4" : "image/jpeg"};base64,${r.stdout.toString("base64")}`;
}

/** O quadro em que dois MP4 mais diferem (cinza, 96 px de largura). */
function maisDiferente(a: string, b: string): number {
  const cinza = (arq: string) => spawnSync("ffmpeg", ["-v", "error", "-i", arq, "-vf", "scale=96:-2:flags=area,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 30 }).stdout as Buffer;
  const A = cinza(a), B = cinza(b);
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", a], { encoding: "utf8" });
  const [w, h] = r.stdout.trim().split(",").map(Number), t = 96 * (Math.round((h * 96) / w / 2) * 2);
  let melhor = 0, mx = -1;
  for (let k = 0; (k + 1) * t <= Math.min(A.length, B.length); k++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Math.abs(A[k * t + i] - B[k * t + i]);
    if (s > mx) { mx = s; melhor = k; }
  }
  return melhor;
}

async function html(o: { pares: number; semente: number; saida: string }) {
  const es = lerEspecificacoes(), r = sorteio(o.semente);
  const classes = PROXIES.filter((c) => es[c] && !es[c].rodada);
  const pares: { par: number; classe: string; caso: string; a: string; b: string; errada: "a" | "b"; video: boolean }[] = [];
  for (let k = 0; pares.length < o.pares && k < 10; k++) for (const c of classes) {
    if (pares.length >= o.pares) break;
    const caso = casosDe(c, 12)[k];
    if (!caso) continue;
    const base = await evidenciaDe(cenaDe(caso, es[c], "base"));
    const errada = await evidenciaDe(cenaDe(caso, es[c], "errada"), { antes: base });
    if (!base.mp4 || !errada.mp4) continue;
    const video = EM_VIDEO.has(c);
    // O quadro: o em que a base e a mutação mais diferem na imagem.
    const q = maisDiferente(base.mp4, errada.mp4);
    const mb = midia(base.mp4, video, q, base.tarefa.qps), me = midia(errada.mp4, video, q, errada.tarefa.qps);
    const lado = r() < 0.5 ? "a" : "b";
    pares.push({ par: pares.length + 1, classe: c, caso: caso.id, a: lado === "a" ? me : mb, b: lado === "a" ? mb : me, errada: lado, video });
    process.stderr.write(`  par ${pares.length}: ${c} ${caso.id}\n`);
  }
  // A chave (qual lado é a mutação) vai cifrada simples no HTML, para não aparecer na tela; volta no JSON exportado.
  const chave = pares.map((p) => ({ par: p.par, classe: p.classe, caso: p.caso, k: Buffer.from(p.errada === "a" ? "1" : "2").toString("base64") }));
  const blocos = pares.map((p) => {
    const m = (src: string) => p.video ? `<video src="${src}" controls loop muted playsinline></video>` : `<img src="${src}" alt="">`;
    return `<section class="par" data-par="${p.par}"><h2>Par ${p.par}</h2><div class="lado"><figure>${m(p.a)}<figcaption>A</figcaption></figure><figure>${m(p.b)}<figcaption>B</figcaption></figure></div>
<fieldset><legend>Qual está melhor?</legend><label><input type="radio" name="p${p.par}" value="A"> A</label><label><input type="radio" name="p${p.par}" value="B"> B</label><label><input type="radio" name="p${p.par}" value="igual"> Tanto faz</label>
<input type="text" name="n${p.par}" placeholder="comentário (opcional)"></fieldset></section>`;
  }).join("\n");
  const pagina = `<!doctype html>
<html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rótulos A/B do bench</title>
<style>
:root { --fundo: #f7f4ec; --tinta: #1b1f2a; --linha: #d8d2c4; --acento: #2e86ab; }
@media (prefers-color-scheme: dark) { :root { --fundo: #15181f; --tinta: #eceae4; --linha: #333846; --acento: #6fb6d6; } }
body { margin: 0; background: var(--fundo); color: var(--tinta); font: 16px/1.5 system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 16px; }
.par { border-top: 1px solid var(--linha); padding: 16px 0; }
.lado { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 640px) { .lado { grid-template-columns: 1fr; } }
figure { margin: 0; } img, video { width: 100%; height: auto; max-height: 70vh; object-fit: contain; background: #000; border-radius: 6px; }
figcaption { text-align: center; font-weight: 700; }
fieldset { border: 0; display: flex; flex-wrap: wrap; gap: 16px; align-items: center; padding: 8px 0; }
input[type=text] { flex: 1; min-width: 200px; padding: 6px; }
button { background: var(--acento); color: #fff; border: 0; padding: 10px 18px; border-radius: 6px; font-size: 16px; cursor: pointer; }
.fixo { position: sticky; top: 0; background: var(--fundo); padding: 8px 0; border-bottom: 1px solid var(--linha); display: flex; gap: 16px; align-items: center; }
</style>
<main>
<h1>Qual está melhor?</h1>
<p>${pares.length} pares de vídeos sintéticos do bench (marca fictícia). Em cada par, escolha o que está melhor; «tanto faz» quando não há diferença que importe. As respostas ficam salvas neste navegador; no fim, baixe o JSON.</p>
<div class="fixo"><button id="baixar">Baixar respostas (JSON)</button><span id="conta"></span></div>
${blocos}
</main>
<script>
const CHAVE = ${JSON.stringify(chave)};
const salvar = () => { try { const r = {}; for (const i of document.querySelectorAll('input')) { if (i.type === 'radio' ? i.checked : i.value) r[i.name] = i.value; } localStorage.setItem('rotulos-ab', JSON.stringify(r)); } catch {} conta(); };
const conta = () => { document.getElementById('conta').textContent = document.querySelectorAll('input[type=radio]:checked').length + ' de ' + CHAVE.length + ' respondidos'; };
try { const r = JSON.parse(localStorage.getItem('rotulos-ab') || '{}'); for (const i of document.querySelectorAll('input')) { if (i.type === 'radio') i.checked = r[i.name] === i.value; else if (r[i.name]) i.value = r[i.name]; } } catch {}
document.addEventListener('change', salvar); document.addEventListener('input', salvar); conta();
document.getElementById('baixar').onclick = () => {
  const respostas = CHAVE.map((c) => ({ par: c.par, classe: c.classe, caso: c.caso, mutacao: atob(c.k) === '1' ? 'A' : 'B',
    escolha: (document.querySelector('input[name=p' + c.par + ']:checked') || {}).value || null, comentario: (document.querySelector('input[name=n' + c.par + ']') || {}).value || '' }));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ geradoEm: ${JSON.stringify(new Date().toISOString().slice(0, 10))}, respostas }, null, 1)], { type: 'application/json' }));
  a.download = 'rotulos-ab-respostas.json'; a.click();
};
</script>
`;
  writeFileSync(o.saida, pagina);
  process.stdout.write(`${JSON.stringify({ saida: o.saida, pares: pares.length, bytes: Buffer.byteLength(pagina), classes: [...new Set(pares.map((p) => p.classe))] })}\n`);
}

/** Concordância por classe: o responsável escolheu a base (o lado sem a mutação). «Tanto faz» conta como discordância. */
export function concordancia(respostas: { classe: string; mutacao: "A" | "B"; escolha: string | null }[]) {
  const r: Record<string, { pares: number; concorda: number; fracao: number; automatica: boolean }> = {};
  for (const x of respostas) {
    if (!x.escolha) continue;
    r[x.classe] ??= { pares: 0, concorda: 0, fracao: 0, automatica: false };
    r[x.classe].pares++;
    if (x.escolha !== "igual" && x.escolha !== x.mutacao) r[x.classe].concorda++;
  }
  for (const v of Object.values(r)) { v.fracao = +(v.concorda / v.pares).toFixed(3); v.automatica = v.fracao >= CONCORDANCIA_MINIMA; }
  return r;
}

async function principal() {
  const [cmd, arq] = process.argv.slice(2);
  if (cmd === "conferir") { process.stdout.write(`${JSON.stringify(concordancia(JSON.parse(readFileSync(arq, "utf8")).respostas), null, 1)}\n`); return; }
  const { values: v } = parseArgs({ args: process.argv.slice(3), options: { pares: { type: "string", default: "50" }, semente: { type: "string", default: "3" }, saida: { type: "string", default: join(RAIZ, "tmp", "rotulos-ab.html") } } });
  await html({ pares: Number(v.pares), semente: Number(v.semente), saida: v.saida! });
}

if (import.meta.url === `file://${process.argv[1]}`) await principal();
