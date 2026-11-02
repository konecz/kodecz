# Measurements

The numbers in the README. Every number published about Kodecz comes from a run recorded here.

## Kodecz, HyperFrames and Remotion, same day (2026-11-02)

The first measurement of HyperFrames, with Remotion again on the same day so the three are comparable.

- **Machine:** 16 cores, RTX 5090 (shared with other services; nearly idle, checked with `nvidia-smi` first), Ubuntu,
  NVIDIA driver 595.99.02, ffmpeg 8.0.1. Every render ran alone under the exclusive GPU lock, with the usual
  containment (nice 19, idle I/O, a cap of 8 cores) for all renderers alike. Other services kept running: the load
  average before each render was between 3.4 and 9.9.
- **Renderers**, each at its official defaults:
  - **Kodecz** at `main` `5c9fbc7`: `--placa` (GPU: texture → NVENC, H.264) and `--cpu` (software paint → x264
    `veryfast`, CRF 18; no GPU device inside its sandbox).
  - **HyperFrames** 0.9.2 (`npx hyperframes render`): defaults are automatic workers (5 here), the «looks» quality
    (x264, CRF 16, slower preset), `beginframe` capture, and Chrome on the GPU when it finds one («hardware gpu» in
    its log). Also measured: the same with no GPU device visible (`bwrap` with a fresh `/dev`; it falls back to
    SwiftShader, «software gpu»: what it does on a machine without a GPU), and with `--gpu` (its NVENC option).
  - **Remotion** 4.0.536 (`npx remotion render`), defaults (x264 CRF 18), presenter only.
- **Method:** a warm-up round, then 3 measured rounds with the order of the renderers rotated every round. CPU = user +
  system time of the whole process tree, from the cgroup of the render's own scope (every browser and ffmpeg process
  included); wall = start to MP4 on disk; peak memory of the same cgroup. The medians are in bold, every round in
  parentheses.
- **Quality:** SSIM of every frame against HyperFrames' default render (round 1) and, for the presenter, against
  Remotion's.
- **Cases** (`scripts/comparar/casos/`, synthetic, written by us in each format; the same CSS, times and Web
  Animations on every side):
  - **Presenter**, 1920×1080, 150 frames: the case of 2026-10-30. A generated presenter video with its sound, a lower
    third and word-by-word captions.
  - **Audiogram**, 1080×1080, 814 frames: a cover, a title, 48 waveform bars (one keyframe per frame), a progress bar
    and captions over a generated voice-like tone. Written for this comparison; it is not Remotion's audiogram template
    of 2026-10-30 (Remotion License), so Remotion does not run it.

| Case | Renderer | CPU (s) | Wall (s) | Peak memory | Size | SSIM vs. HyperFrames, mean / min |
|---|---|---|---|---|---|---|
| Presenter, 1080p, 150 frames | **Kodecz, GPU** | **2.0** (2.0 / 2.3 / 2.0) | **2.7** (2.7 / 3.1 / 2.5) | 0.48 GB | 1.00 MB | 0.9976 / 0.9973 |
| | Kodecz, `--cpu` | 28.1 (28.1 / 27.9 / 28.1) | 7.1 (7.6 / 6.8 / 7.1) | 1.60 GB | 0.75 MB | 0.9972 / 0.9968 |
| | HyperFrames, defaults | 22.0 (21.8 / 22.0 / 22.2) | 6.4 (6.4 / 6.8 / 6.3) | 1.22 GB | 1.62 MB | reference (0.9996 / 0.9991 across rounds) |
| | HyperFrames, no GPU | 26.3 (26.3 / 26.0 / 26.5) | 6.8 (7.0 / 6.8 / 6.8) | 1.25 GB | 1.63 MB | 0.9994 / 0.9993 |
| | HyperFrames, `--gpu` | 14.8 (14.8 / 14.0 / 14.8) | 6.6 (6.6 / 6.6 / 6.6) | 0.79 GB | 2.69 MB | 0.9993 / 0.9991 |
| | Remotion, defaults | 37.7 (37.7 / 39.0 / 36.6) | 9.9 (9.9 / 10.4 / 9.7) | 3.76 GB | 1.03 MB | 0.9969 / 0.9965 |
| Audiogram, 1080×1080, 814 frames | **Kodecz, GPU** | **7.0** (6.7 / 7.3 / 7.0) | **7.8** (6.9 / 8.2 / 7.8) | 0.55 GB | 5.10 MB | 0.9960 / 0.9951 |
| | **Kodecz, `--cpu`** | **24.6** (23.8 / 24.6 / 24.6) | **9.3** (9.3 / 9.3 / 9.7) | 0.98 GB | 2.85 MB | 0.9955 / 0.9947 |
| | HyperFrames, defaults | 47.4 (47.7 / 47.3 / 47.4) | 10.8 (10.7 / 10.8 / 10.8) | 1.11 GB | 3.23 MB | reference (0.9996 / 0.9988 across rounds) |
| | HyperFrames, no GPU | 59.9 (59.9 / 59.8 / 60.3) | 12.2 (12.2 / 12.4 / 12.2) | 1.07 GB | 3.17 MB | 0.9993 / 0.9988 |
| | HyperFrames, `--gpu` | 32.6 (32.9 / 32.6 / 32.1) | 10.3 (10.6 / 10.3 / 10.2) | 0.90 GB | 5.69 MB | 0.9996 / 0.9993 |

- **Kodecz on the GPU against HyperFrames' defaults:** **11× less CPU** (22.0 → 2.0 s) and **2.4× sooner** (6.4 →
  2.7 s) on the presenter; **6.8× less CPU** (47.4 → 7.0 s) and **1.4× sooner** (10.8 → 7.8 s) on the audiogram.
  Against HyperFrames' own `--gpu`: 7.4× and 4.7× less CPU.
- **On the CPU only, HyperFrames wins the presenter.** Kodecz `--cpu` used 28.1 s of CPU against 22.0 s for
  HyperFrames' defaults and 26.3 s for HyperFrames with no GPU (1.07× more), and took 7.1 s against 6.4 and 6.8 s.
  Kodecz paints the embedded 1080p video in software (SwiftShader); HyperFrames extracts the video's frames with
  ffmpeg once and caches them. Without that cache (`--frames-cache-dir off`, a separate series of 3 rounds alternated
  with Kodecz `--cpu`), HyperFrames took 25.4 s (25.7 / 25.2 / 25.4) of CPU and 7.0 s of wall, against 28.0 s and
  7.1 s for Kodecz `--cpu` in the same series: still ahead.
- **On the CPU only, Kodecz wins the audiogram:** 24.6 s of CPU against 59.9 s for HyperFrames with no GPU (**2.4×
  less**) and 47.4 s for its defaults (1.9× less), and 9.3 s of wall against 12.2 and 10.8 s.
- **Remotion, same day:** 37.7 s of CPU and 9.9 s of wall on the presenter, below the 43.7 s and 13.6 s of
  2026-10-30; Kodecz on the GPU also went from 4.4 s to 2.0 s since then. Same day, Kodecz on the GPU used 19× less CPU
  than Remotion and finished 3.7× sooner. HyperFrames' defaults used 1.7× less CPU than Remotion.
- **Encoders are not the same:** HyperFrames' default x264 settings (CRF 16, a slower preset) spend more CPU per frame
  than Kodecz `--cpu` (CRF 18, `veryfast`) and give a bigger file (1.62 against 0.75 MB on the presenter). Part of
  HyperFrames' CPU is that choice; we measured each renderer as it ships.
- **Image:** no frame of any pair falls below 0.994, and the presenter renders of all three tools sit between
  0.9965 and 0.9983 of each other: the same video. HyperFrames' rounds sit at 0.9991 or above of each other.
- **Determinism** (MD5 of the video stream over the 3 rounds): identical in every round for Kodecz `--placa` and
  `--cpu`, every HyperFrames mode and Remotion on the presenter; on the audiogram, identical for Kodecz `--cpu` and
  HyperFrames with no GPU, and different between rounds for Kodecz on the GPU and HyperFrames' defaults and `--gpu`
  (animated text over a GPU raster, the up-to-2-levels variation the README describes).
- **Caveats:** the GPU is shared and the CPU serves other sites (load 3.4 to 9.9), which raises every wall time a
  little but hit all renderers alike, in alternating order; the rounds of each renderer stay within 8 % of each other,
  except Kodecz on the GPU, whose short runs vary more (2.0 to 2.3 s of CPU, 2.5 to 3.1 s of wall on the presenter). The compositions are ours, written in each format by the Kodecz authors, so a HyperFrames or Remotion expert
  might write them differently; the SSIM above shows they draw the same frames. HyperFrames reuses its frame cache
  across renders by default (the cold series above shows the cost without it).

To reproduce (needs Kodecz installed with `./instalar.sh`, `ffmpeg`, `bwrap`, `systemd --user` and Node 24; HyperFrames
and Remotion are installed, pinned, into the work folder `~/.cache/kodecz/comparar`, outside the repository):

```bash
scripts/comparar/comparar.sh 3                                          # all cases and renderers, 3 rounds
CASOS=apresentador LADOS="hyperframes-frio kodecz-cpu" scripts/comparar/comparar.sh 3   # the cold-cache series
```

It prints the table above (`scripts/comparar/resumir.mjs`). The renders, logs, `medidas.jsonl` and the per-frame SSIM
files stay in the work folder.

## Kodecz against Remotion, synthetic compositions (2026-10-30)

- **Machine:** RTX 5090 (shared, measured under a GPU lock while nearly idle), Ubuntu, NVIDIA driver 595.
- **Method:** two alternating runs per codec; CPU = user + system time of the whole process tree; wall = start to
  MP4 on disk. Remotion is its official renderer at the same settings.
- **Quality:** SSIM of every frame against Remotion's render.

| Case | Renderer | CPU (s) | Wall (s) | Size | SSIM vs. Remotion, mean / min |
|---|---|---|---|---|---|
| Presenter, 1080p, 150 frames | Remotion | 43.7 | 13.6 | — | — |
| | Kodecz, H.264 | 4.4 / 4.7 | 4.6 / 5.0 | 1.03 MB | 0.9981 / 0.9978 |
| | Kodecz, HEVC | 4.2 / 4.3 | 4.4 / 5.1 | 0.91 MB | 0.9982 / 0.9980 |
| Audiogram, 1080×1080, 814 frames | Remotion | 48.1 | 17.0 | — | — |
| | Kodecz, H.264 | 14.6 / 14.2 | 18.5 / 18.0 | 7.78 MB | 0.9968 / 0.9939 |
| | Kodecz, HEVC | 13.5 / 14.6 | 17.9 / 18.5 | 7.70 MB | 0.9967 / 0.9938 |

- Both codecs sit at the same distance from Remotion's own run-to-run floor (0.9991 to 0.9994), and no frame falls
  below 0.99. The video stream is identical across runs of the same codec.
- The audiogram was written for Remotion and runs through a compatibility layer, so it saves CPU but not wall time.
  That layer is being removed; the case will be measured again in the Kodecz format.

## Presenter composited on the GPU (2026-10-30)

Decoding the presenter video with NVDEC and blending it under the page before NVENC, instead of decoding it inside
the browser: **62 to 67 % less CPU and 36 % less wall time**; with an animated zoom on the presenter, **81 % less CPU
and 50 % less wall time**.
