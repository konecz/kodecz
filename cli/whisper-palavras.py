"""Word timestamps with faster-whisper, for `kodecz prepare words` (cli/preparar.ts, docs/formatos/preparo.md).

Reads mono float32 samples at 16 kHz (already decoded and cut by ffmpeg, so PyAV is not needed) and prints
{"palavras": [{"texto", "inicio", "fim"}], "idioma", "dispositivo"} on stdout. No initial prompt: a supporting text
makes the recognizer write the prompt instead of what was said. On CUDA only, unless --cpu: it never falls back to
the CPU on its own. Exit code 3 when CUDA is not usable, 1 on other errors.

The Python and faster-whisper (MIT) are the user's: KODECZ_PYTHON, or python3 with the module.
"""

import argparse
import ctypes
import json
import site
import sys
from pathlib import Path


def carregar_bibliotecas_cuda():
    # The pip wheels nvidia-cublas-cu12 and nvidia-cudnn-cu12 put the libraries where ctranslate2 does not look: load
    # them first, when they are there. Without them, the system ones (if any) are used.
    pastas = [Path(p) for p in site.getsitepackages() + [site.getusersitepackages()]]
    for lib in ("cublas/lib/libcublasLt.so.12", "cublas/lib/libcublas.so.12", "cudnn/lib/libcudnn.so.9"):
        for pasta in pastas:
            caminho = pasta / "nvidia" / lib
            if caminho.exists():
                try:
                    ctypes.CDLL(str(caminho), mode=ctypes.RTLD_GLOBAL)
                except OSError:
                    pass
                break


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--audio", required=True, help="raw float32 mono samples at 16 kHz")
    p.add_argument("--model", default="mobiuslabsgmbh/faster-whisper-large-v3-turbo")
    p.add_argument("--language", default=None)
    p.add_argument("--cpu", action="store_true")
    a = p.parse_args()

    import numpy as np

    if not a.cpu:
        carregar_bibliotecas_cuda()
        import ctranslate2

        if ctranslate2.get_cuda_device_count() < 1:
            print("no CUDA device for faster-whisper (ctranslate2 sees none); pass --cpu to run on the CPU", file=sys.stderr)
            sys.exit(3)
    from faster_whisper import WhisperModel

    amostras = np.fromfile(a.audio, dtype=np.float32)
    dispositivo, tipo = ("cpu", "int8") if a.cpu else ("cuda", "float16")
    try:
        modelo = WhisperModel(a.model, device=dispositivo, compute_type=tipo)
        segmentos, info = modelo.transcribe(amostras, language=a.language, word_timestamps=True)
        palavras = [{"texto": w.word, "inicio": round(w.start, 3), "fim": round(w.end, 3)} for s in segmentos for w in (s.words or [])]
    except RuntimeError as e:
        if not a.cpu and ("CUDA" in str(e) or "cuDNN" in str(e) or "cublas" in str(e).lower()):
            print(f"CUDA failed in faster-whisper: {e}; install nvidia-cublas-cu12 and nvidia-cudnn-cu12 in the same Python, or pass --cpu", file=sys.stderr)
            sys.exit(3)
        raise
    json.dump({"palavras": palavras, "idioma": info.language, "dispositivo": dispositivo}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
