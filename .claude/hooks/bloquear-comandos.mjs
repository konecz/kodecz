// Hook PreToolUse: bloqueia comandos destrutivos e alterações diretas na main (CLAUDE.md, "Segurança e operação" e "Segurança e autonomia da IA").
// O CLAUDE.md pede; este hook garante. Se o responsável humano autorizar, ele mesmo roda o comando com `! comando`.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A mídia (vídeos dos clientes e renders aprovados) fica em ~/midia, fora do Git: apagar lá não tem volta.
const MIDIA_DESTRUTIVO = /\brm\b[^\n]*\bmidia\b/;

// Separa os comandos encadeados (&&, ||, ;, |, & e quebra de linha), sem quebrar 2>&1 nem &>.
const SEPARADORES = /&&|\|\||[;|\n]|(?<![>&])&(?!>)/;

// Textos entre aspas (mensagens de commit, por exemplo) não são comandos: viram marcadores, para não serem lidos
// como operadores, e `restaurar` devolve o texto quando ele é argumento de `cd` ou `git -C`.
function separarTextos(comando) {
    const textos = [];
    const texto = comando.replace(/"([^"]*)"|'([^']*)'/g, (_, duplas, simples) => {
        textos.push(duplas ?? simples);

        return `\0${textos.length - 1}\0`;
    });

    return { texto, restaurar: (token) => token.replace(/\0(\d+)\0/g, (_, n) => textos[n]) };
}

// Opções globais do git antes do subcomando. As que mudam o diretório (-C, --work-tree, --git-dir) valem para a branch.
const GIT_OPCAO_COM_VALOR = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path']);

function subcomandoGit(tokens, dir, restaurar = (t) => t) {
    const globais = [];
    let i = 1;
    while (tokens[i]?.startsWith('-')) {
        const igual = tokens[i].indexOf('=');
        const nome = igual === -1 ? tokens[i] : tokens[i].slice(0, igual);
        let valor = igual === -1 ? undefined : tokens[i].slice(igual + 1);
        if (igual === -1 && GIT_OPCAO_COM_VALOR.has(nome)) valor = tokens[++i];
        if (['-C', '--work-tree', '--git-dir'].includes(nome) && valor) dir = path.resolve(dir, restaurar(valor));
        globais.push(nome);
        i++;
    }

    return { git: tokens[i], args: tokens.slice(i + 1), dir, globais };
}

// Destinos (branches remotas) de um `git push`. O primeiro argumento posicional é o remoto; os demais, refspecs
// (`origem:destino`, `:destino` apaga; `+` força e `*` é curinga, ambos bloqueados). `HEAD` e `@` valem a branch do diretório do git.
// Sem refspec, devolve lista vazia: o push vai para a branch atual.
const PUSH_OPCAO_COM_VALOR = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);

function destinosDoPush(args, restaurar, branchAtual) {
    const posicionais = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('-')) {
            if (PUSH_OPCAO_COM_VALOR.has(args[i])) i++;
            continue;
        }
        posicionais.push(restaurar(args[i]));
    }

    // Com `--repo`, o remoto vem da opção e todos os posicionais são refspecs.
    const remotoNaOpcao = args.some((t) => t === '--repo' || t.startsWith('--repo='));

    return posicionais.slice(remotoNaOpcao ? 0 : 1).map((refspec) => {
        // `+` força o push, e o curinga alcança qualquer branch, inclusive a main: ambos contam como destino main.
        if (refspec.startsWith('+') || refspec.includes('*')) return 'main';

        const destino = refspec.split(':').pop().replace(/^(refs\/)?heads\//, '');

        return destino === 'HEAD' || destino === '@' ? branchAtual : destino;
    });
}

// Retorna o motivo do bloqueio, ou null se o comando for permitido.
// `branch` é a branch atual ou uma função que a devolve para um diretório: com vários worktrees,
// vale a branch do diretório em que o git roda (`cd` antes dele ou `git -C`), não a da sessão.
export function motivoDoBloqueio(comando, branch, cwd = '.') {
    const branchEm = typeof branch === 'function' ? branch : () => branch;
    const { texto, restaurar } = separarTextos(comando);
    let dir = path.resolve(cwd);

    for (const trecho of texto.split(SEPARADORES)) {
        const tokens = trecho.trim().split(/\s+/);

        if (tokens[0] === 'cd' && tokens[1]) {
            dir = path.resolve(dir, restaurar(tokens[1]));
            continue;
        }

        if (MIDIA_DESTRUTIVO.test(trecho)) return 'comando que apaga a mídia em ~/midia';
        if (tokens[0] !== 'git') continue;

        const { git, args, dir: dirDoGit } = subcomandoGit(tokens, dir, restaurar);

        if (git === 'reset' && args.includes('--hard')) return 'git reset --hard descarta alterações';
        if (git === 'clean' && args.some((t) => /^-[a-z]*f/.test(t) || t === '--force')) {
            return 'git clean -f apaga arquivos não versionados';
        }
        if (git === 'push') {
            if (args.some((t) => t === '-f' || t.startsWith('--force'))) return 'force push reescreve o histórico';
            if (args.some((t) => t === '--all' || t === '--mirror')) return 'push --all ou --mirror alcança a main';
            const atual = branchEm(dirDoGit);
            const destinos = destinosDoPush(args, restaurar, atual);
            if (destinos.length === 0 ? atual === 'main' : destinos.includes('main')) return 'push direto na main';
        }
        if ((git === 'commit' || git === 'merge') && branchEm(dirDoGit) === 'main') return `git ${git} direto na main`;
    }

    return null;
}

// Sessões somente leitura (`claude --agent revisor` e os subagentes revisor e explorador): só comandos de leitura
// conhecidos passam. Lista do que é permitido, não do que é proibido: comando novo fica bloqueado até ser incluído.
export const AGENTES_SOMENTE_LEITURA = ['revisor', 'explorador'];
const LEITURA = new Set(['cat', 'head', 'tail', 'grep', 'rg', 'ls', 'wc', 'sort', 'uniq', 'diff', 'jq', 'echo', 'pwd', 'date', 'cut', 'tr', 'test', 'true', 'basename', 'dirname', 'realpath']);
const GIT_LEITURA = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'blame', 'merge-base', 'fetch', 'shortlog', 'describe', 'grep']);
const FIND_ESCRITA = ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls'];
const GH_LEITURA = new Set(['list', 'view', 'diff', 'checks', 'status']);

function leituraGit(git, args) {
    if (GIT_LEITURA.has(git)) return true;
    if (git === 'worktree') return args[0] === 'list';
    if (git === 'branch') return args.every((t) => ['--show-current', '-a', '-r', '-v', '-vv', '--list'].includes(t));
    if (git === 'remote') return args.length === 0 || args[0] === '-v';
    if (git === 'config') return args.includes('--get') || args.includes('--list');

    return false;
}

export function motivoSomenteLeitura(comando) {
    const { texto, restaurar } = separarTextos(comando);

    // Substituição de comando executa o que estiver dentro, inclusive entre aspas duplas.
    if (/\$\(|`/.test(comando.replace(/'[^']*'/g, ''))) return 'substituição de comando';

    // Redirecionamento para arquivo, exceto descartar em /dev/null e duplicar descritor (2>&1).
    const semDescartes = texto.replace(/[\d&]?>{1,2}\s*\/dev\/null\b/g, '').replace(/\d?>&\d/g, '');
    if (semDescartes.includes('>')) return 'redirecionamento grava em arquivo';

    for (const trecho of texto.split(SEPARADORES)) {
        const tokens = trecho.trim().split(/\s+/).filter(Boolean);
        const [programa] = tokens;

        if (!programa || programa === 'cd') continue;
        if (programa === 'sort' && tokens.some((t) => /^(-[a-z]*o|--output)/.test(t))) return 'sort -o grava em arquivo';
        if (programa === 'rg' && tokens.some((t) => /^--pre/.test(t))) return 'rg --pre executa um programa';
        if (programa === 'uniq' && tokens.slice(1).filter((t) => !t.startsWith('-')).length > 1) return 'uniq com dois arquivos grava no segundo';
        if (LEITURA.has(programa)) continue;
        // Script do sed sem os comandos que gravam (w, W) ou executam (e).
        if (programa === 'sed' && tokens.includes('-n') && !tokens.some((t) => t.startsWith('-i'))
            && !tokens.slice(1).some((t) => /(^|[^a-zA-Z\\])[wWe](\s|$)/.test(restaurar(t)))) continue;
        if (programa === 'find' && !tokens.some((t) => FIND_ESCRITA.includes(t))) continue;
        if (programa === 'gh' && ['pr', 'issue', 'run', 'repo'].includes(tokens[1]) && GH_LEITURA.has(tokens[2])) continue;
        if (programa === 'git') {
            const { git, args, globais } = subcomandoGit(tokens, '.');
            // -c e afins trocam a configuração (core.pager executa um comando); --output e -O gravam ou abrem programa.
            const seguro = !globais.some((g) => ['-c', '--config-env', '--exec-path'].includes(g))
                && !args.some((t) => /^(--output|--open-files-in-pager|-[a-zA-Z]*O)/.test(t));
            if (seguro && leituraGit(git, args)) continue;
        }

        return `sessão somente leitura não roda \`${tokens.slice(0, 3).join(' ')}\``;
    }

    return null;
}

function branchAtual(dir) {
    try {
        return execFileSync('git', ['branch', '--show-current'], {
            cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        return '';
    }
}

// Executa sempre, exceto quando importado pelos testes: comparar caminhos
// inteiros falha no Windows (maiúsculas, junções) e faria o script terminar sem fazer nada, com código 0; o nome
// do arquivo basta.
if (!process.env.VITEST && path.basename(process.argv[1] ?? '') === 'bloquear-comandos.mjs') {
    const entrada = JSON.parse(readFileSync(0, 'utf8'));
    const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const comando = entrada.tool_input?.command ?? '';
    const motivo = (AGENTES_SOMENTE_LEITURA.includes(entrada.agent_type) ? motivoSomenteLeitura(comando) : null)
        ?? motivoDoBloqueio(comando, branchAtual, entrada.cwd ?? raiz);

    if (motivo) {
        process.stderr.write(
            `Bloqueado pelo hook do projeto (${motivo}). CLAUDE.md, "Segurança e operação" e "Segurança e autonomia da IA". `
            + 'Explique ao responsável humano; se ele autorizar, ele mesmo roda o comando com `! comando`.',
        );
        process.exit(2);
    }
}
