# Gerador de casos do Kodecz Bench (P12)

Os ~5 mil casos do bench a partir das 106 classes do #79 (`docs/pesquisa/erros-de-agentes.json`). Registros:
`docs/experimentos/2026-11-p12-gerador.md` (o manifesto) e `docs/experimentos/2026-11-p12-bench-completo.md` (mundo,
mutações, motores de oráculo, provas e matriz cruzada).

## Ideia

- **Mutação em vez de montagem:** para cada caso há uma cena base CORRETA (`mundo.ts`, por tipo de vídeo e eixos); a
  classe é uma mutação que injeta o defeito nela (a «errada»). A mesma mutação em intensidades diferentes dá os graus.
- **A regra é dado:** cada classe tem uma especificação em `especificacoes.json` (pedido, primitivas da errada e da
  certa, graus, regra = medida + parâmetros + limiar). As medidas são de três motores genéricos (`motores.ts`):
  estilo calculado e fonte da página; geometria e tempo; sinal (pixel, som, memória, metadado, mídia rotulada).
- **Um conjunto só com a conferência (S04):** as especificações são também as regras da conferência dos vídeos reais
  (`cli/conferir.ts`). O campo `conferencia` (G15, G19, G20…) diz que a regra roda lá, com esse código; as regras do
  S04 que ainda não são classe (G17, G21, tremor) ficam no mesmo arquivo com `so: "conferencia"`, e o bench as pula
  (`lerEspecificacoes` devolve só as classes; `lerRegras`, tudo). A situação (`situacaoDe`) vale nos dois: automática,
  aviso, desligada; a conferência pode ter a própria (`"conferencia": { "codigo": "G20", "situacao": "aviso" }`), sem
  mudar a do bench. Formato em `docs/formatos/conferencia.md`.
- **A regra só lê a evidência** (`evidencia.ts`): a página entregue, a coleta (`../bench/sonda.js` +
  `sonda-estilo.js`), o render, a biblioteca de mídia rotulada e a tarefa. Nunca o modelo da cena nem a mutação.

## Arquivos

| Arquivo | O que é |
|---|---|
| `expandir.ts`, `efetivo.ts`, `catalogo.ts`, `compostas.ts` | o manifesto `casos.jsonl` (como no #88); o verificador de cada caso diz a medida, o motor e a situação |
| `mundo.ts` | a cena base (modelo de dados), os acessórios, a página e a mídia sintética |
| `mutacoes.ts` | as primitivas e o formato da especificação |
| `especificacoes.json` | uma especificação por classe (`origem`: «modelo» se veio do modelo e passou nas provas, «mao» se foi escrita à mão), mais as regras só da conferência (`so: "conferencia"`) |
| `motores.ts` | as medidas e `avaliarRegra` |
| `evidencia.ts`, `sonda-estilo.js` | a evidência de uma entrega |
| `provas.ts`, `provar.ts` | dois sentidos, graus, pairwise, matriz cruzada |
| `propor.ts` | a geração das especificações por modelo barato, com auto-verificação e teto de custo |
| `adaptador.ts` | o caso como `Item` do degrau 1 (o rodador usa) |
| `mesmice.ts` | K-IA-09, métrica da rodada |
| `rotulos.ts` | os pares A/B para o responsável e a concordância |
| `calibrar.ts` | as regras de geometria nos vídeos reais da calibração do S04 (só números agregados, R01) |

## Comandos

```
node bench-gerador/expandir.ts [--conferir]                    # o manifesto
node --test bench-gerador/*.test.ts                            # sob flock -s /tmp/motor-video-placa.lock
node bench-gerador/provar.ts --classes K-DES-07 --max 8        # provas de uma classe (placa, sob flock -s)
node bench-gerador/provar.ts --matriz                          # a matriz cruzada (do cache em tmp/bench-provas/)
node bench-gerador/propor.ts gerar|cpu|provar --classes …      # geração com auto-verificação
node bench-gerador/rotulos.ts html | conferir <respostas.json> # rodada de rótulos A/B
```
