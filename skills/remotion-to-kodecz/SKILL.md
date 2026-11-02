---
name: remotion-to-kodecz
description: Port a Remotion project (React video with useCurrentFrame, interpolate, spring, Sequence, Composition, OffthreadVideo) to Kodecz, the Apache-2.0 engine that renders a web page into an MP4 on an NVIDIA GPU or any CPU. Use when the user wants to move off Remotion, avoid the Remotion company license, render Remotion-style videos with Kodecz, or asks to convert/migrate a Remotion composition; maps every Remotion API to its Kodecz equivalent and verifies frame by frame.
license: Apache-2.0
compatibility: Needs a Kodecz install (https://github.com/konecz/kodecz) and the Remotion project's source. Uses React and a bundler only if the components are kept.
metadata:
  author: Konecz
  homepage: https://github.com/konecz/kodecz
---

# Port a Remotion project to Kodecz

Kodecz takes any web page, so a Remotion project ports without a rewrite: the React tree can stay, only the frame
source changes. The result renders on the GPU (NVENC) or the CPU (x264) and drops the `remotion` package.

Read the `kodecz` skill first (the page format, the loop, the checks). Then pick a strategy per composition.

## Pick a strategy

| | A. Keep React (fast) | B. Native CSS (best) |
|---|---|---|
| Work | swap the `remotion` import for a small shim, bundle | rewrite the animations as `@keyframes` / `element.animate()` |
| Frames | `window.kodecz_frame(n)` re-renders React at frame *n* | Kodecz seeks the page's animations itself |
| Speed | every frame is drawn | still frames are repeated without drawing (much faster for slow scenes) |
| Kodecz blocks and checks | checks work; blocks need CSS | blocks drop in, checks work |

Start with A to get a matching video quickly; move hot scenes (long holds, captions) to B when it pays off.

## Strategy A: keep React

1. Copy `references/remotion-shim.js` (next to this file) into the project. It is original Apache-2.0 code with the
   same names: `useCurrentFrame`, `useVideoConfig`, `Sequence`, `Series`, `Loop`, `Freeze`, `AbsoluteFill`, `Img`,
   `staticFile`, `interpolate`, `spring`, `random`, plus `mount()` and `springEasing()`.
2. Replace `from "remotion"` with `from "./remotion-shim.js"` everywhere. Anything the shim does not export is in the
   table below.
3. Write an entry that mounts the composition's component (what `<Composition component={…}>` pointed at):

   ```js
   import { mount } from "./remotion-shim.js";
   import { MyVideo } from "./MyVideo";
   mount(MyVideo, { title: "Hello" });   // the old defaultProps
   ```

4. Bundle it to one local file (esbuild, Vite, Rollup...). The render has no network: no CDN imports.
5. `index.html`, with the values of the old `<Composition>`:

   ```html
   <!doctype html>
   <meta charset="utf-8">
   <script type="application/json" id="kodecz">
   { "id": "MyVideo", "width": 1920, "height": 1080, "fps": 30, "frames": 300 }
   </script>
   <style>html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden }</style>
   <div id="root" style="position: absolute; inset: 0"></div>
   <video class="bg" src="clip.mp4" data-inicio="0" data-quadros="300"></video>
   <script src="bundle.js"></script>
   ```

   **Video and audio stay outside React**, as static tags in `index.html`: Kodecz decodes them itself, turns each
   `<video>` into a `<canvas>` and only takes media present when the page finishes loading. Position them with CSS
   (by class or id) and layer the React root with `z-index`.
6. Copy what was in `public/` next to `index.html`.

## API mapping

| Remotion | Kodecz |
|---|---|
| `<Composition id width height fps durationInFrames>` | the JSON block `{ "id", "width", "height", "fps", "frames" }` in `index.html`; one folder per composition |
| `<Still>` | `"frames": 1` and `kodecz preview <folder> <id> --frame 0` |
| `defaultProps`, `getInputProps()`, `calculateMetadata` | no input props yet: write the values in the page (A: `mount(Component, props)`), or generate the folder with a script |
| `useCurrentFrame()` | A: shim. B: no hook; an animation's delay is its start frame, `calc(<frame> * 1s / var(--fps))` |
| `useVideoConfig()` | A: shim. B: `JSON.parse(document.getElementById("kodecz").textContent)` |
| `interpolate(f, [a, b], [x, y], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })` | B: `@keyframes k { from { prop: x } to { prop: y } }`, `animation: k calc((b - a) * 1s / var(--fps)) linear calc(a * 1s / var(--fps)) both` (`both` = clamp on both sides) |
| `interpolate` with more points `[a, b, c]` | one keyframe per point: offsets `(b - a) / (c - a)` etc. |
| `interpolate` with the default `"extend"` | Remotion extends by default; CSS clamps. If the value matters outside the range, widen the keyframes to the frames you need or use strategy A |
| `Easing.bezier(a, b, c, d)` | `cubic-bezier(a, b, c, d)` |
| `Easing.linear` | `linear` |
| other `Easing.*` (`quad`, `cubic`, `sin`, `exp`, `elastic`, `bounce`, `in/out/inOut`) | sample the function into CSS `linear(…)` (one point per frame is enough) or keep A |
| `spring({ frame, fps, config })` | A: shim (closed-form spring, close to Remotion's). B: `springEasing({ fps, frames, config })` gives a `linear(…)` easing for `element.animate()` |
| `interpolateColors(f, [a, b], [c1, c2])` | `@keyframes` on the color, same delay and duration as above |
| `random(seed)` | A: shim. B: any seeded generator; never `Math.random()` |
| `<Sequence from durationInFrames>` | B: a scene from `blocos/cena` (`--inicio`, `--fim` in frames); children add the scene start to their delays: `calc((var(--inicio) + 12) * 1s / var(--fps))` |
| `<Series>` / `<Series.Sequence offset>` | consecutive scenes, each `--inicio` = previous `--fim` (+ offset) |
| `<Loop durationInFrames times>` | `animation-duration` = loop length, `animation-iteration-count: times` |
| `<Freeze frame>` | the static style at that frame (or A) |
| `<AbsoluteFill>` | `position: absolute; inset: 0; display: flex; flex-direction: column` |
| `@remotion/transitions` `<TransitionSeries>`, `fade()`, `slide()`, `wipe()` | blocks `transicao-fade`, `transicao-deslizar`, `transicao-wipe` |
| `<Img src>` | `<img src>` (Kodecz waits for it to decode) |
| `staticFile("a.png")` | `"a.png"`, the file next to `index.html` |
| `<Video>` / `<OffthreadVideo src>` | `<video src>` in `index.html` |
| `<Sequence from={s}>` around a video | `data-inicio="s"` on the `<video>` |
| `trimBefore` (old `startFrom`) | `data-recorte` (frames cut from the start of the file) |
| `trimAfter` (old `endAt`) | `data-quadros` = `trimAfter - trimBefore` |
| `playbackRate` | `data-velocidade` (0.1 to 10; audio keeps its pitch) |
| `volume={0.6}` | `data-volume="0.6"` |
| `volume={(f) => interpolate(f, [0, 6, d - 20, d], [0, 1, 1, 0])}` | `data-volume="0:0 6:1 <d - 20>:1 <d>:0"` (frame:volume points, straight lines between) |
| `muted` | `muted` |
| `<Audio>` | `<audio>` with the same attributes |
| `loop` on media | not supported yet |
| `delayRender()` / `continueRender()` | Kodecz waits for fonts and `<img>` before frame 0; finish other async setup before the page's `load` event, or return a Promise from `window.kodecz_frame` |
| `@remotion/google-fonts`, `loadFont()` | a Google Fonts `<link>` (cached once) or local `@font-face` |
| `@remotion/lottie` | lottie-web by classic `<script>` + `lottie.loadAnimation`; Kodecz drives it |
| `@remotion/three`, `<ThreeCanvas>` | draw in `window.kodecz_frame(n)` |
| `useCurrentFrame()` inside a `<canvas>` effect | `window.kodecz_frame = (n) => draw(n)` |

## Command mapping

| Remotion | Kodecz |
|---|---|
| `npx remotion render src/index.ts MyVideo out.mp4` | `kodecz render my-video/ MyVideo out.mp4` (GPU when there is one) |
| `--frames=30-89` | `--from 30 --frames 60` |
| `--codec=h265` | `--hevc` (GPU only) |
| `--codec=prores --prores-profile=4444`, VP8/VP9 with alpha | `--alpha` (raw HEVC with alpha, GPU only, no audio) |
| `npx remotion still … --frame=45` | `kodecz preview my-video/ MyVideo --frame 45` |
| `npx remotion studio` | `kodecz preview my-video/ MyVideo --frame 0,45,90` after each change |
| `--concurrency`, `--gl` | not needed: one Chromium draws, the GPU path never copies frames to the CPU |

## Verify the port frame by frame

1. Pick frames that matter: 0, the first and last frame of each `<Sequence>`, the middle of each transition, the last
   frame.
2. Remotion side (if it still runs): `npx remotion still … --frame=N` for each. Kodecz side:
   `kodecz preview my-video/ MyVideo --frame <the same list>`.
3. Look at the pairs side by side. Text metrics can differ by a pixel; layout, timing and color must not. A shifted
   entrance usually means a delay forgot the scene start or an `interpolate` used `"extend"`.
4. `kodecz check my-video/ MyVideo` exits 0, then `kodecz render`.

Remotion is a trademark of its owner; this skill only maps public behaviour. Do not copy Remotion source into the
port.
