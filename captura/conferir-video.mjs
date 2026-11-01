// M09: confere a marca do vídeo em todos os quadros de um render do main.mjs com M04_MARCA_VIDEO=1.
// Uso: node captura/conferir-video.mjs <rótulo.json> [--deslocamento k]
// Sai com 0 se todos os quadros pedidos trazem o quadro N + k do vídeo; 1 se algum traz outro; 2 se o render falhou
// ou algum quadro ficou sem a marca lida.
import { readFileSync } from 'node:fs';
import { conferirVideo } from './marca-video.ts';

const args = process.argv.slice(2);
const i = args.indexOf('--deslocamento');
const deslocamento = i >= 0 ? Number(args[i + 1]) : 0;
const { resumo, quadros } = JSON.parse(readFileSync(args[0], 'utf8'));
const r = conferirVideo(quadros, { deslocamento, total: resumo.pedidos });
for (const e of r.errados.slice(0, 10)) console.log(`quadro ${e.n}: vídeo ${e.video}, esperado ${e.esperado}`);
console.log(`vídeo: ${r.conferidos} quadros conferidos, ${r.errados.length} errados, ${r.faltando} sem marca (deslocamento ${deslocamento}, render ${resumo.motivo})`);
process.exit(resumo.motivo !== 'ok' || r.faltando ? 2 : r.errados.length ? 1 : 0);
