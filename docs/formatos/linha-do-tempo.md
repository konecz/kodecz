# Format: the declared timeline composition

What Kodecz renders: a plain HTML page with declared animations, which Kodecz puts at frame N. Minimal and complete
example: `cli/fixtures/linha-sintetica/index.html`.

## Folder

- `index.html` at the root, with the declaration block. Everything else (CSS, JS, images, fonts) lives in the same
  folder and is served over local HTTP; the network outside is blocked (Google Fonts only through a local cache; a
  missing one is downloaded once by the render).
- The block is the `<script>` with `id="kodecz"` and `type="application/json"`, outside any comment:

```html
<script type="application/json" id="kodecz">
{ "id": "MyComposition", "width": 1920, "height": 1080, "fps": 30, "frames": 300 }
</script>
```

| Field | Rule |
|---|---|
| `id` | text; the `<composition>` argument of the commands must be equal to it |
| `width`, `height` | px, even integers up to 8192 (the NVENC limit); width ≥ 800 (the frame mark is 800 px wide), height ≥ 16 |
| `fps` | frames per second, integer from 1 to 240 |
| `frames` | length in frames, integer ≥ 1 |

**Original names.** The block was born with Portuguese names, still accepted: `id="motor-video"`, `largura` (width),
`altura` (height), `qps` (fps) and `quadros` (frames). Old and new names can be mixed; the same field under both
names with different values is an error. Write new compositions with the English names.

## Animation

- Every animation of the page on `document.timeline` counts: CSS `@keyframes` (`animation:`) and
  `element.animate()`. They all start at t = 0 of the video; the moment one enters is its `delay` (or
  `animation-delay`).
- `document.timeline` is stopped from before the page loads: nothing moves on its own, not even a short animation
  without `fill` while the page takes time to be ready.
- At frame N, Kodecz pauses each animation and sets `currentTime = N × 1000 / fps`, also on the ones that already
  ended without `fill`. The frame depends only on N: starting in the middle (`--from`) or out of order gives the same
  frame. One caveat: with GPU rasterization, a blurred shadow (`box-shadow`) can vary by up to 2 levels depending on
  the path to the frame.
- `will-change` can be used (its own layer, grayscale text antialiasing). Kodecz removes the transform hint
  (`transform`, `translate`, `rotate`, `scale`, `perspective`, `transform-style`) and puts `left` in its place: with
  the hint, Chromium kept the layer's raster at the position where it first appeared, and frame N depended on where
  the render started (up to 98 levels on the edge of text). The own layer, the stacking context and the containing
  block stay (the latter through a `translate: 0px` that loses to any rule of the page); a child's `backdrop-filter`
  still sees the page. The swap follows what the page changes (class, `style`, a new element or stylesheet) and is
  undone when the hint goes away. The render summary counts the swapped elements at the end in `camadasNeutras`. A
  moving layer is rasterized again on every frame, as without `will-change`.
  Out of reach (the hint stays and starting in the middle can differ): pseudo-elements (`::before`, `::after`),
  shadow DOM, iframes, a hint that changes through a sibling selector (`+`, `~`, `:has()`) or an inherited variable.
- Time in frames in CSS: with `:root { --fps: 30 }`, `animation-delay: calc(var(--start) * 1s / var(--fps))` lands
  exactly on the frame (checked from 24 to 60 fps; it is how the blocks do it, `blocos/INDICE.md`).
- `@keyframes` with a `var()` that a script sets after the page has computed its style can be born without the value
  (seen now and then): for values a script computes, use `element.animate()`.
- What is not animation (canvas, WebGL, text changed by JS) goes in the optional hook `window.kodecz_frame(n, ms)`,
  called before the animations; it can return a Promise. It must depend only on `n`, never on the previous frame or
  on the clock. The original name, `window.motor_quadro`, still works.
- Do not use `requestAnimationFrame`, `setTimeout`/`setInterval` to animate, or `Date.now()`/`performance.now()`
  (the clock keeps running). A scroll animation (`ScrollTimeline`) or one on another `DocumentTimeline` does not move
  with N: it stays still, counted in `animacoesSoltas` in the command's JSON, with a warning on stderr. CSS
  transitions jump to their end (counted in `transicoesAoFim`).

## GSAP and Lottie

The format is **compatible** with pages that use GSAP or Lottie (lottie-web): **you bring the library** in your
folder, like any other file. Kodecz does not ship either of them, and its blocks do not generate GSAP code (the GSAP
license is not compatible with Apache-2.0). Apart from the declaration block, the page stays as you wrote it.
Examples: `cli/fixtures/linha-gsap/index.html` and `cli/fixtures/linha-lottie/index.html` (without the library; the
tests copy it from a local cache, `cli/fixtures/bibliotecas.ts`).

**GSAP** (3.x, the UMD file loaded by `<script src="gsap.min.js">`, which sets `window.gsap`):

- Before the page's scripts, Kodecz watches `window.gsap`: when GSAP arrives, its root timeline is paused at 0 and
  stops removing animations that end. The GSAP ticker does not move anything on its own.
- Every animation created while the page loads starts at t = 0 of the video (the moment it enters is its `delay` or
  its position in the timeline). At frame N, Kodecz puts the root at time N / fps; a paused top-level animation
  (`gsap.timeline({ paused: true })`, for example) goes to time N / fps counted from its own start, without the page
  calling `play`.
- `onUpdate` and the other callbacks work (a counter that writes its text from `onUpdate` comes out right).
- Starting in the middle, out of order and with jumps gives the same frame, as with Web Animations; frame 0 is always
  the one of going back to 0.
- These stop the render, with the reason: GSAP outside `window.gsap` (an ES module without `window.gsap = gsap`
  before creating the animations; GSAP leaves a trace in `window.gsapVersions`), more than one GSAP on the page, and
  GSAP arriving at `window.gsap` with animations already created.
- Do not use: animations created after the page loads (in a `setTimeout`, an event or an `onComplete`: they would
  start at whatever time the root is at), `gsap.ticker.add` (the ticker sleeps during the render), ScrollTrigger and
  other plugins that depend on scrolling or the mouse.

**Lottie** (lottie-web 5.x, through `<script src="lottie.min.js">`, which sets `window.lottie`;
`lottie.loadAnimation` with `animationData` or `path` to a JSON in the folder):

- Before the first frame, Kodecz waits for every registered animation to load (`DOMLoaded`; one that fails stops the
  render) and freezes the lottie-web loop (`lottie.freeze()`).
- At frame N, each animation goes to its frame `N × fr × speed / fps` (`goToAndStop(…, true)`, with sub-frames): with
  `loop: true`, it goes back to the start every `totalFrames`; with `loop: k`, it plays k + 1 times; without a loop
  (or after the last one), it stops at the last frame (`totalFrames − 1`), like lottie-web. It starts at t = 0 of the
  video.
- Playing backwards (`setDirection(-1)`), segments (`playSegments`) and animations created after the page loads do
  not follow N. Every registered animation moves with N, also one with `autoplay: false`.
- lottie-web bundled in a module (without `window.lottie`) is not seen and would run on the clock, without an error:
  load `lottie.min.js` with `<script>`. Images inside a Lottie (SVG renderer) are not waited for.

GSAP limits, also without an error: a top-level timeline paused on purpose moves with N anyway. GSAP 2 (`TweenMax`,
`TweenLite`) stops the render.

## Still frames

On the GPU, Kodecz does not draw again a frame in which nothing moves: it repeats the previous one in the video,
without going through the page. What moves is said by the animations themselves: the interval of each one (`delay`
to the `endTime` of `getComputedTiming()`, endless if it repeats forever). So:

- it only works without `window.kodecz_frame`: with the hook, Kodecz cannot know what it changes and draws every
  frame (`repetirNao: "kodecz_frame"` in the JSON, or `"motor_quadro"` with the original name); the same with an
  animation outside `document.timeline`;
- with GSAP or Lottie on the page, it also draws every frame (`repetirNao: "GSAP"` or `"Lottie"`): Kodecz does not
  read what they change;
- SVG SMIL (`<animate>`, `<animateTransform>`, `<animateMotion>`, `<set>`) and an `<img>` that may be animated (GIF,
  APNG, animated WebP; by extension, so also `.png` and `.webp`) change without `document.timeline`: with them on the
  page, Kodecz draws every frame (`repetirNao: "SVG SMIL"` or `"imagem que pode ser animada (GIF, APNG, WebP)"`);
- an animation counts as moving during its whole interval, even when its value stands still (`from, to { opacity: 1 }`
  during a scene): Kodecz draws all those frames. To turn something on and off, use two zero-length animations with
  `forwards`, one at the start and one at the end (the later one wins), as in `blocos/cena/bloco.css`;
- other than that, what changes must be an animation. A change outside one is not seen and can come out still (a
  script on the clock, already forbidden above);
- embedded video changes the frame without an animation: from its first frame (`data-inicio`) to the one that clears
  the canvas (`data-inicio` + `data-quadros`), Kodecz draws every frame; outside that span, it repeats. Audio (from
  `<audio>` or `<video>`) does not prevent it: Kodecz mixes it by the declared times, also on repeated frames;
- starting in the middle or out of order, it only repeats a frame that comes right after the previous one; after
  repeated frames, the next drawn one does not need N − 1 first (nothing changed since the last drawn one);
- `MOTOR_REPETIR=0` draws every frame (to check or to measure).

## Images and fonts

- Before the first frame, Kodecz waits for the fonts (`document.fonts.ready`) and for every `<img>` to decode; on
  each frame, also for an `<img>` added or changed later (by `kodecz_frame`). An image that fails to load stops the
  render.
- A CSS background image (`background-image`) is not waited for: use an `<img>` (with `object-fit`) for what must be
  there on the first frame.

## Background and alpha

Kodecz does not touch the page background. With `--alpha`, what the page does not paint is transparent; for a
graphics layer, leave `html` and `body` without a background. Without `--alpha`, transparent comes out black.

## Video and audio

The `<video>` and `<audio>` elements in the document when the page finishes loading (in the HTML or added by its
scripts; not those in a `<template>` nor those created later) go into the render. Minimal example:
`cli/fixtures/linha-video/index.html`.

```html
<video class="screen" src="presenter.mp4" data-inicio="0" data-recorte="12" data-quadros="225"></video>
<audio src="music.wav" data-inicio="30" data-volume="0.6"></audio>
```

| Attribute | Rule |
|---|---|
| `src` | a file inside the composition folder (Kodecz serves only that folder; a symlink to elsewhere works). No `<source>` |
| `data-inicio` | start: the composition frame where the media starts, integer ≥ 0 (default 0) |
| `data-recorte` | trim: how many frames, at the composition's fps, to cut from the start of the media (default 0), like Remotion's `trimBefore` |
| `data-quadros` | frames: how many composition frames it lasts, integer ≥ 1 (default: to the end of the media or of the composition; with a speed, (duration × fps − trim) / speed) |
| `data-volume` | a fixed volume, from 0 to 10 (default 1), or `frame:volume` points, like `"0:0 6:1 580:1 600:0"`: the frame is counted from the start of the media in the composition (0 = `data-inicio`) and grows; between two points, a straight line; before the first and after the last, the volume at that end |
| `data-velocidade` | speed of the media, a number from 0.1 to 10 (default 1): 2 plays twice as fast, 0.5 half. The audio speeds up without changing pitch |
| `muted` | no sound (the video shows; its audio is not mixed) |

The media attributes still have their Portuguese names; English names will come with the same kind of alias.

- **Video frame:** at composition frame N, the time in the video is
  t = (N − `data-inicio`) × `data-velocidade` / fps + `data-recorte` / fps; t goes to the nearest tick of the video's
  time base, and the frame shown is the last one that starts at or before that tick (pts counted from the first
  frame, no slack). It is the rule of Remotion's `<OffthreadVideo>` (4.0.536), checked frame by frame with 24, 25,
  29.97 and 30 fps videos in 25, 30 and 60 fps compositions, with and without start and trim. At the same fps and
  speed 1, it is exactly frame N − start + trim; 29.97 in 30 gives frame N − 1 from frame 1 on; at speed 2,
  2 × (N − start) + trim; at 1.1, the floor of 1.1 × (N − start) + trim. The trim counts in the media, without the
  speed. It depends only on N; starting in the middle (`--from`) shows the same frame. It holds on both paths (the
  canvas and NVDEC).
- **MP4 timestamps:** frame N comes out at exactly N / fps (90 kHz time base), without drift. To compare with another
  render, match by frame index or by time; both give the same pair.
- **Kodecz decodes the video**, not Chromium's `<video>`: one ffmpeg per video, in order, hands over the frame in
  I420; the page builds the `VideoFrame` and converts the color with the same math as Remotion's video
  (`composicao/cor-limpa.js`, spec in `conversao-de-cor.md`). The `<video>` becomes a `<canvas>` of the video's size,
  with the same attributes (`class`, `id`, `style`, `data-*`, except the media ones and `width`/`height`) and
  `data-motor-video`. Style it by class or id, not with the `video` selector; its size on screen comes from CSS
  (`object-fit` works on the canvas). Outside the media's span, the canvas is transparent.
- **On the GPU, the video goes under the page:** H.264 or HEVC is decoded by NVDEC and composited under the page
  texture before NVENC, with the same color math; the canvas stays transparent. This holds on a frame where the video
  is at 1:1 size, on whole pixels, positioned (`position` other than `static`), with no opacity, filter, mask, rounded
  clip or transform other than a translation on it or on its ancestors, and nothing painted under it except the
  background color of the root, of an ancestor that covers the whole frame or of an ancestor the video covers.
  A scaled video and the **rounded-corner card** also go through the GPU: an ancestor with `overflow` other than
  `visible` and `border-radius` (all four corners equal, circular, the box on whole pixels, without `border` or its
  own background), with `box-shadow` (outer) and `outline` (outer, `outline-offset` ≥ 0) on it. Nothing positioned
  after the video may cross the corners (a strip over a corner sends the frame to the canvas), except the background
  of an almost opaque element (90 % or more, no shadow or filter, no opacity on its ancestors) that covers the whole
  corner, with its text and no other element in the same corner (a caption passing by the card's corner). With text
  in the corner, up to 3 levels in up to 2 pixels per frame against the canvas.
  On other frames (an entrance with scale or opacity, for example), Kodecz decodes on the CPU and draws the canvas,
  as above; the result is the same. One video per frame goes through the GPU. `MOTOR_TAKE_PLACA=0` sends all of them
  through the canvas.
- **Accepted video:** 8-bit 4:2:0 (`yuv420p`, `yuvj420p`), even width and height, square pixels, no rotation in the
  metadata; matrix bt709, bt601, smpte240m or bt2020 (untagged: bt709 at 720 lines or more, like Remotion). Anything
  else stops the render with the reason.
- **Audio:** `<audio>` leaves the page. The sound of every `<audio>` and of every `<video>` without `muted` is mixed by
  Kodecz with the declared times (a single ffmpeg pass, `composicao/audio.ts`), as AAC 320 kbit/s in the MP4.
  `--no-audio` turns it off. With `data-velocidade`, the media's sound is sped up by ffmpeg's `atempo`, which changes
  the duration without changing the pitch (chained in roots when the speed is outside 0.5 to 2, like Remotion), and
  starts at the media's `data-recorte`; volume points count in composition frames. Looping does not exist yet.
- **Variable volume:** with points, each frame takes the volume of the line at that frame (the math of Remotion's
  `interpolate`), reached exactly at the frame's instant; between two frames the volume follows the straight line
  sample by sample, so a ramp is smooth. This differs from Remotion, whose volume is constant within the frame and
  rounded to 97 steps: ffmpeg's `volume=…:eval=frame` evaluates it once per audio block (about 1024 samples), so a
  ramp came out in steps and a step could click (a music track ducking under a voice). A frame with volume 0 leaves
  the mix, as in Remotion. The ramp `interpolate(f, [0, 6, total − 20, total], [0, 1, 1, 0])` of a
  Remotion volume function becomes `data-volume="0:0 6:1 <total − 20>:1 <total>:0"`.
- **In a normal browser** (the author's own preview), `<video>` and `<audio>` play on their own and do not follow the
  attributes; what counts is the render.

## Destination: `data-destino`

The video's destination goes on `<html>`: `<html data-destino="reels">`. Values: `reels`, `instagram`, `anuncio` (ad),
`tiktok`, `shorts`, `youtube` (lowercase, no accents; the check also accepts `Reels` or `anúncio`). The render ignores
the attribute; the automatic check reads it (`docs/formatos/conferencia.md`) after the page is ready, so whatever a
script of the composition sets on `document.documentElement` also counts. For destinations with the app's interface
on top (`reels`, `instagram`, `anuncio`, `tiktok`, `shorts`), the safe area (G19) is checked; without the attribute,
or with another value, it is not.

## Not there yet

Values passed from outside (`--props` belonged to the Remotion input, removed in 2026-10-31); looping media.
