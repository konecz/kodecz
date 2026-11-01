#!/bin/sh
# S02: gera o «apresentador» sintético da demonstração dos blocos (R01: nada de cliente, nada de pessoa), em
# <pasta>/midia/apresentador.mp4 (fora do git: *.mp4). 1920×1080, 30 q/s, 6,5 s (195 quadros), H.264 + AAC.
# Fundo em degradê, uma «cabeça e ombros» (retângulos) que balança devagar, o número do quadro no canto e um tom de
# 330 Hz que liga e desliga a cada meio segundo (para ouvir o tempo do áudio).
# Uso: blocos/gerar-midia.sh [pasta]   (padrão: a pasta deste script)
set -eu
pasta=${1:-$(dirname "$0")}
mkdir -p "$pasta/midia"
fonte=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
ffmpeg -v error -y \
  -f lavfi -i "gradients=s=1920x1080:r=30:d=6.5:c0=0x22305e:c1=0x4a6fa8:x0=0:y0=0:x1=1920:y1=1080:speed=0.01" \
  -f lavfi -i "aevalsrc=0.2*sin(2*PI*330*t)*lt(mod(t\,1)\,0.5)|0.2*sin(2*PI*330*t)*lt(mod(t\,1)\,0.5):s=48000:d=6.5" \
  -filter_complex "[0:v]drawbox=x='750+40*sin(2*PI*t/3)':y=640:w=420:h=440:color=0xc98f5a@1:t=fill,\
drawbox=x='850+40*sin(2*PI*t/3)':y=300:w=220:h=280:color=0xeec39a@1:t=fill,\
drawtext=fontfile=$fonte:text='%{n}':fontsize=96:fontcolor=white@0.8:x=1700:y=60,format=yuv420p[v]" \
  -map "[v]" -map 1:a -c:v libx264 -preset medium -crf 18 -g 30 -c:a aac -b:a 192k -shortest "$pasta/midia/apresentador.mp4"
echo "gerado: $pasta/midia/apresentador.mp4"
