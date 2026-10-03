import json
import sys

if "--diarization-model" in sys.argv:
    speakers = [{"id": "SPEAKER_00", "label": "Speaker 1"}, {"id": "SPEAKER_01", "label": "Speaker 2"}]
    segments = [
        {"startMs": 0, "endMs": 900, "text": "Hello", "speakerId": "SPEAKER_00"},
        {"startMs": 1000, "endMs": 1900, "text": "Hi", "speakerId": "SPEAKER_01"},
    ]
else:
    speakers = []
    segments = [{"startMs": 0, "endMs": 900, "text": "Hello"}]

print(json.dumps({"engine": "faster-whisper", "language": "en", "durationMs": 2000, "speakers": speakers, "segments": segments}))
