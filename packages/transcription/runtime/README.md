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

`runtime_check.py` exits non-zero when FFmpeg, Python inference dependencies, or the configured local diarization model are unavailable. This is suitable for container health/readiness wiring.

A clean runtime must not require OpenAI, Deepgram, AssemblyAI, pyannoteAI, or another hosted inference credential.
