#!/bin/bash
# P14: prova da instalação e do render na CPU numa máquina SEM driver NVIDIA, num contêiner limpo (node:24-trixie-slim,
# o do P03) sem CDI, sem /dev/nvidia* e sem as .so do driver. O /sys do contêiner é o do hospedeiro: o /sys/module/nvidia
# e o /sys/class/drm de lá (o que o instalador e a sonda da placa leem) ficam cobertos por tmpfs vazios; o resto
# (/proc/driver/nvidia, os módulos nvidia_drm e nvidia_uvm) continua visível, e nada do motor o lê.
#
# Passos dentro do contêiner, como root (o apt sem sudo): ./instalar.sh --sistema; se ele pedir o Rust, o rustup que ele
# imprime e ./instalar.sh de novo; tem de terminar «pronto». Depois, o render da composição sintética na CPU, com os 60
# quadros gravados: cada um tem de trazer N nas três tarjas da página (cli/fixtures/linha-sintetica), além da marca que
# o próprio render confere. Por fim, o --placa tem de ser recusado com a instrução (saída 3), sem render, e os testes
# do protocolo do host sem a feature `placa` (a recusa das operações do modo placa) passam.
#
# Uso (da raiz do repositório; o docker e a rede, para o apt, o rustup, o npm e o CEF):
#   flock -s /tmp/motor-video-placa.lock instalar/sem-nvidia.sh [--cache-cef] [--saida PASTA]
#   --cache-cef   usa o CEF já achatado desta máquina (~/.cache/motor-video/cef/156.0.14, só leitura) em vez de baixar
#                 os 332 MB de novo; o resto (apt, Rust, npm, compilação) é sempre do zero
#   --saida       onde ficam o log, o framemd5, o hash de cada quadro BGRA e o MP4 (padrão: tmp/sem-nvidia/ na raiz)
# Saída: 0 se instalou («pronto») e o render saiu certo; 1 senão (o log diz onde parou). Leva de 5 a 15 min.
# As fontes vão ao contêiner como estão no disco (o que o git rastreia e os arquivos novos não ignorados), sem
# node_modules nem target. O contêiner é apagado no fim, mesmo interrompido.
set -euo pipefail
raiz=$(cd "$(dirname "$0")/.." && pwd)
saida="$raiz/tmp/sem-nvidia"
cache_cef=0
while [ $# -gt 0 ]; do
  case "$1" in
    --cache-cef) cache_cef=1 ;;
    --saida) saida="$2"; shift ;;
    *) echo "uso: instalar/sem-nvidia.sh [--cache-cef] [--saida PASTA]" >&2; exit 2 ;;
  esac
  shift
done
mkdir -p "$saida"
nome="motor-sem-nvidia-$$"
trap 'docker rm -f "$nome" >/dev/null 2>&1 || true' EXIT
trap 'exit 130' INT TERM

opcoes=(--name "$nome" -i --shm-size=1g
  # O bwrap do modo CPU (esconde a placa) precisa de um namespace novo: o docker barra sem o seccomp e o AppArmor soltos,
  # e com kernel.apparmor_restrict_unprivileged_userns=1 (Ubuntu 24.04+) o de usuário falha mesmo assim; com o
  # CAP_SYS_ADMIN, o bwrap do root cria só o de montagem. Nenhum dos três dá acesso a dispositivo (a placa segue fora),
  # mas juntos soltam o confinamento (mount, umount) de um contêiner que roda apt, npm e o rustup como root: servem para
  # esta prova local, não como padrão.
  --cap-add SYS_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined)
for d in /sys/module/nvidia /sys/class/drm; do [ -e "$d" ] && opcoes+=(--tmpfs "$d:ro"); done
cef="$HOME/.cache/motor-video/cef/156.0.14"
if [ "$cache_cef" = 1 ]; then
  [ -f "$cef/rs/archive.json" ] || { echo "erro: --cache-cef sem o CEF achatado em $cef/rs" >&2; exit 2; }
  opcoes+=(-v "$cef:/root/.cache/motor-video/cef/156.0.14:ro")
fi

# O roteiro de dentro do contêiner. Cada etapa escreve «== etapa» e o resultado final é a última linha: «P14: ok» ou
# «P14: falhou em <etapa>».
read -r -d '' interno <<'FIM' || true
set -uo pipefail
falhou() { echo "P14: falhou em $1"; exit 1; }
export XDG_RUNTIME_DIR=/tmp/xdg && mkdir -m 700 -p "$XDG_RUNTIME_DIR"
mkdir -p /motor /resultado && tar -x -C /motor && cd /motor || falhou "copiar as fontes"

echo "== ambiente sem driver NVIDIA"
{ compgen -G "/dev/nvidia*" || [ -e /dev/dri ]; } && falhou "o contêiner vê a placa"
ldconfig -p | grep -E 'libnvidia|libcuda|libnvcuvid' && falhou "o contêiner tem bibliotecas do driver"
[ -e /sys/module/nvidia/version ] && falhou "o contêiner vê o módulo nvidia"
echo "sem /dev/nvidia*, sem /dev/dri, sem libnvidia-*, sem /sys/module/nvidia"

echo "== ./instalar.sh --sistema"
./instalar.sh --sistema 2>&1 | tee /resultado/instalar-1.txt
estado=${PIPESTATUS[0]}
if grep -q "Rust (cargo) ausente" /resultado/instalar-1.txt; then
  echo "== rustup (o comando que o instalador imprimiu) e ./instalar.sh de novo"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal >/resultado/rustup.txt 2>&1 \
    || falhou "rustup"
  ./instalar.sh 2>&1 | tee /resultado/instalar-2.txt
  estado=${PIPESTATUS[0]}
fi
echo "instalar.sh saiu com $estado"
instalou=1
[ "$estado" = 0 ] || instalou=0

echo "== render na CPU (60 quadros, todos gravados)"
ffmpeg -version | head -n 1
quadros=$(seq -s, 0 59)
node cli/render.ts cli/fixtures/linha-sintetica LinhaSintetica /resultado/saida.mp4 --cpu \
  --gravar "$quadros" --gravar-pasta /resultado/q >/resultado/render.json 2>/resultado/render.txt
r=$?
tail -n 5 /resultado/render.txt
[ "$r" = 0 ] || { [ "$instalou" = 1 ] || falhou "instalar.sh (e o render: saiu com $r)"; falhou "render (saiu com $r)"; }

echo "== quadro N nas três tarjas de cada quadro"
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { lerMarcaEm } from "/motor/captura/faixa.ts";
  let erros = 0;
  for (let n = 0; n < 60; n++) {
    const p = readFileSync(`/resultado/q/motor-${n}.bgra`);
    const lidos = [524, 508, 492].map((y) => lerMarcaEm(p, 960, y + 8));
    if (lidos.some((v) => v !== n)) { erros++; console.log(`quadro ${n}: tarjas ${lidos}`); }
  }
  console.log(`${60 - erros} de 60 quadros com N nas três tarjas`);
  process.exit(erros ? 1 : 0);
' || falhou "tarjas"
# O hash de cada quadro BGRA (o pixel antes do x264), para comparar com o render da CPU de outra máquina.
(cd /resultado/q && sha256sum $(seq -f "motor-%g.bgra" 0 59)) > /resultado/quadros.sha256
pacotes=$(ffprobe -v error -count_packets -select_streams v:0 -show_entries stream=nb_read_packets -of csv=p=0 /resultado/saida.mp4)
echo "MP4 com $pacotes quadros"
[ "$pacotes" = 60 ] || falhou "contagem de quadros do MP4"
ffmpeg -v error -i /resultado/saida.mp4 -map 0:v -f framemd5 /resultado/saida.framemd5 || falhou "framemd5"

echo "== --placa sem placa: recusa com a instrução (saída 3), sem render"
node cli/render.ts cli/fixtures/linha-sintetica LinhaSintetica /resultado/placa.mp4 --placa >/dev/null 2>/resultado/placa.txt
r=$?
cat /resultado/placa.txt
{ [ "$r" = 3 ] && grep -q -- "--cpu" /resultado/placa.txt && [ ! -e /resultado/placa.mp4 ]; } || falhou "recusa do --placa (saiu com $r)"

echo "== testes do protocolo do host sem a feature placa"
captura/cef/montar.sh test --no-default-features protocolo >/resultado/testes-host.txt 2>&1 \
  || { tail -n 20 /resultado/testes-host.txt; falhou "testes do host sem placa"; }
grep "test result" /resultado/testes-host.txt | head -n 1
[ "$instalou" = 1 ] || falhou "instalar.sh (o render saiu certo)"
echo "P14: ok"
FIM

echo "contêiner $nome (node:24-trixie-slim, sem placa); resultado em $saida"
set +e
git -C "$raiz" ls-files -z -co --exclude-standard | (cd "$raiz" && tar --null -T - -cf -) |
  docker run "${opcoes[@]}" node:24-trixie-slim bash -c "$interno" 2>&1 | tee "$saida/log.txt"
codigo=${PIPESTATUS[2]}
set -e
rm -rf "$saida/resultado"
docker cp "$nome:/resultado" "$saida/resultado" >/dev/null 2>&1 || true
rm -rf "$saida/resultado/q"
exit "$codigo"
