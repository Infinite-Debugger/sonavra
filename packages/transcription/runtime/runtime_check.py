import json
import os
import shutil
import sys
from pathlib import Path


def main() -> None:
    failures = []

    if shutil.which("ffmpeg") is None:
        failures.append("ffmpeg is not installed")

    try:
        import faster_whisper  # noqa: F401
    except Exception as error:
        failures.append(f"faster-whisper unavailable: {error}")

    try:
        import pyannote.audio  # noqa: F401
    except Exception as error:
        failures.append(f"pyannote.audio unavailable: {error}")

    diarization_model = os.getenv("SONAVRA_DIARIZATION_MODEL")
    if diarization_model and not Path(diarization_model).exists():
        failures.append(f"diarization model not found: {diarization_model}")

    result = {"ready": not failures, "failures": failures}
    print(json.dumps(result))
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
