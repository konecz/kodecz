# Preparing media: `kodecz prepare`

The steps that every video repeats before and after the render, as one command each. Each step prints **one JSON
line** with its result on stdout (like `kodecz render`); progress notes go to stderr as `kodecz: …`, problems as
`warning: …` and `error: …`. Exit codes: `0` ok, `1` failure, `2` usage error, `3` GPU or CUDA not usable.

```
kodecz prepare voice       <in> <out.wav>                    [--speed 1.1] [--max-pause 0.35] [--threshold -40] [--keep-edges]
kodecz prepare words       <audio> <script.txt> <out.json>   [--language pt] [--model <name|dir>] [--cpu]
kodecz prepare interpolate <video> <out-dir>                 [--fps 72] [--rife <binary|dir>] [--model <dir>]
kodecz prepare loudness    <in.mp4> <out.mp4>                [--target -14] [--true-peak -1]
```

Code: `cli/preparar.ts` (the steps), `cli/alinhar.ts` (script ↔ recognizer alignment), `cli/whisper-palavras.py`
(the recognizer). Tests: `cli/preparar.test.ts` and `cli/alinhar.test.ts` (no GPU), `cli/preparar-placa.test.ts`
(GPU, skipped when RIFE or faster-whisper is not installed).

The external programs are yours and are not in this repository: `ffmpeg` and `ffprobe` on the PATH, a Python with
faster-whisper (for `words`) and the rife-ncnn-vulkan binary with a RIFE v4 model (for `interpolate`). On a shared
GPU, hold the same lock you hold for the render around `words` and `interpolate`.

## voice

Speeds the speech up without changing the pitch (`atempo`) and shortens long pauses (`silenceremove`), in this order:

1. silence trimmed at the start and at the end (below `--threshold`, default −40 dB; `--keep-edges` keeps it);
2. every pause longer than `--max-pause` seconds (default 0.35) cut down to it, ± one 20 ms detection window
   (`--max-pause 0` keeps the pauses);
3. `atempo=<speed>` (default 1.1; 0.5 to 2).

Output: PCM WAV, 16-bit, 48 kHz. Do this before the word timings and before anything that is generated from the voice
(an avatar video is shorter and cheaper to generate from the faster voice), so the rest of the edit runs at speed 1.0.

```json
{"ok":true,"passo":"voice","saida":"/…/voice-1.1x.wav","velocidade":1.1,"pausaMaxima":0.35,"duracao":{"antes":4,"depois":2.152},"parede":0.11}
```

Note: on ffmpeg 6.1 and later, `silenceremove` keeps `stop_duration + stop_silence` of each long pause. This command
uses `stop_silence=0`, so `--max-pause` is the pause that stays.

## words

Word timings for the speech file. The **text comes from the script** (accents, punctuation, numbers as written); the
recognizer only gives the times.

1. The audio is decoded to mono 16 kHz and cut at the **end of the voice + 0.2 s** (the end of the last 20 ms window
   above −45 dBFS): in the silence after the speech, the recognizer makes words up.
2. faster-whisper `large-v3-turbo` (`mobiuslabsgmbh/faster-whisper-large-v3-turbo`, or `--model`) transcribes it on
   **CUDA, float16**, with word timestamps. No initial prompt: a supporting text makes the recognizer write the text
   instead of what was said. Without a usable CUDA device the command fails with exit code 3; it never falls back to
   the CPU on its own. `--cpu` runs it on the CPU (int8) on purpose.
3. The script words and the recognized ones are aligned by key (lowercase, no accents, letters and digits only), by
   longest common subsequence. Matched words take the recognized times. Where the two differ — a word heard wrong,
   «2.000» written and «dois mil» spoken, «vinte e quatro» written and «24» heard — the script words of that stretch
   share the time of the recognized words of the same stretch, in proportion to their length. A script word with
   nothing heard in its stretch sits in the gap between its neighbours; recognized words that are not in the script
   are dropped. Times never go back and never pass the cut.

The script is plain text, split on whitespace. A token with no letter or digit («—», «…») joins the word before it.

Output file (the speech file, read by the other commands):

```json
{ "palavras": [
  {"texto":"Olá,","inicio":0.12,"fim":0.48},
  {"texto":"mundo!","inicio":0.52,"fim":0.97}
] }
```

`texto` is the script's word, `inicio` and `fim` are seconds (3 decimals) in the audio given to the command. Result on
stdout: counts (`palavras`, `reconhecidas`, `iguais`, `trocas`, `semPar`, `extras`), `semelhanca` (2 × matched /
(script + recognized words), warning below 0.8), `duracao`, `fimVoz`, `corte`, `idioma`, `dispositivo` and `modelo`.
Each differing stretch is printed on stderr as `kodecz: script «…» ← heard «…»`.

Install (once): a Python 3.9+ with faster-whisper (MIT) and, for CUDA, the cuBLAS and cuDNN wheels:

```
python3 -m venv ~/.venvs/kodecz
~/.venvs/kodecz/bin/pip install faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12
export KODECZ_PYTHON=~/.venvs/kodecz/bin/python
```

Without `KODECZ_PYTHON`, `python3` is used. The model (about 1.6 GB) is downloaded by faster-whisper from Hugging Face
on the first run, into its usual cache; `--model <dir>` uses a local copy.

## interpolate

In-between frames by RIFE (rife-ncnn-vulkan) on the GPU, for slow motion or a speed ramp: a video at 24 fps becomes a
JPEG sequence at `--fps` (default 72) with the same duration, `<out-dir>/0001.jpg`, `0002.jpg`… The output folder must
be new or empty.

1. The frames are decoded (NVDEC when it can; ffmpeg falls back to the CPU for what NVDEC does not read, such as H.264
   4:4:4) to JPEG `-q:v 2`. JPEG in and out of RIFE: with PNG, writing and reading the frames made the CPU the
   bottleneck (about 3× slower per clip, with the two results above 40 dB PSNR apart).
2. RIFE makes round(N × fps / source fps) frames (a v4 model takes any count). Only the NVIDIA GPU is made visible to
   Vulkan (`VK_DRIVER_FILES` and `VK_ICD_FILENAMES` set to `nvidia_icd.json`), otherwise RIFE may pick an integrated
   GPU. The command checks that RIFE made exactly that many frames, and reports the device RIFE ran on.
3. One more ffmpeg pass at `-q:v 2` writes the `%04d.jpg` names (RIFE's own JPEGs are about three times larger).

Frame *i* of the output (from 1) is the instant (*i* − 1) / fps of the source.

```json
{"ok":true,"passo":"interpolate","pasta":"/…/frames","padrao":"%04d.jpg","entrada":{"quadros":48,"fps":24},"saida":{"quadros":144,"fps":72},"rife":{"modelo":"/…/rife-v4.6","placa":"NVIDIA GeForce RTX 5090","segundos":1.4},"parede":2.1}
```

Install (once): download rife-ncnn-vulkan (MIT) from <https://github.com/nihui/rife-ncnn-vulkan/releases> and unzip
it. Kodecz finds the binary by `--rife <binary or folder>`, then `KODECZ_RIFE`, then `rife-ncnn-vulkan` on the PATH;
the model is `--model <dir>` or `rife-v4.6` next to the binary. For example, with the release unzipped in
`~/models/rife`: `export KODECZ_RIFE=~/models/rife`.

## loudness

Brings the audio of a finished MP4 to an integrated loudness target, with the true peak capped, and copies the video
stream without re-encoding:

1. measures the input (ffmpeg `ebur128=peak=true`);
2. `loudnorm` in two passes (`I=--target`, default −14 LUFS; `TP=--true-peak`, default −1 dBTP; `LRA=11`): the first
   measures, the second applies the measurement with `linear=true` (a plain gain). When a linear gain would pass the
   true-peak cap, loudnorm switches to its dynamic mode and the command warns;
3. writes AAC 192 kb/s at 48 kHz, `-c:v copy`, `+faststart`, and measures the output.

```json
{"ok":true,"passo":"loudness","saida":"/…/final.mp4","alvo":-16,"picoMaximo":-1,"antes":{"lufs":-51.8,"pico":-47.5},"depois":{"lufs":-16,"pico":-11.6},"modo":"linear","parede":0.3}
```

Common targets: −14 LUFS for short social videos, −16 LUFS for longer explainers.
