---
name: grafico-linha
description: Gráfico de linha que se desenha da esquerda para a direita, com os pontos aparecendo quando o traço passa e o último valor contando junto. Use para mostrar uma evolução no tempo.
id: H12
versao: 1
estado: em-uso
regras: [G19, G20]
quando: [evolução no tempo, tendência]
nao-quando: [mais de uma série com escalas diferentes, mais de doze pontos]
entradas:
  dados: "valores inteiros em ordem (data-valores) e o topo da escala (data-maximo)"
  design: "DESIGN.md: colors.accent-2 (ou accent), colors.ink, colors.surface, typography.title"
parametros:
  duracao: { padrao: "45 quadros", faixa: "30 a 90 quadros" }
  linha-espessura: { padrao: "8", faixa: "4 a 12 px" }
  linha-topo: { padrao: "30%", faixa: "dentro da zona segura" }
saidas: "um figure .kz-linha com o SVG montado na carga por bloco.js"
custo: { preparacao: "nenhuma", render: "repete-quadro: sim depois do traço", contexto: "~900 tokens" }
conferencia: [linha.chega-no-alvo, linha.zona-segura]
origem:
  - "prova P07 do motor (docs/experimentos/2026-10-p07-prova/linha/graficos), reescrita com o movimento em CSS"
  - "catálogo do HyperFrames em 2818160: chart-story e decline-chart, só o nome; nenhum código lido nem copiado (R06)"
license: Proprietária
---

## O que é

Uma polilinha com `pathLength="1"` e `stroke-dasharray: 1`: o `stroke-dashoffset` vai de 1 a 0 em `--duracao`
quadros, linear. Cada ponto cresce quando o traço chega à posição dele no tempo (`--ordem / --pontos` da duração), e o
número no canto conta do primeiro ao último valor.

## Por quê

O SVG precisa dos pontos em pixels, que dependem do tamanho da figura: `bloco.js` monta a geometria uma vez, na carga
(sem relógio, R03), e a contagem do número por `element.animate()`, com o tempo convertido como o motor (q × 1000 /
qps). Tudo fica na linha do tempo do documento, então o motor sabe quando o quadro para e repete.

## Como aplicar

1. `data-valores` (inteiros separados por espaço) e `data-maximo` na figura; `--inicio` e `--duracao` em quadros.
2. `<script src="…/grafico-linha/bloco.js">` depois das figuras, uma vez por página.
3. Nada de SVG SMIL (`<animate>`): desliga o quadro repetido do motor.

## Bloco

```html
<figure class="kz-linha" data-bloco="grafico-linha" data-valores="30 45 40 62 58 80 92" data-maximo="100"
        style="--inicio: 440; --duracao: 45">
  <svg aria-hidden="true"><polyline class="kz-linha-traco" pathLength="1"></polyline></svg>
  <b class="kz-linha-num"></b>
</figure>
<script src="grafico-linha/bloco.js"></script>
```

## Conferência

- `linha.chega-no-alvo` (P0): no último quadro em que o gráfico aparece (o corte da cena ou o fim do vídeo), o número mostra o último valor (falha também sem o `bloco.js`).
- `linha.zona-segura` (P0): parado, a figura e o número dentro de `--spacing-safe`.

## Erros comuns

- Esquecer o `bloco.js`: a linha não aparece e o número fica em 0.
- Contar o número com `@keyframes` e `var()` posta pelo script: a animação do CSS pode nascer antes da variável e o
  número fica em 0 (por isso o `bloco.js` usa `element.animate()`).

## Exemplos

- `exemplo.html`: sete pontos.
