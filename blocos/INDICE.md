# Blocos Kodecz

> Técnicas de edição prontas para a composição em linha do tempo declarada (`docs/formatos/linha-do-tempo.md`), no
> formato Kodecz (pesquisa P12, `docs/pesquisa/habilidades-de-edicao.md`). Cada bloco é uma pasta com `KODECZ.md` (o
> que é, quando usar, parâmetros, como aplicar, conferência), `bloco.css`, `bloco.html` (o trecho a colar),
> `conferencia.json` (as checagens do DOM) e `exemplo.html`. Produto fechado: nada daqui sai do repositório (R02).

Leia este índice inteiro; abra o `KODECZ.md` só do bloco que vai usar.

## Blocos

- [H04 cena](cena/KODECZ.md): trecho visível de um quadro a outro, em corte seco; raiz das transições.
- [H05 transicao-fade](transicao-fade/KODECZ.md): a cena nova aparece por cima da anterior.
- [H06 transicao-wipe](transicao-wipe/KODECZ.md): uma borda reta atravessa o quadro e revela a cena nova.
- [H07 transicao-deslizar](transicao-deslizar/KODECZ.md): a cena nova empurra a anterior para fora.
- [H08 titulo-entrada](titulo-entrada/KODECZ.md): título e subtítulo que sobem aparecendo e saem juntos.
- [H09 cartela](cartela/KODECZ.md): quadro cheio de cor com uma chamada curta (abertura, capítulo, fim).
- [H10 terco-inferior](terco-inferior/KODECZ.md): nome e cargo de quem fala, no terço de baixo.
- [H01 legenda-uma-linha](legenda-uma-linha/KODECZ.md): legenda palavra a palavra, sempre numa linha (G17).
- [H02 zoom-ate-o-fim-da-frase](zoom-ate-o-fim-da-frase/KODECZ.md): punch-in da palavra de ênfase até a pausa
  depois da frase (G21); o movimento de câmera dos blocos.
- [H11 grafico-barras](grafico-barras/KODECZ.md): barras que crescem com o número contando.
- [H12 grafico-linha](grafico-linha/KODECZ.md): linha que se desenha, com os pontos e o último valor contando.
- [H13 contagem](contagem/KODECZ.md): número grande contando até o valor, ou regressiva de N até 1.

H03 (`texto-fora-do-rosto`) está reservado: precisa da caixa do rosto, que vem do S04. Mapas ficaram fora do S02.

## Como usar

1. A composição é uma pasta com `index.html` e o bloco `<script id="kodecz">` (formato linha do tempo).
2. `:root { --fps: N }` com o mesmo `fps` declarado (o antigo `--qps` ainda é lido pela conferência; os blocos usam `--fps`): todo tempo de bloco é em **quadros** e o CSS converte
   (`calc(q * 1s / var(--fps))`), com limites exatos no quadro.
3. Os tokens da marca entram como variáveis CSS: `node identidade/design-md.ts css <DESIGN.md> > marca.css` e
   `<link rel="stylesheet" href="marca.css">` (S03). Os blocos só leem `var(--…)`: cores `--color-ground`, `-ink`,
   `-accent`, `-accent-2`, `-muted`, `-surface`; fontes `--font-display`, `-title`, `-body`, `-caption`, `-label`;
   `--spacing-margin`, `-gap`, `-safe`; `--rounded-card`; `--motion-duration-enter`, `-exit`;
   `--motion-easing-enter`, `-exit`, `-move`. Os que não são obrigatórios no `DESIGN.md` têm reserva no bloco.
4. Copie o `bloco.css` de cada bloco para a pasta da composição (ou um link para esta pasta: o motor segue links) e
   cole o trecho de `bloco.html`, trocando os `⟨…⟩`. Cada raiz de bloco leva `data-bloco="<nome>"`.
5. `--inicio` e `--fim` em quadros na raiz do bloco; os blocos dentro de uma cena herdam os dela.
6. Confira o DOM antes do render: `node blocos/conferir-dom.ts <pasta> index.html` (JSON com os achados; sai com 1
   se há P0). Depois, `kodecz render <pasta> <id> saida.mp4`.

Demonstração com todos os blocos: `index.html` desta pasta (marca fictícia em `marca/`, apresentador sintético de
`gerar-midia.sh`). `blocos/gerar-midia.sh && kodecz render blocos Demonstracao saida.mp4`.

## Regras de todos os blocos

- Só animação declarada: CSS `@keyframes` ou `element.animate()`. Nada de `requestAnimationFrame`, `setTimeout`,
  `setInterval`, `Date.now()`, `performance.now()`, sorteio, GSAP (licença incompatível com a Apache-2.0), SVG SMIL, GIF, APNG nem WebP.
  Script só para ler o DOM na carga: `grafico-linha/bloco.js` (geometria e a contagem por `element.animate()`) e
  `legenda-uma-linha/bloco.js` (publica `window.motor_falas` para o S04).
- Sem `kodecz_frame`: com ele o motor desenha todos os quadros. Ligar e desligar (cena, frase, palavra) é um par de
  animações de duração zero com `forwards`, não uma animação que dura o trecho: o motor repete o quadro em que nenhuma
  animação está no meio do intervalo (P10.3).
- Sem `box-shadow` borrada (pode variar até 2 níveis entre renders na placa, R03) e sem hex solto no `bloco.css`.
- Número que conta: `@property --kz-valor` inteiro e `counter()`; nada de texto trocado por script.

## Conferência

`conferencia.json` de cada bloco: `{ "bloco", "checagens": [{ id, prioridade, seletor, quando, medida, maximo |
minimo, margem?, propriedade?, mensagem }] }`. Mensagem no jeito `t=… · onde · problema → mudança`, com `{t}`,
`{quadro}`, `{onde}` e `{valor}`.

| `quando` | Em que quadros |
|---|---|
| `visivel` | todo quadro em que o elemento está visível (opacidade efetiva > 0,01, caixa no quadro, sem `clip-path` que recorte tudo) |
| `visivel-parado` | visível e sem animação de geometria (transform, clip-path, posição) no meio, nele ou num ancestral |
| `todos` | todos os quadros (só com `visiveis`) |
| `inicio`, `fim` | o quadro do `--inicio` ou do `--fim` do elemento |
| `fim-da-transicao` | `--inicio` + `--duracao` (padrão 15) |
| `fim-do-bloco` | o último quadro em que o elemento está visível: o corte da cena, a saída dele ou o fim da composição (um zoom ainda fechado no corte da cena é pego); se nunca aparece, o último quadro |

| `medida` | O que lê |
|---|---|
| `linhas` | linhas de texto (caixas do texto agrupadas pela altura) |
| `transborda` | px de texto além da largura da caixa |
| `fora-da-margem` | px da caixa ou do texto além da `margem` (em px, `rem`, `em` (pela fonte da raiz), `vw` ou `vh` do quadro, ou um token com um desses, como `--spacing-safe`; em `%`, `cqw` ou `cqh` é recusada, porque não diz a base no quadro) |
| `visiveis` | quantos elementos do seletor estão visíveis |
| `inteira` | 0 se cobre o quadro inteiro, opaca e sem recorte; 1 se não |
| `escala` | largura na tela ÷ largura no layout |
| `fim-menos-inicio` | `--fim` − `--inicio` |
| `distancia-do-alvo` | distância entre a `propriedade` (ex. `--kz-valor`) e o `data-valor` |
| `opacidade` | opacidade efetiva |

Recorte (`clip-path`) em visível e inteira: `inset()` pela conta; `circle()`, `ellipse()` e `polygon()` por uma grade
de 32 × 32 pontos. `path()`, `shape()`, `url()`, valores com `calc()` e posição de quatro valores não são conferidos:
contam como sem recorte e viram `pagina.recorte` (P1), um por elemento.

Toda página com blocos também confere `pagina.qps` (P0), o `--fps` da raiz igual ao declarado, e `pagina.animacao`
(P0): elemento que um bloco anima e ficou sem animação, porque falta uma variável sem padrão da declaração (o bloco
sem `--fim` fora de uma cena, por exemplo); a mensagem diz quais faltam. O executor é
`conferir-dom.ts` (Electron sem remendo, o quadro N posto como no motor, só DOM); o S04 vai rodar as mesmas
checagens e as que precisam do quadro capturado ou do rosto.
