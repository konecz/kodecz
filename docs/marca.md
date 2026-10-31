# Marca do Kodecz

O Kodecz é da família Konecz: o mesmo azul, as mesmas fontes e o mesmo traço do konecz.com e do perfil
`konecz/konecz`. Tudo em `marca/` sai de `node scripts/marca.mjs` (sem dependências); para mudar um desenho, mude o
script e rode de novo, nunca edite o SVG à mão.

## Nome

**Kodecz**: Konecz + codec + code. Escreve-se sempre com K maiúsculo e o resto minúsculo. No terminal e em
pacotes, `kodecz`.

Conferido em 2026-10-31: livre no npm e no crates.io, e sem projeto conhecido com esse nome (o mais perto é o
Kodezi, de outra área). No GitHub existe a conta pessoal `Kodecz`, vazia desde 2025-04 e de outra pessoa; o
repositório é `konecz/kodecz`. Falta a busca de marca no INPI antes de abrir.

## Logo

A fita da Konecz, que na logo dela é um laço em 8 com meia torção, aqui se fecha num **triângulo de play** com
meia torção, uma fita de Möbius. «Fita» vale duas vezes: a fita da marca e a fita de vídeo. É desenhada como objeto
3D só com linhas finas paralelas, mais fortes na frente e mais apagadas atrás; na versão animada ela gira devagar e
a torção corre pela fita, como a da Konecz no site.

| Arquivo | Uso |
|---|---|
| `marca/logo.svg` | símbolo parado, azul sobre transparente |
| `marca/logo-azul.svg` | símbolo branco no quadrado azul de cantos redondos: avatar, ícone, prévia social |
| `marca/logo-animada.svg` | símbolo girando (SMIL, anda dentro de `<img>`) |
| `marca/logo-nome-{claro,escuro}.svg` | símbolo e nome lado a lado |
| `marca/logo-nome-animada-{claro,escuro}.svg` | o mesmo, girando |
| `marca/cabecalho-*.svg`, `tecnologias-*.svg`, `caminho-*.svg`, `numeros-*.svg`, `agentes-*.svg` | cartões do README, um por tema |

Não pode: esticar, girar, contornar, pôr sombra ou gradiente, trocar a cor por outra que não as de baixo, nem pôr
o símbolo sobre foto sem o quadrado azul.

## Cor

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| azul | `#1f56e0` | `#4d82ff` | símbolo, destaque, a barra do Kodecz nos gráficos |
| azul-claro | `#7ea2ff` | `#8fb0ff` | detalhe |
| tinta | `#1f2328` | `#f0f6fc` | nome e títulos |
| secundário | `#59636e` | `#9198a1` | texto de apoio |
| fraco | `#818b98` | `#656c76` | notas, a barra do concorrente |

Fundo e bordas são os neutros do GitHub, para o cartão sumir no README. Sobre o azul da marca (`#1f56e0`), o
traço é branco e azul-claro `#d6e2ff`, como no konecz.com. Sem cor de estado e sem gradiente.

## Tipografia

- **Schibsted Grotesk**, peso 800, com letras apertadas (−4 a −5 % no nome), para o nome e os títulos.
- **IBM Plex Mono** 500 para rótulos, números e comandos, com números tabulares.

As duas vêm em `marca/fontes/` com a licença OFL e são embutidas nos SVGs.

## Gráfico é gráfico, texto é texto

Os cartões do README não têm frases: só ícone, logo, número e no máximo uma palavra por peça. A explicação fica
no texto do README, fora do cartão. Ícones: Octicons (MIT) e Simple Icons (CC0) em `marca/icones/`.

## Movimento

O mesmo do site: só o que se move sozinho e devagar (o giro da fita e quadros andando pela linha); as entradas
(barras crescendo, etapas surgindo) acontecem uma vez. Tudo anda também com «menos movimento» ligado e em
navegador fraco, como no konecz.com: só se anima `transform` e `opacity`, e a fita animada pequena usa poucas linhas e
poucos quadros.
