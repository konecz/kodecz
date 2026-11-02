<a href="https://konecz.com">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/konecz/kodecz/main/marca/cabecalho-escuro.svg">
  <img alt="Kodecz, the open-source engine that renders a web page into an MP4 video on an NVIDIA GPU or on any CPU. The Kodecz ribbon, a twisted play triangle drawn in fine blue lines, turns in 3D." src="https://raw.githubusercontent.com/konecz/kodecz/main/marca/cabecalho-claro.svg" width="100%">
</picture>
</a>

**Kodecz is an open-source video rendering engine that turns a web page into an MP4.** You write the video in HTML,
CSS and JavaScript (React, WebGL, GSAP, Lottie or nothing at all), and Kodecz renders it frame by frame on an NVIDIA
GPU with NVENC or on any CPU with x264, without taking a screenshot of every frame. It is an alternative to Remotion
and HyperFrames, made to be driven by AI agents.

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#write-a-video">Write a video</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#numbers">Numbers</a> ·
  <a href="#for-ai-agents">For AI agents</a> ·
  <a href="#faq">FAQ</a> ·
  <a href="LEIAME.md">Português</a>
</p>

If Chromium can draw it, Kodecz can render it:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/konecz/kodecz/main/marca/tecnologias-escuro.svg">
  <img alt="HTML, CSS, JavaScript, TypeScript, React, WebGL, three.js, GSAP and SVG." src="https://raw.githubusercontent.com/konecz/kodecz/main/marca/tecnologias-claro.svg" width="100%">
</picture>

<a id="how-it-works"></a>

## How it works

Two paths, one folder. Other tools take a screenshot of every frame and turn it into a PNG before encoding it;
Kodecz never does, with or without a GPU.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/konecz/kodecz/main/marca/caminho-escuro.svg">
  <img alt="With an NVIDIA GPU: page, Chromium, shared texture, NVENC, MP4. On the CPU: page, Chromium, raw frame, x264, MP4. Frames move along both lines without becoming PNGs." src="https://raw.githubusercontent.com/konecz/kodecz/main/marca/caminho-claro.svg" width="100%">
</picture>

**Page** is your `index.html`. **Chromium** draws frame *N*. On a GPU, that frame stays on the card as a
**texture**; on the CPU, it is the **raw frame** Chromium just painted. Either way it goes straight to the encoder,
**NVENC** on the card or **x264** on the processor, and comes out as an **MP4** with the audio mixed in. Frame *N* is
always the same frame, in order, out of order or starting from the middle: same content, same timing.

<a id="numbers"></a>

## Numbers

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/konecz/kodecz/main/marca/numeros-escuro.svg">
  <img alt="One square per second. CPU time: Remotion 43.7 s, Kodecz 4.4 s, 10 times less. Wall time: Remotion 13.6 s, Kodecz 4.6 s, 3 times faster." src="https://raw.githubusercontent.com/konecz/kodecz/main/marca/numeros-claro.svg" width="100%">
</picture>

Each square is one second. Rendering the same video, Kodecz keeps the processor busy for **10× less time**
(43.7 s → 4.4 s of CPU) and hands you the MP4 **3× sooner** (13.6 s → 4.6 s on the clock).

<sub>1080p · 150 frames · H.264 · RTX 5090 · <a href="docs/medidas.md">how we measured</a></sub>

## Kodecz, Remotion and HyperFrames

| | Kodecz | Remotion | HyperFrames |
|---|---|---|---|
| You write the video in | any web page: HTML, CSS, JS, React, WebGL | React components | HTML |
| How each frame leaves the browser | GPU texture or the raw painted frame, no screenshot | screenshot (`Page.captureScreenshot`) | screenshot (`HeadlessExperimental.beginFrame`) |
| Encoding | NVENC on the GPU, or x264 on the CPU | ffmpeg, x264 on the CPU by default | ffmpeg |
| CPU time for the same 1080p video | **4.4 s** | 43.7 s | not measured yet |
| License | Apache-2.0 | Remotion License (paid for companies above 3 people) | Apache-2.0 |

<sub>Remotion and HyperFrames are good tools, and Kodecz learned from both. The capture methods come from their source
code; the CPU numbers are ours, in <a href="docs/medidas.md">docs/medidas.md</a>.</sub>

## Quick start

> **Status:** private preview. Commands, options and attributes still have their original Portuguese names
> (`node cli/render.ts`, `--de`, `id="motor-video"`, `qps`...), and this page uses them as they are.
> **Roadmap:** English names (`kodecz render`, `--from`, `id="kodecz"`, `fps`...) are coming, with the current
> names still accepted for a while.

Requirements: Linux, Node 24, `ffmpeg`, `weston`, `bubblewrap`, and Rust 1.85+ with a C/C++ toolchain (`cmake`,
`ninja`): the Chromium host is compiled on your machine, with or without a GPU. For the GPU path, an NVIDIA GPU with
NVENC (tested on an RTX 5090, driver 570+). Without one, the installer sets up the CPU path; HEVC and the transparent
layer need the GPU.

```bash
git clone https://github.com/konecz/kodecz && cd kodecz
./instalar.sh                                  # checks the system, installs and renders a test video
node cli/render.ts my-video/ MyVideo out.mp4   # GPU when there is one, CPU when not
```

`./instalar.sh --verificar` only says what is missing; `./instalar.sh --sistema` also installs the missing `apt`
packages (with `sudo`). Details in [`instalar/LEIAME.md`](instalar/LEIAME.md).

| Option | What it does |
|---|---|
| `--hevc` | HEVC instead of H.264 (GPU only) |
| `--alfa` | transparent layer: raw HEVC with alpha (`.hevc`, GPU only, no audio) |
| `--de N --quadros M` | render *M* frames starting at frame *N* (the same frames as a full render) |
| `--cpu` | render on the CPU even when there is a GPU |
| `--placa` | GPU only: fails (exit code 3) when there is none |
| `--sem-audio` | skip the audio |
| `node cli/previa.ts my-video/ MyVideo --quadro 90` | one frame as PNG, in one to two seconds |
| `node cli/previa.ts my-video/ MyVideo --observar` | re-renders the frames you are looking at on every save |

`node cli/render.ts --ajuda` lists every option. The render prints one JSON line with the result on stdout.

## Write a video

A video is a folder. `index.html` declares the size, frame rate and length; everything else is a normal web page.

```html
<script type="application/json" id="motor-video">
{ "id": "MyVideo", "largura": 1920, "altura": 1080, "qps": 30, "quadros": 150 }
</script>

<style>
  :root { --qps: 30 }
  h1 {
    font: 800 120px/1 "Schibsted Grotesk", sans-serif;
    animation: in 0.6s cubic-bezier(.3, 0, .2, 1) both;
    animation-delay: calc(15 * 1s / var(--qps));    /* enters on frame 15 */
  }
  @keyframes in { from { opacity: 0; transform: translateY(40px) } }
</style>

<h1>Hello, frame 15.</h1>
<video src="presenter.mp4" data-inicio="0" data-quadros="150"></video>
<audio src="music.wav" data-inicio="30" data-volume="0.6"></audio>
```

- **The block:** `largura` and `altura` are the size in pixels (even numbers, width at least 800, up to 8192), `qps`
  the frames per second and `quadros` the length in frames. The `id` is the name you pass to the commands. The full
  format is in [`docs/formatos/linha-do-tempo.md`](docs/formatos/linha-do-tempo.md) (Portuguese for now).
- **Animation:** CSS `@keyframes`, `element.animate()`, GSAP and Lottie (bring your own copy). Kodecz pauses the
  page's timeline and puts every animation at `N / qps` seconds before drawing frame *N*.
- **Canvas and WebGL:** define `window.motor_quadro(n, ms)`; it runs before each frame and must depend only on `n`.
- **Video and audio:** `<video>` and `<audio>` with `data-inicio` (first frame), `data-quadros` (length in frames),
  `data-recorte` (frames cut from the start of the file), `data-volume` and `data-velocidade` (speed). Kodecz
  decodes them itself and mixes the audio in a single pass. On the GPU path, H.264 and HEVC video is decoded with
  NVDEC and composited under the page on the card, never inside the browser.
- **Not allowed:** `requestAnimationFrame`, timers and the wall clock. They do not follow frame *N*. The render's
  JSON line counts the animations that do not follow the page timeline (`animacoesSoltas`) and the CSS transitions
  it sent straight to their end (`transicoesAoFim`).

## For AI agents

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/konecz/kodecz/main/marca/agentes-escuro.svg">
  <img alt="The agent loop: write, preview, check, fix, around the Kodecz ribbon." src="https://raw.githubusercontent.com/konecz/kodecz/main/marca/agentes-claro.svg" width="100%">
</picture>

Kodecz is made for any agent to write video with: a coding agent in a terminal, an agent in your own pipeline, or a
script calling a model. Nothing in it is tied to one vendor. The agent needs only what it already handles: files,
shell commands, HTML and CSS, and JSON.

- **The format is plain web.** A video is an `index.html` and its files. Any model that writes web pages can write a
  video, and any tool that edits files can change one.
- **Kodecz blocks** (`blocos/`): each editing technique (one-line captions, zoom to the end of a sentence, text that
  avoids the face...) is a folder with a `KODECZ.md` in plain Markdown (what, when, parameters, where it came from),
  the CSS, a snippet to paste and a right and a wrong example. An index lists them all, so an agent can find the
  right one without reading everything.
- **Automatic checks:** `node cli/conferir.ts my-video/ MyVideo` looks at every frame of the page without rendering the
  video (text over a face, captions on one line, the safe area of a declared destination, contrast over the real
  background, a zoom that ends with the sentence) and answers with one JSON line plus a picture of each problem, so
  the agent can fix it before a human looks. It needs a one-time `node conferencia/preparar.ts`.
- **Previews in one to two seconds** (`node cli/previa.ts`), so the agent sees what it wrote instead of guessing.

### Install the Kodecz skills

Three skills teach an agent the method: `kodecz` (make a video: write, preview, check, fix, render),
`remotion-to-kodecz` and `hyperframes-to-kodecz` (port a project, with the API mapped one to one). They need Kodecz
installed on the machine (quick start above).

| Agent | Install |
|---|---|
| Claude Code | `/plugin install kodecz --marketplace konecz/kodecz` (skills and the MCP server; before 2.1.275: `/plugin marketplace add konecz/kodecz`, then `/plugin install kodecz@kodecz`) |
| Codex, Cursor, Gemini CLI, Copilot and [others](https://skills.sh) | `npx skills add konecz/kodecz` |
| Any MCP client | the [`kodecz-mcp`](mcp/) server: `render`, `preview` (frames come back as images) and `check` |

The skills are plain Markdown in [`skills/`](skills/), in the open [Agent Skills](https://agentskills.io) format.

<a id="faq"></a>

## FAQ

### Does Kodecz work without a GPU?

Yes. Without an NVIDIA GPU, Kodecz renders on the CPU: Chromium paints in software and the raw frame goes straight to
x264. The same folder renders on both, frame for frame.

### Is Kodecz an alternative to Remotion?

Yes. Both turn code into video. Remotion asks you to write React components; Kodecz takes any web page. On the same
1080p video with a presenter, Kodecz used 10 times less CPU and finished 3 times sooner on the GPU path.

### Which AI agents can use Kodecz?

Any agent that can write files and run commands: Claude Code, Codex, Cursor, Gemini CLI or your own. The format is
plain HTML, the editing blocks are Markdown and the checks answer in JSON. See [`AGENTS.md`](AGENTS.md).

### Is the output deterministic?

Frame *N* depends only on the page and on *N*: rendering in order, out of order or from the middle gives the same
content at the same moment. In our test compositions the pixels are identical too. In real videos, Chromium can
rasterize animated text slightly differently from one run to the next, by up to 2 color levels out of 255, which you
cannot see. Timers and the wall clock are not allowed in a composition.

### Which formats does it export?

MP4 with H.264 (default) or HEVC (GPU only), a transparent layer as raw HEVC with alpha (`--alfa`, GPU only, no
audio), and AAC audio mixed from every `<audio>` and `<video>` on the page.

## Patents

Kodecz contains no video codec. It asks the NVENC encoder in your GPU (or the `ffmpeg` installed on your system) to
encode H.264 or HEVC. Those formats are covered by patent pools; using them in a product you sell or distribute may
need a license from those pools, as with any software that writes H.264 or HEVC. See [`docs/patentes.md`](docs/patentes.md).

## License

[Apache-2.0](LICENSE). Third-party notices in [`NOTICE`](NOTICE) and
[`docs/licencas/`](docs/licencas/). The Schibsted Grotesk and IBM Plex Mono fonts in
`marca/fontes/` are under the SIL Open Font License.

The Kodecz name and logo are brand assets of Konecz; see [`docs/marca.md`](docs/marca.md).

## Authors

Kodecz was created by **Pedro Henrique Lahr** and **Vanessa Cristine** at [Konecz](https://konecz.com). See
[`AUTHORS`](AUTHORS).
