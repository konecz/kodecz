# Brilho por quadro (piscada)

O render na placa mede o brilho de cada quadro **durante o render**, no quadro que já passa pela placa antes do NVENC
(decisão do responsável de 2026-11-01: a piscada é medida no render, não decodificando o MP4). Serve para achar a
**piscada** (um quadro isolado muito mais claro ou mais escuro que os vizinhos, como o quadro perdido do vídeo reprovado
na calibração do S04) e fica aberto a outras regras que leiam a série (a conferência, o bench).

- Onde se mede: `nativo/src/brilho.rs` (núcleo PTX, na thread do NVENC, depois da montagem do take e antes da
  codificação). A série e o aviso: `cli/brilho.ts`. Só no modo placa; no `--cpu` não há série (`brilho: null`).
- Custo: um núcleo que lê o quadro (e o anterior) e devolve duas somas; mediana em `brilho.msBrilho` (ms por quadro,
  na thread do NVENC). Medida do custo no registro do S08, seção 9.
- `MOTOR_BRILHO=0` desliga a medida (para medir o custo; sem a série, sem o arquivo e sem o aviso).
- É medida auxiliar: se o núcleo não carregar ou uma medida falhar, o render segue sem a série (`brilho: null`), com o
  motivo no stderr (`kodecz: warning: per-frame brightness was not measured (…)`).

## Escala

**A do Y do MP4:** BT.709 de faixa limitada, de 16 (preto) a 235 (branco), a mesma conversão que o NVENC faz do ARGB
(registro do M02). Assim os números batem com os medidos no MP4 entregue (a calibração do S04 mediu o Y do MP4). Luma
de cada pixel com os pesos do BT.709 (0,2126 R + 0,7152 G + 0,0722 B, em inteiros de soma 2^16); a soma é exata. No
vídeo real de 16:9 (2241 quadros), a série ficou a até 0,16 nível do `YAVG` do `signalstats` do ffmpeg sobre o MP4 (média
0,04): a diferença é só a compressão.

Com `--alfa` (camada do M05), o quadro tem alfa pré-multiplicado: o brilho é o do RGB sobre preto, e a piscada não é
procurada (`limitePiscada: null`, `piscadas: []`): a camada vai ser montada sobre outra coisa, e um elemento de um
quadro sobre o transparente acusaria à toa.

## O arquivo ao lado da saída

`<saída sem a extensão>.brilho.json` (`video.mp4` → `video.brilho.json`), uma linha JSON (exemplo, encurtado):

```json
{
  "formato": 1,
  "escala": "Y do MP4 (BT.709, faixa limitada: preto 16, branco 235)",
  "qps": 30,
  "de": 0,
  "limitePiscada": 60,
  "piscadas": [{ "quadro": 12, "pico": 190.2, "brilho": 235, "antes": 44.8, "depois": 44.8 }],
  "brilho": [44.8, 44.8, …],
  "mudanca": [0, 0.41, …]
}
```

| Campo | O que é |
|---|---|
| `formato` | versão deste formato; muda só se um campo mudar de sentido (campo novo não muda a versão) |
| `qps`, `de` | quadros por segundo da composição e o primeiro quadro renderizado (`--de`); o valor `i` das séries é o quadro `de + i` |
| `brilho` | um valor por quadro do arquivo (contando os repetidos): a média do luma do quadro, na escala acima, com 2 casas |
| `mudanca` | um valor por quadro: a média, pixel a pixel, da diferença absoluta do luma para o quadro anterior do arquivo, na mesma escala (0 no primeiro e nos repetidos). Pega a troca de quadro que não muda a média (um quadro de outra cena com o mesmo brilho) |
| `limitePiscada` | o limite usado (`LIMITE_PISCADA` do `cli/brilho.ts`) |
| `piscadas` | os picos isolados acima do limite, em ordem: `quadro` (na composição), `pico`, e o brilho do quadro e dos vizinhos |

A ordem das séries é a do arquivo. Num render fora de ordem (`M04_ORDEM`, só experimento e prévia), é a ordem do
fluxo, e o `de + i` não vale.

## Piscada

**Pico isolado:** o quadro `i` cujo brilho salta para o mesmo lado em relação aos dois vizinhos (mais claro que os
dois, o clarão; mais escuro que os dois, o quadro preto). O pico é o **menor dos dois saltos** (a medida da calibração do
S04, `experimentos/2026-11-s04-calibrar.md`). Piscada é pico acima de **60** (estrito).

- **Por que 60:** na calibração do S04 (o brilho medido no MP4), o vídeo reprovado pela piscada teve pico de 131,2 e os
  aprovados, 30,3 no máximo (a cortina de transição, nos mesmos quadros de todas as versões). 60 fica com o dobro de
  folga sobre os aprovados e menos da metade do reprovado. No vídeo real de 16:9 medido no render, o maior pico foi 0,5.
- **O que não é piscada:** corte seco (um salto só, sem volta), clarão de dois quadros ou mais, rampa (fade). Os testes
  (`cli/brilho.test.ts`; `cli/render.test.ts` com `cli/fixtures/linha-piscada` e `linha-sem-piscada`) fixam isso.

## No JSON do render

O resumo vai no campo `brilho` (null fora da placa):

```json
"brilho": { "arquivo": "/…/video.brilho.json", "medio": 143.23, "minimo": 93.7, "maximo": 223.95,
            "maiorPico": { "quadro": 1149, "pico": 0.5 }, "maiorMudanca": 116.23, "limitePiscada": 60,
            "piscadas": [], "msBrilho": 0.074 }
```

`maiorPico` é o maior pico isolado de qualquer tamanho (null se nenhum), para calibrar. Cada piscada também sai no
stderr: `kodecz: warning: flash at frame 12 (isolated brightness spike of 190.2: 44.8 → 235 → 44.8; limit 60)`. O
render não falha por piscada: é aviso, para quem confere decidir.
