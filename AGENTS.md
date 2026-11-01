# AGENTS.md

How an AI agent (Claude Code, Codex, Cursor, Gemini CLI or your own) makes a video with Kodecz. Everything here works
with files and shell commands; nothing depends on one vendor.

> **Status:** private preview. Commands, options and attributes still have their original Portuguese names, and this
> file uses them as they are. **Roadmap:** English names (`kodecz render`, `id="kodecz"`, `fps`...) are coming, with
> the current names still accepted for a while.

## The loop

1. **Write** the video as a folder: `index.html` with the `<script type="application/json" id="motor-video">` block
   (`id`, `largura` = width, `altura` = height, `qps` = frames per second, `quadros` = length in frames) and normal
   HTML, CSS and JS. See «Write a video» in the README and `docs/formatos/linha-do-tempo.md`.
2. **Preview** a frame instead of guessing: `node cli/previa.ts <folder> <id> --quadro <N>` writes a PNG in one to
   two seconds (`--quadro 0,45,120` for several). Look at it.
3. **Check** before rendering: `node cli/conferir.ts <folder> <id>` looks at every frame of the page (text over a
   face, captions on one line, the safe area of a declared destination, contrast over the real background, a zoom
   that ends with the sentence) and prints one JSON line, with a picture of each problem. Exit code 4 means a rule
   was broken. Fix what it reports and check again.
4. **Render**: `node cli/render.ts <folder> <id> out.mp4`. It uses the GPU when there is one and the CPU when not
   (`--cpu` forces the CPU). It prints one JSON line with the result.

## Rules that keep frames deterministic

- Animate with CSS `@keyframes` or `element.animate()`. Time in frames: with `:root { --qps: 30 }`,
  `animation-delay: calc(<frame> * 1s / var(--qps))`.
- Canvas, WebGL and text changed by script go in `window.motor_quadro(n, ms)`, which must depend only on `n`.
- Never use `requestAnimationFrame`, `setTimeout`, `setInterval`, `Date.now()` or `performance.now()` to animate.
- Media: `<video>` and `<audio>` with `data-inicio` (first frame), `data-quadros` (length in frames), `data-recorte`
  (frames cut from the start of the file), `data-volume` and `data-velocidade` (speed). Files live inside the folder.
- Fonts: local files or Google Fonts (downloaded once into a cache).

## Editing techniques

Each technique is a Kodecz block in `blocos/`: a `KODECZ.md` (what, when, parameters), the CSS, a snippet to paste
and a right and a wrong example. Read `blocos/INDICE.md` first and only the block you need. The blocks are written in
Portuguese for now.

## Before you call it done

- Look at key frames yourself (start and end of every scene, every zoom, every caption change).
- `node cli/conferir.ts` with no errors.
- Watch the MP4, or at least the frames around every cut.
