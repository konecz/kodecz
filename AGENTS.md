# AGENTS.md

How an AI agent (Claude Code, Codex, Cursor, Gemini CLI or your own) makes a video with Kodecz. Everything here works
with files and shell commands; nothing depends on one vendor.

> **Status:** private preview. The engine is being moved into this repository; command names below are the ones it
> ships with.

## The loop

1. **Write** the video as a folder: `index.html` with the `<script type="application/json" id="kodecz">` block
   (`id`, `width`, `height`, `fps`, `frames`) and normal HTML, CSS and JS. See «Write a video» in the README.
2. **Preview** a frame instead of guessing: `kodecz preview <folder> <id> --frame <N>` writes a PNG in about a second.
   Look at it.
3. **Check** before rendering: `kodecz check <folder> <id>` looks at the frames themselves (text inside the safe area,
   text over a face, contrast, captions on one line) and prints one JSON line, with a picture of each problem. Fix
   what it reports and check again.
4. **Render**: `kodecz render <folder> <id> out.mp4`. It uses the GPU when there is one and the CPU when not.

## Rules that keep frames deterministic

- Animate with CSS `@keyframes` or `element.animate()`. Time in frames: `animation-delay: calc(<frame> * 1s / var(--fps))`.
- Canvas, WebGL and text changed by script go in `window.kodecz_frame(n, ms)`, which must depend only on `n`.
- Never use `requestAnimationFrame`, `setTimeout`, `setInterval`, `Date.now()` or `performance.now()` to animate.
- Media: `<video>` and `<audio>` with `data-start`, `data-frames`, `data-trim` and `data-volume`. Files live inside
  the folder.
- Fonts: local files or Google Fonts (downloaded once into a cache).

## Editing techniques

Each technique is a Kodecz block in `blocos/`: a `KODECZ.md` (what, when, parameters), the CSS, a snippet to paste
and a right and a wrong example. Read `blocos/INDICE.md` first and only the block you need.

## Before you call it done

- Look at key frames yourself (start and end of every scene, every zoom, every caption change).
- `kodecz check` with no errors.
- Watch the MP4, or at least the frames around every cut.
