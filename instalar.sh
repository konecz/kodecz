#!/bin/sh
# Instalação em um passo do motor-video (P03): ./instalar.sh [--verificar] [--sistema] [--sem-render]
# Só confere o Node 24 (o resto do instalador é TypeScript, em instalar/instalar.ts) e diz como instalar se faltar.
set -eu
cd "$(dirname "$0")"
maior=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$maior" -lt 24 ]; then
  echo "✗ Node 24 is required (found: $(node --version 2>/dev/null || echo none))" >&2
  echo "    → curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && . ~/.nvm/nvm.sh && nvm install 24" >&2
  echo "      (no sudo needed; or your distribution's Node 24 package, or any other way), then run ./instalar.sh again" >&2
  exit 1
fi
exec node instalar/instalar.ts "$@"
