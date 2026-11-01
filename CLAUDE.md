# CLAUDE.md — kodecz

O Kodecz é o motor de vídeo por código da Konecz em **código aberto** (Apache-2.0, público desde 2026-11-01): a página
web vira vídeo renderizado na placa da NVIDIA, sem a «foto» de cada quadro passar pela CPU. É aqui que o motor é
desenvolvido; o antigo `motor-video` (privado) foi apagado em 2026-11-01 e o histórico dele ficou só no bundle
`~/apagados/motor-video-2026-11-01.bundle` (consultar com `git clone` do bundle numa pasta temporária, nunca trazer
para cá o que for privado).

Mapa do código: `ARCHITECTURE.md`. Estado, próximo passo e o que ficou para depois: `docs/estado-atual.md`. Formatos
(linha do tempo, conferência, brilho…): `docs/formatos/`. Números publicados: `docs/medidas.md`.

## Regras

- **R01 — Nada de cliente aqui** (o repositório é público): nem vídeo, áudio, imagem, roteiro, nome de cliente ou de
  projeto de cliente, nem caminho do servidor da Konecz. Testes só com composições sintéticas. Antes de cada commit,
  conferir o diff; os nomes proibidos ficam fora do repositório, em `~/.config/kodecz/nomes-proibidos.txt`.
- **R02 — Licenças:** nenhuma dependência nem código copiado de projeto sem licença compatível com a Apache-2.0
  (Remotion, GSAP). Comportamento compatível estudado é permitido (decisão do responsável em 2026-11-01); arquivo do
  HyperFrames leva o aviso da Apache-2.0. Dependência nova: justificar e registrar em `docs/licencas/`.
- **R03 — Quadro determinístico:** o quadro N depende só de N, não do relógio, da ordem nem da rede. Onde o Chromium
  não deixa (texto animado, até 2 níveis), o teste usa limiar, não hash.
- **R04 — Na placa, o quadro não passa pela CPU.**
- **R05 — Ganho só com medida:** CPU (cgroup), tempo de parede e lado a lado, com N rodadas; número publicado só com a
  medida em `docs/medidas.md`.
- **Fechar sem abrir pendências** (decisão do responsável, 2026-11-01): o que sobra de uma tarefa vai para a lista
  «Depois» do `docs/estado-atual.md`, não vira tarefa nova no meio do trabalho.
- Código, README e docs públicos em inglês; `LEIAME.md` e os docs internos (`docs/estado-atual.md`, `docs/marca.md`)
  em português. Marca: `marca/` sai inteira de `node scripts/marca.mjs`.

## Processo

Pair programming com IA: o responsável define prioridades e valida; o agente investiga, planeja, testa, implementa e
verifica. Entender → planejar (checkpoint da tarefa em `docs/estado/<branch-com-hífen>.md`, apagado antes do PR) →
aprovar → testes primeiro onde houver regra → verificar → validar. Não iniciar a próxima tarefa sozinho.

- **Verificações:** `./verificar.sh` (rápido) e `./verificar.sh completo` (antes do merge do que mexe no render), por
  `node .claude/scripts/resumo.mjs <comando>`. Instalar ou recompilar: `./instalar.sh`.
- **Placa:** RTX 5090 dividida com outros serviços; conferir `nvidia-smi` antes de medir. Trava `flock` em
  `/tmp/motor-video-placa.lock`: `-x` só para medida do R05, `-s` para teste e render. Renders longos com
  `ferramentas/contencao.mjs`. A CPU é dos sites.
- **Git:** uma tarefa, uma branch (`feature/`, `fix/`, `refactor/`, `docs/`, `experimento/`), PR, squash (skill `/pr`).
  A `main` é protegida no GitHub (só por PR). Sem merge, push ou PR sem autorização. Nunca `git reset --hard`,
  `git clean -fd`, force push nem reescrever histórico. Conventional Commits em português.
- **Hooks** (`.claude/settings.json`): `bloquear-comandos`, `estado-sessao`, `leitura-dirigida`. Subagentes
  `explorador` e `revisor`.
- Responder em português do Brasil. Ao terminar: o que mudou, verificações e resultados reais, pendências.
