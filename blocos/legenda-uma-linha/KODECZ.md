---
name: legenda-uma-linha
description: Legenda presa à fala, palavra a palavra, sempre numa linha só, com as frases montadas pela largura medida na fonte de cada formato. Use em todo vídeo com fala e legenda, em 16:9 e 9:16.
id: H01
versao: 2
estado: em-uso
regras: [G17, G14, G11, G07, G19]
quando: [fala com legenda]
nao-quando: [texto de documento real (DOC)]
entradas:
  palavras: "tempos por palavra do Whisper, texto do roteiro (G11)"
  design: "DESIGN.md: typography.caption, colors.ink, colors.accent, colors.muted, colors.ground, rounded.card"
  formato: "largura, altura e qps da composição"
parametros:
  legenda-largura: { padrao: "84%", faixa: "70% a 90% da largura" }
  legenda-base: { padrao: "12%", faixa: "acima da zona segura de baixo (G19)" }
  legenda-fundo: { padrao: "ground a 78%", faixa: "qualquer cor do DESIGN.md" }
saidas: "um .kz-legenda por frase e um .kz-palavra por palavra, com --inicio e --fim em quadros"
custo: { preparacao: "medir as palavras na fonte, sem placa", render: "repete-quadro: sim", contexto: "~1100 tokens" }
conferencia: [legenda.uma-linha, legenda.cabe, legenda.zona-segura, legenda.uma-por-vez]
origem:
  - "G17 e G14 (skill video-konecz, origens.md)"
  - "pesquisa P12, H01 (docs/pesquisa/habilidades-de-edicao.md)"
  - "catálogo do HyperFrames em 2818160: caption-highlight e caption-pill-karaoke, só o nome; nenhum código lido nem copiado (R06)"
license: Proprietária
---

## O que é

A fala aparece em frases curtas, uma de cada vez, sempre numa linha. A frase inteira entra no começo dela (a largura
não muda enquanto se fala); a palavra dita agora fica em `accent`, as já ditas em `ink` e as que faltam em `muted`.

## Por quê

G17: a legenda cortada em número fixo de palavras quebrou em duas linhas no 9:16 do caso de teste. Duas linhas tampam
mais a imagem e mudam de altura a cada frase. Aqui o tamanho é o do `DESIGN.md` e o que muda é onde a frase corta.

## Como aplicar

1. Na preparação (fora da página): medir cada palavra na fonte e no tamanho de `typography.caption` do formato
   (canvas `measureText` depois de `document.fonts.ready`, ou as métricas do arquivo da fonte).
2. Juntar palavras enquanto couber em `--legenda-largura` menos o respiro, nunca por número fixo de palavras (G17).
   Toda pontuação (`. , : ; ! ?`) fecha a frase. Frase que não cabe corta antes: depois de uma pausa ≥ 150 ms, se
   houver, senão entre duas palavras; artigo, preposição e conjunção do fim descem para a frase seguinte.
3. Tempos em quadros: `q = round(segundos × qps)`. Cada frase com `--inicio` = início da primeira palavra e `--fim` =
   início da frase seguinte (ou fim da última palavra). Cada palavra com o `--inicio` e o `--fim` dela na fala
   (do Whisper; G14: tempos vêm das palavras, nunca de número fixo). Não esticar o `--fim` da palavra até a seguinte:
   o `bloco.js` publica esses tempos como a fala, e a pausa depois da frase (onde o zoom volta, G21) sumiria.
4. O texto vem do roteiro, não do Whisper (G07: número e sigla por extenso só na voz).
5. `bloco.css` no `<head>` e `:root { --fps: … }` igual ao do bloco `kodecz`.
6. Para a conferência do S04 (`kodecz check`): cada frase leva `data-papel="legenda"` e o `bloco.js`, depois
   das legendas, publica a fala em `window.motor_falas` a partir das palavras (se a página ainda não publicou).

## Bloco

`bloco.html` (estrutura) e `bloco.css` (regras). O essencial:

```html
<div class="kz-legendas" data-bloco="legenda-uma-linha">
  <p class="kz-legenda" style="--inicio: 175; --fim: 222">
    <span class="kz-palavra" style="--inicio: 175; --fim: 180">O</span>
    <span class="kz-palavra" style="--inicio: 180; --fim: 188">zoom</span> …</p>
</div>
```

A frase e cada palavra ligam e desligam com pares de animações de duração zero e `forwards` (a de depois vence):
`opacity` 1 no `--inicio` e 0 no `--fim` da frase; `accent` no `--inicio` e `ink` no `--fim` da palavra. Uma
animação que durasse a frase inteira faria o motor desenhar todos os quadros dela (P10.3).

## Conferência

- `legenda.uma-linha` (P0): em cada quadro com a frase visível, o texto dá uma linha só.
- `legenda.cabe` (P0): a frase não passa da largura da caixa (com `nowrap`, a sobra seria cortada).
- `legenda.zona-segura` (P0): a caixa fica dentro de `--spacing-safe` das bordas (G19).
- `legenda.uma-por-vez` (P1): nunca duas frases visíveis no mesmo quadro.

## Erros comuns

- Cortar por número de palavras (o erro de origem).
- Seguir a frase depois da vírgula ou do ponto só porque ainda cabe: a pontuação fecha a frase (G17).
- Medir com a fonte reserva, antes de a fonte carregar.
- Usar o texto do Whisper na legenda (sai «dois mil e vinte e seis»).
- Esquecer o `--fim` da palavra: ela herda o da frase e fica em `accent` até o fim.

## Exemplos

- `exemplo.html`: duas frases, certas.
- `exemplo-errado.html`: a mesma fala em grupos de palavras sem medir, com quebra; a conferência acusa
  `legenda.uma-linha` e `legenda.uma-por-vez`.
