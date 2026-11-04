---
name: faixa-do-tema
description: O tema do trecho num cartão de uma linha, centralizado no eixo da legenda e logo acima dela, que entra por mola ou cortina e sai junto com o zoom, no fim da frase. Use para nomear o assunto de um trecho falado sem tirar o olho da legenda.
id: H14
versao: 1
estado: proposta
regras: [G15, G16, G18, G19, G21]
quando: [trecho falado com legenda, um tema por frase ou por zoom]
nao-quando: [sem legenda (use o titulo-entrada), nome e cargo de quem fala (terco-inferior), duas faixas ao mesmo tempo]
entradas:
  design: "DESIGN.md: colors.ink, colors.ground, colors.accent, colors.accent-2, colors.surface, typography.title, typography.caption, spacing.safe, rounded.card, motion.easing"
  fala: "palavras com início e fim (segundos), para o montar.ts"
parametros:
  inicio: { padrao: "obrigatório", faixa: "o quadro da palavra que abre o tema" }
  fim: { padrao: "obrigatório", faixa: "o quadro em que começa a sair: o fim da frase, o mesmo --fim do zoom (G21)" }
  faixa-entrada: { padrao: "15 quadros", faixa: "meio segundo; na cortina, metade para cada fase" }
  faixa-saida: { padrao: "9 quadros", faixa: "0,3 s; a faixa já cai abaixo de 90 % até 3 quadros depois do --fim (G21)" }
  faixa-letras: { padrao: "1 (sem encolher)", faixa: "o número de letras do tema; o texto encolhe para caber" }
  legenda-base: { padrao: "12%", faixa: "o mesmo do H01, posto no :root" }
  faixa-folga: { padrao: "20px", faixa: "entre a faixa e o topo da legenda" }
  faixa-teto: { padrao: "60vh no 16:9, 52vh no 9:16", faixa: "a linha do queixo do take, em px ou vh (G15)" }
  faixa-base: { padrao: "a da legenda + a altura dela + a folga", faixa: "só quando a legenda não é a do H01" }
saidas: "um .kz-faixa com .kz-faixa-cartao (data-papel=faixa), .kz-faixa-cortina e a sonda .kz-faixa-teto"
custo: { preparacao: "nenhuma", render: "repete-quadro: sim fora da entrada e da saída", contexto: "~900 tokens" }
conferencia: [faixa.uma-linha, faixa.cabe, faixa.zona-segura, faixa.rosto, faixa.uma-por-vez]
origem:
  - "G15, G16, G18, G19 e G21 (skill video-konecz)"
  - "versões aprovadas pelo responsável em vídeos da Konecz (cartão claro com filete; barra à esquerda com cortina), reescritas no formato dos blocos; nenhum material de cliente"
license: Proprietária
---

## O que é

Um cartão de uma linha com o tema do trecho, no mesmo eixo da legenda (H01) e logo acima dela. Dois estilos:

- `data-estilo="cartao"` (padrão): cartão claro (`ink`), texto em `ground`, filete de `accent` embaixo.
- `data-estilo="barra"`: cartão escuro (`surface`), barra de `accent` à esquerda, contorno de `accent-2`, e o texto
  sobe de dentro do cartão com uma mola que passa um pouco e volta.

Duas entradas, cada uma com a saída simétrica:

- `data-entrada="mola"` (padrão): sobe 24 px aparecendo, na curva `motion.easing.enter`; sai descendo e apagando na
  mesma curva, que começa rápida (a G21 quer a faixa já caindo 3 quadros depois de o zoom voltar).
- `data-entrada="cortina"`, em duas fases: o painel de `accent` abre da esquerda para a direita e depois recolhe para a
  direita, revelando o cartão; na saída, o painel cobre da esquerda (o cartão apaga por baixo) e o recorte fecha para a
  direita.

A faixa entra no `--inicio` e **começa a sair** no `--fim`, como o zoom (H02): o `--fim` dos dois é o mesmo quadro, o
fim da frase.

## Por quê

G16: um só eixo de texto; o tema em cima, a fala embaixo, no mesmo centro, e o olho não sai da legenda. G15: a faixa
fica embaixo, longe do rosto; faixa alta no 9:16 cobre a cara de quem fala. G18: uma linha só; o tema longo encolhe,
não quebra. G21: a faixa sai junto com o zoom, na pausa depois da frase. Duas faixas na mesma altura se cruzam: a nova
só entra depois de a anterior sair.

## Como aplicar

1. `--legenda-base` no `:root` (ou num ancestral comum), para a faixa e a legenda lerem o mesmo valor; a faixa fica
   `--faixa-folga` acima do topo da legenda, calculado pelos tokens da caption (`font-caption-size`,
   `font-caption-line-height`) e pelo `padding` do H01.
2. `--inicio` na palavra que abre o tema; `--fim` no fim da frase (o `--fim` do zoom, se houver).
3. `--faixa-letras` com o número de letras do tema: o tamanho cai de 38 px (16:9) ou 44 px (9:16) até caber em
   `--faixa-largura` (padrão: 1300 px no 16:9, 980 px no 9:16, sempre dentro de `--spacing-safe`).
4. `--faixa-teto` na linha do queixo do take (px ou vh do topo). A sonda `.kz-faixa-teto` (1 px, sem pintura) sobe do
   topo do cartão até essa altura; se passa do topo do quadro, a faixa está sobre o rosto (`faixa.rosto`). A G15 do
   `kodecz check`, com o rosto achado no quadro, confere o resto.
5. Uma faixa por vez: a seguinte com `--inicio` maior ou igual ao `--fim` + `--faixa-saida` da anterior.

### Montagem (`montar.ts`, para o `kodecz assemble`)

`montar(item, ctx): Montado`, com os tipos `Palavra`, `ContextoMontagem` e `Montado` do contrato. O item:

| Campo | Padrão | O quê |
|---|---|---|
| `texto` | obrigatório | o tema, uma linha (texto vazio ou com quebra de linha é recusado) |
| `de` | obrigatório | gatilho de entrada, resolvido por `ctx.tempo` |
| `ate` | `ctx.fimDaFrase(de)` | gatilho do começo da saída |
| `estilo` | `"cartao"` | ou `"barra"` |
| `entrada` | `"mola"` | ou `"cortina"` |
| `grupo` | `"tema"` | faixas do mesmo grupo nunca ficam juntas |
| `sobreposicao` | `"ajustar"` | ou `"recusar"` |
| `teto`, `folga`, `base` | os do CSS | `--faixa-teto` (px ou vh), `--faixa-folga` (px), `--faixa-base` (px, vh ou %) |

Devolve o `html` do bloco (com `--inicio`, `--fim`, `--faixa-entrada` = 0,5 s, `--faixa-saida` = 0,3 s e
`--faixa-letras` já postos, texto escapado) e `css: ["faixa-do-tema/bloco.css"]` (caminho relativo a `blocos/`).

Sobreposição: as faixas já montadas ficam guardadas por `ctx` e por `grupo` (o `assemble` passa o mesmo `ctx` para a
composição inteira, com os itens em ordem). A que entraria antes de a anterior terminar de sair (`--fim` +
`--faixa-saida`) é **atrasada** até esse quadro (`"ajustar"`) ou **recusada** com erro (`"recusar"`). O ajuste que não
deixa a faixa pelo menos meio segundo parada depois da entrada também é recusado (juntar os dois temas ou tirar um). A
recusada não ocupa lugar.

## Bloco

```html
<div class="kz-faixa" data-bloco="faixa-do-tema" data-estilo="cartao" data-entrada="mola"
     style="--inicio: 12; --fim: 60; --faixa-letras: 14">
  <p class="kz-faixa-cartao" data-papel="faixa"><span class="kz-faixa-texto">Tema do trecho</span></p>
  <i class="kz-faixa-cortina"></i><i class="kz-faixa-teto"></i>
</div>
```

## Conferência

- `faixa.uma-linha` (P0): o cartão numa linha.
- `faixa.cabe` (P0): o tema cabe no cartão (com `nowrap`, o que passa seria cortado).
- `faixa.zona-segura` (P0): parado, dentro de `--spacing-safe` das bordas.
- `faixa.rosto` (P0): o topo do cartão abaixo de `--faixa-teto` (pela sonda).
- `faixa.uma-por-vez` (P0): nunca duas faixas visíveis no mesmo quadro.
- Junto com a legenda é permitido: o `terco.sem-legenda` do H10 vale só para o terço inferior.

## Erros comuns

- Faixa no alto do quadro no 9:16, sobre o rosto (`faixa.rosto`).
- A faixa nova entrando antes de a anterior sair, na mesma altura (`faixa.uma-por-vez`).
- `--legenda-base` mudado só no `.kz-legendas`: a legenda sobe e a faixa fica, e as duas se cruzam.
- `--fim` no fim da saída, como no terço inferior: a faixa sai depois do zoom (G21).
- Tema longo sem `--faixa-letras`: não encolhe e é cortado (`faixa.cabe`).

## Exemplos

- `exemplo.html`: duas faixas, cartão por mola e barra por cortina, uma depois da outra, com a legenda embaixo.
- `exemplo-errado.html`: a faixa erguida sobre o rosto, duas juntas e uma quebrada em duas linhas; a conferência
  acusa `faixa.rosto`, `faixa.uma-por-vez` e `faixa.uma-linha`.
