---
name: pr
description: Fecha uma tarefa do kodecz com Pull Request e faz o merge aprovado. Use ao concluir uma tarefa (antes de commitar, enviar a branch ou abrir o PR), ao decidir se uma alteração merece PR próprio e quando o responsável humano aprovar o merge de um PR.
---

# Pull Request e merge — kodecz

Um PR por tarefa coesa. Cada merge vira um commit permanente na `main`, então o PR precisa justificar seu lugar no histórico.

## Quando uma alteração merece PR próprio

- **Sim:** mudança de código ou comportamento (inclui testes); dependências, configuração ou infraestrutura; regra ou decisão nova (`CLAUDE.md`, `ARCHITECTURE.md`, `docs/`).
- **Não:** atualização dos checkpoints (`docs/estado-atual.md`, `docs/estado/`), correção de digitação, formatação ou links. Entra no PR da tarefa em andamento ou da próxima. Na dúvida, agregar.
- **Agrupar por assunto, não por passo.** Refatoração do código que a tarefa acabou de criar entra no PR dela.

## Abrir o PR

1. Revisar o `git diff` da branch: eliminar redundâncias e simplificar, preservando o comportamento e os testes.
2. **Nada de cliente** (`CLAUDE.md`, R01; o repositório é público): `git diff --name-only main...` sem mídia, roteiro, nome ou caminho de cliente; conferir com `~/.config/kodecz/nomes-proibidos.txt` (`git diff main... | grep -iFf ~/.config/kodecz/nomes-proibidos.txt`).
3. Revisão em contexto separado (subagente `revisor` ou `/code-review`). Corrigir o que for confirmado; o que não for corrigido vai para a descrição com o motivo.
4. Checkpoints: apagar o da tarefa (`docs/estado/<branch>.md`), levar o que ficar pendente para o `docs/estado-atual.md` e descrever ali o estado após o merge.
5. `./verificar.sh` (ou `completo`, se mexeu no render) por `node .claude/scripts/resumo.mjs <comando>`. Mudança no render: medição de CPU e tempo e lado a lado (R05), com os números na descrição.
6. Commits pequenos em Conventional Commits, em português.
7. Com autorização ou instrução prévia: enviar a branch e abrir o PR para a `main`. Título em Conventional Commits, em português. Descrição: o que mudou, por quê e como foi testado, com os números reais.

## Ideias fora do escopo

Melhorias notadas durante a tarefa que não pertencem a ela vão para as «Pendências» do `docs/estado-atual.md` e para o resumo ao responsável.

## Merge

**Squash and merge é o padrão.** Pré-condições, todas obrigatórias:

- verificações verdes no último commit, executadas e reportadas;
- branch com a `main` atual (`git fetch && git merge origin/main`);
- aprovação explícita do responsável humano para este PR.

```bash
gh pr merge <n> --squash --subject "<tipo>: <mudança completa> (#<n>)" --body "<resumo objetivo>"
```

O corpo resume a mudança completa e termina com a linha `Co-Authored-By` do agente.

Depois do merge: `git fetch --prune`; conferir `MERGED` (`gh pr view <n> --json state`) e a remota apagada (`git push origin --delete <branch>` se sobrou); `git switch main && git pull --ff-only`; `git branch -D <branch>`.

## Gotchas

- O hook `bloquear-comandos.mjs` barra commit, `git merge` e push na `main`. O push com refspec explícito para outra branch passa. O `gh pr merge` é o caminho do merge; não contornar o hook.
- Não usar `gh pr merge --delete-branch`: a limpeza local segue o roteiro acima.
