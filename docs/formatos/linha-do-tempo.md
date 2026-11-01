# Formato: composição em linha do tempo declarada (P10)

O formato do motor sem o Remotion: uma página HTML comum, com as animações declaradas, que o motor põe no quadro N.
É o que o serviço de render aceita (`scope.md`, P10 e P09). Exemplo mínimo e completo:
`cli/fixtures/linha-sintetica/index.html`.

## Pasta

- `index.html` na raiz, com o bloco de declaração. O resto (CSS, JS, imagens, fontes) fica na mesma pasta e é
  servido por HTTP local; a rede para fora é bloqueada (fontes do Google só pelo cache, `adr.md` seção 9; a que faltar o render baixa uma vez).
- O bloco (o `<script>` com `id="motor-video"` e `type="application/json"`, fora de comentário) é o que diferencia
  do pacote do Remotion:

```html
<script type="application/json" id="motor-video">
{ "id": "MinhaComposicao", "largura": 1920, "altura": 1080, "qps": 30, "quadros": 300 }
</script>
```

| Campo | Regra |
|---|---|
| `id` | texto; o `<composição>` do comando tem de ser igual |
| `largura`, `altura` | px, inteiros pares até 8192 (limite do NVENC); largura ≥ 800 (a faixa da marca tem 800 px), altura ≥ 16 |
| `qps` | quadros por segundo, inteiro de 1 a 240 |
| `quadros` | duração em quadros, inteiro ≥ 1 |

## Animação

- Toda animação da página na `document.timeline` vale: CSS `@keyframes` (`animation:`) e `element.animate()`.
  Todas começam em t = 0 do vídeo; o momento de entrada é o `delay` (ou `animation-delay`).
- A `document.timeline` fica parada desde antes de a página carregar: nada anda sozinho, nem a animação curta sem
  `fill` enquanto a página demora a ficar pronta.
- No quadro N, o motor pausa cada animação e põe `currentTime = N × 1000 / qps`, inclusive nas que já acabaram sem
  `fill`. O quadro depende só de N: começar no meio (`--de`) ou fora de ordem dá o mesmo quadro (R03, P10.4). Uma
  ressalva: com a rasterização na placa, a sombra borrada (`box-shadow`) pode variar até 2 níveis conforme o caminho
  até o quadro, dentro da régua do R03 (decisão do responsável de 2026-10-30;
  `docs/experimentos/2026-10-p10-4-ponto-de-partida.md`).
- `will-change` pode ser usado (camada própria, texto em tons de cinza). O motor tira a dica de transform
  (`transform`, `translate`, `rotate`, `scale`, `perspective`, `transform-style`) e põe `left` no lugar: com a dica, o
  Chromium guardava a rasterização da camada na posição em que ela apareceu primeiro, e o quadro N dependia de onde o
  render começou (até 98 níveis na borda do texto, achado no P13). A camada própria, o contexto de empilhamento e o
  bloco de contenção ficam (estes por um `translate: 0px` que perde para qualquer regra da página); o `backdrop-filter`
  de um filho continua vendo a página. A troca acompanha o que a página muda (classe, `style`, elemento ou folha
  nova) e é desfeita quando a dica sai. O resumo do render conta os elementos trocados no fim em `camadasNeutras`.
  Uma camada que anda passa a ser rasterizada de novo a cada quadro, como sem `will-change`.
  Fora do alcance (a dica fica e o começo no meio pode diferir): pseudoelemento (`::before`, `::after`), shadow DOM,
  iframe, dica que muda por seletor de irmão (`+`, `~`, `:has()`) ou por variável herdada.
- Tempo em quadros pelo CSS: com `:root { --qps: 30 }`, `animation-delay: calc(var(--inicio) * 1s / var(--qps))` cai
  exatamente no quadro (conferido de 24 a 60 qps; é o jeito dos blocos do S02, `blocos/INDICE.md`).
- `@keyframes` com `var()` que um script põe depois que a página já calculou o estilo pode nascer sem o valor (visto
  no S02, de vez em quando): para valores que o script calcula, usar `element.animate()`.
- O que não é animação (canvas, WebGL, texto trocado por JS) vai no gancho opcional
  `window.motor_quadro(n, ms)`, chamado antes das animações; pode devolver uma Promise. Ele tem de depender só de
  `n`, nunca do quadro anterior nem do relógio.
- Não usar: `requestAnimationFrame`, `setTimeout`/`setInterval` para animar, `Date.now()`/`performance.now()` (o
  relógio continua andando). Animação de rolagem (`ScrollTimeline`) ou de outra `DocumentTimeline` não anda com N:
  sai parada, contada em `animacoesSoltas` no JSON do comando, com aviso no stderr. Transição de CSS vai direto ao
  fim (contada em `transicoesAoFim`).

## GSAP e Lottie (S01)

O formato é **compatível** com páginas que usam GSAP ou Lottie (lottie-web): **o cliente traz a biblioteca** na pasta
dele, como qualquer outro arquivo. O motor não distribui nenhuma das duas, não as põe no repositório nem no serviço, e
o editor e os blocos da Konecz não geram código GSAP (parecer jurídico, J5: `docs/pesquisa/parecer-juridico.md`). Fora
o bloco de declaração, a página fica como o cliente escreveu. Exemplos: `cli/fixtures/linha-gsap/index.html` e
`cli/fixtures/linha-lottie/index.html` (sem a biblioteca; os testes a copiam do cache local, `cli/fixtures/bibliotecas.ts`).

**GSAP** (3.x, o arquivo UMD carregado por `<script src="gsap.min.js">`, que põe a `window.gsap`):

- Antes dos scripts da página, o motor vigia a `window.gsap`: quando o GSAP chega, a linha do tempo raiz dele fica
  pausada em 0 e deixa de remover as animações que acabam. O ticker do GSAP não anda nada sozinho.
- Toda animação criada na carga da página começa em t = 0 do vídeo (o momento de entrada é o `delay` ou a posição na
  timeline). No quadro N, o motor põe a raiz no tempo N / qps; a animação de cima pausada (`gsap.timeline({ paused:
  true })`, por exemplo) vai ao tempo N / qps contado do começo dela, também sem a página dar `play`.
- `onUpdate` e os outros eventos valem (o contador que escreve o texto pelo `onUpdate` sai certo).
- Começar no meio, fora de ordem e com saltos dá o mesmo quadro (R03, P10.4), como nas Web Animations; o quadro 0 é
  sempre o de voltar a 0.
- Derrubam o render, com o motivo: GSAP fora da `window.gsap` (módulo ES sem `window.gsap = gsap` antes de criar as
  animações; o GSAP deixa o rastro em `window.gsapVersions`), mais de um GSAP na página, e GSAP que chega à
  `window.gsap` com animações já criadas.
- Não usar: animação criada depois da carga (num `setTimeout`, num evento ou num `onComplete`: ela começaria no tempo
  em que a raiz estiver), `gsap.ticker.add` (o ticker dorme no render), ScrollTrigger e outros plugins que dependem
  de rolagem ou do mouse.

**Lottie** (lottie-web 5.x, por `<script src="lottie.min.js">`, que põe a `window.lottie`; `lottie.loadAnimation` com
`animationData` ou `path` para um JSON da pasta):

- Antes do primeiro quadro, o motor espera cada animação registrada carregar (`DOMLoaded`; a que falha derruba o
  render) e congela o laço do lottie-web (`lottie.freeze()`).
- No quadro N, cada animação vai ao quadro `N × fr × velocidade / qps` dela (`goToAndStop(…, true)`, com subquadro):
  com `loop: true`, volta ao começo a cada `totalFrames`; com `loop: k`, dá k + 1 voltas; sem laço (ou depois da
  última volta), para no último quadro (`totalFrames − 1`), como o lottie-web. Começa em t = 0 do vídeo.
- Direção para trás (`setDirection(-1)`), segmentos (`playSegments`) e animação criada depois da carga não seguem N.
  Toda animação registrada anda com N, também a de `autoplay: false`.
- O lottie-web empacotado num módulo (sem a `window.lottie`) não é visto e andaria no relógio, sem erro: carregar o
  `lottie.min.js` por `<script>`. Imagens dentro do Lottie (renderer SVG) não são esperadas.

Limites do GSAP, também sem erro: a timeline de cima pausada de propósito anda com N mesmo assim. O GSAP 2
(`TweenMax`, `TweenLite`) derruba o render.

## Quadros parados

Na placa, o motor não desenha de novo o quadro em que nada anda: ele repete o anterior no vídeo, sem passar pela
página (P10.3). Quem diz o que anda são as próprias animações: o intervalo de cada uma (`delay` até o `endTime` do
`getComputedTiming()`, sem fim se repete para sempre). Por isso:

- só vale sem `window.motor_quadro`: com o gancho, o motor não sabe o que ele muda e desenha todos os quadros
  (`repetirNao: "motor_quadro"` no JSON); o mesmo com animação fora da `document.timeline`;
- com GSAP ou Lottie na página (S01), também desenha todos (`repetirNao: "GSAP"` ou `"Lottie"`): o motor não lê
  o que eles mudam;
- SVG SMIL (`<animate>`, `<animateTransform>`, `<animateMotion>`, `<set>`) e `<img>` que pode ser animada (GIF,
  APNG, WebP animado; pela extensão, então também `.png` e `.webp`) mudam sem a `document.timeline`: com eles na
  página, o motor desenha todos (`repetirNao: "SVG SMIL"` ou `"imagem que pode ser animada (GIF, APNG, WebP)"`);
- uma animação conta como andando no intervalo inteiro dela, mesmo com o valor parado (`from, to { opacity: 1 }`
  durante uma cena): o motor desenha todos esses quadros. Para ligar e desligar algo, duas animações de duração zero
  com `forwards`, uma no começo e outra no fim (a de depois vence), como em `blocos/cena/bloco.css` (S02);
- fora isso, o que muda tem de ser animação. Mudança fora dela não é vista e pode sair parada (script com relógio, já
  proibido acima);
- o vídeo embutido muda o quadro sem animação: do primeiro quadro dele (`data-inicio`) ao que limpa o canvas
  (`data-inicio` + `data-quadros`), o motor desenha todos; fora do trecho, repete. O áudio (de `<audio>` ou de
  `<video>`) não impede: o motor o mistura pelos tempos declarados, também nos quadros repetidos;
- começando no meio ou fora de ordem (R03, P10.4), só repete o quadro que vem logo depois do anterior; depois de
  quadros repetidos, o seguinte desenhado não precisa do N − 1 antes (nada mudou desde o último desenhado);
- `MOTOR_REPETIR=0` desenha todos (para conferir ou medir).

## Imagens e fontes

- Antes do primeiro quadro, o motor espera as fontes (`document.fonts.ready`) e a decodificação de cada `<img>`; a
  cada quadro, também a de `<img>` posta ou trocada depois (pelo `motor_quadro`). Imagem que não carrega derruba o
  render.
- Imagem de fundo do CSS (`background-image`) não é esperada: usar `<img>` (com `object-fit`) para o que precisa
  estar no primeiro quadro.

## Fundo e alfa

O motor não mexe no fundo da página. Com `--alfa`, o que a página não pinta fica transparente; para uma camada de
gráficos, deixar `html` e `body` sem fundo. Sem `--alfa`, o transparente sai preto.

## Vídeo e áudio (P10.5)

Os `<video>` e `<audio>` que estão no documento quando a página termina de carregar (no HTML ou postos pelos scripts
dela; não os de `<template>` nem os criados depois) entram no render. Exemplo completo:
`docs/experimentos/2026-10-p10-5-composicao-nossa/linha/index.html`; mínimo: `cli/fixtures/linha-video/index.html`.

```html
<video class="tela" src="apresentador.mp4" data-inicio="0" data-recorte="12" data-quadros="225"></video>
<audio src="trilha.wav" data-inicio="30" data-volume="0.6"></audio>
```

| Atributo | Regra |
|---|---|
| `src` | arquivo dentro da pasta da composição (o motor serve só ela; um link para fora vale). Sem `<source>` |
| `data-inicio` | quadro da composição em que a mídia começa, inteiro ≥ 0 (padrão 0) |
| `data-recorte` | quantos quadros, no qps da composição, cortar do começo da mídia (padrão 0), como o `trimBefore` do Remotion |
| `data-quadros` | quantos quadros da composição ela ocupa, inteiro ≥ 1 (padrão: até o fim da mídia ou da composição; com velocidade, (duração × qps − recorte) / velocidade) |
| `data-volume` | volume fixo, de 0 a 10 (padrão 1), ou pontos `quadro:volume` (C02), como `"0:0 6:1 580:1 600:0"`: o quadro é contado do começo da mídia na composição (0 = `data-inicio`) e cresce; entre dois pontos, a reta; antes do primeiro e depois do último, o volume da ponta |
| `data-velocidade` | velocidade da mídia (C02), número de 0,1 a 10 (padrão 1): 2 anda o dobro, 0,5 a metade. O áudio acelera sem mudar o tom |
| `muted` | sem som (o vídeo aparece; o áudio dele não entra na mistura) |

- **Quadro do vídeo:** no quadro N da composição, o tempo no vídeo é
  t = (N − `data-inicio`) × `data-velocidade` / qps + `data-recorte` / qps; t vai ao tick mais próximo da base de
  tempo do vídeo, e o quadro mostrado é o último que começa até esse tick (pts contado do primeiro quadro, sem folga).
  É a regra do `<OffthreadVideo>` do Remotion 4.0.536 (o compositor: `calc_position` e `get_item_id`), conferida
  quadro a quadro com vídeos de 24, 25, 29,97 e 30 qps em composições de 25, 30 e 60, com e sem início e recorte. Com
  o mesmo qps e velocidade 1, é o quadro N − início + recorte, exato; com 29,97 em 30, o quadro N − 1 a partir do 1; a
  2, 2 × (N − início) + recorte; a 1,1, o piso de 1,1 × (N − início) + recorte. O recorte conta na mídia, sem
  acelerar. Só depende de N (R03); começar no meio (`--de`) mostra o mesmo quadro. Vale pelos dois caminhos (o canvas
  e o NVDEC do S08).
- **Tempos do MP4:** o quadro N sai em N / qps exato (base de 90 kHz), sem deriva. Para comparar com outro render,
  casar pelo índice do quadro ou pelo tempo; os dois dão o mesmo par.
- **Quem decodifica é o motor**, não o `<video>` do Chromium: um ffmpeg por vídeo, em ordem, entrega o quadro em I420;
  a página monta o `VideoFrame` e converte a cor com a mesma conta do vídeo do Remotion (`cor-limpa.js`, M09 e P05). O
  `<video>` vira um `<canvas>` do tamanho do vídeo, com os mesmos atributos (`class`, `id`, `style`, `data-*`, menos os
  de mídia e `width`/`height`) e `data-motor-video`. Estilizar por classe ou id, não pelo seletor `video`; o tamanho
  na tela vem do CSS (`object-fit` vale no canvas). Fora do trecho da mídia, o canvas fica transparente.
- **Na placa, o vídeo vai por baixo da página (S08):** o H.264 ou HEVC é decodificado no NVDEC e montado por baixo da
  textura da página antes do NVENC, com a mesma conta de cor; o canvas fica transparente. Vale no quadro em que o vídeo
  está em tamanho 1:1, no pixel inteiro, posicionado (`position` diferente de `static`), sem opacidade, filtro, máscara,
  recorte arredondado nem transformação que não seja deslocamento nele ou nos ancestrais, e sem nada pintado por baixo
  dele além do fundo de cor da raiz, de um ancestral que cobre o quadro inteiro ou de um ancestral que o vídeo cobre.
  O vídeo ampliado ou reduzido e o **cartão de canto arredondado** também vão pela placa: um ancestral com `overflow`
  diferente de `visible` e `border-radius` (os quatro cantos iguais, em círculo, a caixa no pixel inteiro, sem
  `border` nem fundo próprio), com `box-shadow` (de fora) e `outline` (de fora, `outline-offset` ≥ 0) nele. Nada
  posicionado depois do vídeo pode cruzar os cantos (uma tarja por cima do canto manda o quadro para o canvas), salvo o
  fundo de um elemento quase opaco (90 % ou mais, sem sombra nem filtro, sem opacidade nos ancestrais) que cobre o canto
  inteiro, com o texto dele e sem outro elemento no mesmo canto (a legenda passando pelo canto do cartão). Com o texto
  no canto, até 3 níveis em até 2 pixels por quadro contra o canvas (exceção do R03, `domain.md`).
  Nos outros quadros (uma entrada com escala ou opacidade, por exemplo), o motor decodifica na CPU e desenha o canvas,
  como acima; o resultado é o mesmo. Um vídeo por quadro vai pela placa. `MOTOR_TAKE_PLACA=0` põe todos pelo canvas.
- **Vídeo aceito:** 4:2:0 de 8 bits (`yuv420p`, `yuvj420p`), largura e altura pares, pixel quadrado, sem rotação no
  metadado; matriz bt709, bt601, smpte240m ou bt2020 (sem marca: bt709 com 720 linhas ou mais, como o Remotion). O
  resto derruba o render com o motivo.
- **Áudio:** o `<audio>` sai da página. O som de cada `<audio>` e de cada `<video>` sem `muted` é misturado pelo motor
  com os tempos declarados (o mesmo ffmpeg único do M07, `composicao/audio.ts`), em AAC 320 kbit/s no MP4. `--sem-audio`
  desliga. Com `data-velocidade` (C02), o som da mídia é acelerado pelo `atempo` do ffmpeg, que muda a duração sem
  mudar o tom (encadeado em raízes quando a velocidade sai de 0,5 a 2, como o Remotion), e começa no `data-recorte`
  da mídia; o volume por pontos conta nos quadros da composição. Laço ainda não existe.
- **Volume variável (C02):** com pontos, cada quadro leva o volume da reta naquele quadro (a conta do `interpolate` do
  Remotion), constante dentro do quadro e na mesma expressão do ffmpeg que a entrada do Remotion usa; o quadro com
  volume 0 sai da mistura, como no Remotion. A rampa `interpolate(f, [0, 6, total − 20, total], [0, 1, 1, 0])` da
  função de volume do Remotion vira `data-volume="0:0 6:1 <total − 20>:1 <total>:0"`.
- **No navegador comum** (prévia de quem escreve), `<video>` e `<audio>` tocam sozinhos e não seguem os atributos; o
  que vale é o render.

## Destino: `data-destino` (G19)

O destino do vídeo vai no `<html>`: `<html data-destino="reels">`. Valores: `reels`, `instagram`, `anuncio`, `tiktok`,
`shorts`, `youtube` (sem acento e em minúsculas; a conferência também aceita `Reels` ou `anúncio`). O render ignora o atributo;
quem lê é a conferência (`docs/formatos/conferencia.md`), depois de a página ficar pronta, então vale também o que um
script da composição puser em `document.documentElement`. Nos destinos com a interface do aplicativo por cima
(`reels`, `instagram`, `anuncio`, `tiktok`, `shorts`), a zona segura (G19) é conferida; sem o atributo, ou com outro valor, não é
(decisão do responsável de 2026-11-01).

## Ainda não existe

Valores de fora (o `--props` era da entrada do Remotion, que saiu do motor em 2026-10-31); laço de mídia.
