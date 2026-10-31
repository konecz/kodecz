# Estado atual

**Atualizado em:** 2026-10-31, na criação do repositório.

## Decisão

Em 2026-10-31 o responsável decidiu abrir o motor como projeto de código aberto chamado **Kodecz**, num repositório
novo, privado até ficar pronto. A licença é Apache-2.0, e o repositório começa com histórico limpo. As patentes de
codec foram pesquisadas e a posição está em `docs/patentes.md`. O Remotion sai do motor por completo.

## Feito

- Marca: a logo (fita de Möbius em triângulo de play), os cartões do README e `docs/marca.md`.
- `README.md` (inglês), `LEIAME.md`, `LICENSE`, `NOTICE`, `docs/patentes.md`, `docs/medidas.md`.

## Falta para abrir (em ordem)

1. No motor-video: terminar o C02 e tirar o Remotion (`refactor/remover-remotion`).
2. Trazer o código para cá (`captura/`, `composicao/`, `nativo/`, `cli/`, `instalar/`, `blocos/`, testes e
   fixtures sintéticas), sem o histórico, e com a auditoria de abertura:
   - varredor de segredos (gitleaks) e busca por nomes de cliente, caminhos do servidor e `~/midia`;
   - nenhuma mídia que não seja sintética;
   - licenças repetidas (`auditoria-derivado.md` do motor-video), sem GSAP nos testes públicos, e avisos de terceiros
     completos em `docs/licencas/`.
3. **Fazer o código bater com o que o README promete** (o README descreve a interface pública já com os nomes
   novos):
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
5. Busca de marca «Kodecz» no INPI.
6. Abrir: repositório público, prévia social (`marca/logo-azul.svg` em PNG 1280×640) e a janela no konecz.com
   (capítulo Pesquisa, como a do remotion-gpu).
