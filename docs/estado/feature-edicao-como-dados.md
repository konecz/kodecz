# feature/edicao-como-dados — `kodecz assemble`

Checkpoint da tarefa (apagar antes do PR). Itens 1, 7 e 8 da seção A e seção C do inventário de peças de edição.

## Plano
1. `edicao/tipos.ts` (contrato canônico: Palavra, ContextoMontagem, Gatilho, Montado).
2. `edicao/contexto.ts` + testes: q, quando (acento, pontuação, ocorrência, erro com parecidas), fimDaFrase (.!?… fecham,
   vírgula não, +0,15 s), tempo.
3. `edicao/audio.ts` + testes: sons por evento (antes, fim em 3 quadros), trilha com ducking pelo envelope das falas.
4. `edicao/montar.ts` (o montador) + `cli/montar.ts` (`kodecz assemble`): cenas com transição, embutidos
   video/imagem/audio, marca (css ou DESIGN.md), `edicao.resolvida.json`, conferir-dom depois (`--no-check`).
5. `montar.ts` de cena, transicao-fade/-wipe/-deslizar, titulo-entrada, cartela, contagem, grafico-barras, grafico-linha.
6. `docs/formatos/edicao.md` (inglês, exemplo completo).
7. Ponta a ponta: edição sintética → assemble → render --gpu sob flock -s → quadros e RMS da trilha.

## Estado
- em andamento: 1 a 3.
