# Formato do DESIGN.md (S03)

Identidade da marca que o agente segue ao escrever o vídeo: cores, fontes, logo, espaçamento, movimento e tom de voz. **Um arquivo por marca, na raiz do projeto do vídeo** (`<projeto>/DESIGN.md`), com o logo e as fontes ao lado (`<projeto>/marca/`). Nunca neste repositório, salvo a marca fictícia dos testes (R01).

- Exemplo completo (marca fictícia, é também a fixture dos testes): `identidade/fixtures/marca-ficticia/DESIGN.md`.
- Leitor e validador: `identidade/design-md.ts` (seção 6).

## 1. De onde vem

- **design.md do Google** (formato `alpha`, <https://github.com/google-labs-code/design.md>): tokens em YAML no frontmatter (`name`, `colors`, `typography`, `spacing`, `rounded`, `components`), referências `{grupo.nome}`, prosa em seções `##`, linter com `broken-ref` e chave duplicada como erro.
- **HyperFrames** (`heygen-com/hyperframes`, commit `3e462f4`, o mesmo de `docs/pesquisa/video-e-audio.md`):
  - `skills/hyperframes/references/look.md:7-11`: lê o primeiro de `frame.md`, `design.md`, `DESIGN.md` na raiz do projeto; «o frontmatter é normativo» (hex e famílias citados exatamente), «a prosa é intenção»; cor, fonte e peso são rígidos, tamanhos e espaçamento o agente escala para o vídeo.
  - `look.md:56-69`: a página declara a paleta e as fontes como variáveis na raiz (`--color-ground`, `--color-ink`, `--color-accent`, `--font-display`) e usa `var(...)` em todo lugar, para trocar de marca sem reescrever.
  - `README.md:144-146` e `skills/hyperframes/assets/frame-presets/*/FRAME.md`: o `frame.md` é um superconjunto do design.md do Google escrito para o quadro (1920×1080), com seções de regras, «faça e não faça» e auditoria antes do render.
  - `packages/cli/src/media-use/lib/brand-provider.mjs:4-31`: o leitor deles achata toda linha `chave: valor` do frontmatter num mapa só, sem aninhar nem validar. É a lacuna que este leitor fecha.
- **Vídeos atuais** (lidos, nada copiado): cada vídeo tem um `src/tema.ts` com um objeto de cores e um de fontes (Google Fonts com pesos e subconjuntos), o logo em `public/marca/` e hex soltos nas cenas; o porquê de cada cor fica em comentário. Os vídeos em HTML carregam as fontes por `@font-face` de arquivos locais. Daí: tokens com nome de papel, fonte em arquivo local e o porquê na prosa.

## 2. Estrutura

```
---
<frontmatter YAML: tokens, normativo, lido por máquina>
---

# <Nome da marca>

## Visão geral        ← obrigatória
## Cores
## Tipografia
## Logo
## Movimento
## Tom de voz         ← obrigatória
## Faça e não faça
```

- **Frontmatter é normativo:** o agente usa os valores exatamente (hex, família, peso, tempo); nunca arredonda nem inventa. Na página, pelas variáveis CSS (seção 5), não copiando hex.
- **Prosa é intenção:** para que serve o visual, quando usar cada token, o que nunca fazer. O agente segue para o julgamento, não para valores. Pode citar tokens pelo caminho (`colors.accent`, `logo.minHeight`).
- Seções obrigatórias: `## Visão geral` e `## Tom de voz`. As outras são recomendadas, nesta ordem; títulos desconhecidos são aceitos. Título `##` repetido é erro.

## 3. Tokens

Nomes de token em kebab-case (`accent-2`), porque viram variáveis CSS. Chave desconhecida no topo é **aviso**, não erro (compatível com o design.md do Google e com o `frame.md`, que têm chaves próprias). Referência `{grupo.nome}` que não existe é erro.

| Chave | Obrigatória | Conteúdo |
|---|---|---|
| `name` | sim | Nome da marca. |
| `version`, `description` | não | Texto. `version: alpha` segue o Google. |
| `colors` | sim | `nome: "#rrggbb"` (também `#rgb`, `#rgba`, `#rrggbbaa`), **entre aspas** (sem aspas, `#` é comentário em YAML). Papéis obrigatórios: `ground` (fundo), `ink` (texto), `accent` (destaque); os nomes são os do HyperFrames. |
| `typography` | sim | `papel: { fontFamily, fontWeight, fontSize, lineHeight, letterSpacing, fontFeature, fontVariation }`. Só `fontFamily` é obrigatória; `fontWeight` é número inteiro de 1 a 1000, sem aspas. Papéis obrigatórios: `display` (chamadas) e `body` (texto); comuns: `title`, `caption` (legenda). Tamanhos para o quadro de 1080 de altura. |
| `fonts` | não | Lista de `{ family, src, weight, style }`, com `src` relativo ao DESIGN.md (`woff2`, `woff`, `ttf`, `otf`) e `weight` inteiro de 1 a 1000; fonte variável leva a faixa do eixo entre aspas, `weight: "100 900"` (com um peso só, o navegador prende o eixo nele e o texto de outro peso sai errado). Obrigatória na prática quando a família não está no cache de fontes do motor: o render não usa rede (R03). |
| `spacing`, `rounded` | não | `nome: "96px"` (dimensão com unidade: `px`, `rem`, `em`, `%`, `cqw`, `cqh`, `vw`, `vh`…) ou número. |
| `logo` | não | `{ src, srcOnDark, minHeight, clearSpace }`. `src` e `srcOnDark` relativos ao DESIGN.md (`svg`, `png`, `webp`): nada de URL, de caminho absoluto nem de `..`. Vale também para `fonts.src`: o caminho vai para o `url()` do CSS, então aspas, parênteses, `;`, `\` e quebra de linha são recusados. |
| `motion` | não | `duration: { nome: "400ms" }` e `easing: { nome: "cubic-bezier(…)" }` (também `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `steps(n)`). Em tempo, não em quadros: vale para qualquer taxa de quadros. |
| `voice` | não | `{ language: pt-BR, avoid: [palavras] }`. O tom em si fica na prosa (`## Tom de voz`); `avoid` existe para a conferência por máquina das legendas e chamadas (S04). |
| `components` | não | `nome: { propriedade: valor }`, como no Google; valores podem referir tokens (`"{colors.ink}"`). Só é conferido o formato e as referências. |

## 4. YAML aceito

O frontmatter é lido por um **subconjunto estrito de YAML**, sem dependência. O que fica fora é erro com a linha do arquivo, para o agente corrigir.

- Mapas e listas em bloco, recuo só com espaços.
- Mapa e lista em fluxo **numa linha só e sem aninhar**: `{ fontFamily: "X", fontWeight: 700 }`, `[a, "b"]`. Item de lista que é mapa vai em fluxo: `- { family: "X", src: "…" }`.
- Escalares simples ou entre aspas; blocos `>` e `|` (com `-` opcional); comentários com `#`. Aspas só contam no começo do valor: em `Gota d'água # nota`, o apóstrofo é texto e o comentário começa no ` #`.
- Erro: âncoras, aliases, tags, vários documentos (`---` ou `...` no meio), tabulação, recuo inconsistente, chave duplicada, chaves `__proto__`, `constructor` e `prototype`, aspas sem fechar ou com texto depois, texto simples com `: ` ou começando por indicador (`,`, `]`, `}`, `%`, `@`…), `|+` e `|2`.
- Erro, pedindo aspas: o que o YAML 1.1 e o 1.2 leem diferente ou como número, data ou booleano: `yes`/`no`/`on`/`off`/`y`/`n`, `16:9` e `1:30:00`, zero à esquerda (`0700`), expoente (`1e3`), `_` em número (`1_000`), `0b`, `0x`, `0o`, `.inf`, `.nan`, sinal antes do ponto (`-.5`), `=` e datas (`2026-10-29`).

**O que se promete:** o que o leitor aceita é YAML 1.2 válido e dá o mesmo valor no PyYAML (YAML 1.1). Os testes conferem isso lendo a fixture e a lista de casos aceitos com o PyYAML, por `python3 -I`, quando ele está instalado (6.0.3 em 2026-10-29); sem ele, o teste é pulado e diz por quê. Não é prova para qualquer entrada: um caso novo que divirja vira teste de regressão.

## 5. Na página do vídeo

`paraCss(tokens)` (ou `node identidade/design-md.ts css <DESIGN.md>`) gera:

```css
:root {
  --color-<nome>: …;                 /* colors */
  --font-<papel>: "<família>";       /* typography */
  --font-<papel>-weight: …;  --font-<papel>-size: …;  --font-<papel>-line-height: …;  --font-<papel>-letter-spacing: …;
  --spacing-<nome>: …;  --rounded-<nome>: …;
  --motion-duration-<nome>: …;  --motion-easing-<nome>: …;
}
@font-face { font-family: "…"; src: url("<base><src>") format("woff2"); font-weight: …; font-style: …; font-display: block; }
```

`font-display: block` porque o quadro não pode sair com a fonte reserva (R03). `--base` é o prefixo do CSS até a pasta do DESIGN.md. No Remotion, o mesmo objeto `tokens` (lido em Node por `lerDesignMd`, antes do empacotamento) ou o CSS gerado substitui o `tema.ts` de hoje.

## 6. Leitor e conferência

- TypeScript só com sintaxe apagável (sem `enum`, `namespace` nem propriedade no parâmetro do construtor): roda direto no Node 24 pelo type stripping, sem build nem flag; `identidade/package.json` só declara `"type": "module"`.
- `analisarDesignMd(texto)` → `{ ok, erros, avisos, tokens, secoes }`; cada achado tem `caminho` (`colors.accent`, `typography.display.fontFamily`, `secoes.Tom de voz`), `mensagem` em português, escrita para o agente corrigir sem ler o código, e `linha` quando o erro é do YAML ou de seção repetida.
- `lerDesignMd(caminho)` faz o mesmo e confere que o logo e as fontes existem ao lado do arquivo.
- `node identidade/design-md.ts conferir <DESIGN.md>` escreve o JSON `{ ok, erros, avisos }` e sai com 1 se há erro. É a interface neutra: qualquer modelo (Claude, GPT, modelo local) ou ferramenta roda e lê o resultado.
- `node identidade/design-md.ts css <DESIGN.md> [--base <prefixo>]` escreve o CSS; com erro, sai com 1 e escreve os erros na saída de erro. Uso errado sai com 2.
- Testes: `node --test identidade/design-md.test.ts`. Checagem de tipos, opcional e fora do repositório (o `typescript` não é dependência): `tsc --strict --erasableSyntaxOnly` com os tipos do Node de outro projeto passou sem erro em 2026-10-29.

Fora daqui (vão para o S04): contraste entre `ink` e `ground`, palavras de `voice.avoid` nas legendas, logo abaixo de `minHeight` no quadro.
