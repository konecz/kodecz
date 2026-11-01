---
name: terco-inferior
description: Nome e cargo de quem fala num cartão no terço de baixo, à esquerda, que se revela da esquerda para a direita e recolhe no fim. Use na primeira aparição de cada pessoa ou apresentador.
id: H10
versao: 1
estado: em-uso
regras: [G15, G16, G18, G19]
quando: [primeira aparição de quem fala]
nao-quando: [legenda na tela ao mesmo tempo (G16), texto que cairia sobre o rosto (G15)]
entradas:
  design: "DESIGN.md: colors.surface, colors.accent, colors.ink, colors.muted, typography.title, typography.label, rounded.card"
parametros:
  terco-base: { padrao: "24%", faixa: "abaixo do queixo e dentro da zona segura (G15, G19)" }
  atraso: { padrao: "4 quadros", faixa: "o texto depois do cartão" }
saidas: "um .kz-terco com .kz-terco-nome e .kz-terco-cargo"
custo: { preparacao: "nenhuma", render: "repete-quadro: sim fora do trecho do vídeo", contexto: "~600 tokens" }
conferencia: [terco.cabe, terco.zona-segura, terco.sem-legenda]
origem:
  - "G15, G16 e G18 (skill video-konecz)"
  - "catálogo do HyperFrames em 2818160: lt-clean-bar e lt-mask-reveal, só o nome; nenhum código lido nem copiado (R06)"
license: Proprietária
---

## O que é

Um cartão (`surface`, borda de `accent`) com o nome em cima e o cargo embaixo. Revela-se por recorte da esquerda para
a direita no `--inicio`, o texto vem `--atraso` quadros depois, e recolhe acabando no `--fim`.

## Por quê

Quem fala precisa ser apresentado uma vez. G16: um só eixo de texto; o cartão no canto disputa com a legenda, então
ele sai antes de a primeira frase entrar. G15: nunca sobre o rosto.

## Como aplicar

1. `--inicio` logo depois de a pessoa aparecer; `--fim` antes do `--inicio` da primeira frase da legenda.
2. Nome e cargo numa linha cada (G18); encurte o cargo.
3. No 9:16, suba `--terco-base` só até abaixo do queixo (G15).

## Bloco

```html
<div class="kz-terco" data-bloco="terco-inferior" style="--inicio: 105; --fim: 168">
  <p class="kz-terco-nome">Apresentador sintético</p>
  <p class="kz-terco-cargo">Gerado pelo ffmpeg, sem pessoa</p>
</div>
```

## Conferência

- `terco.cabe` (P1): nome e cargo cabem no cartão (com `nowrap`, o que passa seria cortado).
- `terco.zona-segura` (P0): parado, dentro de `--spacing-safe` das bordas.
- `terco.sem-legenda` (P1): nunca junto com uma legenda visível.
- Rosto livre: do S04 (precisa da caixa do rosto, H03).

## Erros comuns

- Deixar o cartão no ar durante a legenda.
- Cargo longo que vira duas linhas.

## Exemplos

- `exemplo.html`: o cartão sobre um retângulo no lugar do vídeo.
- `exemplo-errado.html`: o cartão no ar junto com a legenda; a conferência acusa `terco.sem-legenda`.
