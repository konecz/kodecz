# Formato: quadros de referência (S05)

Quadros aprovados de uma composição, comparados a cada render para pegar regressão. Escritos por
`node cli/referencias.ts aprovar` e lidos por `node cli/referencias.ts conferir` (código em `cli/referencias.ts` e
`cli/quadros.ts`; uso em `ARCHITECTURE.md`, «Quadros de referência»).

## Pasta

`<pasta da entrada>/referencias/<composição>/` (ou `--referencias <pasta>`), versionada junto com a composição:

```
referencias/LinhaSintetica/
  referencias.json
  placa-0.png  placa-30.png  ...   um PNG por quadro aprovado, com o modo no nome
  cpu-0.png    ...                 (se também aprovada na CPU)
```

Neste repositório o `.gitignore` ignora `*.png`, com exceção de `**/referencias/**/*.png`.

## Quadro: PNG sem perda

O quadro do motor é BGRA de 8 bits com alfa pré-multiplicado (o do Chromium, `--gravar` do `cli/render.ts`). A
referência é PNG RGBA de 8 bits (alfa direto), escrito com o `zlib` do Node, sem dependência:

- abre em qualquer visualizador, para quem aprova olhar o que aprovou (o BGRA comprimido não abre);
- é sem perda: desfazer a pré-multiplicação arredondando e refazê-la volta ao mesmo byte (o erro é ≤ ½ · a/255 < ½
  para alfa < 255). O `aprovar` confere cada pixel e recusa o quadro que não volta igual; o `conferir` relê o PNG e
  confere o `sha256` do BGRA.
- Tamanho na fixture de 960 × 540: 5 a 29 KB por quadro (o BGRA cru tem 2 MB).

## referencias.json

```json
{
  "formato": 1,
  "composicao": "LinhaSintetica",
  "formatoEntrada": "linha",
  "largura": 960, "altura": 540, "qps": 30,
  "props": "{}",
  "modos": {
    "placa": {
      "motor": "60a67ef",
      "data": "2026-10-30T15:00:00.000Z",
      "aprovadoPor": "Ana Exemplo",
      "quadros": [ { "n": 0, "arquivo": "placa-0.png", "sha256": "…", "bytes": 5066 } ]
    }
  }
}
```

| Campo | O que é |
|---|---|
| `formatoEntrada` | `linha` (P10); `pacote` ou `projeto` só em referências antigas, da entrada do Remotion, que saiu em 2026-10-31 |
| `props` | `{}`; com props (referência antiga do Remotion), o `conferir` recusa |
| `modos.<modo>.motor` | `git describe --always --dirty` do motor que renderizou |
| `quadros[].sha256` | do BGRA pré-multiplicado cru (o mesmo hash do `main.mjs` do M04) |
| `quadros[].bytes` | tamanho do PNG |

Aprovar de novo no mesmo modo troca as referências desse modo (some o PNG que saiu da lista). Se o tamanho ou as
props mudaram, as do outro modo são descartadas.

## Régua

- **Mesmo modo (R03):** passa se o hash é igual ou se a diferença é invisível: até 2 níveis por canal e SSIM ≥ 0,999
  (sobre cinza, desfeita a pré-multiplicação, como o `diferenca.mjs` do M04).
- **Placa × CPU (`--cruzado`):** a CPU rasteriza por software (antisserrilhado, texto e gradiente saem diferentes em
  dezenas de níveis sem ser regressão): só o SSIM conta, ≥ 0,997, com as duas sobre preto (o que o MP4 mostra). Na
  fixture, placa × CPU dá SSIM de 0,99978 a 0,99995 com até 63 níveis. O 0,997 é o piso de ruído do render em
  camadas contra o render atual (`docs/pesquisa/render-camadas.md`). Sem `--cruzado`, render de um modo sem
  referência desse modo é erro de uso (2): aprovar também no outro modo é o caminho normal.

## Amostragem automática

Sem `--lista`: o primeiro e o último quadro, um a cada `--cada` (padrão: o maior entre o qps e duração ÷ 30) e, na
linha do tempo, o quadro de início e o de fim de cada animação declarada com valores literais (`animation:` no CSS,
`element.animate(…, { delay, duration, iterations })` com números). O que é calculado ou repete para sempre fica de
fora: é amostragem, não prova. 
