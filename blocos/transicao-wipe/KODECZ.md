---
name: transicao-wipe
description: Transição em que uma borda reta atravessa o quadro e revela a cena nova (máscara por clip-path). Use para passar de uma ideia à seguinte com movimento, sem tirar a anterior do lugar.
id: H06
versao: 1
estado: em-uso
regras: [G22]
quando: [passagem para o capítulo seguinte, troca de gráfico]
nao-quando: [clarão branco (G22)]
entradas:
  design: "DESIGN.md: colors.ground, motion.easing.move"
parametros:
  duracao: { padrao: "15 quadros", faixa: "9 a 24 quadros a 30 qps" }
  wipe-de: { padrao: "inset(0 100% 0 0), da esquerda", faixa: "da direita inset(0 0 0 100%), de cima inset(0 0 100% 0), de baixo inset(100% 0 0 0)" }
saidas: "uma camada .kz-wipe dentro da cena que entra"
custo: { preparacao: "nenhuma", render: "repete-quadro: sim fora da transição", contexto: "~500 tokens" }
conferencia: [wipe.inteira]
origem:
  - "técnica comum de edição (wipe)"
  - "catálogo do HyperFrames em 2818160: directional-wipe, só o nome; nenhum código lido nem copiado (R06)"
license: Proprietária
---

## O que é

A camada da cena nova começa recortada a zero (`clip-path: inset(…)`) e abre até o quadro inteiro em `--duracao`
quadros, com a curva `motion.easing.move`.

## Por quê

G22 pede transição com movimento (máscara, whip). O recorte não move o conteúdo: o texto da cena nova já aparece no
lugar final.

## Como aplicar

1. A cena que entra começa no quadro da troca; a de baixo fica até a troca + `--duracao`.
2. O conteúdo vai dentro de `.kz-wipe`; `--wipe-de` escolhe o lado.

## Bloco

```html
<section class="kz-cena" data-bloco="cena" style="--inicio: 270; --fim: 435">
  <div class="kz-wipe" data-bloco="transicao-wipe" style="--duracao: 15"> … </div>
</section>
```

## Conferência

- `wipe.inteira` (P0): no fim da transição a camada cobre o quadro inteiro, sem recorte.

## Erros comuns

- `--wipe-de` com valor que não é `inset(…)`: a interpolação vira corte seco no meio.

## Exemplos

- `exemplo.html`: duas cenas, wipe da esquerda e de baixo.
