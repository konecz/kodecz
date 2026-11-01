# Estado atual

> Checkpoint de continuidade entre sessões. Curto: sobrescrever, nunca acumular.

**Atualizado em:** 2026-11-01, na abertura.

## Onde estamos

- **Público desde 2026-11-01** (Apache-2.0). O código veio do `motor-video` sem o histórico (PR #3) e com a auditoria
  de abertura (gitleaks sem achado, nada de cliente, mídia só sintética ou licenciada, sem GSAP, avisos de terceiros em
  `docs/licencas/`). O `motor-video` foi apagado; o desenvolvimento é aqui (`CLAUDE.md`).
- **Segurança no GitHub:** varredura de segredos com bloqueio no push, Dependabot (alertas e correções), CodeQL, relato
  privado (`SECURITY.md`), `main` só por PR, sem force push, só squash.
- **Papers** (figshare, 2026-11-01): o motor contra o Remotion e o HyperFrames, e o editor para agentes com o Kodecz
  Bench (modo 1 em 300 casos: o Claude Opus errou 35 de 219, 16,0 %).
- **Render:** `node cli/render.ts <pasta> <composição> <saída.mp4> --placa` (H.264; `--hevc`, `--alfa`, `--cpu`,
  `--de N`). Instalar: `./instalar.sh`.

## Próximo passo

Nenhum em andamento: o responsável escolhe da lista abaixo.

## Depois (escolha do responsável; nada daqui vira tarefa sozinho)

- Interface com os nomes em inglês (`kodecz render|preview|check`, `--alpha`, `--from`, `id="kodecz"`, `width`,
  `height`, `fps`, `frames`, `window.kodecz_frame`), aceitando os antigos por um tempo; `docs/formatos/` e os blocos
  em inglês.
- Electron fora da conferência (Q06): o vídeo decodificado pelo motor e a captura do quadro pela casca do CEF.
- Modo 1 do bench rodando daqui (hoje `bench/rodar.ts` copia uma skill que ficou fora do repositório).
- Take na placa: os quadros que ainda vão pelo canvas (legenda cruzando a faixa do canto, cartão fora do pixel) e a
  camada com alfa pela placa.
- Render sem driver NVIDIA: prova numa máquina física sem placa.
- Protocolo para agentes em 5 camadas (modos 2 e 3 do bench) e os 50 pares A/B do responsável.
- Bench: as 99 acusações fora da diagonal da matriz cruzada e as 5 regras desligadas; a v2 do paper.
- Reservar o nome `kodecz` no npm e no crates.io (aguarda o OK do responsável); prévia social no GitHub
  (`marca/previa-social.png`, Settings → Social preview).

## Pendências (só do responsável)

- Sandbox do Chromium e `chrome-sandbox` (pede `sudo`; aviso do `./instalar.sh`).
- Teste da demonstração dos blocos: falha intermitente do Chromium (rasterização que depende do relógio); manter
  estrito é o recomendado.
