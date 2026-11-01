// Hook SessionStart: injeta no contexto do Claude o estado do Git, os PRs abertos e o checkpoint da tarefa da
// branch atual ou, sem ele, o checkpoint do projeto.
// Executado no início de cada sessão e após /clear, /compact ou /resume. Apenas lê; não altera nada.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_CHECKPOINT = 8000;

// Checkpoint de uma tarefa (CLAUDE.md, "Checkpoint"): um arquivo por branch, para branches paralelas não conflitarem.
export function checkpointDaTarefa(branch) {
    if (!branch || branch === 'main' || branch.startsWith('(')) return null;

    return path.join('docs', 'estado', `${branch.replaceAll('/', '-')}.md`);
}

export function montarContexto({ branch, status, commits, prs, checkpoint, tarefa }) {
    const partes = [
        '# Retomada de sessão — kodecz',
        'Siga "Continuidade entre sessões" no CLAUDE.md: confira o estado abaixo, resuma o entendimento e confirme com o responsável humano antes de agir.',
        '',
        `## Git\nBranch: ${branch}`,
        `Status:\n${status || '(limpo)'}`,
        `Últimos commits:\n${commits}`,
        '',
        `## Pull Requests abertos\n${prs}`,
        '',
    ];

    if (tarefa) {
        partes.push(`## Checkpoint da tarefa (${tarefa.arquivo})\n${tarefa.conteudo ?? `(${tarefa.arquivo} não existe: criar ao aprovar o plano; com o PR já aberto, a tarefa aguarda CI e merge)`}`, '');
    }

    // Com o checkpoint da tarefa, o do projeto fica fora: é longo e entraria em toda retomada e após cada /clear.
    if (tarefa?.conteudo) {
        partes.push('docs/estado-atual.md: ler só o trecho necessário, ao fechar a tarefa ou quando o checkpoint pedir.');
    } else {
        partes.push(`## Checkpoint (docs/estado-atual.md)\n${checkpoint}`);
    }

    return partes.join('\n');
}

function raizDoWorktree(cwd) {
    if (!cwd) return null;

    try {
        return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
    } catch {
        return null;
    }
}

function ler(arquivo) {
    try {
        const conteudo = readFileSync(arquivo, 'utf8').trim();
        return conteudo.length > MAX_CHECKPOINT ? conteudo.slice(0, MAX_CHECKPOINT) + '\n[... truncado]' : conteudo;
    } catch {
        return null;
    }
}

if (!process.env.VITEST) {
    // Raiz do worktree da sessão: os hooks rodam a partir do checkout principal.
    let entrada = {};
    try {
        entrada = JSON.parse(readFileSync(0, 'utf8'));
    } catch {
        // Sem entrada: usa a pasta do hook.
    }
    const pastaDoHook = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const root = raizDoWorktree(entrada.cwd) ?? pastaDoHook;

    const git = (...args) => {
        try {
            return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        } catch {
            return '(indisponível)';
        }
    };

    // PRs abertos, inclusive os do Dependabot. Depende do gh autenticado e da rede.
    const prsAbertos = () => {
        try {
            const saida = execFileSync('gh', ['pr', 'list', '--state', 'open', '--limit', '20'], {
                cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000,
            }).trim();
            return saida || '(nenhum)';
        } catch {
            return '(indisponível: gh sem acesso)';
        }
    };

    const branch = git('branch', '--show-current');
    const arquivoTarefa = checkpointDaTarefa(branch);

    const context = montarContexto({
        branch,
        status: git('status', '--short'),
        commits: git('log', '--oneline', '-5'),
        prs: prsAbertos(),
        checkpoint: ler(path.join(root, 'docs', 'estado-atual.md')) ?? '(docs/estado-atual.md não encontrado)',
        tarefa: arquivoTarefa ? { arquivo: arquivoTarefa, conteudo: ler(path.join(root, arquivoTarefa)) } : null,
    });

    process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
    }));
}
