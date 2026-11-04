# Checkpoint: feature/faixa-do-tema (H14)

Apagar antes do PR.

## Tarefa

Bloco H14 `faixa-do-tema`: cartão com o tema do trecho, centralizado logo acima da legenda (H01), no mesmo eixo; sai
junto com o zoom (`--fim` = início da saída, como o `--fim` do H02). `montar.ts` no contrato do `kodecz assemble`.

## Plano

1. Testes primeiro: `blocos/faixa-do-tema.test.ts` (montar.ts com gatilhos sintéticos; DOM do exemplo certo, do
   errado e do 9:16 sintético).
2. `bloco.css` (variantes `cartao` e `barra`; entrada `mola` ou `cortina` em duas fases; saída simétrica), `bloco.html`,
   `conferencia.json`, `KODECZ.md`, `exemplo.html` (com legenda), `exemplo-errado.html`, `montar.ts`.
3. Linha do H14 no `INDICE.md`.
4. Render curto do exemplo na placa (`flock -s`), `conferir-dom.ts` no certo e no errado, `./verificar.sh` e
   `./verificar.sh completo`.

## Decisões

- Rosto sem medida nova: a sonda `.kz-faixa-teto` (1 px de largura, altura `--faixa-teto`) fica em cima do cartão; se
  passa do topo do quadro, o cartão subiu acima da linha do queixo (`fora-da-margem` com margem 0).
- Posição: `--faixa-base` = `--legenda-base` + altura da legenda (tokens da caption) + `--faixa-folga`.
- Sobreposição: o `montar.ts` guarda as faixas já montadas por `ctx` e `grupo`; ajusta (atrasa a nova até a anterior
  sair) ou recusa (`sobreposicao: "recusar"`, ou quando o ajuste não deixa tempo).

## Estado

- [ ] testes
- [ ] bloco
- [ ] índice
- [ ] render e conferência
- [ ] verificar.sh rápido e completo
