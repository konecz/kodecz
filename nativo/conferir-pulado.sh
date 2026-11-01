#!/bin/bash
# C01: confere um vídeo (MP4 ou fluxo cru) com quadros pulados escritos pelo motor (nativo/src/pulado.rs).
#  1. decodifica inteiro no ffmpeg sem erro (-xerror);
#  2. acha os pulados pelo cabeçalho, com o trace_headers: o pulado se reconhece por five_minus_max_num_merge_cand = 4
#     (HEVC) ou nal_ref_idc = 2 (H.264), valores que o NVENC não usa (ele escreve 0 e 3);
#  3. cada pulado decodifica igual ao quadro anterior;
#  4. sem os pulados (bsf noise=drop), o que sobra, só os quadros do NVENC, decodifica sem erro e dá, quadro a quadro, o
#     mesmo que esses quadros no vídeo inteiro: depois de cada pulado, o NVENC e o decodificador usam as mesmas
#     referências. Juntos, 3 e 4 dizem que o vídeo é o do NVENC com cada repetido igual ao anterior.
# Saída: «<arquivo>: N quadros, P pulados iguais ao anterior; sem eles, os M do NVENC decodificam iguais».
# Uso: conferir-pulado.sh video
set -euo pipefail
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
nome=$(basename "$1")
ffmpeg -v error -xerror -i "$1" -map 0:v -f framemd5 - | grep -v '^#' | awk -F', *' '{print $NF}' > "$dir/inteiro"
total=$(wc -l < "$dir/inteiro")
ffmpeg -v info -i "$1" -map 0:v -c copy -bsf:v trace_headers -f null - 2>&1 \
  | awk '/Packet:/ {n++} /five_minus_max_num_merge_cand .* = 4$/ || /nal_ref_idc .* = 2$/ {print n - 1}' \
  | sort -nu > "$dir/pulados"
p=$(wc -l < "$dir/pulados")
if [ "$p" -eq 0 ]; then echo "$nome: $total quadros, 0 pulados"; exit 0; fi
diferentes=$(awk 'NR==FNR {h[FNR-1]=$1; next} !(h[$1] == h[$1-1]) {printf "%d ", $1}' "$dir/inteiro" "$dir/pulados")
if [ -n "$diferentes" ]; then echo "$nome: pulados diferentes do anterior: $diferentes" >&2; exit 1; fi
fmt=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$1")
expr=$(awk '{printf "%seq(n\\,%d)", (NR>1 ? "+" : ""), $1}' "$dir/pulados")
ffmpeg -v error -i "$1" -map 0:v -c copy -bsf:v "noise=drop=$expr" -f "$fmt" "$dir/nvenc.bruto"
ffmpeg -v error -xerror -f "$fmt" -i "$dir/nvenc.bruto" -f framemd5 - | grep -v '^#' | awk -F', *' '{print $NF}' > "$dir/nvenc"
awk 'NR==FNR {fora[$1+1]=1; next} !(FNR in fora)' "$dir/pulados" "$dir/inteiro" > "$dir/esperado"
if ! cmp -s "$dir/esperado" "$dir/nvenc"; then
  echo "$nome: DIFERE: sem os $p pulados, $(wc -l < "$dir/nvenc") quadros do NVENC contra $(wc -l < "$dir/esperado") esperados" >&2
  diff <(nl "$dir/esperado") <(nl "$dir/nvenc") | head -5 >&2
  exit 1
fi
echo "$nome: $total quadros, $p pulados iguais ao anterior; sem eles, os $(wc -l < "$dir/nvenc") do NVENC decodificam iguais"
