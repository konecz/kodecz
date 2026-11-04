# Third-party notices

Kodecz is licensed under the Apache License 2.0 ([`LICENSE`](../../LICENSE)). It depends on the components below,
each under its own license. Nothing here is vendored in this repository unless the table says so; versions are the
ones pinned in the manifests and lockfiles. The repository ships source code only: you compile the native module and
the Chromium host yourself, and `npm ci` downloads the packages. If a prebuilt binary is ever distributed, the notices
of everything compiled into it (the Rust crates, CEF and Chromium) go with it.

## In this repository

| Material | Where | License | Notice |
|---|---|---|---|
| DejaVu Sans and DejaVu Serif, regular and bold, cut to Latin as WOFF2 (test fixtures) | `cli/fixtures/fonte-padrao/` | Bitstream Vera Fonts license; DejaVu changes in the public domain | Copyright (c) 2003 Bitstream, Inc.; full text in `cli/fixtures/fonte-padrao/LICENCA-DEJAVU.txt`. Bitstream Vera is a trademark of Bitstream, Inc. |
| Schibsted Grotesk, IBM Plex Mono, Octicons, Simple Icons (brand assets) | `marca/` | see [`NOTICE`](../../NOTICE) | |

Everything else in the repository (code, tests, fixtures, the fictional brand in `identidade/fixtures/` and the SVG
and Lottie test files) was written by the Kodecz authors and is under Apache-2.0.

## npm

| Package | Version | License | Used by | Notice |
|---|---|---|---|---|
| onnxruntime-node | 1.30.0 | MIT | `conferencia/` (face detection in the automatic checks) | Copyright (c) Microsoft Corporation; its native binaries ship with `ThirdPartyNotices.txt` in the package |
| electron (dev) | 45.1.0, unmodified | MIT | `captura/` (the automatic checks and one test that plays the MP4 in a browser) | Copyright (c) Electron contributors, Copyright (c) 2013-2020 GitHub Inc.; Chromium notices in `dist/LICENSES.chromium.html` |

Indirect, with `onnxruntime-node`: onnxruntime-common 1.30.0, adm-zip 0.6.1, define-data-property 1.1.4,
define-properties 1.2.1, es-define-property 1.0.1, es-errors 1.3.0, escape-string-regexp 4.0.0, globalthis 1.0.4,
gopd 1.2.0, has-property-descriptors 1.0.2, matcher 4.0.0, object-keys 1.1.1, serialize-error 8.1.0 (MIT);
global-agent 4.1.6 (BSD-3-Clause); semver 7.8.5 (ISC); type-fest 0.20.2 (MIT OR CC0-1.0).

Indirect, with `electron`: @electron/get 5.1.0, @electron-internal/extract-zip 1.0.8, @types/node 24.19.2, debug
4.4.3, env-paths 3.0.0, ms 2.1.3, progress 2.0.3, undici 7.30.1, undici-types 7.24.6 (MIT); graceful-fs 4.2.11,
semver 7.8.5 (ISC); sumchecker 3.0.1 (Apache-2.0).

## Rust

Direct dependencies of `nativo/` and `captura/cef/`:

| Crate | Version | License | Note |
|---|---|---|---|
| ash | 0.38.0+1.3.281 | MIT OR Apache-2.0 | Vulkan bindings |
| cudarc | 0.16.6 | MIT OR Apache-2.0 | loads the CUDA driver at run time; no CUDA library is linked or shipped |
| napi, napi-derive, napi-build | 3.15.0 / 3.16.0, 3.6.13 / 3.7.0, 2.6.0 | MIT | Node-API bindings |
| nvidia-video-codec-sdk | 0.4.0 | MIT | bundles `nvEncodeAPI.h`, `nvcuvid.h` and `cuviddec.h`, Copyright (c) 2010-2023 NVIDIA Corporation, under NVIDIA's permissive header notice; links at run time to the driver's `libnvidia-encode.so` and `libnvcuvid.so`, which are not shipped |
| cef | 156.2.0+156.0.14 | Apache-2.0 OR MIT | CEF bindings by the Tauri project |
| serde_json | 1.0.154 | MIT OR Apache-2.0 | |

All 155 crates, direct and indirect, are listed with their licenses in [`rust-crates.md`](rust-crates.md). Their
licenses: MIT, Apache-2.0 (alone, with the LLVM exception, or with MIT, ISC, Zlib or 0BSD as alternatives),
Unicode-3.0 (ICU4X), ISC, BSD-3-Clause, Unlicense OR MIT, Zlib, bzip2-1.0.6 (`libbz2-rs-sys`), CDLA-Permissive-2.0
(`webpki-roots`) and Apache-2.0 AND ISC (`ring`). All are permissive and compatible with Apache-2.0.

## Downloaded at install or test time (not in this repository)

| Component | Version | License | Downloaded by |
|---|---|---|---|
| Chromium Embedded Framework (CEF), minimal Linux build | 156.0.14 (Chromium 156.0.8078.48) | BSD-3-Clause, plus Chromium's third-party licenses (`LICENSE.txt` and `CREDITS.html` in the CEF package) | `captura/cef/preparar-cef.sh` |
| YuNet face detection model | `face_detection_yunet_2026may.onnx`, opencv_zoo at a pinned commit | MIT, Copyright (c) 2020 Shiqi Yu | `conferencia/rosto.ts` |
| Google Fonts used by a composition | as requested by the page | mostly SIL Open Font License 1.1; each family has its own | `captura/fontes.ts` |
| lottie-web (tests only) | 5.13.0 | MIT | `cli/fixtures/bibliotecas.ts` |
| Test portrait (tests only) | NASA S69-31741, Apollo 11 portrait | Public domain (work of the U.S. Government) | `conferencia/preparar.ts` |
| HyperFrames CLI (comparison only) | `hyperframes` 0.9.2 and its npm dependencies | Apache-2.0, Copyright HeyGen; it downloads its own Chrome headless shell | `scripts/comparar/comparar.sh`, into the work folder |
| Remotion (comparison only) | `remotion`, `@remotion/cli`, `@remotion/media` 4.0.536, with React 19.2.0 | Remotion License (not Apache-2.0: free for individuals and companies of up to 3 people) | `scripts/comparar/comparar.sh`, into the work folder |

HyperFrames and Remotion are not dependencies of Kodecz: the comparison script installs them, pinned, outside the
repository, to measure them. The compositions in `scripts/comparar/casos/` were written by the Kodecz authors in each
renderer's format; no HyperFrames or Remotion code is copied there.

GSAP is not a dependency and is not in this repository: a composition may bring its own copy, under GSAP's own
license.

## System requirements (not shipped)

| Program | License | Note |
|---|---|---|
| Node.js 24 | MIT | runs the TypeScript directly |
| ffmpeg and ffprobe | LGPL-2.1+ or GPL-2.0+, depending on the build | called as separate processes; the CPU path needs libx264 in your build |
| weston | MIT | virtual display |
| bubblewrap | LGPL-2.0+ | hides the GPU from the CPU path |
| NVIDIA driver 570+ (NVENC, NVDEC, Vulkan, CUDA) | proprietary | optional; without it, Kodecz renders on the CPU |
| faster-whisper, with numpy and CTranslate2 (`kodecz prepare words` only) | MIT (faster-whisper, CTranslate2), BSD-3-Clause (numpy) | in your own Python (`KODECZ_PYTHON`); run as a separate process by `cli/whisper-palavras.py` |
| Whisper large-v3-turbo, CTranslate2 conversion `mobiuslabsgmbh/faster-whisper-large-v3-turbo` (`kodecz prepare words` only) | MIT (OpenAI's Whisper weights) | downloaded by faster-whisper from Hugging Face on the first run, into its cache; or `--model <dir>` |
| rife-ncnn-vulkan and the RIFE v4.6 model (`kodecz prepare interpolate` only) | MIT (rife-ncnn-vulkan, Copyright (c) 2020 nihui; RIFE, Copyright (c) hzwer) | the release you download; found by `--rife`, `KODECZ_RIFE` or the PATH, run as a separate process |
| Ubuntu font, variable (benchmark scenes only) | Ubuntu Font Licence 1.0 | copied from `/usr/share/fonts` into a generated scene by `bench-gerador/mundo.ts`; not shipped |
