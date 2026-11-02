# AGENTS.md

How an AI agent (Claude Code, Codex, Cursor, Gemini CLI or your own) makes a video with Kodecz. Everything here works
with files and shell commands; nothing depends on one vendor.

`kodecz` is on the PATH after `npm link` in the clone; without it, `node cli/kodecz.ts` does the same.

## Skills, plugin and MCP server

The method below also ships as installable skills, in the open Agent Skills format (`skills/`): `kodecz` (make a
video), `remotion-to-kodecz` and `hyperframes-to-kodecz` (port a project).

- Claude Code: `/plugin install kodecz --marketplace konecz/kodecz` (the skills and the MCP server).
- Codex, Cursor, Gemini CLI, Copilot and other agents: `npx skills add konecz/kodecz`.
- Any MCP client: `mcp/kodecz-mcp.mjs` (npm `kodecz-mcp`), with the tools `render`, `preview` (returns the frames as
  images) and `check`. It runs the `kodecz` command installed on the machine.

## The loop

1. **Write** the video as a folder: `index.html` with the `<script type="application/json" id="kodecz">` block
   (`id`, `width`, `height`, `fps` = frames per second, `frames` = length in frames) and normal HTML, CSS and JS.
   See «Write a video» in the README and `docs/formatos/linha-do-tempo.md`.
2. **Preview** a frame instead of guessing: `kodecz preview <folder> <id> --frame <N>` writes a PNG in one to two
   seconds (`--frame 0,45,120` for several). Look at it.
3. **Check** before rendering: `kodecz check <folder> <id>` looks at every frame of the page (text over a face,
   captions on one line, the safe area of a declared destination, contrast over the real background, a zoom that
   ends with the sentence) and prints one JSON line, with a picture of each problem. Exit code 4 means a rule was
   broken. Fix what it reports and check again.
4. **Render**: `kodecz render <folder> <id> out.mp4`. It uses the GPU when there is one and the CPU when not (`--cpu`
   forces the CPU). It prints one JSON line with the result.

## Rules that keep frames deterministic

- Animate with CSS `@keyframes` or `element.animate()`. Time in frames: with `:root { --fps: 30 }`,
  `animation-delay: calc(<frame> * 1s / var(--fps))`.
- Canvas, WebGL and text changed by script go in `window.kodecz_frame(n, ms)`, which must depend only on `n`.
- Never use `requestAnimationFrame`, `setTimeout`, `setInterval`, `Date.now()` or `performance.now()` to animate.
- Media: `<video>` and `<audio>` with `data-inicio` (first frame), `data-quadros` (length in frames), `data-recorte`
  (frames cut from the start of the file), `data-volume` and `data-velocidade` (speed). Files live inside the folder.
- Fonts: local files or Google Fonts (downloaded once into a cache).

## Older names

Compositions and scripts written with the original Portuguese names keep working for now: `id="motor-video"`,
`largura`, `altura`, `qps`, `quadros`, `window.motor_quadro`, `node cli/render.ts|previa.ts|conferir.ts` and the
options `--placa`, `--alfa`, `--de`, `--quadros`, `--quadro`, `--observar`. Write new ones with the English names.

## Editing techniques

Each technique is a Kodecz block in `blocos/`: a `KODECZ.md` (what, when, parameters), the CSS, a snippet to paste
and a right and a wrong example. Read `blocos/INDICE.md` first and only the block you need. The block docs are
written in Portuguese for now.

## Before you call it done

- Look at key frames yourself (start and end of every scene, every zoom, every caption change).
- `kodecz check` with no errors.
- Watch the MP4, or at least the frames around every cut.
