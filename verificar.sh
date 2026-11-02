#!/usr/bin/env bash
# Verificação do Kodecz. Dois modos:
#   ./verificar.sh          rápido: os testes que não abrem placa nem navegador (segundos) e um render de prova na
#                           placa (a linha sintética, sob a trava da placa). Para mudança pequena e no dia a dia.
#   ./verificar.sh completo todas as suítes, sob a trava da placa. Antes do merge do que mexe no render.
set -euo pipefail
cd "$(dirname "$0")"
TRAVA=/tmp/motor-video-placa.lock

if [ "${1:-rapido}" = "completo" ]; then
  nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader
  # A suíte segura a trava (exclusiva); os testes que pediriam a mesma trava (bench/coletar.ts, naTrava) rodam direto.
  export MOTOR_TRAVA_PLACA_TOMADA=1
  exec flock "$TRAVA" node --test "cli/*.test.ts" "captura/*.test.ts" "composicao/*.test.ts" "blocos/*.test.ts" \
    "conferencia/*.test.ts" "instalar/*.test.ts" identidade/design-md.test.ts \
    "bench-gerador/*.test.ts" "mcp/*.test.mjs" "scripts/*.test.mjs"
fi

# Sem placa nem navegador.
node --test cli/brilho.test.ts captura/codificador-cpu.test.ts captura/faixa.test.ts captura/fontes.test.ts captura/marca-video.test.ts cli/midia-linha.test.ts \
  cli/processos.test.ts cli/regras.test.ts cli/nomes.test.ts composicao/audio.test.ts composicao/cor-limpa.test.ts composicao/parados.test.ts \
  conferencia/falas.test.ts \
  conferencia/regras.test.ts conferencia/rosto.test.ts identidade/design-md.test.ts instalar/instalar.test.ts \
  bench-gerador/expandir.test.ts bench-gerador/adaptador.test.ts mcp/kodecz-mcp.test.mjs scripts/agentes.test.mjs

# Um render de prova na placa: a linha sintética (60 quadros) sai com o quadro N certo (a marca confere cada quadro).
saida=$(mktemp -d)
trap 'rm -rf "$saida"' EXIT
flock "$TRAVA" node cli/render.ts cli/fixtures/linha-sintetica LinhaSintetica "$saida/prova.mp4" --placa > "$saida/prova.json"
node -e 'const j=require(process.argv[1]); if(!j.ok||j.quadros!==60) {console.error("render de prova falhou",j); process.exit(1)} console.log(`render de prova: ${j.quadros} quadros, ${j.parede} s`)' "$saida/prova.json"
