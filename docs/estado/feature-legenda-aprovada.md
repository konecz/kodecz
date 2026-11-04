# feature/legenda-aprovada (checkpoint; apagar antes do PR)

H01 legenda-uma-linha no padrão aprovado (item 2 da seção A do inventário de peças).

## Plano
1. Testes primeiro em `blocos/legenda-uma-linha.test.ts`: medida da fonte (métricas do TTF), quebra das frases
   (artigo no fim, palavra longa, pontuação, vírgula, exceções), tempos (destaque até fim + 0,15 s cortado pela
   palavra seguinte), posição por formato e zona segura, e o DOM do exemplo 9:16 no quadro N.
2. `montar.ts` (contrato do `kodecz assemble`) + `fonte.ts` (cmap/hmtx do TTF, sem dependência; reserva por
   `larguraEm` quando a fonte não abre).
3. `bloco.css`: destaque `falada` (padrão) e `progresso`; `--apaga`/folga; entrada `subir`; âncora topo; px de
   respiro; base max(56px, --spacing-safe).
4. `bloco.js` lê `data-t` (texto com a pontuação). KODECZ.md versão 3.
5. `exemplo.html` fica no modo `progresso` (o teste de blocos.test.ts, que não posso editar, confere esse modo);
   `exemplo-9x16.html` gerado pelo montar.ts no modo novo.

## Estado
- [ ] testes  - [ ] montar/fonte  - [ ] css/js  - [ ] exemplos/docs  - [ ] verificar rápido e completo
