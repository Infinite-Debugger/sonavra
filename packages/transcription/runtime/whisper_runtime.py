import argparse
import json
import sys
from pathlib import Path

import torch
from faster_whisper import WhisperModel
from pyannote.audio import Pipeline


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--model-cache")
    parser.add_argument("--diarization-model")
    parser.add_argument("--min-speakers", type=int)
    parser.add_argument("--max-speakers", type=int)
    parser.add_argument("media")
    parser.add_argument("--language")
    parser.add_argument("--detect-language", action="store_true")
    return parser.parse_args()


def assign_speaker(start: float, end: float, turns: list[dict]) -> str | None:
    best_speaker = None
    best_overlap = 0.0
    for turn in turns:
        overlap = max(0.0, min(end, turn["end"]) - max(start, turn["start"]))
        if overlap > best_overlap:
            best_overlap = overlap
            best_speaker = turn["speaker"]
    return best_speaker


def diarize(media: Path, model_path: str, device: str, min_speakers: int | None, max_speakers: int | None):
    pipeline = Pipeline.from_pretrained(model_path)
    if device == "cuda":
        pipeline.to(torch.device("cuda"))

    kwargs = {}
    if min_speakers is not None:
        kwargs["min_speakers"] = min_speakers
    if max_speakers is not None:
        kwargs["max_speakers"] = max_speakers

    output = pipeline(str(media), **kwargs)
    annotation = output.exclusive_speaker_diarization
    turns = [
        {"start": turn.start, "end": turn.end, "speaker": speaker}
        for turn, _, speaker in annotation.itertracks(yield_label=True)
    ]
    speaker_ids = sorted({turn["speaker"] for turn in turns})
    speakers = [
        {"id": speaker_id, "label": f"Speaker {index + 1}"}
        for index, speaker_id in enumerate(speaker_ids)
    ]
    return turns, speakers


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

    turns = []
    speakers = []
    if args.diarization_model:
        turns, speakers = diarize(
            media,
            args.diarization_model,
            args.device,
            args.min_speakers,
            args.max_speakers,
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
                "speakerId": assign_speaker(segment.start, segment.end, turns) if turns else None,
                "confidence": confidence,
            }
        )

    print(
        json.dumps(
            {
                "engine": "faster-whisper",
                "language": info.language,
                "durationMs": round(info.duration * 1000),
                "speakers": speakers,
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
