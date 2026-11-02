---
name: hyperframes-to-kodecz
description: Port a HyperFrames (HeyGen) project to Kodecz, the Apache-2.0 engine that renders a web page into an MP4 on an NVIDIA GPU or any CPU. Use when the user has a HyperFrames composition (data-composition-id, data-start, data-duration, class="clip", window.__timelines GSAP timelines) and wants to render it with Kodecz, render it on the GPU, or migrate; maps every attribute and command, converts seconds to frames and verifies frame by frame.
license: Apache-2.0
compatibility: Needs a Kodecz install (https://github.com/konecz/kodecz) and the HyperFrames project's files.
metadata:
  author: Konecz
  homepage: https://github.com/konecz/kodecz
---

# Port a HyperFrames project to Kodecz

Both tools take an HTML page, so most of a HyperFrames project carries over unchanged: the markup, the CSS and the
GSAP timelines. What changes is how timing is declared. HyperFrames reads timing from data attributes, in
**seconds**, and its runtime shows and hides clips. Kodecz has no clip runtime: the page itself turns things on and
off with animations, and time is counted in **frames**.

Read the `kodecz` skill first (the page format, the loop, the checks).

## Steps

1. **Pick the frame rate:** the root's `data-fps`, or the `--fps` the project renders with, or 30. Every time below is
   `frames = round(seconds × fps)`.
2. **Add the block** to `index.html`, from the root element:

   ```html
   <script type="application/json" id="kodecz">
   { "id": "launch", "width": 1920, "height": 1080, "fps": 30, "frames": 450 }
   </script>
   <style>:root { --fps: 30; --qps: 30 }</style>
   ```

   `id` = `data-composition-id`, `width`/`height` = `data-width`/`data-height`, `frames` = `data-duration` × fps (if
   the root has no duration, the end of the last clip or medium).
3. **Resolve relative starts** (`data-start="intro + 0.5"`): walk the references and write every clip's absolute
   start and end in seconds, then in frames.
4. **Turn clips into scenes:** each timed element gets an on/off pair of zero-length animations at its start and end
   frames. Use the `cena` block (`blocos/cena/bloco.css`, with `--inicio` and `--fim` in frames), or inline:

   ```css
   .clip { opacity: 0;
     animation: on 0s calc(var(--in) * 1s / var(--fps)) forwards, off 0s calc(var(--out) * 1s / var(--fps)) forwards }
   @keyframes on { to { opacity: 1 } }
   @keyframes off { to { opacity: 0 } }
   ```

   ```html
   <section id="intro" class="clip" style="--in: 0; --out: 75">…</section>
   ```

   A CSS animation wins over the inline style GSAP writes: if a timeline animates the clip's own `opacity` (or uses
   `autoAlpha`), move the scene animation to a wrapper element around the clip. Drop `data-track-index` (display only in HyperFrames; paint order is `z-index` in both).
5. **GSAP stays.** Kodecz pauses GSAP's root timeline and puts it at *N* / fps on every frame; a timeline created with
   `{ paused: true }` at load is driven from its own start, just like in HyperFrames. Keep
   `window.__timelines[id] = tl` (harmless) or remove it. Requirements: load GSAP with a classic
   `<script src="gsap.min.js">` from the project folder (it must set `window.gsap`; no CDN, no ES module without
   `window.gsap = gsap`), create every tween at load, one GSAP copy per page. GSAP is the user's own dependency under
   its own license; Kodecz does not ship it.
6. **Nested compositions** (`data-composition-src`): inline the child's markup into the parent page and give it a
   scene (`--in`, `--out` from the host's `data-start` and `data-duration`). Its timeline runs from frame 0, so add
   it to one master timeline at the host start: `master.add(childTl, hostStart - playbackStart)`. Write the child's
   `data-variable-values` into its markup (Kodecz has no input props yet).
7. **Media:** convert the attributes (table below), keep files inside the folder, style videos by class or id.
8. **Preview, check, render:** `kodecz preview`, `kodecz check`, `kodecz render` (below).

## Attribute mapping

| HyperFrames | Kodecz |
|---|---|
| root `data-composition-id` | block `id` |
| root `data-width`, `data-height` | block `width`, `height` |
| root `data-duration` (s) | block `frames` = s × fps |
| root `data-fps` / render `--fps` (default 30) | block `fps` |
| root `data-start="0"` | drop |
| root `data-no-timeline` | nothing to do: Kodecz never waits for a timeline |
| clip `id` | keep |
| clip `data-start` (s, or `other + 0.5`) | scene start frame `--in` (resolved to absolute) |
| clip `data-duration` (s) | scene end frame `--out` = `--in` + s × fps |
| `class="clip"` | keep as a layout class; visibility comes from the scene animations |
| `data-track-index` | drop |
| `<video>`/`<audio>` `data-start` | `data-inicio` (frames) |
| `data-duration` on media | `data-quadros` (frames) |
| `data-media-start` (s into the file) | `data-recorte` (frames, at the composition's fps) |
| `data-playback-rate` | `data-velocidade` (0.1 to 10) |
| `data-volume` (gain, up to 3.98) | `data-volume` (0 to 10) |
| `data-fade-in` / `data-fade-out` (s) | volume points: `data-volume="0:0 <in>:<v> <len - out>:<v> <len>:0"`, frames counted from the medium's start |
| `data-has-audio="true"` on a video | drop: a Kodecz video without `muted` is mixed in |
| `muted` on a silent video | keep `muted` |
| nested `data-composition-src` | inline the child (step 6) |
| nested `data-playback-start` (s) | offset when adding the child timeline to the master |
| nested `data-variable-values` | write the values in the child markup |
| `window.__timelines[id]` | optional; any paused GSAP timeline created at load is driven |
| CSS animations, WAAPI | the same; delays are from t = 0 of the video in both |
| Lottie | lottie-web by classic `<script>`; Kodecz drives every registered animation |
| Three.js, canvas, custom frame adapter | `window.kodecz_frame = (n, ms) => { … }`, depending only on `n` |

## Command mapping

| HyperFrames | Kodecz |
|---|---|
| `npx hyperframes render -o out.mp4` | `kodecz render my-video/ launch out.mp4` (GPU when there is one, CPU when not) |
| `--fps 60` | `"fps": 60` in the block (and recompute every frame number) |
| `--format webm` / `mov` for transparency | `--alpha` (raw HEVC with alpha, GPU only, no audio) |
| `--format mp4` H.265 | `--hevc` (GPU only) |
| `--workers` | not needed: one Chromium draws, the GPU path never copies frames to the CPU |
| `npx hyperframes preview` | `kodecz preview my-video/ launch --frame 0,45,90` (PNG per frame) |
| `npx hyperframes lint`, `check` | `kodecz check my-video/ launch` (face, one-line captions, safe area, contrast, zoom timing; JSON, exit 4 on a broken rule) |

## Verify the port frame by frame

1. Pick times that matter: 0, each clip's first and last frame, the middle of each transition, the last frame.
2. HyperFrames side (if it still runs): its snapshots at those times (`npx hyperframes check --snapshots --at …`).
   Kodecz side: `kodecz preview my-video/ launch --frame <the same moments in frames>`.
3. Look at the pairs. A clip one frame early or late is a rounding of seconds to frames: round the same way
   everywhere. A clip that never appears usually lost its scene animation; a timeline that does not move was created
   after load or GSAP is not on `window.gsap`.
4. `kodecz check my-video/ launch` exits 0, then `kodecz render`.

## Licenses

HyperFrames is Apache-2.0. Files copied from it (catalog blocks, examples) keep their copyright and Apache-2.0 notice
in the project. HyperFrames is a project of HeyGen; Kodecz is not affiliated with it.
