# Format: the edit as data (`kodecz assemble`)

Editing a video is filling in a JSON file instead of writing the page by hand. `kodecz assemble` turns the edit into a
composition folder in the declared timeline format (`linha-do-tempo.md`), ready for `kodecz render`:

```sh
kodecz assemble edicao.json out/            # writes out/index.html, out/edicao.resolvida.json, …
kodecz render out/ MyVideo video.mp4
```

What the command does, in order:

1. Reads the edit, the words file (`falas`) and the brand (`marca`).
2. Resolves every trigger (a second, a spoken word, the end of a sentence) to a frame.
3. Builds each item with the `montar.ts` of its block (`blocos/<name>/montar.ts`) or as a built-in (`video`,
   `imagem`, `audio`), turns scene transitions into the transition blocks, and places the voice, the event sounds and
   the music with its volume points.
4. Writes the folder, then runs the blocks' DOM checks on it (`node blocos/conferir-dom.ts out index.html`) and
   passes the findings on. `--no-check` skips that step.

stdout gets one JSON line: `{ ok, pasta, composicao, quadros, avisos, conferencia: { achados, p0 } | null,
achados?, proximo }`. Warnings and findings go to stderr, prefixed with `kodecz assemble:`. Exit codes: 0 done
(warnings allowed); 1 error in the edit (the message says where, like `itens[2].itens[0]: word «tste» is not in the
speech; closest: teste, isto`); 2 arguments; 4 the DOM check found a P0. The folder is written even when the check
fails, so it can be inspected.

## The output folder

| Path | What |
|---|---|
| `index.html` | the page: the `<script id="kodecz">` block, `:root { --fps }`, the brand and block stylesheets, the items, the `<audio>` elements, the block scripts. Generated: edit the JSON, not this file |
| `edicao.resolvida.json` | the edit after resolution, every `de`, `ate` and `inicio` in frames, transitions expanded, audio volume points written out. Read it to check timing without opening the page |
| `marca/` | `marca.css` (copied, or made from a `DESIGN.md` by `identidade/design-md.ts`) and links to the font files it uses |
| `blocos/<name>/` | copies of the block files the page uses (`bloco.css`, `bloco.js`) |
| `midia/` | symbolic links to the media of the edit (Kodecz follows links). Moving the folder to another machine needs real copies |

The page is static HTML and CSS with declared animations only: frame N depends only on N (no clock, no random, no
`requestAnimationFrame`). Assembling the same edit twice gives the same page, byte for byte.

## Top level

| Field | Rule |
|---|---|
| `composicao` | `{ "id", "largura", "altura", "fps", "quadros"? }`: id (letters, digits, `_`, `-`; the `<composition>` of `kodecz render`), width and height (even, 800 to 8192 wide), frames per second (1 to 240). Without `quadros`, the length is the longest of: the voice file (ffprobe), the last word + 0.5 s, every `ate` (and `de` + 1 frame) of the items, every sound `fim` |
| `marca` | path to a brand CSS (`--color-…`, `--font-…` variables; its relative `url()`s are linked too) or to a `DESIGN.md` (converted with `identidade/design-md.ts`). Without it, the blocks use their fallbacks and a warning says so |
| `falas` | path to the words file: `{ "palavras": [ { "texto": "balde", "inicio": 1.23, "fim": 1.56 } ] }`, seconds on the composition's clock, text from the script (made by `kodecz prepare words`) |
| `voz` | the voice file, or `{ "src", "volume"? }`. It starts at frame 0 (the words' times are the composition's) |
| `destino` | `reels`, `instagram`, `anuncio`, `tiktok`, `shorts` or `youtube`: becomes `<html data-destino>`, which the automatic check uses for the safe area (G19) |
| `itens` | the list of items, in drawing order (later ones on top) |
| `sons` | event sounds (below) |
| `trilha` | the music (below) |

Paths are relative to the folder of the edit file.

## Triggers

Every `de`, `ate`, `em` and `fim` is a trigger, resolved to seconds and then to the frame `round(seconds × fps)`:

| Trigger | Moment |
|---|---|
| `2.5` or `{ "segundo": 2.5 }` | that second |
| `{ "palavra": "balde" }` | the start of the first spoken «balde» |
| `{ "palavra": "balde", "ocorrencia": 2, "borda": "fim", "deslocamento": -0.1 }` | the end of the second «balde», 0.1 s earlier |
| `{ "fimDaFrase": <trigger> }` | the end of the sentence that holds the inner moment, plus 0.15 s |

- Words match without accents, punctuation or case: `{ "palavra": "agua" }` finds «Água,». `ocorrencia` counts from
  1. A word that is not in the speech is an error that lists the closest words; an occurrence past the last one says
  how many there are.
- **End of sentence:** from the last word that starts at or before the moment, forward to the first word that ends in
  `.`, `!`, `?` or `…` (closing quotes and brackets after the mark count). A comma does not close the sentence. The
  result is that word's end + 0.15 s, the pause where a zoom goes back or a strip leaves (G21). Speech without a
  closing mark ends at its last word.
- The same resolver is the `ContextoMontagem` each block receives (`ctx.tempo`, `ctx.quando`, `ctx.fimDaFrase`,
  `ctx.q`), so a block's own word parameters follow the same rules.

## Items

```json
{ "bloco": "titulo-entrada", "de": { "palavra": "hoje" }, "ate": { "fimDaFrase": { "palavra": "hoje" } },
  "titulo": "Short title", "subtitulo": "One sentence" }
```

- `bloco`: a folder of `blocos/` that has a `montar.ts`, or a built-in type. A block folder without `montar.ts` is an
  error that says so (its markup can still be written by hand from its `bloco.html`).
- `de`, `ate`: triggers. Left out, the item takes its parent's (a scene's, or the whole video at the top level); in
  the page, the block then inherits the scene's `--inicio`/`--fim`.
- `itens`: children. The assembler builds them first and hands their markup to the parent as `conteudo`.
- `variaveis`: any CSS variable the block reads, without the leading `--`: `{ "titulo-topo": "7%" }`.
- Everything else is a parameter of the block (see its `montar.ts` header and its `KODECZ.md`).

### Scenes and transitions

```json
{ "bloco": "cena", "de": 0, "ate": { "palavra": "segunda" }, "itens": [ … ] },
{ "bloco": "cena", "de": { "palavra": "segunda" }, "ate": 12, "transicao": { "tipo": "fade", "duracao": 15 }, "itens": [ … ] }
```

`transicao` on a scene: `tipo` is `fade`, `wipe` or `deslizar`; `duracao` in frames (default 15); `lado` for `wipe`
(`esquerda`, `direita`, `cima`, `baixo`) and `deslizar` (`direita`, `esquerda`: where the new scene comes from). The
assembler wraps the scene's children in the transition block and keeps the previous scene of the same list until the
transition ends (`de + duracao`), with the children that inherit its end. For `deslizar`, the previous scene must last
until this one starts; it then ends exactly at `de + duracao` and gets the leaving layer. `edicao.resolvida.json`
shows the result.

### Blocks with `montar.ts`

| Block | Parameters (besides `de`, `ate`, `variaveis`) |
|---|---|
| `cena` | `itens` |
| `transicao-fade`, `transicao-wipe`, `transicao-deslizar` | `duracao`, `lado`, `papel` (`entra`/`sai`, slide only); usually through `transicao` |
| `titulo-entrada` | `titulo`, `subtitulo`?, `atrasoSub`? (frames, 6), `topo`? (`36%`), `alinhar`? (`centro`, `esquerda`) |
| `cartela` | `texto`, `rotulo`?, `fundo`?, `tinta`? (brand color names: `accent`, `ground`…) |
| `contagem` | `valor` (counts from 0 at `de` to it at `ate`), `rotulo`?, `prefixo`?, `sufixo`?, `x`?, `topo`?, `tamanho`?; or `regressiva`: N (N to 1, one per second, from `de`) |
| `grafico-barras` | `barras`: `[{ "valor", "rotulo", "destaque"? }]`, `maximo`? (largest value), `sufixo`?, `passo`?, `duracao`?, `topo`?, `altura`? |
| `grafico-linha` | `valores`: numbers, `maximo`?, `duracao`?, `sufixo`?, `topo`?, `altura`?, `largura`? |

Other blocks get their `montar.ts` with their own parameters; `blocos/INDICE.md` lists the blocks.

### Built-in items

| `bloco` | Becomes | Parameters |
|---|---|---|
| `video` | `<video class="kz-midia" data-inicio data-quadros …>` covering the frame | `src`, `recorte`? (seconds cut from the start), `volume`?, `velocidade`?, `mudo`?, `papel`? (`data-papel`, e.g. `apresentador`), `ajuste`? (object-fit, `cover`), `classe`?, `estilo`? |
| `imagem` | `<img class="kz-midia kz-trecho">`, visible from `de` to `ate` | `src`, `ajuste`?, `alt`?, `classe`?, `estilo`? |
| `audio` | `<audio data-inicio …>`; with `ate`, falls to zero in 3 frames there | `src`, `volume`?, `recorte`?, `papel`? |

A video's `de`/`ate` default to its scene's, so it plays for the whole scene (and through a transition that keeps the
scene longer).

## Event sounds: `sons`

```json
"sons": [
  { "src": "sfx/whoosh.wav", "em": { "palavra": "segunda" }, "antes": 0.4, "volume": 0.3 },
  { "src": "sfx/ding.wav", "em": { "fimDaFrase": { "palavra": "segunda" } }, "volume": 0.8 },
  { "src": "sfx/filling.wav", "em": 3, "fim": { "palavra": "pronto" }, "volume": 0.5 }
]
```

Each becomes `<audio data-papel="som" data-inicio>` at `em` minus `antes` seconds (never before frame 0): a whoosh
`antes: 0.4` lands before the cut it announces. `volume` 0 to 10 (default 1). With `fim`, the sound stops there: its
volume falls to zero over the last 3 frames (`data-volume="0:v N−3:v N:0"`, `data-quadros="N"`). Normalizing the files
(peak level) is a preparation step, outside the assembler.

## Music: `trilha`

```json
"trilha": { "src": "music.wav", "volume": 0.5, "abaixarSobVoz": 14, "atraso": 4, "rampaEntrada": 0, "rampaSaida": 1 }
```

One `<audio data-papel="trilha">` from frame `atraso` (frames, default 0: shift the music so a beat lands on a cut) to
the end of the video, with `data-volume` points made from the speech:

- `volume` × the fade-in (`rampaEntrada` seconds, default 0) and fade-out (`rampaSaida` seconds, default 1).
- `abaixarSobVoz` dB (0 to 60, default 0): the music goes down by that much under each phrase of the speech. A phrase
  is a run of words with pauses of at most 0.6 s; in a longer pause the music comes back up. It starts going down
  0.15 s before the first word, is fully down at it, and takes 0.4 s to come back after the last one. Phrases closer
  than that are joined.
- The points count from the music's own start, as `data-volume` does; collinear points are dropped.

## Example

```json
{
  "composicao": { "id": "Example", "largura": 1080, "altura": 1920, "fps": 30 },
  "marca": "brand/DESIGN.md",
  "falas": "falas.json",
  "voz": "audio/voice.wav",
  "destino": "reels",
  "itens": [
    { "bloco": "cena", "de": 0, "ate": { "palavra": "numbers" }, "itens": [
      { "bloco": "video", "src": "takes/presenter.mp4", "papel": "apresentador", "mudo": true },
      { "bloco": "titulo-entrada", "de": { "palavra": "today" }, "ate": { "fimDaFrase": { "palavra": "today" } },
        "titulo": "Three numbers", "subtitulo": "From the last quarter", "topo": "12%" }
    ] },
    { "bloco": "cena", "de": { "palavra": "numbers" }, "ate": { "palavra": "finally" },
      "transicao": { "tipo": "wipe", "duracao": 12, "lado": "direita" }, "itens": [
      { "bloco": "grafico-barras", "de": { "palavra": "numbers", "deslocamento": 0.3 },
        "barras": [ { "valor": 42, "rotulo": "Q1" }, { "valor": 58, "rotulo": "Q2" }, { "valor": 73, "rotulo": "Q3", "destaque": true } ] },
      { "bloco": "contagem", "de": { "palavra": "grew" }, "ate": { "palavra": "grew", "borda": "fim" }, "valor": 73,
        "sufixo": " %", "topo": "82%" }
    ] },
    { "bloco": "cena", "de": { "palavra": "finally" }, "transicao": { "tipo": "deslizar" }, "itens": [
      { "bloco": "cartela", "texto": "See you next time", "rotulo": "Example" }
    ] }
  ],
  "sons": [
    { "src": "sfx/whoosh.wav", "em": { "palavra": "numbers" }, "antes": 0.4, "volume": 0.3 },
    { "src": "sfx/pop.wav", "em": { "palavra": "grew" }, "volume": 0.5 },
    { "src": "sfx/ding.wav", "em": { "fimDaFrase": { "palavra": "grew" } }, "volume": 0.6 }
  ],
  "trilha": { "src": "audio/music.wav", "volume": 0.5, "abaixarSobVoz": 14, "atraso": 4, "rampaSaida": 1.5 }
}
```

A tested synthetic edit is in `edicao/ponta-a-ponta.test.ts` (assemble, DOM check, GPU render, frames and the music's
RMS under the voice).

## For block authors: `montar.ts`

The contract is `edicao/tipos.ts`. A block folder adds `montar.ts`:

```ts
export function montar(item: Record<string, unknown>, ctx: ContextoMontagem): Montado
// Montado = { html: string; css?: string[]; js?: string[]; head?: string }
```

- `item` is the edit's item as written (its triggers unresolved, so a block can read a word trigger's structure),
  plus `conteudo`, the children's HTML. For `cena`, and for a scene whose end a transition changed, `de`/`ate` come
  as seconds of the resolved frames.
- `ctx`: `fps`, `largura`, `altura`, `palavras`, `q(s)`, `quando(word, occurrence?)`, `fimDaFrase(s)`, `tempo(trigger)`.
- `css`/`js`: paths relative to the block folder. The assembler copies them to `blocos/<name>/…`, links each
  stylesheet once (a parent's before its children's, in the order they first appear) and puts the scripts at the end
  of the body. `head`: extra `<head>` markup, deduplicated.
- Throw an `Error` with a plain message for a wrong parameter; the assembler adds where the item is.
- `edicao/html.ts` has the helpers: `esc`, `estilo` (the inline `style` with `variaveis`), `quadros`, `texto`,
  `textoCss`.
- Only declared animation in the markup (R03); the root of the block carries `data-bloco="<name>"` so the DOM check
  finds it.
