#!/bin/bash
# Monta o host da captura pelo CEF (P02). O CEF 156.0.14 pronto fica fora do repositório, achatado no formato que o
# cef-dll-sys espera (CEF_PATH), montado por captura/cef/preparar-cef.sh. O cargo copia o libcef.so e os recursos para
# target/release, ao lado dos executáveis (fora do git).
# Uso: captura/cef/montar.sh            (cargo build --release)
#      captura/cef/montar.sh test ...   (cargo test --release ...; os testes do host: `captura/cef/montar.sh test protocolo`)
#      captura/cef/montar.sh --no-default-features   (P14: sem a feature `placa`, para máquina sem driver NVIDIA: o host
#                                                   não liga no NVENC/NVDEC e só faz o modo CPU; o instalador escolhe)
#      captura/cef/montar.sh test --no-default-features protocolo   (os testes do protocolo sem a placa)
set -euo pipefail
cd "$(dirname "$0")"
export CEF_PATH="${CEF_PATH:-${MOTOR_CACHE:-$HOME/.cache/motor-video}/cef/156.0.14/rs}"
if [ ! -f "$CEF_PATH/archive.json" ]; then
  echo "erro: falta o CEF achatado em $CEF_PATH (captura/cef/preparar-cef.sh)" >&2
  exit 1
fi
sub=build
if [ "${1:-}" = test ]; then sub=test; shift; fi
exec "${CARGO:-$HOME/.cargo/bin/cargo}" "$sub" --release --locked "$@"
