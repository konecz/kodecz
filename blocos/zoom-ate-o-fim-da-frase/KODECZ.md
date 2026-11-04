---
name: zoom-ate-o-fim-da-frase
description: Take do apresentador com aproximação lenta e punch-in de 12 % em cada palavra de ênfase, que só sai no fim da frase dela; recorte da fonte no foco, preso às bordas, e passagem opcional para um cartão. Use em todo take falado; é o movimento de câmera dos blocos.
id: H02
versao: 2
estado: em-uso
regras: [G21, G14, G15, G23, G25]
quando: [apresentador na tela, palavra de ênfase marcada no roteiro]
nao-quando: [duas ênfases na mesma frase, plano já fechado no rosto]
entradas:
  palavras: "tempos por palavra do Whisper (G11)"
  roteiro: "pontuação do roteiro: o fim da frase é o primeiro . ! ou ? depois da palavra, mais 0,15 s"
  take: "src, de e ate na composição, inicioNoVideo, formatoFonte (16:9 ou 9:16) e foco em px da fonte"
parametros:
  aproximacao: { padrao: "1 → 1.06 no take", faixa: "1 → 1.04 a 1 → 1.06" }
  escala: { padrao: "1.12 (punch-in de 12 %, mola damping 18)", faixa: "1.08 a 1.15" }
  saida: { padrao: "0,4 s, acabando no fim da frase", faixa: "6 a 15 quadros a 30 qps" }
  foco: { padrao: "o centro da fonte", faixa: "o ponto de interesse (G23), entre o rosto e as mãos" }
  ancora: { padrao: "0.5 × 0.45 da caixa", faixa: "onde o foco fica na caixa" }
  cartao: { padrao: "sem (tela cheia)", faixa: "x, y, w, h, raio 32, contorno 4, em (passagem por mola damping 200 em 22 quadros), foco" }
saidas: "um .kz-take (caixa .kz-take-caixa, vídeo .kz-take-video com data-papel apresentador) com @keyframes por quadro, gerado por montar.ts; v1: o invólucro .kz-zoom"
custo: { preparacao: "montar.ts, sem placa (contas por quadro)", render: "o vídeo desenha todos os quadros do take, todos na placa", contexto: "~1400 tokens" }
conferencia: [zoom.ordem, zoom.volta, zoom.enfase-ordem, zoom.enfase-volta, zoom.take-volta]
origem:
  - "G21 (skill video-konecz, origens.md)"
  - "pesquisa P12, H02 (docs/pesquisa/habilidades-de-edicao.md)"
  - "comportamento das edições aprovadas da Konecz (aproximação lenta, 0,12 × (mola entra − mola sai), vídeo preso às bordas), reescrito aqui"
  - "catálogo do HyperFrames em 2818160: push-in e cinematic-zoom, só o nome; nenhum código lido nem copiado (R06)"
license: Proprietária
---

## O que é

O take do apresentador ocupa uma caixa (a tela cheia ou um cartão) e o vídeo a cobre sempre, recortado em volta do
foco. Ao longo do take o quadro se aproxima devagar (1 → 1,06); em cada palavra de ênfase entra um punch-in de 12 %
com mola, que acaba de sair no fim da frase dela.

## Por quê

G21: zoom de duração fixa voltava no meio da frase, e o corte no meio da fala parece erro. Um zoom por frase, no
máximo: racionado, ele marca; em toda frase, cansa. A aproximação lenta tira o ar de câmera parada e esconde a emenda
entre takes curtos. O zoom muda a caixa do vídeo (posição e tamanho, G25), sem `transform`: escala num ancestral do
vídeo tira o quadro da placa. No exemplo (195 quadros, 9:16), pela caixa: 195 na placa e 0 no canvas; o mesmo take com
o `.kz-zoom` da v1 (escala no invólucro): 49 na placa e 146 no canvas.

## Como aplicar

1. Monte o take com `montar(item, ctx)` de `montar.ts` (o `kodecz assemble` chama): `src`, `de` e `ate` do take na
   composição, `inicioNoVideo`, `formatoFonte`, `foco`, `aproximacao`, `enfases` (palavras do roteiro, ou
   `{ palavra, ocorrencia }`), `escala`, `saida` e `cartao`. Devolve o HTML (com os `@keyframes`) e o `bloco.css`.
2. Cada ênfase vai da palavra (`ctx.quando`) ao fim da frase dela (`ctx.fimDaFrase`, pontuação do roteiro); duas na
   mesma frase são recusadas. Frase que passa do corte do take acaba no último quadro dele.
3. `foco` mira o ponto de interesse (G23); o recorte 16:9 → 9:16 sai dele, preso às bordas da fonte.
4. Texto fica fora do `.kz-take` (o zoom não pode levar texto para o rosto, G15). A faixa do trecho sai no mesmo fim da
   frase (G21).
5. v1, ainda aceita: o invólucro `.kz-zoom` com `--inicio`, `--fim`, `--escala` (1.15), `--entrada`, `--saida` e
   `--zoom-origem` (o vídeo vai pelo canvas enquanto escala).

## Bloco

```html
<div class="kz-take" data-bloco="zoom-ate-o-fim-da-frase" style="--inicio: 0; --fim: 195; --kz-n: 195; --kz-caixa: ⟨nome⟩-caixa; --kz-video: ⟨nome⟩-video">
  <div class="kz-take-caixa" data-valor="0">
    <video class="kz-take-video" data-papel="apresentador" src="apresentador.mp4" data-inicio="0" data-recorte="0" data-quadros="195"></video>
    <i class="kz-take-enfase" style="--inicio: 49; --fim: 82" data-valor="0"></i>
  </div>
</div>
```

Os `@keyframes` (`left`, `top`, `width`, `height` do vídeo; caixa, raio e contorno do cartão; `--kz-punch`) são
amostrados por quadro e saem do `montar.ts`; os pontos que a reta dos vizinhos já dá são tirados. Escrito à mão, só
o v1 (`bloco.html`).

## Conferência

- `zoom.ordem` e `zoom.volta` (P0, v1): `--fim` depois do `--inicio`; no último quadro em que o `.kz-zoom` aparece a
  escala é 1.
- `zoom.enfase-ordem` (P0): a ênfase acaba depois da palavra.
- `zoom.enfase-volta` (P0): no quadro do fim da frase o punch-in (`--kz-punch`, herdado pelo marcador) é 0.
- `zoom.take-volta` (P0): no último quadro do take o punch-in é 0 (voltou antes do corte).
- A conferência da pausa contra os tempos do Whisper e a do rosto livre (H03) são do S04.

## Erros comuns

- Duração fixa no lugar da âncora de frase.
- Fim de frase tirado do Whisper, que pontua diferente do roteiro.
- `transform: scale` num invólucro do vídeo: o quadro vai para o canvas.
- `object-fit: cover` no vídeo ampliado: também vai para o canvas; o recorte é a caixa, do `montar.ts`.
- Pôr a legenda dentro do take: ela cresce junto e sai da zona segura.

## Exemplos

- `exemplo-apresentador.html`: o apresentador sintético (`gerar-midia.sh`) 16:9 recortado para 9:16, aproximação
  lenta e punch-in em «três» e «tudo» (a vírgula depois de «tudo» não fecha a frase). Gerado por
  `node blocos/zoom-ate-o-fim-da-frase/montar.ts exemplo`.
- `exemplo.html`: v1, um retângulo no lugar do apresentador, zoom do quadro 20 ao 50.
