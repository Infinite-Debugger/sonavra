# Sonavra transcription runtime

This directory packages the native dependencies for Sonavra's self-hosted transcription path.

## Runtime invariants

Transcription and diarization run locally. No hosted speech-to-text or diarization API is required.

The pyannote Community-1 model is gated for its initial download. A Hugging Face token is therefore a provisioning credential only. It is not required by a provisioned runtime.

## Provision models

Build the runtime, then provision the persistent model volume once:

```sh
docker compose -f compose.cpu.yml build
docker compose -f compose.cpu.yml run --rm transcription-runtime \
  python provision_models.py --hf-token "$HF_TOKEN"
```

The model volume survives worker/container recreation. After provisioning, runtime inference can operate without `HF_TOKEN`.

## CPU

```sh
docker compose -f compose.cpu.yml run --rm transcription-runtime python runtime_check.py
```

CPU is the supported baseline. Whisper defaults to int8 compute.

## GPU

Install the NVIDIA Container Toolkit on the host, then apply the GPU override:

```sh
docker compose -f compose.cpu.yml -f compose.gpu.yml run --rm transcription-runtime \
  python runtime_check.py
```

GPU execution is configured as CUDA with float16 compute. Host NVIDIA drivers and the container toolkit remain host-level prerequisites.

## Readiness

`runtime_check.py` loads the configured Whisper and local diarization models with offline Hugging Face access and verifies the configured CPU/CUDA device. It returns only boolean component checks and exits non-zero for missing caches, load failures, missing dependencies or an unavailable device. Probes never download models or print underlying diagnostic text. Provision the cache and diarization directory before starting a production worker.

`--components-only` checks installed dependencies without loading models. Root development Compose uses this lightweight check so provisioning can run in a newly created container; it is not proof of inference readiness. The worker exposes strict model readiness on its protected `/ready` endpoint and does not claim jobs while unready or probing. Model probes run at startup and during idle maintenance, with a 55-second process deadline; a large model that cannot load within that deadline remains unready. Existing CPU/GPU packaging and model provisioning commands above remain the source of model artifacts.

Docker inference runs with offline model access. Missing diarization configuration fails explicitly instead of silently removing speaker labels. Normalization accepts at most `SONAVRA_MAX_DURATION_SECONDS` (four hours by default); FFmpeg limits decoded output before checking duration. Each normalization and inference command has a five-minute deadline. Completed runtime results contain processing duration, CPU time, peak resident memory and CUDA peak allocation where applicable; transcripts and raw errors are excluded from operational logs.

A clean runtime must not require OpenAI, Deepgram, AssemblyAI, pyannoteAI, or another hosted inference credential.
