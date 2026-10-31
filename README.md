<a href="https://konecz.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="marca/cabecalho-escuro.svg">
    <img alt="Kodecz: video as a web page, on the GPU or the CPU. The Kodecz ribbon, a twisted play triangle drawn in fine blue lines, turns in 3D." src="marca/cabecalho-claro.svg" width="100%">
  </picture>
</a>

<p align="center">
  <b>Write the video as a web page. Render it on an NVIDIA GPU or on any CPU.</b><br>
  <sub>HTML, CSS, JS, React, WebGL, GSAP, Lottie: if Chromium can draw it, Kodecz can render it, frame by frame, on either one, from the same folder.</sub>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#write-a-video">Write a video</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#numbers">Numbers</a> ·
  <a href="#for-ai-agents">For AI agents</a> ·
  <a href="LEIAME.md">Português</a>
</p>

---

## Why

Code-driven video tools render each frame in a browser and then **take a screenshot of it**: the pixels go from the
GPU to the CPU, become a PNG, and travel back to an encoder. That copy is most of the CPU bill.

Kodecz never takes the screenshot, with or without a GPU:

- **On an NVIDIA GPU**, Chromium draws the frame into a GPU texture and the texture goes straight to the hardware
  encoder. The CPU stays free for everything else on the machine.
- **On the CPU** (a laptop, a CI runner, a cloud VM without a GPU), Chromium hands over the raw frame it just painted
  and it goes straight to x264. No PNG, no image encode and decode in the middle.

One folder renders on both. Write on your laptop, render the final cut on the GPU server, or the other way around.

- **The page is the format.** No proprietary scene graph: a folder with an `index.html` and a small JSON block.
- **Deterministic.** Frame *N* is always the same pixels: in order, out of order, or starting from the middle.
- **Built for AI agents, any of them.** Every editing technique ships as a documented, testable block in plain
  Markdown that an agent can read, apply and check (see [For AI agents](#for-ai-agents)).

<a id="how-it-works"></a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="marca/caminho-escuro.svg">
  <img alt="How a frame is made. With an NVIDIA GPU: page, Chromium off-screen, shared texture, NVENC, MP4. Without one: the same page, Chromium software raster, raw frame, x264, MP4. Numbered frames move along both lines without becoming PNGs." src="marca/caminho-claro.svg" width="100%">
</picture>

<a id="numbers"></a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="marca/numeros-escuro.svg">
  <img alt="Same video: Remotion uses 43.7 s of CPU and Kodecz 4.4 s, 10 times less; wall time 13.6 s against 4.6 s, 3 times faster." src="marca/numeros-claro.svg" width="100%">
</picture>

<sub>Synthetic 1080p composition with a presenter video, 150 frames, H.264, RTX 5090, two alternating runs per side;
SSIM 0.998 against the official Remotion render. CPU-mode numbers against Remotion on the same composition are
being measured. Method and raw numbers in <a href="docs/medidas.md"><code>docs/medidas.md</code></a>.</sub>

## Quick start

> **Status:** private preview. The engine is being moved here from our internal repository; the commands below are
> the ones it ships with.

Requirements: Linux, Node 24 and `ffmpeg`. For the GPU path, an NVIDIA GPU with NVENC (tested on an RTX 5090,
driver 570+) and Rust (stable). Without one, the installer sets up the CPU path and everything else works the same.

```bash
git clone https://github.com/konecz/kodecz && cd kodecz
./install.sh                 # checks the system, fetches Chromium (CEF), builds the native module, renders a test video
kodecz render my-video/ MyVideo out.mp4
```

| Option | What it does |
|---|---|
| `--hevc` | HEVC instead of H.264 |
| `--alpha` | transparent video (HEVC with alpha) |
| `--from N` | start at frame *N* (same pixels as a full render) |
| `--cpu` | render on the CPU even when there is a GPU |
| `kodecz preview my-video/ MyVideo --frame 90` | one frame as PNG, in about a second |
| `kodecz preview my-video/ MyVideo --watch` | re-renders the frames you are looking at on every save |

## Write a video

A video is a folder. `index.html` declares the size, frame rate and length; everything else is a normal web page.

```html
<script type="application/json" id="kodecz">
{ "id": "MyVideo", "width": 1920, "height": 1080, "fps": 30, "frames": 150 }
</script>

<style>
  :root { --fps: 30 }
  h1 {
    font: 800 120px/1 "Schibsted Grotesk", sans-serif;
    animation: in 0.6s cubic-bezier(.3, 0, .2, 1) both;
    animation-delay: calc(15 * 1s / var(--fps));   /* enters on frame 15 */
  }
  @keyframes in { from { opacity: 0; transform: translateY(40px) } }
</style>

<h1>Hello, frame 15.</h1>
<video src="presenter.mp4" data-start="0" data-frames="150"></video>
<audio src="music.wav" data-start="30" data-volume="0.6"></audio>
```

- **Animation:** CSS `@keyframes`, `element.animate()`, GSAP and Lottie (bring your own copy). Kodecz pauses the
  page's timeline and puts every animation at `N / fps` before drawing frame *N*.
- **Canvas and WebGL:** export `window.kodecz_frame(n, ms)`; it runs before each frame.
- **Video and audio:** `<video>` and `<audio>` are decoded on the GPU (NVDEC) and mixed in a single pass; the
  presenter video is composited under the page on the GPU, never inside the browser.
- **Not allowed:** `requestAnimationFrame`, timers and the wall clock. They do not follow frame *N*, and Kodecz
  tells you which ones it found.

## For AI agents

Kodecz is made for any agent to write video with: a coding agent in a terminal, an agent in your own pipeline, or a
script calling a model. Nothing in it is tied to one vendor. The agent needs only what it already handles: files,
shell commands, HTML and CSS, and JSON.

- **The format is plain web.** A video is an `index.html` and its files. Any model that writes web pages can write a
  video, and any tool that edits files can change one.
- **Kodecz blocks** (`blocos/`): each editing technique (one-line captions, zoom to the end of a sentence, text that
  avoids the face...) is a folder with a `KODECZ.md` in plain Markdown (what, when, parameters, where it came from),
  the CSS, a snippet to paste and a right and a wrong example. An index lists them all, so an agent can find the
  right one without reading everything.
- **Automatic checks:** `kodecz check` looks at the frames themselves (text inside the safe area, text over a face,
  contrast, captions too long) and answers with one JSON line plus a picture of each problem, so the agent can fix
  it before a human looks.
- **Previews in about a second**, so the agent sees what it wrote instead of guessing.

## Patents

Kodecz contains no video codec. It asks the NVENC encoder in your GPU (or the `ffmpeg` installed on your system) to
encode H.264 or HEVC. Those formats are covered by patent pools; using them in a product you sell or distribute may
need a license from those pools, as with any software that writes H.264 or HEVC. See [`docs/patentes.md`](docs/patentes.md).

## License

[Apache-2.0](LICENSE). Third-party notices in [`NOTICE`](NOTICE). The Schibsted Grotesk and IBM Plex Mono fonts in
`marca/fontes/` are under the SIL Open Font License.

The Kodecz name and logo are brand assets of Konecz; see [`docs/marca.md`](docs/marca.md).

<p align="center"><br>Made by <a href="https://konecz.com"><b>Konecz</b></a> · AI Factory</p>
