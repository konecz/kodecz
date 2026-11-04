---
name: legenda-uma-linha
description: Legenda presa à fala, palavra a palavra, sempre numa linha só, numa caixa da cor do fundo, com só a palavra falada em destaque e as frases montadas pela largura medida no arquivo da fonte (montar.ts). Use em todo vídeo com fala e legenda, em 16:9 e 9:16.
id: H01
versao: 3
estado: em-uso
regras: [G17, G14, G11, G07, G19]
quando: [fala com legenda]
nao-quando: [texto de documento real (DOC)]
entradas:
  palavras: "tempos por palavra do Whisper, texto do roteiro (G11, G07)"
  design: "DESIGN.md: typography.caption, colors.ink, colors.accent, colors.muted, colors.ground, rounded.card, spacing.safe"
  formato: "largura, altura e fps da composição"
parametros:
  destaque: { padrao: "falada", faixa: "falada (só a dita agora em accent) ou progresso (ditas em ink, faltam em muted)" }
  entrada: { padrao: "nenhuma", faixa: "nenhuma ou subir (10 px em 0,12 s)" }
  topo: { padrao: "75% no 9:16", faixa: "px ou %, logo abaixo do queixo; com destino reels, até 65% da altura menos a caixa (G19)" }
  base: { padrao: "56 px no 16:9", faixa: "nunca abaixo de spacing.safe (G19)" }
  largura: { padrao: "78% no 16:9, o quadro menos a zona segura no 9:16", faixa: "até a zona segura dos lados" }
  folga: { padrao: "0,15 s", faixa: "0 a 0,3 s; cortada quando a palavra seguinte começa" }
  fonte: { padrao: "métricas do arquivo da fonte (fontconfig)", faixa: "ou larguraEm 0,55 a 0,65 quando não há arquivo" }
saidas: "um .kz-legenda por frase e um .kz-palavra por palavra, com --inicio, --fim e --apaga em quadros"
custo: { preparacao: "montar.ts, sem placa nem navegador", render: "repete-quadro: sim", contexto: "~1900 tokens" }
conferencia: [legenda.uma-linha, legenda.cabe, legenda.zona-segura, legenda.uma-por-vez]
origem:
  - "G17 e G14 (skill video-konecz, origens.md)"
  - "pesquisa P12, H01 (docs/pesquisa/habilidades-de-edicao.md)"
  - "a legenda aprovada pelo responsável em vídeos da Konecz, reescrita aqui com tokens da marca e nada de cliente (R01)"
  - "catálogo do HyperFrames em 2818160: caption-highlight e caption-pill-karaoke, só o nome; nenhum código lido nem copiado (R06)"
license: Proprietária
---

## O que é

A fala aparece em frases curtas, uma de cada vez, sempre numa linha, numa caixa da cor do fundo (`ground` a 92 %).
A frase inteira entra no começo dela (a largura não muda enquanto se fala). No destaque `falada` (padrão) só a palavra
dita agora fica em `accent`, do início dela até o fim + 0,15 s (ou até a seguinte começar); as outras em `ink`. No
destaque `progresso` (o da versão 2) as já ditas ficam em `ink` e as que faltam em `muted`.

## Por quê

G17: a legenda cortada em número fixo de palavras quebrou em duas linhas no 9:16 do caso de teste. Duas linhas tampam
mais a imagem e mudam de altura a cada frase. Aqui o tamanho é o do `DESIGN.md` e o que muda é onde a frase corta; a
palavra longa demais encolhe a fonte da frase dela em vez de quebrar. Na versão aprovada pelo responsável, só a
palavra falada se destaca, e artigo ou preposição nunca ficam no fim da linha.

## Como aplicar

1. Gere o trecho com `montar.ts` (o `kodecz assemble` chama `montar(item, ctx)`; `ctx` traz `fps`, `largura`,
   `altura`, as `palavras` com o texto do roteiro e o tempo do Whisper, e `q()`/`tempo()`). Ele devolve o `html` e
   `css: ["bloco.css"]`, `js: ["bloco.js"]` (o script vai depois das legendas, uma vez por página).
2. Parâmetros do `item` (todos opcionais):
   - trecho: `palavras` (padrão `ctx.palavras`), `de` e `ate` (refs de `ctx.tempo`; a última frase não passa do `ate`);
   - modo: `destaque` (`"falada"` ou `"progresso"`), `entrada` (`"subir"` ou `"nenhuma"`);
   - fonte, a `typography.caption` da marca: `familia` (padrão `Inter`), `peso` (700), `tamanho` (56 no 9:16, 52 no
     16:9), `alturaLinha` (1,15), `espacamento` (em); o montar escreve esses valores no bloco, então o que se mede é o
     que se desenha;
   - medida: `arquivoFonte` (.ttf/.otf; padrão o que o fontconfig acha para a família e o peso) ou `larguraEm` (só a
     estimativa por largura média, 0,58 a 0,62 conforme a fonte);
   - caixa: `largura`, `respiroX`/`respiroY` (28/16 no 9:16, 26/12 no 16:9), `topo` (px ou `"NN%"`; padrão 75 % no
     9:16, ou logo abaixo do queixo), `base` (16:9, padrão 56 px), `seguro` (o `spacing.safe` da marca, padrão 64) e
     `destino` (`reels`, `instagram`, `anuncio`, `tiktok`, `shorts`: 14 % no topo, 35 % na base e 6 % nos lados livres);
   - tempos (s): `folga` (0,15), `antecipa` (a frase entra 0,05 s antes da primeira palavra), `cauda` (a última frase
     fica 0,6 s depois da última palavra);
   - quebra: `fracas` (artigo, preposição, conjunção e «R$»; troca a lista), `naoFecham` (interjeição ou marcador que,
     sozinho com `, : ;`, não vira frase: «Ó,», «Um:»), `curtaMax` (3: palavra sozinha até esse tamanho com `, : ;`
     também não fecha) e `curtaFecha` (5: palavra até esse tamanho que fecha com `. ! ? …` leva a anterior junto).
3. A medida: o `fonte.ts` lê o `cmap` e o `hmtx` do arquivo da fonte (sem dependência), sem kerning, que quase sempre
   aperta: a largura medida fica igual ou maior que a do Chromium, e o montar ainda tira 2 px de reserva. WOFF, WOFF2,
   coleção (.ttc) ou família que o fontconfig não acha caem na estimativa de 0,6 em por caractere (ou `larguraEm`); o
   comentário antes do bloco diz qual medida valeu.
4. As regras de quebra: junta palavras enquanto cabe, nunca por número fixo (G17); toda pontuação fecha a frase, menos
   as exceções acima; no corte por largura, as fracas do fim descem para a frase seguinte e a palavra curta que fecha
   a frase leva a anterior junto; a frase que ainda não cabe encolhe a fonte (`--legenda-tamanho` só nela).
5. Sem o montar (à mão): os mesmos passos, medindo cada palavra na fonte e no tamanho da legenda; `--inicio` da frase
   no início da primeira palavra, `--fim` no início da seguinte; cada palavra com o `--inicio` e o `--fim` dela na fala
   (G14), e `--apaga` (o `--inicio` da seguinte) quando ela começa antes do fim + 0,15 s. Não esticar o `--fim` da
   palavra até a seguinte: o `bloco.js` publica esses tempos como a fala, e a pausa depois da frase (G21) sumiria.
6. `bloco.css` no `<head>` e `:root { --fps: … }` igual ao do bloco `kodecz`. Cada frase leva `data-papel="legenda"`
   e o `bloco.js` publica a fala em `window.motor_falas` (texto do `data-t`, com a vírgula, ou o da tela).

## Bloco

`bloco.html` (estrutura) e `bloco.css` (regras). O essencial, como o montar escreve:

```html
<div class="kz-legendas" data-bloco="legenda-uma-linha" data-entrada="subir" data-ancora="topo"
     style="--font-caption: 'Inter'; --font-caption-weight: 700; --legenda-tamanho: 56px; --legenda-topo: 1112px; …">
  <p class="kz-legenda" data-papel="legenda" style="--inicio: 56; --fim: 107">
    <span class="kz-palavra" style="--inicio: 58; --fim: 63; --apaga: 64">Ela</span> …</p>
</div>
```

A frase e cada palavra ligam e desligam com pares de animações de duração zero e `forwards` (a de depois vence):
`opacity` 1 no `--inicio` e 0 no `--fim` da frase; `accent` no `--inicio` da palavra e `ink` no `--apaga` (ou no
`--fim` + `--legenda-folga`). A entrada `subir` é a única animação com duração (`transform`, 0,12 s). Uma animação que
durasse a frase inteira faria o motor desenhar todos os quadros dela (P10.3).

## Conferência

- `legenda.uma-linha` (P0): em cada quadro com a frase visível, o texto dá uma linha só.
- `legenda.cabe` (P0): a frase não passa da largura da caixa (com `nowrap`, a sobra seria cortada).
- `legenda.zona-segura` (P0): a caixa parada fica dentro de `--spacing-safe` das bordas (G19).
- `legenda.uma-por-vez` (P1): nunca duas frases visíveis no mesmo quadro.

## Erros comuns

- Cortar por número de palavras (o erro de origem).
- Seguir a frase depois da vírgula ou do ponto só porque ainda cabe: a pontuação fecha a frase (G17).
- Medir numa fonte e desenhar em outra: passe ao montar a `typography.caption` da marca (ele a escreve no bloco).
- Usar o texto do Whisper na legenda (sai «dois mil e vinte e seis»).
- Esquecer o `--fim` da palavra: ela herda o da frase e fica em `accent` até o fim.
- Destacar duas palavras ao mesmo tempo: a folga de 0,15 s acaba quando a seguinte começa (`--apaga`).

## Exemplos

- `exemplo-9x16.html`: saída do `montar.ts` (fala sintética em `legenda-uma-linha.test.ts`): destaque `falada`,
  entrada `subir`, caixa logo abaixo do queixo e a palavra longa encolhendo a fonte.
- `exemplo.html`: duas frases em 16:9 no destaque `progresso`.
- `exemplo-errado.html`: a fala em grupos de palavras sem medir, com quebra; a conferência acusa
  `legenda.uma-linha` e `legenda.uma-por-vez`.
