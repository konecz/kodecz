---
# Marca fictícia da demonstração dos blocos (S02), inventada aqui (R01: nada de cliente).
# As fontes (Inter e Lato) são as do sistema do servidor; o CSS sai por
# `node identidade/design-md.ts css blocos/marca/DESIGN.md > blocos/marca/marca.css`.
version: alpha
name: Farol Ateliê (marca fictícia)
description: >
  Ateliê de vídeo inventado para demonstrar os blocos do Kodecz.
  Noite azul-marinho, tinta clara e um âmbar de farol como destaque.

colors:
  ground: "#101828"
  ink: "#F5F3EE"
  accent: "#FFB648"
  accent-2: "#3EE6B0"
  muted: "#9FB0D8"
  surface: "#1B2547"

typography:
  display: { fontFamily: "Inter", fontWeight: 800, fontSize: "112px", lineHeight: 1.0, letterSpacing: "-0.02em" }
  title: { fontFamily: "Inter", fontWeight: 700, fontSize: "64px", lineHeight: 1.1 }
  body: { fontFamily: "Lato", fontWeight: 400, fontSize: "36px", lineHeight: 1.4 }
  caption: { fontFamily: "Inter", fontWeight: 700, fontSize: "52px", lineHeight: 1.2 }
  label: { fontFamily: "Lato", fontWeight: 700, fontSize: "28px", lineHeight: 1.2 }

spacing:
  margin: "96px"
  gap: "24px"
  safe: "64px"

rounded:
  card: "20px"
  pill: "999px"

motion:
  duration:
    enter: "500ms"
    exit: "300ms"
  easing:
    enter: "cubic-bezier(0.16, 1, 0.3, 1)"
    exit: "cubic-bezier(0.7, 0, 0.84, 0)"
    move: "cubic-bezier(0.65, 0, 0.35, 1)"

voice:
  language: pt-BR
  avoid: [incrível, revolucionário, "o melhor do mundo"]
---

# Farol Ateliê (marca fictícia)

## Visão geral

Ateliê pequeno que faz vídeo de explicação. O quadro é noite: fundo azul-marinho, texto claro, e um único âmbar de
farol que aponta o que importa. Um elemento domina cada quadro.

## Cores

- `ground` é o fundo; `surface` é o cartão sobre ele; `ink` é o texto.
- `accent` uma vez por quadro, no que importa (o número, a palavra dita agora). `accent-2` só na segunda série de
  um gráfico.

## Tipografia

- `display` para chamadas de até seis palavras; `title` para títulos de cena; `body` para frases; `caption` para a
  legenda; `label` para rótulos de eixo e cargo.

## Movimento

- Entra com `motion.easing.enter` em `motion.duration.enter`; sai mais rápido do que entra (`exit`).
- Câmera e transição com `motion.easing.move`. Nada de quique, giro ou brilho.

## Tom de voz

Explica como quem desenha num guardanapo: frases curtas, verbo no presente, você. Sem superlativo; número só com
fonte. Evitar as palavras de `voice.avoid`.

## Faça e não faça

- Faça: margem `spacing.margin` em volta de tudo; texto numa linha sempre que der.
- Não faça: sombra borrada (varia entre renders, R03), clarão branco, mais de duas fontes.
