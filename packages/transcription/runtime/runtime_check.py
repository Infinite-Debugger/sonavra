import argparse
import json
import os
import shutil
import sys
from pathlib import Path


def check_runtime(env=None, components_only=False):
    env = os.environ if env is None else env
    checks = {"ffmpeg": shutil.which("ffmpeg") is not None, "whisper": False, "diarization": False, "device": False}
    try:
        from faster_whisper import WhisperModel
        from pyannote.audio import Pipeline
        import torch
        device = env.get("SONAVRA_TRANSCRIPTION_DEVICE", "cpu")
        checks["device"] = device == "cpu" or (device == "cuda" and torch.cuda.is_available())
        if components_only:
            checks["whisper"] = True
            checks["diarization"] = True
        else:
            # Probes must never download missing models or require hosted credentials.
            os.environ["HF_HUB_OFFLINE"] = "1"
            os.environ["TRANSFORMERS_OFFLINE"] = "1"
            try:
                WhisperModel(
                    env.get("SONAVRA_TRANSCRIPTION_MODEL", "small"),
                    device=device,
                    compute_type=env.get("SONAVRA_TRANSCRIPTION_COMPUTE_TYPE", "int8"),
                    download_root=env.get("SONAVRA_MODEL_CACHE", "/models/whisper"),
                    local_files_only=True,
                )
                checks["whisper"] = True
            except Exception:
                pass
            model = env.get("SONAVRA_DIARIZATION_MODEL")
            if model and Path(model).is_dir():
                try:
                    pipeline = Pipeline.from_pretrained(model)
                    if device == "cuda":
                        pipeline.to(torch.device("cuda"))
                    checks["diarization"] = True
                except Exception:
                    pass
    except Exception:
        pass
    return {"ready": all(checks.values()), "checks": checks}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--components-only", action="store_true")
    result = check_runtime(components_only=parser.parse_args().components_only)
    print(json.dumps(result))
    if not result["ready"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
