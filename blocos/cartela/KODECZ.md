---
name: cartela
description: Quadro cheio de cor com uma chamada curta no meio, que abre do centro para as bordas e fecha no fim. Use para abertura, capítulo ou encerramento.
id: H09
versao: 1
estado: em-uso
regras: [G18, G19, G20]
quando: [abertura, capítulo, encerramento]
nao-quando: [apresentador na tela]
entradas:
  design: "DESIGN.md: colors.accent, colors.ground, typography.display, typography.label, motion"
parametros:
  cartela-fundo: { padrao: "var(--color-accent)", faixa: "um token de cor do DESIGN.md" }
  cartela-tinta: { padrao: "var(--color-ground)", faixa: "um token com contraste sobre o fundo" }
  atraso: { padrao: "6 quadros", faixa: "o texto depois da abertura" }
saidas: "um .kz-cartela com .kz-cartela-rotulo (opcional) e .kz-cartela-texto"
custo: { preparacao: "nenhuma", render: "repete-quadro: sim", contexto: "~600 tokens" }
conferencia: [cartela.cabe, cartela.zona-segura]
origem:
  - "G18 e G20 (skill video-konecz)"
  - "catálogo do HyperFrames em 2818160: titlecard-lockup e canopy-part-title, só o nome; nenhum código lido nem copiado (R06)"
license: Proprietária
---

## O que é

A cartela abre do meio (`clip-path` de uma faixa de altura zero ao quadro inteiro) no `--inicio`, o texto sobe
`--atraso` quadros depois, e tudo fecha acabando no `--fim`.

## Por quê

Uma chamada por quadro, em `display`, com o contraste do `DESIGN.md` (G20). Cor de fundo é token, nunca hex solto: a
mesma cartela serve qualquer marca.

## Como aplicar

1. A cartela ocupa o quadro; ponha-a sozinha numa cena (ou por cima de tudo).
2. Chamada de até quatro palavras, numa linha (`nowrap`); o rótulo é uma palavra ou duas, em caixa alta.

## Bloco

```html
<div class="kz-cartela" data-bloco="cartela" style="--inicio: 3; --fim: 92">
  <p class="kz-cartela-rotulo">Demonstração</p>
  <p class="kz-cartela-texto">Blocos do motor</p>
</div>
```

## Conferência

- `cartela.cabe` (P0): a chamada cabe na largura (com `nowrap` não quebra: passaria da borda).
- `cartela.zona-segura` (P0): parado, o texto dentro de `--spacing-safe` das bordas (chamada longa demais sai do
  quadro, porque não quebra).

## Erros comuns

- Chamada longa: com `nowrap`, passa da borda em vez de quebrar.
- `--cartela-tinta` sem contraste com o fundo.

## Exemplos

- `exemplo.html`: cartela de capítulo.
- `exemplo-errado.html`: chamada longa demais; a conferência acusa `cartela.zona-segura`.
