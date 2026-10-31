# Measurements

The numbers in the README. Every number published about Kodecz comes from a run recorded here.

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
