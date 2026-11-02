# Formato: conferência automática dos quadros (S04)

O comando `cli/conferir.ts` confere regras da skill `video-konecz` numa composição, sem renderizar o vídeo, e aponta o
quadro, o texto e o motivo de cada quebra:

- **G15:** nenhum texto sobre o rosto do apresentador (com margem), em nenhum quadro, inclusive no meio do zoom;
- **G17:** a legenda numa linha só, sem sair do quadro nem estourar a caixa dela;
- **G19:** com destino Reels, Instagram, anúncio, TikTok ou Shorts declarado (`data-destino`), texto fora da faixa que a interface
  do aplicativo cobre;
- **G20:** contraste do texto com o fundo real que está atrás dele;
- **G21:** o punch-in vai até o fim da frase e volta na pausa seguinte; a faixa sai junto;
- **tremor** (aviso): texto que anda devagar sem parar.

As regras são as do Kodecz Bench: um conjunto só (abaixo, «O conjunto único de regras»). O que a IA aprende no bench é
o que a conferência cobra no vídeo real.

É objetiva: mede, compara com um limite e dá *falha* ou *aviso* com o quadro. Não julga gosto. O resto da G37
(transcrição pelo Whisper, duração, loudness) continua manual. Este arquivo é para quem escreve a composição (o
agente) e para quem lê o resultado (o agente, o portal).

## Comando

```
kodecz check <entrada> <composição> [<entrada> <composição> …] [--speech arquivo.json] [--out pasta]
             [--sample 10] [--keep] [--data] [--no-containment]
kodecz check --help
```

Os nomes antigos (`node cli/conferir.ts`, `--falas`, `--saida`, `--amostra`, `--manter`, `--dados`, `--sem-contencao`,
`--ajuda`) continuam aceitos.

- **Entrada:** a pasta da composição em linha do tempo declarada (`docs/formatos/linha-do-tempo.md`); a composição é
  o `id` do bloco `kodecz` (ou do antigo `motor-video`). Vários pares de uma vez: os dois formatos do mesmo vídeo (G04). O pacote e o projeto
  do Remotion são recusados: a entrada do Remotion saiu do motor em 2026-10-31 (`adr.md`, seção 16).
- **Preparação, uma vez por máquina (com rede):** `npm ci --ignore-scripts` em `conferencia/` e
  `node conferencia/preparar.ts`, que baixa o modelo de rosto para `~/.cache/motor-video/modelos/` e confere o
  SHA-256 fixado (sem o modelo, ou com ele diferente, o comando sai com 1 dizendo isso). O Electron é o do M02
  (`npm ci` em `captura/`), como no render.
- **Onde roda:** sempre na CPU (desenho por software, placa escondida), contido como o render (`nice`, `ionice`,
  teto de CPU; `--sem-contencao` tira). A conferência não usa a placa.
- **Saída:** `<pasta>/conferencia.json` (abaixo) e uma foto por quebra, `<pasta>/<composição>-<regra>-<quadro>.png`:
  o pior quadro com as caixas desenhadas (vermelho: o texto; amarelo: o rosto com a margem; azul: o apresentador, na
  G21). Pasta padrão: `tmp/conferencia`. No stdout, uma linha JSON:
  `{ "ok": false, "falhas": { "G15": 1, "G17": 0, "G19": 0, "G20": 0, "G21": 0 }, "avisos": 0, "pasta": "…", "parede": 2.95 }`
  (uma contagem por regra de situação automática, mesmo zerada). Cada falha e cada aviso também saem no stderr, uma
  linha cada.
- **`--dados`:** grava também `<pasta>/<composição>-dados.json` (`{ comp, geometrias, rostos, falas, destino, fundos }`),
  para rodar as regras de novo (`conferir()` de `conferencia/conferir.ts`) sem coletar: é como os limites foram calibrados.
  Cada geometria (tipo `Geometria` em `regras.ts`) traz, além das caixas: `take` do apresentador (`data-midia` ou
  `src`, `@data-inicio`), `opacidade` efetiva de cada texto e, em cada faixa, `opacidade` e `caixa`. Leva texto e
  falas da composição: fica em `tmp/`, nunca no repositório (R01).
- **Códigos:** 0 sem falha (pode ter aviso); 1 erro (com a causa no stderr, começando por `erro:`); 2 argumentos;
  4 regra quebrada; 128 + sinal se interrompido.
- **Custo medido** (2026-10-30, composição sintética 9:16 de 810 × 1440 e 75 s, 2250 quadros, `medir-render.mjs`, 2
  rodadas): 7,0 s de CPU e 14,7 s de parede; a geometria dos 2250 quadros em 66 ms, os 231 quadros limpos em 8,4 s e
  o rosto em 3,9 s (um fio).

## O conjunto único de regras

As regras ficam em `bench-gerador/especificacoes.json`, no formato do Kodecz Bench: `regra: { medida, p, op, limite }`,
medida pelos motores do bench (`bench-gerador/motores.ts`) sobre a coleta da composição (montada como a evidência do
bench: `conferencia/conferir.ts`). O campo `conferencia` diz que a regra também roda aqui e com que código:

| Código | Regra | Medida |
|---|---|---|
| G15 | classe K-DES-08 | `textoSobreRosto` |
| G19 | classe K-PLA-01 | `foraDaZonaSegura` |
| G20 | classe K-COR-01 | `contraste` |
| G17 | só da conferência | `legendaQuebrada` |
| G21 | só da conferência | `zoomForaDaFrase` |
| tremor | só da conferência | `tremor` |

«Só da conferência»: regra do S04 que ainda não é classe do bench (falta a mutação e as provas); fica no mesmo arquivo,
com a chave igual ao código e `so: "conferencia"`, e o bench a pula. Regra nova serve aos dois: uma classe do bench com
`conferencia` passa a rodar aqui.

**Situação** (a mesma do bench, `situacaoDe` em `bench-gerador/mutacoes.ts`): **automática** acusa falha; **aviso**
acusa aviso; **desligada** não roda. A conferência pode ter uma situação própria, declarada no campo:
`"conferencia": { "codigo": "G20", "situacao": "aviso" }` vale só aqui (`situacaoNaConferencia`); no bench continua a
da classe. Sem a sobreposição (`"conferencia": "G15"`), vale a da classe. Hoje G15, G17, G19 e G21 são automáticas; a
G20 é aviso na conferência (decisão do responsável de 2026-11-01; a K-COR-01 segue automática no bench) e o tremor é
aviso. As regras
aplicadas, com a situação e o resultado de cada uma, vão em `regras` no `conferencia.json`.

## O que a composição marca

### Papéis: `data-papel` (G41)

| Valor | Em quê | Para quê |
|---|---|---|
| `apresentador` | o `<img>`, `<video>` ou `<canvas>` do take | o rosto é procurado nele, e a escala dele dá o zoom |
| `legenda` | o elemento da legenda (um por frase, ou um que troca o texto) | G17; a legenda conta como texto na G15 |
| `faixa` | o elemento da faixa do tema | G21: a faixa visível no zoom tem de sair junto |

Atributo HTML comum: vale igual na linha do tempo e no HTML de qualquer formato. Sem `apresentador` visível, G15 e
G21 não são conferidas (aviso). Com texto na tela e sem nenhuma `legenda`, G17 não é conferida (aviso). O resto do
texto da página (chip, título, número) entra na G15 sem papel.

O `<video>` da linha do tempo só conta como apresentador no trecho dele (`data-inicio` e `data-quadros`); fora dele,
no render, o canvas fica transparente.

### Falas: `window.motor_falas`

A composição publica a fala dela no tempo do vídeo, em segundos, uma entrada por palavra:

```js
window.motor_falas = [
  { t: 'Isto', ini: 0.5, fim: 0.8, bloco: 1 },
  { t: 'tudo.', ini: 1.1, fim: 1.6, bloco: 1 },
];
```

- `t`: o texto do roteiro, com a pontuação (G01); o fim da frase é a palavra que termina em `.`, `!`, `?` ou `…`
  (aspas e parênteses de fechamento depois do sinal valem).
- `ini`, `fim`: segundos do vídeo (≥ 0), com o tempo do Whisper (G11) e o deslocamento do bloco já aplicados pela
  própria composição (quem sabe onde cada bloco começa é ela).
- `bloco`: número ou texto.
- Em ordem de `ini`. Fora disso, o comando sai com 1 dizendo a palavra e o campo.

`--falas arquivo.json`, no mesmo formato, vale por cima do que a página publicou. Sem falas e com zoom, G21 não é
conferida (aviso).

### Destino: `data-destino` no `<html>`

`<html data-destino="reels">` (`docs/formatos/linha-do-tempo.md`): `reels`, `instagram`, `anuncio`, `tiktok`, `shorts` ou
`youtube`. A G19 só confere com `reels`, `instagram`, `anuncio`, `tiktok` ou `shorts`; sem o atributo, ou com outro valor, não
acusa. Lido depois de a página ficar pronta (vale o que um script puser).

## Como cada regra é conferida

O processo do Electron da conferência (`conferencia/coletar.ts`) abre a página, põe cada quadro N como o render põe
(animações pausadas em N × 1000 / qps, o gancho `kodecz_frame`, ou o antigo `motor_quadro`, antes) e lê o DOM (`conferencia/geometria.js`). Só lê:
não muda nada no render (é outro processo, que não codifica nada).

- **Caixa de texto:** cada nó de texto visível, uma caixa por linha (`Range.getClientRects()`, já com o `transform`),
  recortada pelos ancestrais que cortam (`overflow`) e pelo quadro. Texto dentro de um elemento que pinta fundo, borda
  ou sombra (até 3 níveis acima, ou até o elemento com papel; menor que um quarto do quadro) vale pela caixa desse
  elemento: o chip inteiro. Visível: `visibility` diferente de `hidden` e opacidade efetiva (o produto dos
  ancestrais) de pelo menos 0,05.
- **Rosto (G15):** procurado pelo YuNet nos quadros limpos (a página com tudo escondido menos o apresentador, para o
  texto por cima não derrubar o detector), reduzidos a 640 px de largura, em um a cada K quadros com o apresentador na
  tela (K = 10, `--amostra`), mais o primeiro e o último de cada take e a volta de cada zoom. O rosto fica guardado
  em frações da caixa do apresentador e é levado de volta à tela pela caixa dele em cada quadro: o zoom e o
  movimento do elemento ficam exatos; o movimento da pessoa dentro do take é interpolado entre as amostras. O maior
  rosto do quadro limpo é o do apresentador.
- **Margem do rosto:** a caixa do detector vai das sobrancelhas ao queixo; soma +25 % da altura em cima, +10 %
  embaixo e +10 % da largura de cada lado. Qualquer interseção (> 0 px²) com uma caixa de texto legível (opacidade
  efetiva de pelo menos 0,5) é falha: o texto que entra ou sai em fade pelo rosto, ainda meio transparente, não conta.
- **Legenda (G17):** as caixas de linha do texto da legenda, agrupadas pela posição vertical (mesma linha quando se
  sobrepõem em mais da metade da menor altura): mais de uma linha é falha («legenda em N linhas»). Caixa de linha
  fora do quadro, ou `scrollWidth > clientWidth` com corte ou reticências na legenda ou num ancestral que corta, é
  falha «legenda cortada».
- **Zoom (G21):** a escala do apresentador por quadro (largura da caixa dele sobre a do primeiro quadro do take; o take
  recomeça quando o apresentador volta e quando a mídia dele troca, `data-midia` ou `src` e `data-inicio`: o corte do
  cartão de um bloco para a tela cheia do seguinte não é zoom, e o zoom ativo no corte sai como corte). Um
  punch-in é uma subida de pelo menos 5 % em até 12 quadros (variação por quadro acima de 0,1 %: a aproximação lenta
  não conta); a saída, a primeira descida igual depois do pico, ou o apresentador saindo (corte), ou o fim do vídeo.
  A palavra de ênfase é a que está sendo dita na entrada (ou a última que começou antes); o fim da frase, o `fim` da
  primeira palavra dali em diante que fecha a frase; a pausa, até o `ini` da palavra seguinte (ou o fim do vídeo). O
  primeiro quadro da saída tem de cair em [fim da frase − 1 quadro, início da próxima palavra + 1 quadro]. A faixa
  visível no último quadro do zoom tem de começar a sair até 3 quadros depois do início da saída: sumir, cair abaixo
  de 90 % da opacidade que tinha no último quadro do zoom, ou andar 2 % do tamanho dela (o fade de mola leva uns 13
  quadros para terminar, e tudo bem); e tem de sumir em até 30 quadros (a faixa que só flutua não sai).

- **Zona segura (G19):** o quadro é posto no meio da tela do celular de 1080 × 1920, na largura (o 9:16 ocupa a tela
  toda; o 16:9 fica numa faixa no meio); um texto legível (opacidade ≥ 0,5) com alguma caixa fora da zona (14 % livres
  em cima, 35 % embaixo, 6 % dos lados) é falha, uma por trecho de quadros seguidos, com quantos textos. O rosto fora
  da zona não é mais avisado (a medida do bench não o olha).
- **Contraste sobre o fundo real (G20):** a cada segundo (quadros 0, qps, 2 × qps…), a coleta lê os textos legíveis
  (opacidade ≥ 0,5; HTML, fora o do apresentador e o SVG) com a cor de preenchimento (passada a rgba), o tamanho, o
  peso e as caixas de linha (recortadas pelo quadro e pelos ancestrais que cortam), e captura o quadro duas vezes,
  reduzido a 640 px de largura: como está e com o preenchimento do texto transparente (`-webkit-text-fill-color`: o
  fundo, o chip, a borda e a sombra do texto ficam). Os pixels da caixa que mudam entre as duas (diferença acima de 3 níveis)
  são os da letra visível; o fundo do texto é a cor média da segunda captura nesses pixels: o que está atrás da letra,
  só onde ela aparece (a parte tapada por outra camada não entra). Texto com menos de 0,5 % da caixa mudando não
  aparece no quadro (tapado, fora de uma máscara) e fica de fora; texto de preenchimento transparente
  (degradê recortado no texto) também. **Texto coberto fica de fora** (decisão do responsável de 2026-11-01): em quinze
  pontos de cada linha (cinco na largura, três na altura), a ordem de pintura (`elementsFromPoint`, com o `pointer-events` ligado em tudo enquanto se
  pergunta) diz se há por cima dele um elemento que pinta (fundo com alfa ≥ 0,1, imagem de fundo que não é da tela
  inteira, mídia ou `backdrop-filter`); basta um ponto. É o texto atrás de um modal, da caixa da legenda ou de uma camada
  escura: não é para ser lido, e a cor dele vem do CSS, sem a camada. A regra é a do bench (K-COR-01): contraste WCAG entre a cor do texto (a transparência própria dela
  composta sobre o fundo) e o fundo, dividido pelo mínimo do tamanho (3 para texto grande, de 24 px, ou 18,66 px em
  negrito; 4,5 para o resto); abaixo de 1 é falha, uma por texto e por trecho de amostras seguidas que quebram, com o
  pior quadro. A opacidade do elemento não entra (como no bench): só a transparência da cor. No bench, sem esse fundo medido, a mesma medida usa a cadeia de fundos do CSS.

Limites numa tabela só (`LIMITES`, em `conferencia/regras.ts`), também gravada no `conferencia.json`. Aprovados pelo
responsável em 2026-10-30 e calibrados nos vídeos reais em 2026-11 (`docs/experimentos/2026-11-s04-calibrar.md`).

## Avisos (não falham)

| Regra | Quando |
|---|---|
| G15 | apresentador na tela e nenhum rosto achado numa amostra (falha de detecção não vira aprovação); nenhum rosto em amostra nenhuma; `<canvas>`, `<img>` ou `<video>` (que não o apresentador) sobre o apresentador, porque texto desenhado neles não é visto |
| G17, G15, G21 (G41) | sem `legenda` marcada com texto na tela; sem `apresentador` visível |
| `tremor` | regra de situação aviso: a caixa de um texto legível anda ou muda de tamanho devagar (mais de 0,05 e menos de 1,5 px por quadro) sem parar por mais de 5 s: zoom lento, flutuação ou respiração da câmera numa tela com texto fazem a letra tremer. Textos que tremem ao mesmo tempo, um aviso só |
| G21 | zoom sem nenhuma palavra no intervalo; frase que acaba sem pausa antes da seguinte (menos de 1 quadro); zoom sem `motor_falas` |

## `conferencia.json`

```json
{
  "versao": 2,
  "ok": false,
  "limites": { "margemRosto": { "cima": 0.25, "baixo": 0.1, "lados": 0.1 }, "opacidadeMin": 0.05, "…": "…" },
  "parede": 2.95,
  "composicoes": [
    {
      "id": "ConfZoomCedo",
      "entrada": "/caminho/da/composicao",
      "destino": null,
      "falhas": [
        {
          "regra": "G21", "de": 28, "ate": 58, "pior": 58,
          "zoom": { "entrada": 28, "pico": 31, "saida": 58, "corte": false },
          "frase": "Isto muda tudo, de verdade.",
          "motivo": "zoom volta 567 ms antes do fim da frase «Isto muda tudo, de verdade.»",
          "imagem": "ConfZoomCedo-G21-58.png"
        }
      ],
      "avisos": [{ "regra": "tremor", "de": 0, "ate": 189, "motivo": "texto «…» andando devagar sem parar (…)" }],
      "zooms": [{ "entrada": 28, "pico": 31, "saida": 58, "corte": false }],
      "falas": 6,
      "origemFalas": "pagina",
      "quadrosComApresentador": 120,
      "amostras": { "quadros": 17, "comRosto": 17 },
      "fotos": ["ConfZoomCedo-G21-58.png"],
      "regras": [{ "regra": "G21", "classe": "G21", "medida": "zoomForaDaFrase", "op": ">", "limite": 0, "situacao": "automatica",
                   "status": "erro", "motivo": "…", "valor": 1 }],
      "tempos": { "abrir": 156, "geometria": 6, "limpos": 386, "rosto": 62, "fundos": 40, "fotos": 24 }
    }
  ]
}
```

| Campo da falha | O que é |
|---|---|
| `regra` | o código da regra (`G15`, `G17`, `G19`, `G20`, `G21`; o campo `conferencia` da especificação) |
| `de`, `ate`, `pior` | primeiro e último quadro do trecho (quadros seguidos com a mesma quebra) e o pior quadro (maior interseção na G15; na G21, o início da saída) |
| `motivo` | em português, com o número (px², linhas, ms, quadros) |
| `texto`, `papel` | o texto (40 primeiros caracteres) e o papel (`legenda`, `faixa` ou `null`), quando há texto |
| `caixa`, `rosto` | [x, y, largura, altura] em px da composição: a caixa do texto e o rosto sem margem, no pior quadro |
| `zoom`, `frase` | na G21: o punch-in (quadros) e a frase dele |
| `imagem` | a foto do pior quadro, na mesma pasta (até 30 por composição) |

Aviso: `regra`, `motivo` e, quando é de um trecho, `de` e `ate`. `origemFalas`: `pagina`, `arquivo` (`--falas`) ou
`null`. `destino`: o `data-destino` normalizado, ou `null`. `regras`: cada regra aplicada, com a classe do bench, a
medida, o limite, a situação e o resultado (`erro`, `certo` ou `nao-conferivel`). `tempos` em ms. Versão 2 desde o
conjunto único (2026-11): `destino`, `regras`, G19 como falha com destino, G20.

## Limites conhecidos

- Só texto no DOM (HTML ou SVG). Texto em `<canvas>`, WebGL, imagem ou vídeo não é visto; o que cobre o apresentador
  sai como aviso.
- Zoom feito dentro do take (recorte desenhado num canvas, sem mexer na caixa do elemento) não aparece na escala.
- O `<video>` é decodificado pelo Chromium na conferência (no render, pelo motor): a cor pode diferir um pouco, o que
  não importa para achar o rosto; o quadro mostrado é o do mesmo tempo.
- A caixa do texto é retangular: num texto inclinado ela exagera, para o lado seguro.
- A piscada (um quadro perdido na decodificação do take) não aparece no DOM e não é conferida: depende do brilho por
  quadro medido no render (outra tarefa); quando o JSON do render trouxer essa série, ela entra como regra.
- G20: o fundo é a média atrás da letra (num fundo de duas cores fortes, a média esconde a parte ruim); a cor do texto
  é a do CSS; texto coberto em qualquer ponto de uma linha sai inteiro (uma vinheta de tela inteira em imagem de fundo
  não cobre; um véu de cor de tela inteira cobre); a amostra é de 1 s (texto que só aparece entre duas amostras não é medido); texto em SVG, `::before`/`::after` e
  `<canvas>` fica de fora; o `<video>` é o decodificado pelo Chromium (a cor pode diferir um pouco da do render).
