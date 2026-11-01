// Argumentos do ffmpeg para cada codificador do M06, usados pelo main.mjs e pelo teste.mjs do M06 e pelo captura/codificador-cpu.ts (o x264).
// O quadro chega em BGRA com alfa pré-multiplicado (ver o registro).
//
// x264: o `setparams` marca o quadro como BT.709 de faixa limitada antes da conversão para yuv420p. Assim o
// swscale converte com a matriz BT.709 e o fluxo leva matriz, primárias e transferência BT.709. Só com as opções de
// saída (-colorspace, -color_primaries, -color_trc), o ffmpeg 8 converte em BT.709 mas grava primárias e
// transferência como «unknown» (conferido com ffprobe, ver o registro).
export const X264 = ['-vf', 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p'];

export const CODIFICADORES = {
  x264: { arquivo: 'x264.mp4', args: X264 },
  utvideo: { arquivo: 'utvideo.mkv', args: ['-c:v', 'utvideo', '-pix_fmt', 'gbrap'] },
  ffv1: { arquivo: 'ffv1.mkv', args: ['-c:v', 'ffv1', '-level', '3', '-slices', '16', '-pix_fmt', 'bgra'] },
  // Só a captura: o ffmpeg lê o pipe e descarta (custo do Chromium, do `paint` e do pipe, sem codificar).
  nulo: { arquivo: null, args: ['-f', 'null'] },
  // Para os testes: `lento` lê a 5 quadros por segundo (o filtro realtime segura a saída), o que enche o pipe e
  // obriga a contrapressão; `sai-cedo` lê 2 quadros e sai, como um ffmpeg que morre no meio.
  lento: { arquivo: null, args: ['-vf', 'setpts=N/(5*TB),realtime', '-f', 'null'] },
  'sai-cedo': { arquivo: null, args: ['-frames:v', '2', '-f', 'null'] },
  // Só para reproduzir o modo cpu do M02 (precisa da placa visível).
  nvenc: { arquivo: 'nvenc.hevc', args: ['-c:v', 'hevc_nvenc', '-preset', 'p4', '-tune', 'hq', '-bf', '0'] },
};
