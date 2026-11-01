# Estado atual

**Atualizado em:** 2026-11-01, com a primeira cópia do código do motor (branch `feature/codigo-do-motor`).

## Decisão

Em 2026-10-31 o responsável decidiu abrir o motor como projeto de código aberto chamado **Kodecz**, num repositório
novo, privado até ficar pronto. A licença é Apache-2.0, e o repositório começa com histórico limpo. As patentes de
codec foram pesquisadas e a posição está em `docs/patentes.md`. O Remotion sai do motor por completo.

## Feito

- Marca: a logo (fita de Möbius em triângulo de play), os cartões do README e `docs/marca.md`.
- `README.md` (inglês), `LEIAME.md`, `LICENSE`, `NOTICE`, `docs/patentes.md`, `docs/medidas.md`.

## Busca e IA (2026-10-31)

Topics no repositório; parágrafo de abertura em texto puro; comparação com Remotion e HyperFrames; FAQ; `llms.txt`, `AGENTS.md` e `CITATION.cff` na raiz; prévia social. O texto dos SVGs não conta para busca: o que importa tem que estar em texto puro no README.

## Falta para abrir (em ordem)

1. No motor-video: terminar o C02 e tirar o Remotion (`refactor/remover-remotion`).
2. 🟡 Trazer o código para cá, sem o histórico, com a auditoria de abertura. Primeira cópia feita em 2026-11-01 do
   `origin/main` do motor-video em `b5f7721`, por `scripts/trazer-do-motor.sh <ref>` (rodar de novo depois de cada
   correção que entrar lá; as pastas copiadas são espelhadas, então correção de código vai no motor-video).
   - **Veio:** `captura/`, `composicao/`, `nativo/`, `cli/`, `instalar/` e `instalar.sh`, `blocos/`, `conferencia/`,
     `identidade/` (os blocos e o bench importam), `bench/` e `bench-gerador/`, `docs/formatos/`, só a
     `ferramentas/contencao.mjs` (o render e a conferência importam) e o catálogo do bench
     (`docs/pesquisa/erros-de-agentes.json`, resumos nossos e links; o gerador lê deste caminho). O `ARCHITECTURE.md`
     daqui foi reescrito em inglês à mão.
   - **Ficou de fora:** `docs/experimentos/`, `docs/pesquisa/` (menos o catálogo), `docs/estado*`, `docs/adr.md`,
     `domain.md`, `scope.md`, `vision.md`, `lancamento.md`, `docs/licencas/` do motor (EULA e rascunho do produto
     fechado), `.claude/`, `CLAUDE.md`, `paper/`, `varredura/` (coleta com User-Agent da empresa; vai com o bench
     quando for revista), o resto de `ferramentas/` (render em camadas feito para o Remotion, medidor e amostra
     `.hevc`; nada do produto importa), `verificar.sh` (cita a `varredura/` e a trava da nossa placa) e
     `composicao/fixtures/gerar-audio-remotion.mjs` (importa o `@remotion/renderer`).
   - **Trocas feitas na cópia** (o script faz; tirar de lá quando a correção chegar ao motor-video): nome de vídeo e
     de sistema de cliente em `docs/formatos/brilho.md` e `bench-gerador/especificacoes.json`, caminho da nossa
     máquina em `bench/rodar.ts`, nome de pessoa no exemplo de `docs/formatos/referencias.md`. Os nomes proibidos
     ficam fora do repositório, em `~/.config/kodecz/nomes-proibidos.txt`.
   - **Falta, no motor-video:** GSAP nos testes (L01: `cli/fixtures/linha-gsap/`, `cli/gsap-lottie.test.ts`,
     `cli/fixtures/bibliotecas.ts`); scripts de `docs/experimentos/` que os testes chamam (Q02
     `captura/marca-video.test.ts`, Q03 `nativo/src/lib.rs` e `cli/render.test.ts:1025, 1047`, e mais
     `cli/render.test.ts:554` e `cli/batida-externa.test.ts:46`, que chamam o `gerar-midia.sh` do experimento do vídeo
     embutido); o modo 1 do bench copia a skill interna `.claude/skills/video-konecz/SKILL.md`, que não vem
     (`bench/rodar.ts:93`); referências a docs internos que não vêm (parecer jurídico, skill interna, `docs/adr.md`,
     `docs/experimentos/`) e menções ao cartão «da apresentadora do C02» em comentários; o `instalar/LEIAME.md` cita o
     programa fechado (P11).
   - **Para o responsável decidir:** o `composicao/audio.ts` e o `composicao/midia-linha.ts` dizem nos comentários
     que reproduzem regras do Remotion 4.0.536 (posição do quadro do vídeo, `interpolate`, volume, `atempo`) e o teste
     do áudio compara com valores gravados do `@remotion/renderer` (`composicao/fixtures/audio-remotion.json`):
     conferir se é só comportamento compatível (ok) ou código derivado (regra «nada do Remotion»). A marca fictícia
     Zunzum e o `zunzum.com.br` dos casos do bench: conferir se não existe empresa real com esse nome.
   - Avisos de terceiros: `NOTICE`, `docs/licencas/third-party-notices.md` e `docs/licencas/rust-crates.md`.
3. **Nomes em inglês na interface** (decisão do responsável: abrir com a interface atual e renomear depois; desde
   2026-11-01 o `README.md`, o `AGENTS.md`, o `llms.txt` e o `LEIAME.md` descrevem os nomes de hoje, com uma linha de
   Roadmap; ao renomear, trocar os quatro junto):
   - comando `kodecz` (`render`, `preview`, `check`) no lugar de `node cli/*.ts`, e `install.sh` no lugar do
     `instalar.sh`;
   - opções `--alpha` e `--from` (hoje `--alfa` e `--de`), e `preview --frame` e `--watch` (hoje `--quadro` e `--observar`);
   - bloco `<script id="kodecz">` com `width`, `height`, `fps`, `frames` (hoje `id="motor-video"`, `largura`,
     `altura`, `qps`, `quadros`), `data-start`, `data-frames`, `data-trim`, `data-volume` (hoje `data-inicio`,
     `data-quadros`, `data-recorte`) e o gancho `window.kodecz_frame` (hoje `motor_quadro`);
   - aceitar os nomes antigos por um tempo, com aviso.
4. **Medir o modo CPU contra o Remotion na mesma composição** (R05, 3 rodadas). O README fala dos dois caminhos e
   só publica número do caminho da placa. A medida do M06 (13,4 a 15,5 s de CPU em 450 quadros) foi feita com outra
   página que a do Remotion e não serve de comparação. Escolher o modo sozinho (placa quando houver, CPU quando não)
   também falta: hoje é o `--placa` que liga a placa.
5. **Reservar o nome `kodecz` no npm e no crates.io** (hoje livres) antes de abrir o repositório: publicar um pacote
   vazio, o que já é público. Aguarda o OK do responsável. Os domínios `kodecz.com`, `.dev`, `.io` e `.com.br` estavam livres em 2026-11-01.
6. Abrir: repositório público, prévia social (`marca/previa-social.png`, 1280×640: o responsável sobe em Settings → Social preview, que não tem API) e a janela no konecz.com
   (capítulo Pesquisa, como a do remotion-gpu).
