import argparse
import json
import sys
from pathlib import Path

from faster_whisper import WhisperModel


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--model-cache")
    parser.add_argument("media")
    parser.add_argument("--language")
    parser.add_argument("--detect-language", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    media = Path(args.media)
    if not media.is_file():
        raise FileNotFoundError(f"Media file does not exist: {media}")

    model = WhisperModel(
        args.model,
        device=args.device,
        compute_type=args.compute_type,
        download_root=args.model_cache,
    )

    language = None if args.detect_language else args.language
    segments, info = model.transcribe(
        str(media),
        language=language,
        word_timestamps=True,
        vad_filter=True,
    )

    normalized_segments = []
    for segment in segments:
        confidence = None
        if segment.avg_logprob is not None:
            confidence = max(0.0, min(1.0, 1.0 + segment.avg_logprob))

        normalized_segments.append(
            {
                "startMs": round(segment.start * 1000),
                "endMs": round(segment.end * 1000),
                "text": segment.text.strip(),
                "confidence": confidence,
            }
        )

    print(
        json.dumps(
            {
                "engine": "faster-whisper",
                "language": info.language,
                "durationMs": round(info.duration * 1000),
                "speakers": [],
                "segments": normalized_segments,
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error), "type": type(error).__name__}), file=sys.stderr)
        sys.exit(1)
