---
name: grafico-barras
description: Gráfico de barras que crescem da base uma depois da outra, com o número de cada uma contando até o valor junto com ela. Use para comparar poucas quantidades (até sete) com dados inventados ou de fonte citada.
id: H11
versao: 1
estado: em-uso
regras: [G18, G19, G20]
quando: [comparar quantidades, evolução por mês]
nao-quando: [mais de sete barras, valores com casas decimais]
entradas:
  dados: "valores inteiros e rótulos curtos; o topo da escala (--maximo)"
  design: "DESIGN.md: colors.muted, colors.accent, colors.ink, colors.surface, typography.title, typography.label, motion.easing.enter"
parametros:
  passo: { padrao: "4 quadros", faixa: "0 a 9 quadros entre barras" }
  duracao: { padrao: "27 quadros", faixa: "15 a 45 quadros" }
  barras-topo: { padrao: "30%", faixa: "dentro da zona segura" }
  barras-altura: { padrao: "46%", faixa: "dentro da zona segura" }
saidas: "um .kz-barras com um .kz-barra por valor (--valor e --ordem), coluna, número e rótulo"
custo: { preparacao: "nenhuma", render: "repete-quadro: sim depois da última barra", contexto: "~900 tokens" }
conferencia: [barras.chega-no-alvo, barras.zona-segura, barras.rotulo-cabe]
origem:
  - "prova P07 do motor (docs/experimentos/2026-10-p07-prova/linha/graficos), reescrita em CSS puro"
  - "catálogo do HyperFrames em 2818160: animated-bar-chart e data-chart, só o nome; nenhum código lido nem copiado (R06)"
license: Proprietária
---

## O que é

Cada barra cresce da base (`scaleY` de 0 a 1) em `--duracao` quadros, começando `--ordem × --passo` quadros depois do
`--inicio`; o número em cima conta de 0 ao `--valor` com a mesma curva e acompanha o topo da barra.

## Por quê

O número que conta junto com a barra diz o valor sem eixo nem grade. A contagem é uma propriedade registrada
(`@property --kz-valor`, inteira) mostrada por `counter()`: o CSS interpola, nada de script com relógio (R03), e o
quadro parado depois da última barra é repetido pelo motor.

## Como aplicar

1. `--maximo` no `.kz-barras` (≥ o maior valor); `--valor` e `--ordem` em cada `.kz-barra`; o mesmo valor em
   `data-valor` do número (a conferência compara).
2. `kz-destaque` na barra que importa (uma só: `accent` uma vez por quadro).
3. `--sufixo` (texto entre aspas, como `' %'`) no `.kz-barras` se o número precisar.

## Bloco

```html
<div class="kz-barras" data-bloco="grafico-barras" style="--inicio: 300; --maximo: 100">
  <div class="kz-barra" style="--valor: 42; --ordem: 0"><i class="kz-barra-coluna"></i>
    <b class="kz-barra-num" data-valor="42"></b><i class="kz-barra-rotulo">jan</i></div> …
</div>
```

## Conferência

- `barras.chega-no-alvo` (P0): no último quadro em que o gráfico aparece (o corte da cena ou o fim do vídeo), cada número mostra o `data-valor`.
- `barras.zona-segura` (P0): parado, o gráfico (com números e rótulos) dentro de `--spacing-safe`.
- `barras.rotulo-cabe` (P1): o rótulo cabe na largura da barra.

## Erros comuns

- `--valor` diferente do `data-valor`.
- Valor maior que `--maximo`: a barra passa do topo da área.
- Número com casas decimais: o contador do CSS só mostra inteiro.

## Exemplos

- `exemplo.html`: quatro barras, uma em destaque.
