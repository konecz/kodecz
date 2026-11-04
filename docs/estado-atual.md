# Estado atual

> Checkpoint de continuidade entre sessões. Curto: sobrescrever, nunca acumular.

**Atualizado em:** 2026-11-04, peças de edição (edição como dados, preparo e blocos no padrão aprovado).

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
- **Mensagens em inglês** (branch `feature/mensagens-em-ingles`, 2026-11-02): o `./instalar.sh` inteiro (termina em
  `ready`), os avisos e erros de `kodecz render|preview|check` (prefixo `kodecz:`, `error:`, `warning:`), a página do
  `preview --serve` e os motivos das regras da conferência em `conferencia/`. O README ganhou o FAQ do Node 24 + Rust
  (`curl | sh` só sugerido) e do `--no-sandbox`.
- **Distribuição para agentes**: skills `kodecz`, `remotion-to-kodecz` e
  `hyperframes-to-kodecz` (`skills/`, formato Agent Skills), plugin e marketplace do Claude Code (`.claude-plugin/`),
  servidor MCP sem dependência (`mcp/`) e `server.json` do registro. Escritos já com os nomes em inglês. Envios
  externos prontos e não enviados em `docs/distribuicao.md`.
- **Peças de edição** (2026-11-04, branch `feature/pecas-de-edicao`): editar vira preencher dados.
  `kodecz assemble edicao.json pasta/` (gatilho por palavra falada, fim da frase, efeitos sonoros por evento, trilha
  que abaixa sob a voz; `docs/formatos/edicao.md`, contrato `edicao/tipos.ts`); `kodecz prepare
  voice|words|interpolate|loudness` (`docs/formatos/preparo.md`); `montar.ts` em todos os blocos; H01 legenda no
  padrão aprovado (só a palavra falada acesa, fonte medida no arquivo), H02 v2 take do apresentador (aproximação lenta,
  punch-in até o fim da frase, recorte 16:9→9:16; zoom pela caixa: 195 de 195 quadros na placa), H14 faixa do tema.
  Origem: inventário das peças repetidas nos vídeos da Konecz e cinco pesquisas de editores (NLE, motion, GitHub,
  edição com IA, editores abertos novos).
- **Render:** `kodecz render <pasta> <composição> <saída.mp4> --gpu` (H.264; `--hevc`, `--alpha`, `--cpu`,
  `--from N`). Instalar: `./instalar.sh`.

## Próximo passo

Em andamento (aprovado em 2026-11-04): H15 assinatura com logo e a onda 1, ferramentas do agente (`kodecz preview
--sheet` folha de contato, `kodecz inspect` do MP4 pronto, `kodecz blocks` catálogo tipado com validação no
`assemble`, `data-item` nos achados com conserto e `kodecz explain`). Depois delas: MCP enxuto (~11 ferramentas, patch
com revisão e recibo).

## Depois (escolha do responsável; nada daqui vira tarefa sozinho)

- Ondas seguintes das peças de edição (ordem aprovada 1 → 2 → 4 → 3 → 5):
  - 2, edição pela fala: remover trecho com ripple, take por frase, silêncios e vícios no `prepare` (Silero VAD,
    auto-editor), cobrir a fala da palavra ao fim da frase, marcadores com nome, corte só entre palavras com fade de
    30 ms, motivo em cada item.
  - 4, conferência: determinismo por ordem embaralhada, legenda rápida (cps), corte na palavra, buraco, trecho parado
    > 1,5 s, transbordo, mídia esticada, G15 para SVG, texto sobre texto, as 10 regras de gosto.
  - 3, motion: curvas e mola como tokens, texto fenda e cascata, fundo vivo, «vida», anotação à mão, lista de passos,
    transições forma e chicote, palavra na batida, revelação de logo, clipe com speed ramp, cortina em duas fases, chip.
  - 5, integrações: OTIO, SRT/VTT/ASS, blocos em OGraf (Resolve), reframe pelo rosto (MediaPipe), DeepFilterNet e
    Demucs, Lottie, texto atrás do apresentador (pede vídeo com alfa).
- Sobras das peças de edição: `prepare voice --max-pause` (o aprovado soava como 0,7); `words` sem teste com fala real;
  trilha sem loop; o `assemble` não passa a tipografia da marca à legenda (usa Inter 700); fonte.ts como utilitário
  comum (kerning, WOFF2); conferência das cores do H01 no `blocos.test.ts` ainda no modo `progresso`; saída do H02
  termina no fim da frase (o aprovado saía ~0,5 s depois), validar com o responsável.

- Modo CPU com vídeo embutido: sem placa, o HyperFrames gasta menos CPU que o `--cpu` no Apresentador (26,3 contra
  28,1 s; `docs/medidas.md`, 2026-11-02). Perfilar a pintura do vídeo no SwiftShader e a conversão de cor.
- Resto da interface em inglês: atributos de mídia (`data-inicio`, `data-quadros`, `data-recorte`,
  `data-velocidade`) com apelido em inglês; `kodecz references` (`cli/referencias.ts`); o JSON de saída (`quadros`,
  `repetirNao`…, e a linha `composition {…}` do stderr, que é o JSON da captura); `window.motor_falas`. Mensagens que
  ainda saem em português: os motivos das medidas do bench que a conferência usa (`bench-gerador/motores.ts`: o G20 de
  contraste e outros; mudar mexe nas matrizes do bench), os erros de dentro da captura e da composição
  (`captura/main.ts`, `composicao/audio.ts`: GSAP, fonte fora do cache, áudio) e as linhas `falhou:` que o render
  repassa quando a captura cai.
- Sandbox do Chromium ligado por padrão: hoje o render (CEF) e a conferência (Electron) passam `--no-sandbox` sempre;
  o `MOTOR_CAPTURA_SANDBOX=1` do host é experimento do P02 e o aviso do instalador só cobre o `chrome-sandbox` do
  Electron (o do CEF fica em `captura/cef/target/release/`).
- Instalação fora do Debian/Ubuntu (Fedora, Arch): hoje o instalador só diz os nomes do Debian e o `--sistema` recusa.
  E a instalação do zero com placa num contêiner (CDI) ou VM: a de 2026-11-02 foi só no modo CPU (Ubuntu 24.04 em VM,
  Ubuntu 22.04 e Debian 12 em contêiner).
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
