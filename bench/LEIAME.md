# Kodecz Bench (P12)

A prova do protocolo Kodecz: os 27 erros reais dos vídeos feitos com o Remotion, recriados como tarefas para o motor
(linha do tempo declarada, `docs/formatos/linha-do-tempo.md`), cada uma com um oráculo automático. Três modos: 1, o
agente só com os documentos; 2, com o protocolo; 3, com o protocolo e as lições. O degrau 1 (este) é o modo 1, a
linha de base. Registro: `docs/experimentos/2026-10-p12-kodecz-bench.md`.

Tudo é inventado (R01): a marca fictícia Zunzum (`identidade/fixtures/marca-ficticia/`), falas e tempos fictícios,
voz feita de tons, clipes de formas e, como apresentador, o retrato de domínio público que a conferência do S04 já usa
nos testes (`conferencia/preparar.ts`). A mídia é gerada na pasta da tarefa (`molde.ts`); nada dela entra no git.

## Arquivos

| Arquivo | O que é |
|---|---|
| `itens.ts` | o catálogo: pedido, partida, solução errada e certa e oráculo de cada item; `FORA`, os que não entram |
| `molde.ts` | página em linha do tempo, apresentador, voz, clipes e imagens sintéticos |
| `oraculos.ts` | as checagens (reaproveitam a margem do rosto, as linhas da legenda e o zoom × frase do S04) |
| `coletar.ts`, `sonda.js` | a geometria de cada quadro pela coleta do S04, com a sonda do bench; o render na placa, sob a trava |
| `analise.ts` | o MP4: luma, quadros parados, contraste, cores, voz por tom, assinatura do x264 |
| `avaliar.ts` | aplica o oráculo à entrega de uma pasta de tarefa |
| `oraculos.test.ts` | cada oráculo nos dois sentidos: acusa a errada e passa a certa |
| `rodar.ts` | o rodador do modo 1 (`claude -p` na pasta da tarefa) |

## Comandos

```
node --test bench/oraculos.test.ts                 # os 20 oráculos nos dois sentidos (~1 min; placa e CPU)
node bench/rodar.ts --itens e1,t1 --modelo opus    # modo 1 em dois itens
node bench/rodar.ts --so-preparar --pasta /tmp/x   # só monta as pastas das tarefas, para olhar
node bench/rodar.ts --gerador --amostra 50 --semente 1 --so-preparar     # 50 casos do gerador, estratificados por classe
node bench/rodar.ts --gerador --classe K-DES-07 --grau unico,no          # filtro por classe, área, grau, forma ou id
```

Com `--gerador`, os itens são os casos do manifesto `bench-gerador/casos.jsonl` (5.075 de classe e 255 compostos;
`bench-gerador/LEIAME.md`): a partida e o pedido vêm da cena base do mundo e da especificação da classe, e o oráculo é
a regra da classe nos motores genéricos (`bench-gerador/motores.ts`). Caso com `bloqueio` (largura < 800) ou sem
oráculo por caso (K-IA-09, métrica da rodada: a `mesmice` sai no resumo) é pulado e registrado como pulado.

Cada render pega sozinho a trava compartilhada da placa (`flock -s`, que só espera quem mede com `-x`); não rodar o
teste nem o rodador dentro de `flock -x` (travaria).
Pré-requisitos: os do render e da conferência (`captura/`, `conferencia/` com `npm ci`, `node conferencia/preparar.ts`).

## A pasta da tarefa (modo 1)

Fora de `~/projetos` (para o agente não carregar CLAUDE.md nenhum) e sem a configuração do usuário. Tem o `PEDIDO.md`,
um `LEIAME.md` curto, a partida em `saida/`, os documentos (`docs/video-konecz/SKILL.md`, `docs/blocos/`,
`docs/formatos/`, `marca/`) e o comando `./motor previa|render|conferir`. Nada do protocolo nem do bench. O rodador
marca como contaminada a rodada em que o agente lê o bench ou a memória do projeto.

## Catálogo

Cada erro está classificado na taxonomia de `docs/pesquisa/erros-de-agentes.json` (#79) em `CLASSIFICACAO`
(`itens.ts`): a classe K-… que ele instancia (ou a mais próxima, marcada `parente`, candidata a classe nova), a camada
do protocolo que o pega e a gravidade, nos critérios do #79. Os 27 erros reais são a semente; os casos que variam os
eixos do #79 (formato, densidade, rosto, fala…) ficam para depois.

20 itens no bench automático, 7 fora. A classificação das fontes (para conferir) deu espaço 7, tempo da fala 5,
movimento 5, contexto 3, cobertura 2, gosto 2, geração da mídia 2 e motor 1.

| Item | Categoria | Erro recriado | Oráculo |
|---|---|---|---|
| e1-faixa-no-rosto | espaço | faixa no alto do 9:16 em tela cheia, sobre o rosto | texto × rosto com a margem do S04 (G15), rosto de caixa conhecida |
| e2-legenda-duas-linhas | espaço | legenda por frase inteira quebrando em duas linhas no 9:16 | linhas da legenda (G17) |
| e3-eixos-16x9 | espaço | faixa no canto e legenda centralizada (16:9) | centros a até 3 % da largura e faixa logo acima da legenda (G16) |
| e4-eixos-9x16 | espaço | o mesmo, no 9:16 | idem |
| e5-meia-logo | espaço | recorte 9:16 do take horizontal corta a logo do fundo ao meio | parte visível da logo entre 5 % e 95 % (G23) |
| e6-fonte-fina-ceu | espaço | serifada fina branca sobre céu claro | contraste no render, texto × fundo atrás dele, ≥ 3:1 (G20) |
| e7-legenda-zona-base | espaço | legenda na base do Reels | todo texto na zona segura: 14 % em cima, 35 % embaixo, 6 % dos lados (G19) |
| t1-zoom-corta-frase | tempo da fala | punch-in de duração fixa volta no meio da frase | zoom × frase do S04 (G21) |
| t2-bloco-whisper | tempo da fala | bloco cortado no fim da palavra do Whisper | tempo com voz de cada bloco no render × referência (G09) |
| t4-zoom-por-palavra | tempo da fala | câmera do documento a cada valor citado | no máximo um início de movimento por frase |
| t5-fala-acelerada | tempo da fala | fala acelerada 1,15× (o aprovado foi 1,10×) | duração da voz no render × original, fator ≤ 1,10 |
| m1-texto-tremendo | movimento | escala lenta numa tela com texto | nenhum texto em movimento contínuo por mais de 24 quadros |
| m2-texto-travado | movimento | cada frase entra, para e some | sem quadro vazio entre as frases e 2 quadros com as duas |
| m3-animacao-parada | movimento | telas paradas depois da entrada | nenhum trecho de 45 quadros sem mudança no render |
| m4-foto-parada | movimento | foto parada com zoom no lugar do vídeo vivo | nenhuma `<img>` cobrindo 40 % do quadro por 15 quadros (G22) |
| m5-clarao-branco | movimento | clarão branco na transição | nenhum quadro com luma média > 190 ou 35 % quase branco (G22) |
| x1-base-velha | contexto | vídeo novo a partir da base velha (logo e cores antigas) | cores da identidade velha em ≤ 0,3 % de cada quadro |
| x3-render-cpu | contexto | render pelo script copiado, que roda na CPU | o MP4 entregue sem a assinatura do x264 (G33) |
| c1-verba-nao-destacada | cobertura | valor pequeno ou zerado citado e não destacado | cada célula citada na tela e realçada enquanto é dita |
| c2-periodo-sem-datas | cobertura | fala cita o período e a tela mostra só os valores | idem, nas datas |

Fora do bench automático (`FORA` em `itens.ts`):

| Item | Categoria | Motivo |
|---|---|---|
| t3-texto-de-apoio-whisper | tempo da fala | depende de rodar o Whisper e do comportamento dele com o texto de apoio |
| x2-device-cpu | contexto | depende do ambiente do Whisper (CUDA); a mesma armadilha está no x3 com o render |
| g1-assinatura-de-site | gosto | sem medida objetiva |
| g2-transicoes-fracas | gosto | «fraca» é julgamento; o objetivo da parte está no m5 |
| d1-imagem-2x3-no-veo | geração da mídia | acontece no gerador de vídeo pago, fora do agente de edição |
| d2-cara-de-ia | geração da mídia | prompt do gerador e gosto |
| k1-quadro-perdido | motor | erro do motor antigo; o nosso testa o quadro N, e o oráculo do m5 pegaria a piscada |

## Limites conhecidos

- O oráculo mede o erro recriado, não a qualidade do vídeo: a solução certa escrita à mão é mínima.
- e1, e4 e e7 se tocam (a faixa e a legenda do 9:16 entre o queixo e os 65 % da altura); o m1 (texto parado depois
  de entrar) e a técnica antiga de «texto que respira» se contradizem: valeu a regra mais nova (2026-10-30).
- O t5 cobra um limite (1,10×) que nenhum documento do modo 1 traz: é um erro que só uma lição evita.
- O m2 cobra a técnica (as frases se transformam uma na outra), não só o ausente (tela vazia).
