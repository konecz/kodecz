// Saída de verificação curta para as sessões de agentes (CLAUDE.md, "Continuidade entre sessões", custo).
// A saída completa vai para tmp/logs e volta só o resumo: no verde, as linhas de resultado; na falha, o fim da
// saída, onde estão a asserção, o arquivo:linha e o diff. O código de saída é o do comando.
//
//   node .claude/scripts/resumo.mjs <verificação do projeto (./verificar.sh)>

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MAXIMO_FALHA = 60;
const RESULTADO = /^\$ |\[porteiro\]|Result:|\d+ tests?, \d+ failures?|found no issues|issues?\b.*found|Finished in|^\s+[MAD?]{1,2} |^ ?\S.* \| +\d+ /;
const semCores = (texto) => texto.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

const args = process.argv.slice(2);
if (!args.length) {
    process.stderr.write('uso: node .claude/scripts/resumo.mjs <comando>\n');
    process.exit(2);
}

const r = spawnSync(args[0], args.slice(1), { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1', CARGO_TERM_COLOR: 'never' } });
const saida = semCores(`${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n[resumo] ${r.error.message}` : ''}`);
const codigo = r.status ?? 1;
const linhas = saida.split('\n').filter((l) => l.trim() && !/^[.*F]+$/.test(l.trim()));
process.stdout.write(`${(codigo === 0 ? linhas.filter((l) => RESULTADO.test(l)) : linhas.slice(-MAXIMO_FALHA)).join('\n')}\n`);

const log = path.join('tmp', 'logs', `resumo-${args.join('-').replace(/[^\w]+/g, '-').slice(0, 40)}.log`);
try {
    mkdirSync(path.dirname(log), { recursive: true });
    writeFileSync(log, saida);
    process.stdout.write(`log completo: ${log}\n`);
} catch {
    // fora do projeto: fica só o resumo
}
process.stdout.write(`saída=${codigo}\n`);
process.exit(codigo);
