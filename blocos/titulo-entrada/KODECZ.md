---
name: titulo-entrada
description: Título e subtítulo que sobem aparecendo, um depois do outro, e saem juntos. Use para abrir uma cena ou um capítulo com uma chamada curta.
id: H08
versao: 1
estado: em-uso
regras: [G18, G19, G20, G16]
quando: [abertura de cena, capítulo, fim]
nao-quando: [apresentador falando com legenda na tela (G16)]
entradas:
  design: "DESIGN.md: typography.display, typography.body, colors.ink, colors.muted, motion.duration, motion.easing, spacing.margin"
parametros:
  atraso: { padrao: "0 no título, 6 no subtítulo", faixa: "quadros depois do --inicio" }
  titulo-topo: { padrao: "36%", faixa: "dentro da zona segura (G19)" }
  titulo-alinhar: { padrao: "center", faixa: "center ou flex-start" }
saidas: "um .kz-titulo com .kz-titulo-principal e .kz-titulo-sub"
custo: { preparacao: "nenhuma", render: "repete-quadro: sim", contexto: "~600 tokens" }
conferencia: [titulo.uma-linha, titulo.sub-linhas, titulo.zona-segura]
origem:
  - "G18 e G20 (skill video-konecz)"
  - "catálogo do HyperFrames em 2818160: staggered-fade-up e titlecard-calm, só o nome; nenhum código lido nem copiado (R06)"
license: Proprietária
---

## O que é

Cada filho de `.kz-titulo` sobe e aparece no `--inicio` + o `--atraso` dele, com `motion.duration.enter` e
`motion.easing.enter`; todos saem acabando no `--fim`, com `motion.duration.exit`.

## Por quê

G18: texto de preferência numa linha (`text-wrap: balance` se quebrar). G20: peso e contraste do `DESIGN.md`
(`display` e `ink`). Entrar em degraus dá hierarquia sem mais um elemento.

## Como aplicar

1. Até seis palavras no título (`typography.display`); uma frase no subtítulo.
2. `--inicio` e `--fim` em quadros, ou herdados da cena.
3. Para palavra a palavra, uma `<span>` por palavra como filho direto, cada uma com o seu `--atraso`.

## Bloco

```html
<div class="kz-titulo" data-bloco="titulo-entrada" style="--inicio: 285; --fim: 420">
  <h1 class="kz-titulo-principal">Números que contam</h1>
  <p class="kz-titulo-sub" style="--atraso: 6">Cada barra cresce e o número acompanha</p>
</div>
```

## Conferência

- `titulo.uma-linha` (P1): o título numa linha.
- `titulo.sub-linhas` (P1): o subtítulo em até duas.
- `titulo.zona-segura` (P0): parado, dentro de `--spacing-safe` das bordas.

## Erros comuns

- `--fim` antes do fim da entrada: o título sai antes de terminar de entrar.
- Título longo em `display`: quebra em três linhas; usar `title` ou encurtar.

## Exemplos

- `exemplo.html`: título e subtítulo no meio do quadro.
