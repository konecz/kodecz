---
name: transicao-fade
description: Transição em que a cena nova aparece por cima da anterior, de transparente a opaca. Use para mudar de assunto com calma; para ritmo, prefira corte seco ou deslizar.
id: H05
versao: 1
estado: em-uso
regras: [G22]
quando: [mudança de assunto, abertura depois de cartela]
nao-quando: [clarão branco (G22), entre takes do mesmo apresentador]
entradas:
  design: "DESIGN.md: colors.ground"
parametros:
  duracao: { padrao: "15 quadros", faixa: "9 a 24 quadros a 30 qps" }
saidas: "uma camada .kz-fade dentro da cena que entra"
custo: { preparacao: "nenhuma", render: "repete-quadro: sim fora da transição", contexto: "~500 tokens" }
conferencia: [fade.inteira]
origem:
  - "técnica comum de edição (dissolve)"
  - "catálogo do HyperFrames em 2818160: fade-through e transitions-dissolve, só o nome; nenhum código lido nem copiado (R06)"
license: Proprietária
---

## O que é

A cena que entra vai de opacidade 0 a 1 em `--duracao` quadros, a partir do `--inicio` dela, por cima da que sai.

## Por quê

G22: transição com movimento ou mistura, nunca clarão branco. A camada pinta o fundo (`ground`) para a cena de baixo
não aparecer por trás do conteúdo novo.

## Como aplicar

1. A cena que entra começa no quadro da troca; a de baixo fica até a troca + `--duracao` (o `--fim` dela).
2. O conteúdo da cena nova vai dentro de `.kz-fade`.

## Bloco

```html
<section class="kz-cena" data-bloco="cena" style="--inicio: 90; --fim: 285">
  <div class="kz-fade" data-bloco="transicao-fade" style="--duracao: 15"> … </div>
</section>
```

## Conferência

- `fade.inteira` (P0): no fim da transição a camada cobre o quadro inteiro, opaca.

## Erros comuns

- A cena de baixo some antes do fim do fade: aparece o fundo no meio da mistura.
- Pôr `opacity` na própria cena em vez da camada.

## Exemplos

- `exemplo.html`: duas cenas de cor com fade de 15 quadros.
