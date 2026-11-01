# Prévia rápida (S07)

`cli/previa.ts`: os quadros de uma composição em linha do tempo (P10, `linha-do-tempo.md`) em PNG, o mesmo pixel do
render (R03), sem renderizar o vídeo inteiro; e um modo que refaz esses quadros a cada mudança na pasta, com uma
página local para o responsável olhar.

```
node cli/previa.ts <pasta> <composição> --quadro 30 [--saida x.png]
node cli/previa.ts <pasta> <composição> --quadro 0,45,120 [--saida pasta]
node cli/previa.ts <pasta> <composição> --observar [--quadro 0,45,120] [--servir [--porta N]] [--saida pasta]
```

| Opção | O que faz |
|---|---|
| `--quadro <N \| lista>` | quadros a gerar; no `--observar`, o padrão é o primeiro, o do meio e o último |
| `--saida` | um quadro: o PNG (padrão `tmp/previa/<composição>/quadro-N.png`); vários ou `--observar`: a pasta, com `quadro-N.png` (padrão `tmp/previa/<composição>/`) |
| `--observar` | refaz os quadros a cada mudança na pasta; para com Ctrl+C ou SIGTERM |
| `--servir`, `--porta` | com `--observar`: página em `http://127.0.0.1:<porta>/` (padrão: porta livre) |
| `--placa`, `--cpu`, `--sem-contencao` | passados ao `cli/render.ts` |

## Como sai o quadro

- Pelo próprio `cli/render.ts --gravar` (sem mexer no laço): o quadro da prévia é o do vídeo. Vários quadros saem num
  render só, que desenha só eles (o `M04_ORDEM` do `captura/main.ts`; cada salto é precedido do N − 1 sem captura,
  P10.4); um trecho seguido vai como `--de`/`--quadros`. O BGRA vira PNG RGBA sem perda (`cli/quadros.ts`, o mesmo
  das referências do S05).
- Teste: `cli/previa.test.ts` confere cada PNG com o quadro N do render inteiro pela régua do R03, no frio, no
  quente e no quadro avulso da página (saiu igual bit a bit nas medições).

## `--observar`

- `fs.watch` recursivo na pasta (a `--saida` não pode ser a própria pasta); sem inotify livre (limite do sistema
  esgotado), avisa e olha a pasta a cada 300 ms pelo tamanho e a data dos arquivos (`MOTOR_PREVIA_CONSULTAR=1` força); uma rajada de eventos (120 ms) vira um render só; mudança durante um render agenda
  mais um, no fim. A pasta da saída, se estiver dentro da observada, não dispara.
- O primeiro render abre frio; no fim de cada render abre a reserva quente seguinte (`cli/render.ts --esperar
  --previa`, `cli/abertura.ts`: sonda, weston e navegador já de pé). Sem placa (ou com `--cpu`), todo render é frio; a reserva que não abre por outro motivo é tentada de novo, e o
  quente desliga na terceira falha seguida.
  O `--previa` é só da prévia: deixa o job gravar quadros e trazer a «ordem»; o `--esperar` sozinho continua recusando os dois.
- Uma linha JSON no stdout por render:
  `{"evento":"quadros","versao":2,"quadros":{"30":"…/quadro-30.png"},"ms":1012,"quente":true,"modo":"placa"}`
  ou `{"evento":"erro","versao":3,"mensagem":"…"}` (a composição quebrada não para a observação). Com `--servir`,
  antes de tudo, `{"evento":"pagina","url":"http://127.0.0.1:…/"}`.
- O PNG é trocado de uma vez (escrito ao lado e renomeado): quem lê nunca pega um pela metade.
- Página (`--servir`): só em 127.0.0.1, só GET e só com o `Host` do próprio endereço (contra DNS rebinding) e, quando o navegador manda `Sec-Fetch-Site`, só `same-origin` ou `none` (outra
  página aberta não põe render na fila). Mostra
  os quadros da lista, que se atualizam sozinhos (`/eventos`, Server-Sent Events), e um controle de N
  (`/quadro/N.png`): o N fora da lista é renderizado sob pedido, guardado até a próxima mudança, numa temporária.
- Ao parar: fecha o observador e a página, mata os grupos de processos (renders, reserva, weston, a captura pelo CEF) e apaga
  as temporárias; sai com 0. Os PNG da saída ficam.

## Saída e códigos

Progresso no stderr. Quadro solto: uma linha JSON no stdout (`{"ok":true,"quadros":{"30":"…"},"ms":…,"quente":false,
"modo":"placa","largura":…,"altura":…}`); códigos 0 ok, 1 render falhou, 2 argumentos, 3 `--placa` sem placa,
128 + sinal se interrompido. O `--observar` para com Ctrl+C ou SIGTERM e sai com 0; um render que estava na fila
não começa (nada sobe depois da parada).

## Tempos (RTX 5090, `cli/fixtures/linha-sintetica`, 960 × 540, 2026-10-30)

| Caso | Tempo |
|---|---|
| Quadro solto, comando inteiro (frio) | 1,69 a 1,94 s |
| 3 quadros num render (frio, comando inteiro) | 1,91 a 2,05 s |
| `--observar`, primeiro render (frio, 2 quadros) | 1,68 a 1,76 s |
| `--observar`, mudança com a reserva já aberta (1 quadro, pela página) | 0,84 a 1,10 s |
| `--observar`, mudança colada na anterior (espera a reserva terminar de abrir, 2 quadros) | 1,48 a 1,81 s |

Pela captura do CEF (padrão da linha do tempo desde o P02), na mesma composição: quadro solto frio 1,77 a 2,25 s,
3 quadros 1,87 a 2,18 s, primeiro do `--observar` 1,72 a 2,04 s, avulso com a reserva aberta 1,03 a 1,22 s.

Cada render (frio ou a reserva) roda com o `TMPDIR` numa temporária da prévia: o que a árvore dele deixa ao ser
parada no meio (a pasta do Chromium, a do host do CEF) some com ela.

Onde vai o tempo: no frio, ~0,8 s até o navegador (Node, sonda do NVENC, weston), que a reserva tira; o laço de um
quadro leva ~0,14 s; o resto é por processo (a captura carregar o `captura/main.ts` e a página, abrir o Vulkan e o
NVENC, sair, e o ffmpeg e o ffprobe do MP4). Abaixo de ~1 s, só com uma sessão que mantenha a página aberta entre
quadros (pendência no `docs/estado-atual.md`). O PNG custa ~0,3 s por quadro em 1920 × 1080 (`paraPng`).
