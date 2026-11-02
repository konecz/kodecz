#!/bin/sh
# Generates the synthetic media of the comparison cases (no person, no client) into <work>/<case>/:
#   apresentador/apresentador.mp4  1920x1080, 30 fps, 5 s, H.264 + AAC: a gradient, a swaying «head and shoulders»
#                                  made of two boxes, the frame number in the corner, and a 440 Hz tone that turns on
#                                  and off every half second. The same file as the 2026-10-30 measurement.
#   audiograma/fala.wav            27.13 s (814 frames at 30 fps), 48 kHz stereo: a tone whose pitch and loudness
#                                  move like speech (syllables of 0.18 s, pauses every 2 s).
#   audiograma/capa.jpg            1080x1080 cover: a gradient with geometric shapes.
# Usage: gerar-midia.sh <work dir>
set -eu
w=$1
fonte=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
mkdir -p "$w/apresentador" "$w/audiograma"

ffmpeg -v error -y \
  -f lavfi -i "gradients=s=1920x1080:r=30:d=5:c0=0x1b2a5a:c1=0x3a6fb0:x0=0:y0=0:x1=1920:y1=1080:speed=0.01" \
  -f lavfi -i "aevalsrc=0.25*sin(2*PI*440*t)*lt(mod(t\,1)\,0.5)|0.25*sin(2*PI*440*t)*lt(mod(t\,1)\,0.5):s=48000:d=5" \
  -filter_complex "[0:v]drawbox=x='860+60*sin(2*PI*t/2)':y=620:w=420:h=460:color=0xd9a066@1:t=fill,\
drawbox=x='960+60*sin(2*PI*t/2)':y=330:w=220:h=260:color=0xf0c8a0@1:t=fill,\
drawtext=fontfile=$fonte:text='%{n}':fontsize=140:fontcolor=white:x=60:y=60,format=yuv420p[v]" \
  -map "[v]" -map 1:a -c:v libx264 -preset medium -crf 16 -g 30 -c:a aac -b:a 192k -shortest \
  "$w/apresentador/apresentador.mp4"

# Speech-like tone: syllables (0.18 s) with a raised-sine envelope, pitch 140-220 Hz, silence 0.4 s every 2 s.
env='(0.5-0.5*cos(2*PI*mod(t\,0.18)/0.18))*gt(mod(t\,2)\,0.4)*(0.6+0.4*sin(2*PI*t*0.37))'
tom='sin(2*PI*(180+40*sin(2*PI*t*0.9))*t)'
ffmpeg -v error -y -f lavfi -i "aevalsrc=0.3*$env*$tom|0.3*$env*$tom:s=48000:d=27.1333" \
  -c:a pcm_s16le "$w/audiograma/fala.wav"

ffmpeg -v error -y \
  -f lavfi -i "gradients=s=1080x1080:d=1:c0=0x5b2a86:c1=0xf2a541:x0=0:y0=0:x1=1080:y1=1080:speed=0" \
  -frames:v 1 -vf "drawbox=x=140:y=140:w=800:h=800:color=0xffffff@0.15:t=40,\
drawbox=x=340:y=340:w=400:h=400:color=0x1d1d3b@0.85:t=fill" -q:v 3 "$w/audiograma/capa.jpg"

echo "generated: $w/apresentador/apresentador.mp4, $w/audiograma/fala.wav, $w/audiograma/capa.jpg"
