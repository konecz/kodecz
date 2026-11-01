---
name: cena
description: Cena da linha do tempo, visível do quadro --inicio ao --fim, em corte seco. Use como raiz de cada trecho do vídeo; os blocos de dentro herdam o --inicio e o --fim dela, e as transições (fade, wipe, deslizar) vão dentro.
id: H04
versao: 1
estado: em-uso
regras: [G14, G22]
quando: [toda composição com mais de um trecho]
entradas:
  formato: "qps da composição (:root { --qps })"
parametros:
  inicio: { padrao: "nenhum", faixa: "quadro em que a cena aparece" }
  fim: { padrao: "nenhum", faixa: "quadro em que a cena some (exclusivo)" }
saidas: "um section .kz-cena com --inicio e --fim em quadros"
custo: { preparacao: "nenhuma", render: "repete-quadro: sim", contexto: "~600 tokens" }
conferencia: []
origem:
  - "técnica comum de edição (corte seco); formato da linha do tempo em docs/formatos/linha-do-tempo.md"
license: Proprietária
---

## O que é

O trecho do vídeo: aparece num quadro e some noutro, sem transição (corte seco). O corte seco não precisa de bloco
próprio: é a cena seguinte começando no quadro em que esta acaba.

## Por quê

Com a cena dona do intervalo, cada bloco de dentro só diz o que muda nele; o `--inicio` e o `--fim` herdados evitam
repetir números. A cena liga e desliga com duas animações de duração zero (`forwards`): o intervalo delas é só a
borda, e o motor continua repetindo os quadros parados no meio da cena (P10.3).

## Como aplicar

1. `:root { --qps: N }` com o mesmo qps do bloco `motor-video` (a conversão de quadro em tempo é `× 1s / --qps`).
2. Uma `section.kz-cena` por trecho, na ordem do vídeo (a de baixo antes, a de cima depois).
3. Corte seco: `--fim` de uma = `--inicio` da seguinte. Com transição, a de baixo fica até o fim da transição.
4. A cena não pinta fundo: o fundo é o do `body` (`--color-ground`) ou o da camada de transição.

## Bloco

```html
<section class="kz-cena" data-bloco="cena" style="--inicio: 585; --fim: 675"> … </section>
```

## Conferência

Sem checagem própria; a do `--qps` (`pagina.qps`, P0) roda em toda página com blocos.

## Erros comuns

- `--qps` diferente do declarado: tudo sai fora do tempo.
- Esquecer o `--fim`: a animação fica inválida e a cena não aparece.

## Exemplos

- `exemplo.html`: três cenas em corte seco.
