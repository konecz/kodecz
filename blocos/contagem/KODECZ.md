---
name: contagem
description: Número grande que conta de zero até o valor, desacelerando no fim, ou contagem regressiva de N até 1, um número por segundo. Use para destacar um número dito ou para abrir uma revelação.
id: H13
versao: 1
estado: em-uso
regras: [G14, G19, G20]
quando: [número de destaque, revelação com regressiva]
nao-quando: [valor com casas decimais, mais de um número grande no quadro]
entradas:
  dados: "valor inteiro (ou o N da regressiva)"
  design: "DESIGN.md: colors.accent, colors.muted, typography.display, typography.body"
parametros:
  contagem-tamanho: { padrao: "1.6", faixa: "1 a 2 vezes o display" }
  prefixo: { padrao: "nenhum", faixa: "texto entre aspas, como 'R$ '" }
  sufixo: { padrao: "nenhum", faixa: "texto entre aspas, como ' %'" }
  de: { padrao: "3", faixa: "2 a 10, na regressiva" }
saidas: "um .kz-contagem com .kz-contagem-num (e rótulo opcional)"
custo: { preparacao: "nenhuma", render: "repete-quadro: sim depois da contagem; na regressiva, o pulso anda o tempo todo", contexto: "~700 tokens" }
conferencia: [contagem.chega-no-alvo, contagem.zona-segura]
origem:
  - "prova P07 do motor (cartões com número contando), reescrita em CSS puro"
  - "catálogo do HyperFrames em 2818160: count-up, só o nome; nenhum código lido nem copiado (R06)"
license: Proprietária
---

## O que é

O bloco entra (opacidade e meio corpo de subida) no `--inicio`, e `@property --kz-valor` (inteiro) vai de 0 ao
`--valor` do `--inicio` ao `--fim`, mostrado por `counter()`. Na
regressiva (`.kz-regressiva`), a mesma propriedade desce de `--de` até 1 em degraus de um segundo
(`steps(--de, jump-none)`), com um pulso a cada número.

## Por quê

Contar chama o olho para o número no momento em que ele é dito (G14: o `--inicio` vem da palavra). Inteiro pelo CSS:
nada de texto trocado por script a cada quadro (que obrigaria o `motor_quadro` e desligaria o quadro repetido).

## Como aplicar

1. `--inicio` = quadro da palavra do número; `--fim` = onde a contagem para (o número fica no valor depois).
2. `data-valor` no `.kz-contagem-num` com o valor final (na regressiva, 1).
3. Regressiva: `--de` e `--fim` = `--inicio` + `--de` × qps.

## Bloco

```html
<div class="kz-contagem" data-bloco="contagem" style="--inicio: 470; --fim: 530; --valor: 312">
  <b class="kz-contagem-num" data-valor="312"></b><span class="kz-contagem-rotulo">vídeos no semestre</span>
</div>
```

## Conferência

- `contagem.chega-no-alvo` (P0): no `--fim`, o número mostra o `data-valor`.
- `contagem.zona-segura` (P0): parado, dentro de `--spacing-safe`.

## Erros comuns

- `--valor` com casas decimais: o contador arredonda.
- Regressiva com `--fim` errado: a conferência acusa o número que não chegou a 1.

## Exemplos

- `exemplo.html`: contagem até 312 e regressiva de 3.
