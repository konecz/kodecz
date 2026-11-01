# Conversão de cor do vídeo embutido: especificação (P05, sala limpa)

Especificação da conversão de YUV para RGB que o motor faz na página para o vídeo embutido (escrita para a entrada do Remotion, que saiu do motor em 2026-10-31; vale hoje para o vídeo da linha do tempo, P10.5)
(M09). Escrita para a reescrita em sala limpa (`docs/pesquisa/auditoria-derivado.md`, seção 6): diz **o que** a
conversão faz, como comportamento observável, e de onde vem cada número (norma pública ou medição). Não diz como a
implementação anterior faz a conta e não tem código, nomes internos, tabelas nem constantes dela nem do ffmpeg.

O teste de caixa-preta que acompanha esta especificação é
`composicao/cor-limpa.test.ts`. O módulo novo é
`composicao/cor-limpa.js`.

## 1. Para que serve

No render da entrada do Remotion, o `@remotion/media` decodifica o vídeo com o WebCodecs e transforma cada
`VideoFrame` em `ImageBitmap` com `createImageBitmap(frame)`, sem opções. Deixada ao Chromium, essa conversão de
YUV para RGB não sai igual à do Remotion. A régua é a foto do quadro que o compositor do Remotion tira com o ffmpeg
(swscale): yuv420p para BGR de 8 bits, do mesmo tamanho, com o filtro bilinear. O motor intercepta o
`createImageBitmap` e faz ele mesmo a conversão, para o quadro sair **igual, bit a bit, ao que o ffmpeg dá** na mesma
entrada.

O formato do serviço (linha do tempo declarada, P10) não carrega este módulo.

## 2. Entrada

- Um `VideoFrame` do WebCodecs com `format === 'I420'`: YUV 4:2:0 planar de 8 bits, três planos (Y inteiro; U e V
  com metade da largura e metade da altura).
- A região convertida é o `visibleRect`; largura e altura dela têm de ser pares.
- O `colorSpace` do quadro (`matrix`, `fullRange`; `primaries` e `transfer` não entram na conta) e a altura visível
  decidem a matriz e a faixa (seção 5).
- Os bytes vêm de `frame.copyTo(buffer)`, que devolve o layout (`[{ offset, stride }]`, um por plano). O stride pode
  ser maior que a largura do plano (folga) e os planos podem estar em qualquer ordem no buffer: só o layout devolvido
  vale.

## 3. Saída

- Um `ImageBitmap` do tamanho visível, opaco (alfa 255), com a linha 0 do plano Y no topo. Lido de volta num canvas
  2D (`drawImage` e `getImageData`), cada pixel tem de dar exatamente o R, G e B que o ffmpeg dá (seção 6).
- Feito na página com WebGL2 (num `OffscreenCanvas`), não pixel a pixel em JS: o JS é a referência e o teste; o
  desenho no quadro é da placa. A conta no shader tem de dar o mesmo resultado da função em JS (o autoteste da seção
  4.3 confere).
- 8 bits por canal. Fora de 0..255 satura (nunca dá a volta).

## 4. Interface

O arquivo é um **script clássico** (sem `import`/`export`): o `captura/main.ts` lê o texto e o injeta na página antes do
pacote, e o teste o roda com `vm.runInNewContext`. Ao rodar, ele:

- define `globalThis.corLimpa` com as três funções da seção 4.1;
- se houver `window` com `createImageBitmap` (na página), chama `corLimpa.instalar(window)`. Fora da página (no
  Node, contexto vazio) não instala nada e não falha.

### 4.1. Funções puras (`globalThis.corLimpa`)

| Função | Argumentos | Retorno |
|---|---|---|
| `escolha(colorSpace, altura)` | o `VideoFrame.colorSpace` (pode ser `null`, `undefined` ou ter campos `null`) e a altura visível em linhas | `{ matriz, faixa }` com `matriz` em `'bt601'`, `'bt709'`, `'smpte240m'`, `'bt2020'` e `faixa` em `'tv'`, `'cheia'`; ou `null` se o quadro não é YUV conhecido (seção 5). Pode ter outros campos (por exemplo, os coeficientes já calculados); o teste só olha estes dois |
| `quadro(entrada, escolha)` | `entrada = { largura, altura, dados, planos }`: `dados` é `Uint8Array`, `planos` é `[{ offset, stride }]` para Y, U e V nessa ordem, como o `copyTo` devolve; `escolha` é o que `escolha()` devolveu (ou um objeto com só `matriz` e `faixa`) | `Uint8Array` (ou `Uint8ClampedArray`) RGBA de `largura × altura × 4`, linha 0 no topo, alfa 255 |
| `instalar(janela)` | o `window` da página | nada; faz o descrito em 4.2 e 4.3 |

`quadro` é a referência em JS da mesma conta do shader. Não precisa ser rápida, mas a varredura do teste passa por
ela 16,7 milhões de vezes por matriz e faixa: evitar alocar por pixel.

### 4.2. Na página: o `createImageBitmap` embrulhado

`instalar(janela)` troca `janela.createImageBitmap` por uma função assíncrona que:

1. Se a fonte não é um `VideoFrame` (ou não existe `VideoFrame`), chama o original sem contar nada.
2. **Passa ao original e conta em `passados`** (caminho de queda) quando o quadro é um `VideoFrame` que a conversão
   não cobre, guardando o motivo em `motivos[<texto>]++`. Os casos, nesta ordem:
   - chamada com mais de um argumento (opções ou recorte do `createImageBitmap`);
   - `rotation` diferente de 0 ou `flip` verdadeiro;
   - `format` diferente de `'I420'` (10 bits, NV12, com alfa, RGB…; o motivo diz o formato);
   - largura ou altura visível ímpar, ou `displayWidth`/`displayHeight` diferente do tamanho visível (pixel não
     quadrado);
   - `escolha()` devolve `null` (o motivo diz a matriz).

   O texto do motivo é livre, mas tem de nomear a causa. O `main.mjs` faz o render falhar se houver `passados` e
   `M04_COR_MISTA` não for `1`, com a mensagem `conversão de cor própria não cobriu …`.
3. Senão, converte: `copyTo` para um buffer reaproveitado (só cresce; um novo conta em `buffers`), confere o layout
   (3 planos, cada um cabe no buffer com stride ≥ largura do plano e offset ≥ 0), desenha com o WebGL2 e devolve o
   `ImageBitmap`. Conta em `convertidos`.

Recursos: **um** contexto WebGL2 para a página inteira, criado no primeiro quadro; texturas reaproveitadas entre
quadros e trocadas só quando o tamanho muda (as velhas apagadas). O `conferir-cor.mjs` exige, no fim de um render com
vídeo de um tamanho só: `contextos === 1`, `texturas === 3` (vivas), `passados === 0`, `erro` nulo, `buffers ≤ 2`.
Se a implementação nova não usar três texturas, o `conferir-cor.mjs` muda junto, com a justificativa.

**Falha nunca vira quadro errado.** Qualquer erro da conversão própria rejeita a promessa com `Error` cuja mensagem
começa com `motor_cor: ` e grava a mensagem em `motor_cor.erro`; o render falha (nunca sai quadro vazio nem o vídeo
do quadro anterior). Mensagens que os testes de integração procuram (`testar-video.sh`):

| Situação | A mensagem começa com |
|---|---|
| layout do `copyTo` que não cobre os três planos ou não cabe no buffer | `motor_cor: layout` |
| contexto WebGL perdido (evento `webglcontextlost`, `isContextLost()` antes, durante ou depois do desenho) | `motor_cor: contexto` |
| sem WebGL2, shader que não compila, erro do `gl.getError()` | `motor_cor: ` e a causa |

Depois de perder o contexto, toda conversão seguinte falha com `motor_cor: contexto…` (não recria o contexto).

### 4.3. Contadores e autotestes na página (contrato com `captura/main.ts`, `conferir-cor.mjs` e `testar-video.sh`)

- `window.motor_cor`: objeto criado por `instalar`, que o `captura/main.ts` copia para o resumo do render. Campos:
  `convertidos`, `passados`, `motivos` (objeto motivo → contagem), `contextos`, `texturas` (vivas),
  `texturasApagadas`, `buffers`, `erro` (`null` ou a última mensagem). Pode ter outros.
- `window.motor_corAutoteste()`: assíncrona; cria `VideoFrame` I420 sintéticos (64×32, conteúdo pseudoaleatório que
  passe por toda a faixa), converte cada um pelo `createImageBitmap` embrulhado, lê de volta num canvas 2D e compara
  com `corLimpa.quadro` do mesmo quadro. Devolve o **número de amostras diferentes** (o `captura/main.ts` exige 0). Casos
  mínimos: bt709 TV, bt601 TV (`smpte170m`), bt709 cheia. As conversões do autoteste não contam em `convertidos`.
- `window.motor_corTesteFalhas()`: assíncrona, só com `M04_COR_TESTE=1`; deixa o contexto perdido de propósito.
  Devolve `{ layoutErrado, folga, perda }`:
  - `layoutErrado`: a mensagem do erro ao converter um quadro cujo `copyTo` devolve um layout que não cobre os
    planos (por exemplo, 2 planos); `'aceito'` se não falhou;
  - `folga`: amostras diferentes (tem de ser 0) ao converter um quadro criado com stride maior que a largura,
    comparado com `corLimpa.quadro` sobre o layout que o `copyTo` devolve;
  - `perda`: a mensagem do erro ao converter depois de `WEBGL_lose_context.loseContext()`; `'aceito'` se não falhou.

  Essas conversões também não contam em `convertidos`.

## 5. Matriz e faixa: a regra de escolha (comportamento da régua)

Nomes da matriz no WebCodecs (`VideoColorSpace.matrix`) e a matriz da norma que valem:

| `matrix` | Matriz |
|---|---|
| `bt709` | BT.709 |
| `smpte170m`, `bt470bg` | BT.601 |
| `smpte240m` | SMPTE 240M |
| `bt2020-ncl` | BT.2020 (luminância não constante) |
| `null` ou ausente | pela regra abaixo |
| `rgb` ou qualquer outro | não coberto: `escolha()` devolve `null` (caminho de queda) |

Faixa: `fullRange === true` é faixa cheia; `false`, `null` ou ausente é faixa TV. A saída é sempre faixa cheia.

| Faixa | Matriz marcada | Resultado |
|---|---|---|
| cheia | sim | a matriz marcada, cheia → cheia |
| cheia | não | BT.601, cheia → cheia (o padrão do ffmpeg) |
| TV ou sem marca | sim | a matriz marcada, TV → cheia |
| TV ou sem marca | não, altura ≥ 720 | BT.709, TV → cheia |
| TV ou sem marca | não, altura < 720 | BT.601, TV → cheia |

A altura é a do quadro visível. Os casos estão no teste (`escolha de matriz e faixa…`), um por linha.

**Decidido pelo responsável em 2026-10-30:** fica como está (a matriz marcada), porque esses dois casos não pesam no uso normal; a diferença para a régua do Remotion nunca foi medida. **Contexto original (não resolver na reescrita):** para `smpte240m` e `bt2020-ncl` em faixa TV, a implementação que
está no ar usa a matriz marcada (é o que a tabela acima manda e o teste confere), mas o registro do M09 descreve a
régua do Remotion como «o resto em faixa TV fica com o padrão do ffmpeg (BT.601)». Os vídeos do M09 são BT.709 e
BT.601, então a diferença nunca foi medida. Fica para o responsável decidir com uma medição contra o compositor do
Remotion; a reescrita reproduz a tabela.

## 6. A conta

### 6.1. Matrizes pelas normas

Cada matriz sai de duas constantes da norma, Kr e Kb (Kg = 1 − Kr − Kb):

| Matriz | Norma | Kr | Kb |
|---|---|---|---|
| BT.601 | ITU-R BT.601 (e SMPTE 170M) | 0,299 | 0,114 |
| BT.709 | ITU-R BT.709 | 0,2126 | 0,0722 |
| SMPTE 240M | SMPTE ST 240 | 0,212 | 0,087 |
| BT.2020 | ITU-R BT.2020 (não constante) | 0,2627 | 0,0593 |

Com Y' em 0..1 e Cb, Cr em −0,5..0,5 (definição das normas):

- R = Y' + 2(1 − Kr)·Cr
- B = Y' + 2(1 − Kb)·Cb
- G = Y' − (2Kb(1 − Kb)/Kg)·Cb − (2Kr(1 − Kr)/Kg)·Cr

e a saída em 8 bits é R, G, B vezes 255, saturados em 0..255.

### 6.2. Faixas

- **TV** (ITU-R BT.601/BT.709, 8 bits): Y' = (Y − 16)/219; Cb = (U − 128)/224; Cr = (V − 128)/224. Y abaixo de 16
  ou acima de 235 e croma fora de 16..240 seguem a mesma conta e saturam na saída.
- **Cheia** (convenção do JPEG/JFIF): Y' = Y/255; o croma é centrado em 128, com a escala da faixa cheia. Como o
  ffmpeg escala o croma em faixa cheia é **para descobrir por medição** (seção 6.4), não por suposição.

### 6.3. Croma 4:2:0

Sem interpolação: o pixel (x, y) usa a amostra de croma (⌊x/2⌋, ⌊y/2⌋), uma para cada bloco 2×2 de luma. É o que o
ffmpeg faz nesse caminho (mesmo tamanho na entrada e na saída); o teste `croma vizinho` confere.

### 6.4. O que a medição fecha

A conta das seções 6.1 e 6.2 em ponto flutuante, arredondada ao inteiro mais próximo, **não** bate bit a bit com o
ffmpeg: ele faz a conta em inteiros, com precisão limitada nos coeficientes e nos valores intermediários, e arredonda
do jeito dele. A diferença é de poucas unidades em parte das amostras. A implementação tem de descobrir, só por
caixa-preta (o ffmpeg como binário e o teste), a aritmética que dá exatamente a mesma saída:

- a precisão dos coeficientes e como eles são arredondados a partir de Kr e Kb;
- a precisão dos valores intermediários e onde há truncamento, arredondamento e saturação;
- a escala do croma e do Y em cada faixa.

A conta tem de caber no shader do WebGL2 (`highp int` de 32 bits, ou float com o mesmo resultado em todos os
valores) e dar o mesmo resultado de `corLimpa.quadro`. A varredura do teste cobre as 256³ combinações de (Y, U, V)
em cada matriz e faixa, então uma conta que passa nela está fechada para toda entrada de 8 bits.

É proibido, nesta descoberta, abrir o código-fonte do ffmpeg (`libswscale`) ou a implementação anterior (a lista do que é liberado e do que é proibido está em
`docs/estado/refactor-p05-cor-sala-limpa.md`).

## 7. O oráculo

- O ffmpeg do sistema, chamado como processo (`ffmpeg 8.0.1` do Ubuntu, no servidor de render, x86-64): a mesma
  imagem `yuv420p` crua, do mesmo tamanho, com
  `-vf scale=<l>:<a>:flags=bilinear:in_color_matrix=<bt601|bt709|smpte240m|bt2020>:in_range=<tv|pc>:out_range=pc`
  e saída `-pix_fmt bgr24`, como o compositor do Remotion faz. O resultado pode depender do caminho que o ffmpeg
  escolhe para a CPU; a régua é a desta máquina, a mesma em que a implementação anterior foi conferida.
- O teste compara R, G e B de cada pixel com o BGR24 do ffmpeg e o alfa com 255.

## 8. Como o teste roda

- Unidade e oráculo (Node, sem placa): `node --test
  composicao/cor-limpa.test.ts`. Cobre: interface, a tabela de escolha, preto e branco, croma vizinho e orientação, stride com
  folga e planos fora de ordem, imagem pseudoaleatória 64×32 e a varredura completa (4096×4096) em cada uma das 8
  combinações de matriz e faixa.
- Na página (Electron, placa): o autoteste e o teste das falhas (seção 4.3) pelo `testar-video.sh`, que roda os
  renders com vídeo e o `conferir-cor.mjs`. Para isso, o `captura/main.ts` e o `main-remotion.mjs` da linha do tempo
  passam a injetar o `cor-limpa.js` (a troca do arquivo é a etapa 4 do plano; até lá, a integração pode ser provada
  num checkout de teste trocando só o nome do arquivo lido).
- Critério do P05 (`scope.md`, seção 4.9): além do teste, o render do M09 sai com os mesmos quadros (marca e SSIM na
  régua do M04).

## 9. Origem do que está aqui

- Kr, Kb, faixas TV e cheia: ITU-R BT.601-7, ITU-R BT.709-6, SMPTE ST 240:1999, ITU-R BT.2020-2, JPEG/JFIF.
- Nomes de matriz e campos do quadro: especificação do WebCodecs (W3C), `VideoFrame` e `VideoColorSpace`.
- Regra de escolha de matriz e faixa: comportamento da régua do Remotion 4.0.536 (estudado, não copiado) e da
  implementação do M09, descrito como tabela de casos.
- Croma vizinho e a aritmética: medição contra o ffmpeg como binário.
