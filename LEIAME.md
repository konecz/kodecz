<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/konecz/kodecz/main/marca/logo-nome-animada-escuro.svg">
  <img alt="Kodecz" src="https://raw.githubusercontent.com/konecz/kodecz/main/marca/logo-nome-animada-claro.svg" width="360">
</picture>

# Kodecz

**O vídeo escrito como página web, renderizado na placa da NVIDIA ou em qualquer CPU.**

O Kodecz é o motor de vídeo por código da [Konecz](https://konecz.com). O vídeo é uma pasta com um `index.html`:
CSS, JS, React, WebGL, GSAP, Lottie, tudo o que o Chromium desenha. O Kodecz põe a página no quadro *N*, o Chromium
desenha o quadro e ele vai direto ao codificador, sem a «foto» de cada quadro no meio:

- **com placa da NVIDIA**, o quadro fica numa textura da placa e vai direto ao NVENC, e a CPU fica livre;
- **sem placa** (notebook, CI, servidor sem GPU), o quadro cru que o Chromium pintou vai direto ao x264, sem PNG.

A mesma pasta renderiza nos dois.

- **19× menos CPU e 3,7× mais rápido** que o Remotion no mesmo vídeo, medido no mesmo dia (1080p, 150 quadros, RTX 5090;
  [`docs/medidas.md`](docs/medidas.md)).
- **11× menos CPU e 2,4× mais rápido** que o HyperFrames no mesmo vídeo, medido no mesmo dia (22,0 s → 2,0 s de CPU,
  6,4 s → 2,7 s de parede). Só na CPU, sem placa, o HyperFrames fica um pouco à frente nesse vídeo, que tem um clipe
  1080p embutido (26,3 s contra 28,1 s de CPU); num audiograma de 27 s, o Kodecz gasta 2,4× menos CPU (24,6 s contra
  59,9 s). Tudo em [`docs/medidas.md`](docs/medidas.md), com o script para repetir (`scripts/comparar/comparar.sh`).
- **Determinístico:** o quadro *N* sai com o mesmo conteúdo e no mesmo tempo, em ordem, fora de ordem ou começando do
  meio. O texto animado pode variar até 2 níveis de cor de um render para outro, pela rasterização do Chromium.
- **Feito para qualquer agente de IA**, sem amarra a um fornecedor: o formato é web comum, cada técnica de edição é
  um bloco Kodecz em Markdown, documentado e testável, e a conferência automática olha os quadros e devolve em JSON
  onde está o erro.

A interface tem os nomes em inglês: `./instalar.sh` e `npm link` (ou `node cli/kodecz.ts`), depois
`kodecz render <pasta> <id> saida.mp4` (com `--cpu`, `--gpu`, `--hevc`, `--alpha`, `--from` e `--frames`),
`kodecz preview`, `kodecz check` e o bloco `<script type="application/json" id="kodecz">` com `width`, `height`,
`fps` e `frames`; o gancho do canvas é `window.kodecz_frame(n, ms)`. Os nomes antigos, em português (`node cli/render.ts`,
`--placa`, `--alfa`, `--de`, `--quadros`, `id="motor-video"`, `largura`, `altura`, `qps`, `quadros`,
`window.motor_quadro`), ainda funcionam.

Para agentes de IA, o método vem em skills no formato aberto Agent Skills (`skills/`): `kodecz` (fazer o vídeo),
`remotion-to-kodecz` e `hyperframes-to-kodecz` (portar um projeto). No Claude Code, `/plugin install kodecz
--marketplace konecz/kodecz` instala as skills e o servidor MCP (`mcp/`, com `render`, `preview` e `check`); nos
outros agentes, `npx skills add konecz/kodecz`.

O README completo, com o passo a passo, está em inglês: [`README.md`](README.md).

Criado por **Pedro Henrique Lahr** e **Vanessa Cristine**, pela [Konecz](https://konecz.com), AI Factory. Licença [Apache-2.0](LICENSE).
