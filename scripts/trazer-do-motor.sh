#!/usr/bin/env bash
# Traz o código do motor-video (privado) para cá, sem o histórico, e roda a auditoria de abertura na cópia.
#
#   scripts/trazer-do-motor.sh <ref>            exporta <ref> do motor-video, audita e sincroniza as pastas abaixo
#   scripts/trazer-do-motor.sh <ref> --so-auditar   só exporta e audita (não mexe no kodecz)
#
# Variáveis: MOTOR (repositório de origem, padrão ../motor-video ao lado deste), PREPARO (pasta de preparo, padrão
# /tmp/claude-$UID/kodecz-copia). A origem é lida só pelo `git archive`: nada é trocado nem mexido no checkout de lá.
#
# O que vem (INCLUIR) e o que fica de fora (FORA) estão nas listas abaixo, com o motivo; o que nem entra na lista
# (docs/experimentos, docs/pesquisa, docs/estado*, .claude, paper, varredura, ferramentas fora a contenção, o
# verificar.sh e os docs internos) está em docs/estado-atual.md. As pastas sincronizadas são espelhadas (rsync --delete):
# mudar um arquivo delas aqui não adianta, a correção vai no motor-video e a cópia roda de novo.
# O ARCHITECTURE.md do motor vem só para o preparo (ARCHITECTURE.motor.md): o daqui é adaptado à mão.
set -euo pipefail

aqui=$(cd "$(dirname "$0")/.." && pwd)
ref=${1:?uso: scripts/trazer-do-motor.sh <ref> [--so-auditar]}
modo=${2:-}
MOTOR=${MOTOR:-$(cd "$aqui/.." && pwd)/motor-video}
PREPARO=${PREPARO:-/tmp/claude-$(id -u)/kodecz-copia}

# Pastas e arquivos que vêm do motor-video, espelhados aqui.
INCLUIR=(
  captura composicao nativo cli instalar instalar.sh blocos conferencia
  identidade                            # leitor do DESIGN.md: blocos, bench e bench-gerador importam
  bench bench-gerador                   # Kodecz Bench e o conjunto único de regras (a conferência lê dele)
  docs/formatos                         # especificação pública do formato (em português até a tradução)
  ferramentas/contencao.mjs             # só a contenção: cli/render.ts e cli/conferir.ts importam
  docs/pesquisa/erros-de-agentes.json   # catálogo do bench (resumos nossos e links); bench-gerador lê deste caminho
)
# Tirados do que veio (dentro das pastas acima).
FORA=(
  composicao/fixtures/gerar-audio-remotion.mjs   # importa o @remotion/renderer (licença não aberta)
)

case "$PREPARO" in "$aqui"*|"$MOTOR"*) echo "PREPARO não pode ficar dentro de um repositório: $PREPARO" >&2; exit 2;; esac

commit=$(git -C "$MOTOR" rev-parse --verify "$ref^{commit}")
rm -rf "$PREPARO"; mkdir -p "$PREPARO"
git -C "$MOTOR" archive "$commit" "${INCLUIR[@]}" | tar -x -C "$PREPARO"
git -C "$MOTOR" show "$commit:ARCHITECTURE.md" > "$PREPARO/ARCHITECTURE.motor.md"
for f in "${FORA[@]}"; do rm -rf "${PREPARO:?}/$f"; done
echo "motor-video $commit exportado em $PREPARO ($(find "$PREPARO" -type f | wc -l) arquivos)"

# Trocas de texto que a auditoria pediu e que ainda não chegaram ao motor-video. Os padrões não citam nome de cliente
# (este script é público): pegam o texto pelo contexto. Quando a correção chegar lá, a troca deixa de achar o texto e
# o script avisa: aí é tirar a linha daqui.
trocar() { # <arquivo> <regex perl> <texto novo>
  local n
  n=$(DE=$2 PARA=$3 perl -0pi -e '$n += s/$ENV{DE}/$ENV{PARA}/g; END { print $n + 0 }' "$PREPARO/$1")
  [ "$n" -gt 0 ] || echo "aviso: troca sem efeito em $1 (já corrigido no motor-video?): $2" >&2
}
# Nome de vídeo de cliente nas medidas (R01).
trocar docs/formatos/brilho.md '(?<=No\s)\S+(?= 16:9)' 'vídeo real de'
# Nome de sistema de cliente e registro interno nas calibrações (R01).
trocar bench-gerador/especificacoes.json '9 aprovados do \S+ \(docs/experimentos/[^)]*\)' '9 vídeos reais aprovados (registro interno de calibração)'
trocar bench-gerador/especificacoes.json 'Os 9 aprovados do \S+ \(' 'Os 9 vídeos reais aprovados ('
trocar bench-gerador/especificacoes.json '\(docs/experimentos/[^)]*\)' '(registro interno de calibração)'
# Caminho da máquina da Konecz no código: o mesmo efeito, pela casa de quem roda.
trocar bench/rodar.ts '"/\.claude/projects/-home-[^"/]*-projetos"' '`/.claude/projects/${homedir().replaceAll("/", "-")}-projetos`'
# Nome de pessoa no exemplo (auditoria, C07).
trocar docs/formatos/referencias.md '"aprovadoPor": "[^"]*"' '"aprovadoPor": "Ana Exemplo"'

# --- Auditoria de abertura (relatório; quem decide é quem roda) -------------------------------------------------
falhas=0
echo; echo "== segredos"
if command -v gitleaks >/dev/null; then
  gitleaks dir "$PREPARO" --redact --no-banner || falhas=$((falhas + 1))
else
  echo "gitleaks ausente: busca por palavra no lugar"
  if grep -rnIE "(api[_-]?key|secret|passw(or)?d|token)[\"' ]*[:=][\"' ]*[A-Za-z0-9_\-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|xox[bp]-|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}" "$PREPARO"; then
    falhas=$((falhas + 1))
  fi
fi

echo; echo "== nomes de cliente e coisas internas"
# Os nomes de cliente não podem estar aqui (R01): vêm de um arquivo fora do repositório, um padrão (grep -E) por linha.
NOMES=${NOMES:-$HOME/.config/kodecz/nomes-proibidos.txt}
padrao='/home/[a-z]|-home-[a-z]|~/midia|~/projetos|/srv/|konecz\.com'
if [ -f "$NOMES" ]; then padrao="$padrao|$(grep -v '^#' "$NOMES" | grep . | paste -sd '|')"
else echo "aviso: sem $NOMES; só os caminhos e domínios internos foram buscados" >&2; falhas=$((falhas + 1)); fi
if grep -rnIiE "$padrao" "$PREPARO" --exclude=ARCHITECTURE.motor.md; then falhas=$((falhas + 1)); else echo "nenhum"; fi

echo; echo "== mídia e binários"
find "$PREPARO" -type f \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.webm' -o -iname '*.mkv' -o -iname '*.hevc' \
  -o -iname '*.h264' -o -iname '*.wav' -o -iname '*.mp3' -o -iname '*.aac' -o -iname '*.png' -o -iname '*.jpg' \
  -o -iname '*.jpeg' -o -iname '*.gif' -o -iname '*.webp' -o -iname '*.svg' -o -iname '*.ttf' -o -iname '*.otf' \
  -o -iname '*.woff' -o -iname '*.woff2' -o -iname '*.pdf' -o -iname '*.onnx' -o -iname '*.node' \) -printf '%s\t%P\n'
grep -rlI . "$PREPARO" >/dev/null # aquece o cache
find "$PREPARO" -type f -size +0 ! -exec grep -qI . {} \; -printf 'binário: %s\t%P\n'

echo; echo "== GSAP (L01)"
grep -rlIi "gsap" "$PREPARO" | sed "s|$PREPARO/||" || true

[ "$falhas" -eq 0 ] || echo "atenção: $falhas verificação(ões) com achado; ver acima"
[ "$modo" = "--so-auditar" ] && exit 0

# --- Sincroniza (só as pastas da lista; o resto do kodecz não é tocado) ------------------------------------------
for p in "${INCLUIR[@]}"; do
  if [ -d "$PREPARO/$p" ]; then
    mkdir -p "$aqui/$p"; rsync -a --delete "$PREPARO/$p/" "$aqui/$p/"
  else
    mkdir -p "$aqui/$(dirname "$p")"; cp -p "$PREPARO/$p" "$aqui/$p"
  fi
done
echo; echo "sincronizado de motor-video $commit; confira o diff (git status) e o ARCHITECTURE.motor.md do preparo"
