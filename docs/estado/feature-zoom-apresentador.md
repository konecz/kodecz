# feature/zoom-apresentador (checkpoint, apagar antes do PR)

H02 no padrão aprovado: take do apresentador montado por `blocos/zoom-ate-o-fim-da-frase/montar.ts`.

- Aproximação lenta (1 → 1,06) somada ao punch-in de 12 % por ênfase (mola damping 18 na palavra, saída que acaba
  no fim da frase, G21).
- Zoom pela caixa do vídeo (left/top/width/height em keyframes amostrados por quadro), não por `transform` no
  invólucro: o `take-placa.js` manda para o canvas a escala num ancestral do vídeo. Medir placa × canvas.
- Trava nas bordas (o vídeo sempre cobre a caixa), recorte 16:9 → 9:16 no foco, cartão opcional (mola damping 200,
  22 quadros, caixa no pixel inteiro).
- Conferência: marcadores `.kz-take-enfase` com `--kz-punch` herdado (distância de 0 no `--fim`).
- `.kz-zoom` antigo continua igual (exemplo.html e teste antigos intactos); exemplo novo em `exemplo-apresentador.html`.

Passos: [x] teste  [x] montar.ts + bloco.css  [x] exemplo  [x] conferência  [x] KODECZ.md v2 + INDICE  [x] medida (placa 195/195, v1 146 no canvas)  [ ] verificar completo
