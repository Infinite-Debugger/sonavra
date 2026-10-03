import argparse
from pathlib import Path

from faster_whisper import WhisperModel
from huggingface_hub import snapshot_download


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--whisper-model", default="small")
    parser.add_argument("--whisper-cache", default="/models/whisper")
    parser.add_argument("--diarization-repo", default="pyannote/speaker-diarization-community-1")
    parser.add_argument("--diarization-dir", default="/models/diarization")
    parser.add_argument("--hf-token")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    whisper_cache = Path(args.whisper_cache)
    whisper_cache.mkdir(parents=True, exist_ok=True)

    WhisperModel(args.whisper_model, device="cpu", compute_type="int8", download_root=str(whisper_cache))

    diarization_dir = Path(args.diarization_dir)
    diarization_dir.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=args.diarization_repo,
        local_dir=str(diarization_dir),
        token=args.hf_token,
    )


if __name__ == "__main__":
    main()
