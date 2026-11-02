#!/bin/sh
# Kodecz, HyperFrames and Remotion on the same compositions (docs/medidas.md, «Kodecz, HyperFrames and Remotion»).
# Renders each case with each renderer, N alternating rounds, every render alone under an exclusive lock and measured
# by ferramentas/medir-render.mjs (CPU = user + system of the whole process tree from its cgroup, wall, peak memory),
# then compares every frame (SSIM) and prints the table.
#
# Usage: scripts/comparar/comparar.sh [rounds=3]
#   CASOS   cases (default: «apresentador audiograma»)
#   LADOS   renderers (default: all below; Remotion only runs the presenter)
#   TRABALHO work folder (default ~/.cache/kodecz/comparar): media, renders, the HyperFrames and Remotion installs
#   TRAVA   lock file (default /tmp/motor-video-placa.lock; on a machine of your own any path works)
#
# Renderers («sides»), each at its official defaults:
#   kodecz-placa     node cli/render.ts <dir> <id> out.mp4 --placa   (GPU: texture → NVENC)
#   kodecz-cpu       node cli/render.ts <dir> <id> out.mp4 --cpu     (software paint → x264; no GPU device inside)
#   hyperframes      npx hyperframes render <dir> -o out.mp4         (defaults: auto workers, «looks» quality, x264,
#                                                                     Chrome on the GPU when it finds one)
#   hyperframes-cpu  the same with no GPU device visible (bwrap with a fresh /dev): what it does on a machine without one
#   hyperframes-gpu  the same plus --gpu (its NVENC option), for reference
#   hyperframes-frio the defaults without its extracted-frame cache (--frames-cache-dir off): a first render of a
#                    video it has not seen yet; not in the default list
#   remotion         npx remotion render Presenter out.mp4           (defaults; the presenter case only)
#
# HyperFrames (Apache-2.0) and Remotion (Remotion License) are downloaded at run time into the work folder, pinned,
# with `npm install --ignore-scripts`; neither becomes part of Kodecz.
# Needs: Kodecz installed (./instalar.sh), ffmpeg, bwrap, systemd --user, Node 24.
set -eu
rodadas=${1:-3}
aqui=$(realpath "$(dirname "$0")")
raiz=$(realpath "$aqui/../..")
w=${TRABALHO:-$HOME/.cache/kodecz/comparar}
trava=${TRAVA:-/tmp/motor-video-placa.lock}
casos=${CASOS:-apresentador audiograma}
lados=${LADOS:-kodecz-placa kodecz-cpu hyperframes hyperframes-cpu hyperframes-gpu remotion}
HYPERFRAMES_VERSAO=0.9.2
REMOTION_VERSAO=4.0.536
export HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_SKIP_SKILLS=1 REMOTION_DISABLE_TELEMETRY=1
mkdir -p "$w"

# 1. Media, cases and the other renderers.
[ -e "$w/audiograma/fala.wav" ] || "$aqui/gerar-midia.sh" "$w"
for c in $casos; do
  for v in kodecz hyperframes; do
    mkdir -p "$w/$c/$v"
    cp "$aqui/casos/$c/$v/index.html" "$w/$c/$v/"
  done
  case $c in
    apresentador) for v in kodecz hyperframes; do cp "$w/apresentador/apresentador.mp4" "$w/$c/$v/"; done ;;
    audiograma)   for v in kodecz hyperframes; do cp "$w/audiograma/fala.wav" "$w/audiograma/capa.jpg" "$w/$c/$v/"; done ;;
  esac
done
if [ ! -x "$w/hyperframes-cli/node_modules/.bin/hyperframes" ]; then
  mkdir -p "$w/hyperframes-cli"
  (cd "$w/hyperframes-cli" && npm init -y >/dev/null && npm install --ignore-scripts --no-audit --no-fund "hyperframes@$HYPERFRAMES_VERSAO")
fi
case " $lados " in *" remotion "*)
  r=$w/apresentador/remotion
  mkdir -p "$r/src" "$r/public"
  cp "$aqui/casos/apresentador/remotion/Presenter.tsx" "$r/src/index.tsx"
  cp "$w/apresentador/apresentador.mp4" "$r/public/"
  if [ ! -d "$r/node_modules/@remotion/cli" ]; then
    printf '{ "private": true, "type": "module", "dependencies": { "@remotion/cli": "%s", "@remotion/media": "%s", "remotion": "%s", "react": "19.2.0", "react-dom": "19.2.0" } }\n' \
      "$REMOTION_VERSAO" "$REMOTION_VERSAO" "$REMOTION_VERSAO" > "$r/package.json"
    (cd "$r" && npm install --ignore-scripts --no-audit --no-fund)
  fi ;;
esac

# 2. One render of one case by one side, measured, under the exclusive lock.
semplaca="env CUDA_VISIBLE_DEVICES= bwrap --dev-bind / / --dev /dev --bind /dev/shm /dev/shm --"
hf=$w/hyperframes-cli/node_modules/.bin/hyperframes
render() { # case side round
  c=$1 l=$2 n=$3
  case $c in apresentador) id=Presenter ;; audiograma) id=Audiogram ;; esac
  o=$w/$c/saidas
  mkdir -p "$o"
  s=$o/$l-$n.mp4
  rm -f "$s"
  case $l in
    kodecz-placa)    set -- node "$raiz/cli/render.ts" "$w/$c/kodecz" "$id" "$s" --placa ;;
    kodecz-cpu)      set -- env CUDA_VISIBLE_DEVICES= node "$raiz/cli/render.ts" "$w/$c/kodecz" "$id" "$s" --cpu ;;
    hyperframes)     set -- "$hf" render "$w/$c/hyperframes" -o "$s" ;;
    hyperframes-cpu) set -- $semplaca "$hf" render "$w/$c/hyperframes" -o "$s" ;;
    hyperframes-gpu) set -- "$hf" render "$w/$c/hyperframes" -o "$s" --gpu ;;
    hyperframes-frio) set -- "$hf" render "$w/$c/hyperframes" -o "$s" --frames-cache-dir off ;;
    remotion)        [ "$c" = apresentador ] || return 0
                     set -- sh -c 'cd "$1" && shift && exec "$@"' sh "$w/apresentador/remotion" \
                       npx remotion render src/index.tsx Presenter "$s" ;;
    *) echo "unknown side: $l" >&2; exit 2 ;;
  esac
  echo "== $c $l round $n" >&2
  flock -x "$trava" node "$raiz/ferramentas/medir-render.mjs" --rotulo "$l-$n" --json "$o/medidas.jsonl" \
    --log "$o/$l-$n.log" -- "$@"
}

# 3. A warm-up round (0: font, browser and bundle caches; not in the table), then the measured rounds, rotating the
#    order of the sides every round.
gira() { # list k: the list rotated left by k
  k=$2; set -- $1; i=0
  while [ "$i" -lt "$k" ]; do x=$1; shift; set -- "$@" "$x"; i=$((i + 1)); done
  echo "$@"
}
for n in $(seq 0 "$rodadas"); do
  ordem=$(gira "$lados" $((n % $(echo $lados | wc -w))))
  [ $((n % 2)) -eq 0 ] || ordem=$(echo $ordem | tr ' ' '\n' | tac | tr '\n' ' ')
  for c in $casos; do for l in $ordem; do render "$c" "$l" "$n"; done; done
done

# 4. Frame by frame against HyperFrames' default render and Remotion's of round 1 (when there is one), and the table.
for c in $casos; do
  for ref in hyperframes remotion; do
    [ -e "$w/$c/saidas/$ref-1.mp4" ] || continue
    for l in $lados; do
      for n in $(seq 1 "$rodadas"); do
        [ -e "$w/$c/saidas/$l-$n.mp4" ] || continue
        flock -s "$trava" node "$aqui/conferir.mjs" "$w/$c/saidas/$ref-1.mp4" "$w/$c/saidas/$l-$n.mp4" \
          > "$w/$c/saidas/ssim-$ref-$l-$n.json"
      done
    done
  done
done
node "$aqui/resumir.mjs" "$w" $casos
