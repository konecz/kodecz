#!/usr/bin/env bash
# Vídeo sintético com o número do quadro marcado (R01: nada de cliente), gerado na hora e fora do repositório
# (tmp/ve, ou $VE_MIDIA). Veio do experimento do vídeo embutido (docs/experimentos/2026-10-m04-video-embutido.md).
# - sintetico.h264: 1920×1080, 25 qps, 12 s, H.264 High sem quadros B, ~4 Mbit/s (como um take de apresentador),
#   Annex-B com AUD (um corte por quadro para a página). testsrc + ruído temporal (cada quadro difere do vizinho) e, na
#   faixa de baixo (y 1040–1079, x 0–1439), o número do quadro em 12 blocos de 120 px (bit 0 à esquerda).
# - sintetico.mp4: o mesmo vídeo em MP4 com um seno de 440 Hz em AAC 48 kHz estéreo (para o vídeo com áudio).
# VE_DURACAO (s, padrão 12): duração dos dois (os testes do comando, P10.5, usam um curto).
set -euo pipefail
cd "$(dirname "$0")"
SAIDA=${VE_MIDIA:-../../tmp/ve}; mkdir -p "$SAIDA"
D=${VE_DURACAO:-12}
F="testsrc=size=1920x1080:rate=25:duration=$D,noise=alls=10:allf=t,drawbox=x=0:y=1040:w=1440:h=40:color=black:t=fill"
for b in $(seq 0 11); do
  F+=",drawbox=x=$((b * 120)):y=1040:w=120:h=40:color=white:t=fill:enable='bitand(n\\,$((1 << b)))'"
done
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "$F" -c:v libx264 -preset fast -profile:v high -pix_fmt yuv420p \
  -g 50 -bf 0 -b:v 4M -maxrate 5M -bufsize 8M -bsf:v h264_metadata=aud=insert -f h264 "$SAIDA/sintetico.h264"
ffmpeg -hide_banner -loglevel error -y -i "$SAIDA/sintetico.h264" -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=$D" \
  -map 0:v -map 1:a -c:v copy -c:a aac -ac 2 -b:a 128k -r 25 -movflags +faststart "$SAIDA/sintetico.mp4"
ls -la "$SAIDA"/sintetico.*
