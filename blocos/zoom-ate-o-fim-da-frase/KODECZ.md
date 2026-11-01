---
name: zoom-ate-o-fim-da-frase
description: Zoom de ênfase (punch-in) no apresentador que entra na palavra de ênfase e só sai na pausa depois do fim da frase dela. Use para destacar uma palavra ou número dito pelo apresentador; é o movimento de câmera dos blocos.
id: H02
versao: 1
estado: em-uso
regras: [G21, G14, G15, G23]
quando: [apresentador na tela, palavra de ênfase marcada no roteiro]
nao-quando: [duas ênfases na mesma frase, plano já fechado no rosto]
entradas:
  palavras: "tempos por palavra do Whisper (G11)"
  roteiro: "pontuação do roteiro: o fim da frase é o primeiro . ! ou ? depois da palavra"
  design: "DESIGN.md: motion.easing.move (padrão cubic-bezier(0.65, 0, 0.35, 1))"
parametros:
  escala: { padrao: "1.15", faixa: "1.08 a 1.25" }
  entrada: { padrao: "6 quadros", faixa: "0 (corte seco) a 9 quadros a 30 qps" }
  saida: { padrao: "12 quadros", faixa: "6 a 15 quadros a 30 qps" }
  zoom-origem: { padrao: "50% 38%", faixa: "o ponto de interesse (G23)" }
saidas: "um invólucro .kz-zoom em volta do vídeo, com --inicio e --fim em quadros"
custo: { preparacao: "nenhuma além do Whisper", render: "repete-quadro: o vídeo embutido já desenha todos no trecho dele", contexto: "~1000 tokens" }
conferencia: [zoom.ordem, zoom.volta]
origem:
  - "G21 (skill video-konecz, origens.md)"
  - "pesquisa P12, H02 (docs/pesquisa/habilidades-de-edicao.md)"
  - "catálogo do HyperFrames em 2818160: push-in e cinematic-zoom, só o nome; nenhum código lido nem copiado (R06)"
license: Proprietária
---

## O que é

O quadro aproxima o apresentador na palavra de ênfase e segura até a frase acabar; volta na pausa seguinte.

## Por quê

G21: zoom de duração fixa voltava no meio da frase, e o corte no meio da fala parece erro. Um zoom por frase, no
máximo: racionado, ele marca; em toda frase, cansa.

## Como aplicar

1. `--inicio` = quadro do início da palavra de ênfase; `--fim` = quadro do começo da pausa depois do fim da frase
   (o primeiro intervalo ≥ 150 ms sem palavra depois da última palavra da frase; pontuação do roteiro, não do Whisper).
2. O invólucro `.kz-zoom` envolve só o vídeo do apresentador; texto fica fora dele (o zoom não pode levar texto para o
   rosto, G15).
3. `--zoom-origem` mira o ponto de interesse (G23), entre o rosto e as mãos.
4. A faixa do trecho, se houver, sai no mesmo `--fim` (G21).

## Bloco

```html
<div class="kz-zoom" data-bloco="zoom-ate-o-fim-da-frase" style="--inicio: 199; --fim: 222; --escala: 1.15">
  <video class="tela-apresentador" data-papel="apresentador" src="apresentador.mp4" data-inicio="90"></video>
</div>
```

Duas animações no invólucro: entrada (`forwards`, no `--inicio`) e saída (`forwards`, no `--fim`, declarada depois:
vence quando começa). Antes do `--inicio`, sem `backwards`, vale a escala 1.

## Conferência

- `zoom.ordem` (P0): `--fim` depois do `--inicio`.
- `zoom.volta` (P0): no último quadro em que o zoom aparece (o corte da cena ou o fim do vídeo) a escala é 1 (o zoom voltou antes do corte).
- A conferência da pausa contra os tempos do Whisper e a do rosto livre (H03) são do S04: precisam das palavras e da
  caixa do rosto, que não estão no DOM.

## Erros comuns

- Duração fixa (`1000ms`) no lugar da âncora de frase.
- Fim de frase tirado do Whisper, que pontua diferente do roteiro.
- Pôr a legenda dentro do invólucro: ela cresce junto e sai da zona segura.

## Exemplos

- `exemplo.html`: um retângulo no lugar do apresentador (sem mídia), zoom do quadro 20 ao 50.
