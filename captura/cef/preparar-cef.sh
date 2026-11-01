#!/bin/bash
# Prepara o CEF 156.0.14 pronto para o host da captura (P02), fora do repositório: baixa o pacote mínimo de
# cef-builds.spotifycdn.com (se ainda não estiver no cache), confere o sha1 publicado no índice e monta em
# ~/.cache/motor-video/cef/156.0.14/rs o formato que o cef-dll-sys espera (CEF_PATH): Release/ e Resources/ juntos,
# include/, cmake/, libcef_dll/, LICENSE.txt, CREDITS.html e o archive.json. Links físicos, sem cópia, menos o
# libcef.so, que vai sem os símbolos de depuração (1,4 GB → 472 MB).
# O pacote pronto da Spotify é o build padrão do Chromium sem `proprietary_codecs` (sem H.264 nem AAC no navegador):
# o motor não usa o decodificador do navegador (o vídeo embutido é decodificado pelo motor, P10.5 e M09).
# Avisos de licença que vão junto se o binário for distribuído: LICENSE.txt (BSD-3 do CEF) e CREDITS.html (Chromium
# e dependências), ambos do pacote.
set -euo pipefail
VERSAO=156.0.14
NOME="cef_binary_156.0.14+g4fa4ab5+chromium-156.0.8078.48_linux64_minimal"
SHA1=d091c82a8655113a34616c08cb340bf92310298d
# CEF_RAIZ (o instalador passa a pasta do cache do motor) ou ~/.cache/motor-video/cef/156.0.14.
C="${CEF_RAIZ:-${MOTOR_CACHE:-$HOME/.cache/motor-video}/cef/$VERSAO}"
B="$C/$NOME"
R="$C/rs"
mkdir -p "$C"
# A pasta extraída só aparece inteira: a extração vai para uma temporária e é movida no fim (uma extração interrompida
# não deixa um $B pela metade que a rodada seguinte aceitaria sem conferir).
if [ ! -d "$B" ]; then
  arquivo="$C/cef.tar.bz2"
  if [ ! -f "$arquivo" ]; then
    curl -fL --retry 3 -o "$arquivo.parcial" "https://cef-builds.spotifycdn.com/$(printf %s "$NOME" | sed 's/+/%2B/g').tar.bz2"
    mv "$arquivo.parcial" "$arquivo"
  fi
  echo "$SHA1  $arquivo" | sha1sum -c - || { rm -f "$arquivo"; exit 1; }
  rm -rf "${C:?}/extraindo"
  mkdir -p "$C/extraindo"
  tar -xjf "$arquivo" -C "$C/extraindo"
  mv "$C/extraindo/$NOME" "$B"
  rm -rf "${C:?}/extraindo"
  # O achatado anterior (de outro pacote) sai: é refeito do pacote conferido.
  rm -rf "${R:?}"
fi
mkdir -p "$R"
# O archive.json sai antes e volta só no fim: rodada interrompida não deixa o achatado parecer pronto.
rm -f "$R/archive.json"
for f in "$B"/Release/*; do n=$(basename "$f"); [ "$n" = libcef.so ] && continue; ln -f "$f" "$R/$n"; done
cp -al "$B"/Resources/. "$R"/
for d in include cmake libcef_dll; do rm -rf "${R:?}/$d"; cp -al "$B/$d" "$R/"; done
for f in CMakeLists.txt CREDITS.html LICENSE.txt; do ln -f "$B/$f" "$R/$f"; done
if [ ! -f "$R/libcef.so" ]; then
  strip --strip-debug -o "$R/libcef.so.parcial" "$B/Release/libcef.so"
  mv "$R/libcef.so.parcial" "$R/libcef.so"
fi
printf '{"type":"minimal","name":"%s.tar.bz2","sha1":"%s"}' "$NOME" "$SHA1" > "$R/archive.json"
echo "CEF $VERSAO pronto em $R (captura/cef/montar.sh usa este caminho)"
