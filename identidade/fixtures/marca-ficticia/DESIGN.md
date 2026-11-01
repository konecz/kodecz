---
# Marca fictícia, inventada para os testes e como exemplo do formato (R01: nada de cliente aqui).
version: alpha
name: Zunzum Torrefação (marca fictícia)
description: >
  Torrefação de bairro inventada para os testes do motor-video.
  Calor de papel, tinta escura e um laranja de torra como destaque.

colors:
  ground: "#F7F4EC"
  ink: "#1B1F2A"
  accent: "#E4572E"
  accent-2: "#2E86AB"
  muted: "#6B6F7A"
  surface: "#FFFFFF"

typography:
  display: { fontFamily: "Crimson Pro", fontWeight: 800, fontSize: "96px", lineHeight: 1.0, letterSpacing: "-0.02em" }
  title: { fontFamily: "Crimson Pro", fontWeight: 700, fontSize: "64px", lineHeight: 1.1 }
  body: { fontFamily: "Source Sans 3", fontWeight: 400, fontSize: "36px", lineHeight: 1.4 }
  caption: { fontFamily: "Source Sans 3", fontWeight: 700, fontSize: "44px", lineHeight: 1.2 }

spacing:
  margin: "96px"
  gap: "32px"
  safe: "64px"

rounded:
  card: "24px"
  pill: "999px"

logo:
  src: "marca/logo.svg"
  srcOnDark: "marca/logo-claro.svg"
  minHeight: "72px"
  clearSpace: "32px"

motion:
  duration:
    enter: "400ms"
    exit: "250ms"
    hold: "1.5s"
  easing:
    enter: "cubic-bezier(0.16, 1, 0.3, 1)"
    exit: "ease-in"

voice:
  language: pt-BR
  avoid: [incrível, revolucionário, "o melhor do mundo"]

components:
  caption-box:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.caption}"
    rounded: "{rounded.card}"
    padding: "{spacing.gap}"
---

# Zunzum Torrefação (marca fictícia)

## Visão geral

Café de bairro, sem pressa e sem luxo. O quadro parece papel de embalagem: fundo claro e quente,
tinta quase preta e um único laranja de torra que chama o olho. Um elemento domina cada quadro.

## Cores

- `ground` é o fundo de quase todo quadro; `ink` é o texto.
- `accent` aparece uma vez por quadro, no que importa (o número, a palavra-chave). Nunca como fundo inteiro.
- `accent-2` só em gráficos, para a segunda série.

## Tipografia

- `display` e `title` para chamadas curtas, até seis palavras. `body` para frases; `caption` para a legenda.
- Nada em caixa alta além de rótulos de uma palavra.

## Logo

- Usar `logo.src` sobre fundo claro e `logo.srcOnDark` sobre `ink`. Nunca recolorir nem esticar.
- Altura mínima de `logo.minHeight` e respiro de `logo.clearSpace` em volta.

## Movimento

- Entra com `motion.easing.enter` em `motion.duration.enter`; sai mais rápido do que entra.
- Nada de giro, quique ou brilho. O movimento acompanha a fala: entra na palavra, sai no fim da frase.

## Tom de voz

Fala como o dono do café fala com o vizinho: frases curtas, verbo no presente, você.
Sem superlativo nem promessa; número só com fonte. Evitar as palavras de `voice.avoid`.

## Faça e não faça

- Faça: um destaque por quadro, margem `spacing.margin` em volta de tudo.
- Não faça: gradiente de tela inteira, sombra, mais de duas fontes, texto sobre o rosto.
