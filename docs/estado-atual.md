# Estado atual

> Checkpoint de continuidade entre sessões. Curto: sobrescrever, nunca acumular.

**Atualizado em:** 2026-11-02, interface em inglês e distribuição para agentes.

## Onde estamos

- **Público desde 2026-11-01** (Apache-2.0). O código veio do `motor-video` sem o histórico (PR #3) e com a auditoria
  de abertura (gitleaks sem achado, nada de cliente, mídia só sintética ou licenciada, sem GSAP, avisos de terceiros em
  `docs/licencas/`). O `motor-video` foi apagado; o desenvolvimento é aqui (`CLAUDE.md`).
- **Segurança no GitHub:** varredura de segredos com bloqueio no push, Dependabot (alertas e correções), CodeQL, relato
  privado (`SECURITY.md`), `main` só por PR, sem force push, só squash.
- **Papers** (figshare, 2026-11-01): o motor contra o Remotion e o HyperFrames, e o editor para agentes com o Kodecz
  Bench (modo 1 em 300 casos: o Claude Opus errou 35 de 219, 16,0 %).
- **Interface em inglês:** `kodecz render|preview|check` (`cli/kodecz.ts`, `bin` do `package.json`; `npm link` no
  clone), `--gpu`, `--alpha`, `--from`, `--frames`, bloco `id="kodecz"` com `width`, `height`, `fps`, `frames`,
  `window.kodecz_frame` e `--fps` nos blocos. Os nomes antigos seguem aceitos (mapa em `cli/nomes.ts`).
- **Distribuição para agentes**: skills `kodecz`, `remotion-to-kodecz` e
  `hyperframes-to-kodecz` (`skills/`, formato Agent Skills), plugin e marketplace do Claude Code (`.claude-plugin/`),
  servidor MCP sem dependência (`mcp/`) e `server.json` do registro. Escritos já com os nomes em inglês. Envios
  externos prontos e não enviados em `docs/distribuicao.md`.
- **Render:** `kodecz render <pasta> <composição> <saída.mp4> --gpu` (H.264; `--hevc`, `--alpha`, `--cpu`,
  `--from N`). Instalar: `./instalar.sh`.

## Próximo passo

Nenhum em andamento: o responsável escolhe da lista abaixo.

## Depois (escolha do responsável; nada daqui vira tarefa sozinho)

- Modo CPU com vídeo embutido: sem placa, o HyperFrames gasta menos CPU que o `--cpu` no Apresentador (26,3 contra
  28,1 s; `docs/medidas.md`, 2026-11-02). Perfilar a pintura do vídeo no SwiftShader e a conversão de cor.
- Resto da interface em inglês: atributos de mídia (`data-inicio`, `data-quadros`, `data-recorte`,
  `data-velocidade`) com apelido em inglês; mensagens de erro dos comandos (hoje em português; a ajuda já é em
  inglês); `kodecz references` (`cli/referencias.ts`); o JSON de saída (`quadros`, `repetirNao`…); `window.motor_falas`.
- Texto em inglês dos `docs/formatos/` que faltam (só `linha-do-tempo.md` foi traduzido; os outros têm só os nomes
  novos) e dos blocos (`INDICE.md`, `KODECZ.md`, nomes das variáveis CSS como `--inicio`).
- Gerador do bench (`bench-gerador/mundo.ts`, `bench/molde.ts`) e fixtures de teste ainda escrevem os nomes antigos
  (de propósito nas fixtures: cobrem os apelidos); passar o gerador para os novos junto com uma rodada nova do bench.
- Quando tirar os nomes antigos: aviso de descontinuação no stderr antes, depois remover.
- Electron fora da conferência (Q06): o vídeo decodificado pelo motor e a captura do quadro pela casca do CEF.
- Modo 1 do bench rodando daqui (hoje `bench/rodar.ts` copia uma skill que ficou fora do repositório).
- Take na placa: os quadros que ainda vão pelo canvas (legenda cruzando a faixa do canto, cartão fora do pixel) e a
  camada com alfa pela placa.
- Render sem driver NVIDIA: prova numa máquina física sem placa.
- Protocolo para agentes em 5 camadas (modos 2 e 3 do bench) e os 50 pares A/B do responsável.
- Bench: as 99 acusações fora da diagonal da matriz cruzada e as 5 regras desligadas; a v2 do paper.
- Reservar o nome `kodecz` no npm e no crates.io (aguarda o OK do responsável). Publicar no npm pede um passo de
  build: o Node não tira os tipos de `.ts` dentro de `node_modules`, então o `bin` só roda hoje do clone (`npm link`,
  `npm i -g .`); o `package.json` está com `"private": true` para não publicar por engano.

## Pendências (só do responsável)

- Envios da distribuição (`docs/distribuicao.md`), depois da interface em inglês na `main`: `npm publish` do
  `kodecz-mcp`, registro do MCP, listas (awesome-claude-code a partir de 2026-11-14) e, se quiser, o diretório da
  Anthropic.
- Sandbox do Chromium e `chrome-sandbox` (pede `sudo`; aviso do `./instalar.sh`).
- Teste da demonstração dos blocos: falha intermitente do Chromium (rasterização que depende do relógio); manter
  estrito é o recomendado.
