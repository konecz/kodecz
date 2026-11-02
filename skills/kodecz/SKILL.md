---
name: kodecz
description: Make a video with Kodecz, the open-source engine that renders a web page (HTML, CSS, JS, React, WebGL, GSAP, Lottie) into an MP4 on an NVIDIA GPU or on any CPU. Use when the user asks for a video, motion graphics, an animated explainer, captions, a title card, a chart animation or a social clip made from code, or mentions Kodecz; write the page, preview frames, run the automatic checks, fix and render.
license: Apache-2.0
compatibility: Needs a Kodecz install (Linux, Node 24, ffmpeg; NVIDIA GPU optional) from https://github.com/konecz/kodecz and a shell.
metadata:
  author: Konecz
  homepage: https://github.com/konecz/kodecz
---

# Make a video with Kodecz

A Kodecz video is a folder with an `index.html`. Kodecz puts the page at frame *N*, Chromium draws it, and the frame
goes straight to the encoder (NVENC on a GPU, x264 on a CPU). You write a web page; Kodecz makes it a video.

The method is a loop: **write → preview → check → fix → render**. Never call a video done from the code alone: look
at frames and run the checks.

## 0. Make sure Kodecz is there

```bash
kodecz render --help        # prints the options when Kodecz is installed
```

If it is missing: `git clone https://github.com/konecz/kodecz && cd kodecz && ./instalar.sh` (it checks the system,
installs and renders a test video; `./instalar.sh --verificar` only lists what is missing). The README quick start
says how to call `kodecz` on that machine. Kodecz runs on Linux; without an NVIDIA GPU it renders on the CPU.

## 1. Write the page

```html
<!doctype html>
<meta charset="utf-8">
<script type="application/json" id="kodecz">
{ "id": "MyVideo", "width": 1920, "height": 1080, "fps": 30, "frames": 150 }
</script>
<style>
  :root { --fps: 30 }
  html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #0b0d12 }
  h1 {
    position: absolute; left: 160px; top: 420px; margin: 0;
    font: 800 120px/1 "Schibsted Grotesk", sans-serif; color: #fff;
    animation: enter 0.6s cubic-bezier(.3, 0, .2, 1) both;
    animation-delay: calc(15 * 1s / var(--fps));      /* enters on frame 15 */
  }
  @keyframes enter { from { opacity: 0; transform: translateY(40px) } }
</style>
<h1>Hello, frame 15.</h1>
```

- **The block** (`<script type="application/json" id="kodecz">`): `id` is the name you pass to the commands;
  `width` and `height` in pixels (even, width ≥ 800, up to 8192); `fps` 1 to 240; `frames` = length in frames.
- **Time is in frames.** With `:root { --fps: 30 }`, `calc(<frame> * 1s / var(--fps))` lands exactly on a frame.
  Every animation starts at t = 0 of the video; its entry moment is its delay.
- **Animate with** CSS `@keyframes`, `element.animate()`, GSAP or Lottie (the user brings the library file into the
  folder; load it with a classic `<script>`, never from a CDN: the render has no network except Google Fonts).
- **Canvas, WebGL, three.js, text changed by script, a React tree:** do it in
  `window.kodecz_frame = (n, ms) => { … }`. It runs before frame *n* is drawn, may return a Promise, and must depend
  only on `n`.
- **Never** use `requestAnimationFrame`, `setTimeout`/`setInterval` to animate, `Date.now()`, `performance.now()`,
  `Math.random()` without a seed, CSS transitions, scroll timelines or animations created after load. They do not
  follow frame *N*. The render's JSON line counts what escaped (`animacoesSoltas`, `transicoesAoFim`).
- **Video and audio:** `<video>` / `<audio>` with the file inside the folder and timing in frames
  (`data-inicio` = first frame, `data-quadros` = length, `data-recorte` = frames cut from the start of the file,
  `data-volume`, `data-velocidade` = speed). Style the video by class or id, not by the `video` selector (it becomes a
  `<canvas>`). Check `docs/formatos/linha-do-tempo.md` for the current attribute names.
- **Images:** `<img>` (Kodecz waits for it to decode); a CSS `background-image` is not waited for.
- **Fonts:** local files with `@font-face`, or a Google Fonts `<link>` (downloaded once into a cache).
- **Transparent layer:** leave `html` and `body` without background and render with `--alpha`.

Full format: `docs/formatos/linha-do-tempo.md` in the Kodecz repository
(<https://github.com/konecz/kodecz/blob/main/docs/formatos/linha-do-tempo.md>).

## 2. Reuse a block before inventing one

`blocos/` holds Kodecz blocks: each editing technique (scene with hard cut, fade, wipe and slide transitions, title
entrance, title card, lower third, one-line word-by-word captions, punch-in zoom that ends with the sentence, bar and
line charts, count-up) is a folder with a `KODECZ.md` (what, when, parameters, checks), `bloco.css`, a snippet to
paste (`bloco.html`) and a right and a wrong example. **Read `blocos/INDICE.md` first, then only the `KODECZ.md` of
the block you will use.** Do not read every block. Blocks take brand colors and fonts from CSS variables (a
`DESIGN.md` turned into CSS by `node identidade/design-md.ts css DESIGN.md > marca.css`). The blocks still read
the frame rate from `--qps`: declare `:root { --fps: 30; --qps: 30 }` (the same number) while that name lasts.

Turning things on and off (a scene, a word, a caption) is a pair of zero-length animations with `forwards`, one at
the start and one at the end, as in `blocos/cena/bloco.css`. An animation that lasts the whole scene makes Kodecz
draw every frame of it instead of repeating still frames.

## 3. Preview frames, then look at them

```bash
kodecz preview my-video/ MyVideo --frame 0,15,45,149
```

Each frame comes out as a lossless PNG in one to two seconds, the same pixels as the render. **Open the PNGs and
look.** Preview the first and last frame of every scene, every transition midpoint, every zoom and every caption
change. Guessing from code is how text ends up off-frame or under a face.

## 4. Run the automatic checks

```bash
kodecz check my-video/ MyVideo
```

It looks at every frame without rendering and prints one JSON line: text over the presenter's face, captions on more
than one line, text in the area a social app covers (when `<html data-destino="reels|tiktok|shorts|instagram|anuncio">`
is set), contrast against the real background, a zoom that does not end with the sentence. Each problem comes with
the frame, the reason and a PNG with the boxes drawn. **Exit code 4 means a rule was broken: fix and check again.**
Mark roles so the checks know what is what: `data-papel="apresentador"` on the presenter video,
`data-papel="legenda"` on captions, and publish the spoken words in `window.motor_falas`
(format in `docs/formatos/conferencia.md`). The first run on a machine needs `node conferencia/preparar.ts` once.

## 5. Render

```bash
kodecz render my-video/ MyVideo out.mp4
```

GPU when there is one, CPU when not. Options: `--cpu` (force the CPU), `--hevc` (GPU only), `--alpha` (raw HEVC with
alpha, GPU only, no audio), `--from N --frames M` (just a slice, same frames as a full render). It prints one JSON
line with the result on stdout; errors go to stderr. `kodecz render --help` lists everything.

## Before you call it done

- [ ] `kodecz check` exits 0 (warnings read and either fixed or explained to the user).
- [ ] You looked at the key frames yourself (start and end of every scene, every zoom, every caption change).
- [ ] The render's JSON line has no escaped animations you did not expect.
- [ ] You watched the MP4, or at least extracted and looked at the frames around every cut.

## Porting an existing project

Remotion project: use the `remotion-to-kodecz` skill. HyperFrames project: use the `hyperframes-to-kodecz` skill.
