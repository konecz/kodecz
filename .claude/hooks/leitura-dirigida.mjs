// Hook PreToolUse (Bash e Read): barra a leitura inteira de arquivo grande (CLAUDE.md, "Gestão do contexto").
// O que é lido fica no contexto até o /clear e é relido a cada chamada: medido em 2026-10-13, arquivos lidos
// inteiros com cat foram 33% dos tokens das sessões de tarefa. Arquivo pequeno, leitura com limite e cat filtrado
// por pipe passam.

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const LIMITE_LINHAS = 300;
const TEXTO = /\.(rs|toml|tsx?|m?js|cjs|md|json|css|ya?ml|sql|txt|csv|xml|html|env|log|lock)$/i;
const COMO_LER = 'Localize com `grep -n` e leia só o intervalo (`sed -n A,Bp` ou Read com offset e limit); '
    + 'para mapear uma área desconhecida, use o subagente Explore, que devolve só a conclusão.';

// Palavras do comando, com o caminho entre aspas inteiro e sem as aspas.
const palavras = (trecho) => (trecho.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((t) => t.replace(/^(['"])(.*)\1$/, '$2'));

// contarLinhas(arquivo, pasta): pasta é o destino do último `cd` do comando, ou '' para a pasta da sessão.
export function motivoBash(comando, contarLinhas) {
    // O corpo de um heredoc é texto, não comando; descartar erro (2>/dev/null) não é gravar em arquivo.
    const semHeredoc = String(comando).replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, '<<heredoc');
    let pasta = '';
    // Cada comando encadeado (&&, ||, ;, quebra de linha); dentro dele, o cat só conta se não houver pipe depois.
    for (const trecho of semHeredoc.split(/&&|\|\||;|\n/)) {
        const estagios = trecho.split('|');
        const tokens = palavras(estagios[0].replace(/\d?>\s*\/dev\/null|\d>&\d/g, ''));
        if (tokens[0] === 'cd' && tokens[1]) {
            pasta = tokens[1].startsWith('/') || !pasta ? tokens[1] : `${pasta}/${tokens[1]}`;
            continue;
        }
        if (tokens[0] !== 'cat' || estagios.length > 1 || tokens.some((t) => /^[<>]/.test(t))) continue;
        const arquivos = tokens.slice(1).filter((t) => !t.startsWith('-'));
        const contados = arquivos.map((a) => [a, contarLinhas(a, pasta)]).filter(([, n]) => n !== null);
        const total = contados.reduce((soma, [, n]) => soma + n, 0);
        if (total > LIMITE_LINHAS) {
            const lista = contados.map(([a, n]) => `${a} (${n} linhas)`).join(', ');
            return `cat de ${total} linhas: ${lista}. ${COMO_LER}`;
        }
    }

    return null;
}

export function motivoRead(entrada, contarLinhas) {
    const arquivo = entrada?.file_path;
    if (!arquivo || entrada.limit || entrada.offset || !TEXTO.test(arquivo)) return null;
    const n = contarLinhas(arquivo);

    return n !== null && n > LIMITE_LINHAS ? `Read sem limite de ${arquivo} (${n} linhas). ${COMO_LER}` : null;
}

if (!process.env.VITEST) {
    let entrada = {};
    try {
        entrada = JSON.parse(readFileSync(0, 'utf8'));
    } catch {
        process.exit(0);
    }
    const cwd = entrada.cwd ?? process.cwd();
    const contarLinhas = (arquivo, pasta = '') => {
        try {
            const conteudo = readFileSync(path.resolve(cwd, pasta, arquivo), 'utf8');

            return conteudo.split('\n').length - (conteudo.endsWith('\n') ? 1 : 0);
        } catch {
            return null;
        }
    };
    const motivo = entrada.tool_name === 'Read' ? motivoRead(entrada.tool_input, contarLinhas) : motivoBash(entrada.tool_input?.command ?? '', contarLinhas);
    if (motivo) {
        process.stderr.write(`Leitura barrada pelo hook do projeto (CLAUDE.md, "Gestão do contexto"): ${motivo}`);
        process.exit(2);
    }
}
