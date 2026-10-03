FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 SONAVRA_MODEL_CACHE=/models/whisper SONAVRA_DIARIZATION_MODEL=/models/diarization SONAVRA_TRANSCRIPTION_DEVICE=cpu SONAVRA_TRANSCRIPTION_COMPUTE_TYPE=int8
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /runtime
COPY requirements.txt ./
RUN python -m pip install --upgrade pip && python -m pip install -r requirements.txt
COPY whisper_runtime.py runtime_check.py provision_models.py ./
RUN mkdir -p "$SONAVRA_MODEL_CACHE" "$SONAVRA_DIARIZATION_MODEL"
VOLUME ["/models"]
CMD ["python", "runtime_check.py"]
