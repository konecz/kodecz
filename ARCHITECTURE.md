# ARCHITECTURE.md

Map of the code and its invariants. Kodecz renders a composition declared as a timeline (a folder with `index.html`
and the `<script type="application/json" id="kodecz">` block, `docs/formatos/linha-do-tempo.md`) with
`cli/render.ts`, on the GPU or on the CPU, capturing each frame from Chromium through CEF. The command imports only
from `captura/`, `composicao/`, `nativo/`, `cli/` and `ferramentas/contencao.mjs`.

The public interface is in English: the `kodecz` command (`cli/kodecz.ts`, the `bin` of `package.json`) with
`render`, `preview` and `check`, its options, the block fields and `window.kodecz_frame`. `cli/nomes.ts` maps each
English name to the original Portuguese one, which the code still uses inside and which is still accepted
(deprecated). Names inside the code are Portuguese (`quadro` = frame, `qps` = frames per second, `placa` = GPU,
`conferência` = automatic check, `prévia` = preview). The code comments cite internal item IDs (P10, S04, C01...); they name the piece of work that introduced
the code and can be ignored.

## Map

| Path | What it is |
|---|---|
| `cli/` | Commands. `kodecz.ts` (the `kodecz render\|preview\|check\|prepare` entry, runs the scripts below in the same process), `nomes.ts` (English names → original ones), `render.ts` (render), `regras.ts` (arguments, GPU probe, GPU/CPU choice), `processos.ts` (process groups, temporary folders, signals), `sonda-nvenc.ts` (opens and closes Vulkan and NVENC), `abertura.ts` and `navegador-em-espera.ts` (warm render: `render.ts --esperar` opens the browser before the job and reads the job from stdin), `brilho.ts` (per-frame brightness and flash warning). Media steps around a render: `preparar.ts` (`kodecz prepare voice\|words\|interpolate\|loudness`, docs/formatos/preparo.md), `alinhar.ts` (script ↔ recognizer word alignment), `whisper-palavras.py` (faster-whisper, run in the user's Python). Preview: `previa.ts`. Reference frames: `referencias.ts` and `quadros.ts` (lossless PNG, the frame-equality rule, SSIM). Automatic checks: `conferir.ts`. Test compositions in `cli/fixtures/`. TypeScript run directly by Node 24 (type stripping, no build). |
| `captura/` | The capture, run by Node on top of the CEF host: `main.ts` (off-screen window with the frame `moldura.html`, puts the timeline at frame N, checks the frame mark; GPU mode: texture → Vulkan → NVENC through `nativo/`; CPU mode: `paint` → x264), `faixa.ts` (frame mark read in JS), `fontes.ts` (Google Fonts from a local cache, downloaded once), `marca-video.ts` (mark of the synthetic test video), `codificador-cpu.ts` and `codificadores.ts` (x264 for the CPU mode). `main.ts` uses a subset of the Electron API, implemented over CEF by `captura/cef/electron-cef.ts`. `package.json` holds only an unmodified Electron, used by the automatic checks and one playback test, which need H.264 decoding inside the page (the stock CEF build has no proprietary codecs). |
| `captura/cef/` | The only capture path. Native host in Rust (`src/main.rs`, Tauri's `cef` crate): off-screen rendering with shared textures, each dma-buf handed to the `nativo/` core (included with `#[path]`, N-API in `noop` mode), a separate executable for Chromium's child processes (`src/filho.rs`). Controller in TypeScript: `host.ts` (starts the host and speaks the protocol of `src/protocolo.rs`: commands on stdin, events on stdout, synchronous operations over a pair of FIFOs), `electron-cef.ts` and `nativo-cef.ts`, `ganchos.ts` (runs `captura/main.ts` with `electron` and `nativo.node` swapped). `preparar-cef.sh` downloads and verifies CEF outside the repository; `montar.sh` builds the host. Without an NVIDIA driver the host is built without the `placa` Cargo feature and only does the CPU mode. |
| `composicao/` | The page side: `audio.ts` (collects and mixes the audio in one ffmpeg pass, checked against recorded reference values in `fixtures/audio-remotion.json`), `midia-linha.ts` (`<video>` and `<audio>` of the timeline: probe, decode, the right video frame for frame N), `parados.ts` (repeated frames), `cor-limpa.js` (YUV → RGB conversion, written from the specification in `docs/formatos/conversao-de-cor.md` and injected in the page), `take-placa.js` (page side of the GPU video compositing). |
| `nativo/` | Native module in Rust: dma-buf → Vulkan → NVENC, the queued capture, repeated frames written as skipped P-frames (`pulado.rs`), video decoded with NVDEC and composited under the page on the GPU (`nvdec.rs`, `mistura.rs`), per-frame brightness before NVENC (`brilho.rs`), `lerMarca` and `versao`. Built into `target/` and copied to `nativo/nativo.node` (not in Git). |
| `instalar.sh`, `instalar/` | One-step install: `instalar.sh` checks Node 24 and calls `instalar/instalar.ts`; `sistema.ts` (prerequisites: driver ≥ 570, GPU, apt packages, Rust, disk; `--sistema` runs apt with sudo), `etapas.ts` (npm ci, native module and checks, idempotent by hash), `navegador.ts` (CEF and the host; the unmodified Electron of the checks), `caminhos.ts`. Ends with a probe and a test render. `instalar/sem-nvidia.sh` proves the CPU path in a container without a driver. See `instalar/LEIAME.md`. |
| `identidade/` | `design-md.ts`: reader and validator of a brand's `DESIGN.md` (tokens, prose sections, CSS variables; `conferir` and `css` commands). Format in `docs/formatos/design-md.md`; a fictional brand in `fixtures/`. |
| `blocos/` | Kodecz blocks: one folder per editing technique with `KODECZ.md` (metadata, rule, how to apply, checks), `bloco.css`, `bloco.html` (the snippet), `conferencia.json`, `exemplo.html` and `exemplo-errado.html`; `INDICE.md` is the entry point. `index.html` is a demo with every block (fictional brand in `marca/`, synthetic presenter from `gerar-midia.sh`). `conferir-dom.ts` and `conferir-dom.cjs` check the DOM at frame N through CEF. Only CSS and Web Animations, times in frames (`× 1s / var(--fps)`), colors and fonts from `DESIGN.md` tokens. |
| `conferencia/` | Automatic checks of the frames: `regras.ts` (the rules as pure functions), `conferir.ts` (runs the rules marked `conferencia` in `bench-gerador/especificacoes.json`), `falas.ts` (`window.motor_falas`), `rosto.ts` (YuNet face detection on `onnxruntime-node`, CPU), `geometria.js` (page script that reads the DOM), `coletar.ts` (the Electron process of the checks, CPU only, separate from the render), `preparar.ts` (model and test portrait in a cache, by hash), test compositions in `fixtures/`. Format in `docs/formatos/conferencia.md`. |
| `bench/`, `bench-gerador/` | Kodecz Bench: tasks for AI agents (`bench/`) and the case generator with the single rule set shared with the checks (`bench-gerador/especificacoes.json`, `motores.ts`, `casos.jsonl`). The class catalog is `docs/pesquisa/erros-de-agentes.json`. See `bench/LEIAME.md` and `bench-gerador/LEIAME.md`. |
| `ferramentas/contencao.mjs` | Optional CPU containment of the render (nice, ionice, CPU cap); on by default, `--sem-contencao` turns it off. |
| `skills/`, `.claude-plugin/`, `mcp/`, `server.json` | The agent distribution layer. `skills/` holds the Agent Skills (`kodecz`, `remotion-to-kodecz` with an original React shim in `references/`, `hyperframes-to-kodecz`), read by skills.sh and by the Claude Code plugin; `.claude-plugin/` has the plugin manifest (the plugin root is the repository root) and the marketplace; `mcp/kodecz-mcp.mjs` is a dependency-free MCP server over stdio that runs the installed `kodecz` command (`render`, `preview`, `check`); `server.json` is the MCP registry entry. `scripts/agentes.test.mjs` keeps them valid and consistent. Submissions in `docs/distribuicao.md`. |
| `ferramentas/medir-render.mjs` | Measures one render command (CPU of its cgroup, wall, peak memory) for the numbers in `docs/medidas.md`. |
| `docs/formatos/` | File format specifications: the timeline (`linha-do-tempo.md`), the brand file (`design-md.md`), reference frames (`referencias.md`), color conversion (`conversao-de-cor.md`), automatic checks (`conferencia.md`), preview (`previa.md`) and per-frame brightness (`brilho.md`). |
| `docs/licencas/` | Third-party notices and the Rust crate list. |
| `scripts/` | `marca.mjs` (brand assets), `trazer-do-motor.sh` (imports the engine code from the internal repository it was developed in, with the opening audit) and `comparar/` (the measured comparison with HyperFrames and Remotion, [`docs/medidas.md`](docs/medidas.md)). |

## Render command

```
kodecz render <folder> <id> <out.mp4> [--gpu | --cpu] [--hevc] [--alpha] [--from N --frames N] [--no-audio]
kodecz render --help
```

Same as `node cli/render.ts …`; the original options (`--placa`, `--alfa`, `--de`, `--quadros`, `--sem-audio`…) are
still accepted.

- **Mode:** `--gpu` (texture → Vulkan → NVENC), `--cpu` (software paint over black, x264) or neither: the probe
  looks for the NVIDIA render node, `/dev/nvidiactl`, weston, the CEF host and `nativo.node`, and opens NVENC with
  the render's codec. Without an NVIDIA GPU it falls back to the CPU with a warning; with a GPU that cannot be used
  right now (no NVENC session, VRAM full, a missing piece), it exits with 3. `--gpu` without a GPU exits with 3.
- **Codec:** H.264 by default in both modes (High profile, 4:2:0, no B-frames, `avc1`, `faststart`). `--hevc` gives
  HEVC in MP4, GPU only. `--alpha` writes a raw HEVC layer with alpha (`.hevc`, GPU only, no audio).
- **Output:** MP4 with video and, if the composition has any, AAC audio. The file is assembled as a partial and
  checked (frames, audio duration) before it is moved into place; if the check fails, it exits with 1 and no output.
  One JSON line with the result on stdout; errors on stderr, starting with `erro:`.
- **Resources:** every child (weston, the capture with the CEF host and Chromium, ffmpeg) runs in its own process
  group, killed at the end, on error and on SIGTERM/SIGINT; temporary files and the partial output are removed
  (`--manter` keeps the temporary folder).
- **Repeated frames:** on the GPU, a frame that the animations' intervals say is equal to the previous one goes into
  the stream as a skipped P-frame written by Kodecz, without page, copy or NVENC. `MOTOR_REPETIR=0` draws every
  frame; `MOTOR_PULADO=0` goes back to repeating through NVENC.
- **Warm start (`--esperar`, used by the preview):** probes, starts weston and the browser, prints
  `{"evento":"pronto",...}`, then reads one job from stdin and runs it like a cold render.

## Preview

```
kodecz preview <folder> <id> --frame 30 | 0,45,120 [--out x.png | folder]
kodecz preview <folder> <id> --watch [--frame 0,45,120] [--serve [--port N]]
```

The frame comes from `cli/render.ts --gravar` (the render loop does not change) and becomes a lossless PNG.
`--watch` re-renders on every change, keeping a warm render in reserve; `--serve` serves a page on 127.0.0.1
with the frames. Format and timings in `docs/formatos/previa.md`.

## Reference frames

```
node cli/referencias.ts aprovar  <folder> [<id>] [--lista 0,30,59 | --cada N] [--placa | --cpu] [--por name]
node cli/referencias.ts conferir <folder> [<id>] [--placa | --cpu] [--cruzado] [--diferencas <folder>]
```

`aprovar` stores lossless PNGs and `referencias.json` next to the composition; `conferir` compares with the
frame-equality rule (same hash, or at most 2 levels and SSIM ≥ 0.999). Exit codes: 0 passed, 1 regression, 2 usage,
3 the render failed. Format in `docs/formatos/referencias.md`.

## Automatic checks

```
kodecz check <folder> <id> [<folder> <id> ...] [--speech file.json] [--out folder] [--sample 10]
```

Checks, without rendering the video, the rules marked `conferencia` in `bench-gerador/especificacoes.json`: text off
the face, captions on one line, the safe area of a declared destination (`data-destino` on `<html>`), contrast over
the real background, a zoom that ends with the sentence, and a shake warning. Output: `conferencia.json` and one
picture per problem; exit code 4 when a rule is broken. Preparation: `npm ci --ignore-scripts` in `conferencia/` and
`node conferencia/preparar.ts`.

## Invariants

Each one has tests next to the code that creates it:

- Frame N depends only on the composition and on N: two renders of the same range have the same hash per frame,
  also starting in the middle and out of order. Kodecz draws N − 1 without capturing before every discontinuity,
  puts every animation it has seen at frame N, and replaces the transform hint of `will-change` (Chromium would not
  re-rasterize the layer with it). The same holds for GSAP and Lottie brought by the page.
- On the GPU, no frame is read back to the CPU.
- Every received texture is released; no child process (the capture, Chromium, ffmpeg) outlives the render.
- Queued capture: the stream comes out in frame order; closing waits for the NVENC queue, and an NVENC error reaches
  JavaScript.
- Repeated frames: the pixels equal those of a render that draws every frame, also with embedded video and audio,
  starting in the middle and out of order. With `MOTOR_PULADO=0`, the video is byte-for-byte the drawn one.
- Blocks: only declared animation (no clock, GSAP, SMIL, `kodecz_frame` or animated images), colors and fonts only
  through `var(--...)`; the demo renders the same twice on the GPU with repeated frames on.
- Warm start gives the same hash per frame as a cold render; each warm process serves one job.
- Automatic checks only read the composition, in a process separate from the render; nothing is left behind.
- CEF capture: frame N by the mark; the dma-buf never leaves the host on the GPU path; if the host dies during a
  synchronous operation, the controller fails at once.
- GPU video compositing: the frame with the video composited on the GPU equals the one from the canvas path (same
  color, same video frame by pts, within the frame-equality rule); geometry it cannot reproduce goes through the
  canvas.
- Preview: the PNG of frame N is frame N of the render.
- Tests use synthetic compositions only.

## Tests

- No GPU or browser needed: `node --test cli/nomes.test.ts cli/alinhar.test.ts cli/preparar.test.ts cli/brilho.test.ts captura/codificador-cpu.test.ts captura/faixa.test.ts
  captura/fontes.test.ts cli/midia-linha.test.ts cli/processos.test.ts cli/regras.test.ts composicao/audio.test.ts
  composicao/cor-limpa.test.ts composicao/parados.test.ts conferencia/falas.test.ts conferencia/regras.test.ts
  identidade/design-md.test.ts instalar/instalar.test.ts bench-gerador/expandir.test.ts`.
- Full suites (GPU and CEF host built): `node --test "cli/*.test.ts" "captura/*.test.ts" "composicao/*.test.ts"
  "blocos/*.test.ts" "conferencia/*.test.ts" "instalar/*.test.ts" identidade/design-md.test.ts "bench-gerador/*.test.ts"`;
  tests that need the GPU are skipped without one.
- Native module: `cargo test --release -- --test-threads=1` in `nativo/`.
- CEF host protocol: `captura/cef/montar.sh test --bin motor-captura protocolo`.
- GSAP and Lottie tests use libraries downloaded into a local cache by `node cli/fixtures/bibliotecas.ts`; without
  them they are skipped with the reason.
