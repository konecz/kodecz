---
name: transicao-deslizar
description: Transição em que a cena nova empurra a anterior para fora do quadro, as duas juntas (push). Use para sequência de itens do mesmo tipo (um gráfico depois do outro) ou para ritmo.
id: H07
versao: 1
estado: em-uso
regras: [G22]
quando: [sequência de itens, troca de gráfico]
nao-quando: [clarão branco (G22), apresentador falando na cena que sai]
entradas:
  design: "DESIGN.md: colors.ground, motion.easing.move"
parametros:
  duracao: { padrao: "15 quadros", faixa: "9 a 21 quadros a 30 qps" }
  desliza-x: { padrao: "100%, da direita", faixa: "100% ou -100%" }
saidas: "uma camada .kz-desliza-sai na cena que sai e uma .kz-desliza-entra na que entra"
custo: { preparacao: "nenhuma", render: "repete-quadro: sim fora da transição", contexto: "~600 tokens" }
conferencia: [deslizar.inteira]
origem:
  - "técnica comum de edição (push)"
  - "catálogo do HyperFrames em 2818160: transitions-push e page-slide, só o nome; nenhum código lido nem copiado (R06)"
license: Proprietária
---

## O que é

As duas cenas andam juntas: a nova entra de um lado enquanto a anterior sai pelo outro, em `--duracao` quadros, com a
curva `motion.easing.move`.

## Por quê

G22: transição com movimento. Mover as duas juntas dá continuidade (o olho segue a direção); só a nova entrando
parece uma cortina.

## Como aplicar

1. Cena que sai: `--fim` = troca + `--duracao`; o conteúdo dentro de `.kz-desliza-sai`.
2. Cena que entra: `--inicio` = troca; o conteúdo dentro de `.kz-desliza-entra`.
3. A mesma `--duracao` nas duas camadas.

## Bloco

```html
<section class="kz-cena" style="--inicio: 270; --fim: 435"><div class="kz-desliza-sai" style="--duracao: 15"> … </div></section>
<section class="kz-cena" style="--inicio: 420; --fim: 585"><div class="kz-desliza-entra" style="--duracao: 15"> … </div></section>
```

## Conferência

- `deslizar.inteira` (P0): no fim da transição a cena nova está no lugar e cobre o quadro.
- A camada que sai não tem checagem própria: no `--fim` dela a cena já some, então o desalinhamento (`--duracao`
  diferente, `--desliza-x` só numa camada) não aparece no DOM; fica para a conferência do quadro (S04, S05).

## Erros comuns

- `--duracao` diferente nas duas camadas: abre uma fresta de fundo entre elas.
- `--fim` da cena que sai igual à troca: ela some antes de deslizar.

## Exemplos

- `exemplo.html`: duas cenas de cor, a segunda empurrando a primeira.
