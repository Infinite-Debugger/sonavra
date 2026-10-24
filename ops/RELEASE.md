# MVP release checklist

Tracks [issue #27](https://github.com/Infinite-Debugger/sonavra/issues/27). A clean deployment must produce a transcript and speaker labels with **zero external AI/transcription credentials**. Provisioning credentials for gated model downloads must be removed before runtime verification.

## Current decision: no-go

Baseline: `2b22837` (production hardening merged in #61). This is an evidence inventory, not a public-release approval. Passing repository checks or closing a dependency issue does not complete a deployment gate.

The baseline passed 57 Node tests, build, typecheck, lint, formatting, Compose ingress validation and reference Caddy configuration validation. This evidence covers software contracts and configuration. It does **not** establish real model accuracy, CPU/GPU inference, production TLS/media routing or desktop/mobile release acceptance.

Release blockers:

- Real Whisper and local diarization have not been demonstrated together against a provisioned release deployment. The transcription tests use `test/fake_runtime.py`; worker integration tests stub preprocessing and inference. CI currently provides no real-audio/model integration proof for #36.
- A clean model provisioning/recreation exercise and offline inference run have not been recorded. Community-1 requires operator acceptance/access for its initial gated download; no such acceptance is implied by this checklist.
- Live TLS ingress, private network boundaries and the desktop/mobile smoke matrix below need deployment evidence.

Keep #27 open until every gate has passing evidence for the release candidate. Fix missing real-model integration coverage in a separate focused change; do not relabel contract tests as real inference tests.

## Gate inventory

All rows are pending release-candidate acceptance. The middle column identifies existing coverage or implementation to inspect, not a passing release verdict.

| Gate                                  | Existing evidence / dependency                              | Required release evidence                                                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous upload → transcript         | Upload API integration and worker queue tests; #4, #6, #7   | Fresh guest uploads real audio, sees progress and receives a persisted, readable transcript after refresh, without an account.                                                                          |
| OGG happy path                        | MIME validation and local FFmpeg implementation; #34        | A real OGG speech fixture completes the full browser/storage/queue/runtime journey.                                                                                                                     |
| Production Whisper                    | Packaged faster-whisper runtime; #32                        | Offline CPU inference produces recognizable expected speech with valid timestamps on release hardware. Record duration and resource use.                                                                |
| Controlled speaker diarization        | Local Community-1 path; #33                                 | A consented two-speaker fixture produces at least two used speaker identities with plausible turns. Missing/broken diarization fails safely.                                                            |
| Local preprocessing                   | Docker FFmpeg normalization; #34                            | OGG, MP3, WAV, MP4, M4A and WebM with audio complete; malformed and audio-free files fail safely; temporary files are removed after success/failure.                                                    |
| Reproducible runtime/models           | CPU/GPU packaging and provisioning guide; #35               | Fresh runtime and cache provision successfully; record image digest, model revisions/artifact hashes and configuration; recreate runtime with the cache and repeat inference.                           |
| Real integration without credentials  | Existing fake-runtime contract tests; #36                   | Automated real-audio, multi-speaker worker/runtime integration passes with external AI credentials absent and runtime egress blocked. Include timestamp, speaker, failure and retry assertions.         |
| Provider outage independence          | Default worker uses local Docker engine                     | Repeat a new job with inference runtime internet egress denied and hosted providers unreachable; no fallback or hosted request occurs. Offline flags alone are insufficient network-isolation evidence. |
| Signup retains guest work             | Auth/claim HTTP and database tests; #11, #22                | Sign up after a guest transcript; recording, edits and speakers survive refresh and become account-only. Another browser cannot claim/access it.                                                        |
| Account library/history               | Library authorization and deletion tests; #23               | Own history, search, rename, pagination, processing/failure states and transcript navigation work; another account sees none of these records.                                                          |
| Playback, editing, search, exports    | Edit API and export helper tests; #8–#10                    | Seek/playback highlighting, persistent text/speaker edits, search, copy and TXT/SRT/VTT/DOCX downloads work in the smoke matrix. Inspect timestamps and speaker labels.                                 |
| Guest retention                       | Disposable-database cleanup tests; #24                      | Expired guest access is denied; worker removes media and dependent records; failed cleanup retries; claimed work remains. Use an isolated test deployment.                                              |
| Formats and limits documented         | Product limits below; #4, #34                               | Deployed UI and configured limits agree with this guide; oversized/unsupported files show useful errors.                                                                                                |
| Visible privacy/deletion              | Upload/workspace retention messaging; library deletion flow | Guest expiry is visible before upload and in the workspace; account deletion confirmation explains permanence; deletion removes access and eventually media/data, including during an active job.       |
| Runtime monitoring                    | Protected API/worker readiness and safe logs; #26           | Model/database/storage failures produce readiness failure and useful private alerts; repair restores readiness. Trace one job by IDs without logging media, transcript text or credentials.             |
| Desktop/mobile critical path          | Responsive Tailwind UI                                      | Complete every scenario in the smoke matrix in both color schemes, with keyboard and touch checks. Record browser/device versions.                                                                      |
| Same-origin application API           | `apps/web/next.config.ts` rewrites                          | Browser network inspection shows application requests use the public Next.js origin, including auth, upload metadata, polling, edits and exports.                                                       |
| Private NestJS API                    | Loopback API binding and production validation              | From an external host, only intended TLS ingress is reachable; API, worker diagnostics, database, storage and runtime ports are inaccessible. Check actual host firewall/listeners as well as Compose.  |
| No internal origin in browser bundles | Server-side rewrite configuration                           | Inspect built `apps/web/.next/static` for the exact deployment internal API host/origin; browser execution requires no internal host/port. Do not publish server build configuration as evidence.       |
| Streaming media upload                | Presigned storage uploads and Caddy route                   | Browser PUT goes through narrow media ingress directly to storage; large bodies never pass through NestJS. Verify an allowed large synthetic file and over-limit rejection.                             |
| Private object storage                | Storage tests and narrow Caddy route                        | Unsigned GET/HEAD/PUT, bucket listing and administrative/delete routes are denied; authorized signed upload/download works; expired signatures fail. Avoid retaining signed URLs in evidence.           |

Bootstrap, database and storage foundations are tracked by #1–#3; the complete dependency set is #1–#11, #22–#26 and #32–#36. Recheck their acceptance criteria against the candidate, regardless of issue status.

## Supported media and product limits

- Accepted containers/formats: OGG, MP3, WAV, MP4, M4A and WebM. Upload validation uses the declared MIME type; an accepted container still needs a decodable audio stream. Video is transcribed from its audio track locally.
- Maximum upload: 500 MiB (524,288,000 bytes), described as “500 MB” in the UI. Empty files and unsupported declared media types are rejected.
- Maximum decoded duration: `SONAVRA_MAX_DURATION_SECONDS`, default 14,400 seconds (four hours). Normalization and inference each have a five-minute deadline, so the duration ceiling does not guarantee completion for every model/hardware combination. Verify representative lengths on release hardware.
- Guest access: 24 hours by default from guest-session creation, configurable for new sessions using `SONAVRA_GUEST_RETENTION_HOURS`. Uploads in a session share its deadline. Expired work becomes inaccessible immediately; the worker retries physical cleanup. Eligible work saved to an account has no guest expiry.
- Deletion: access is blocked when deletion is requested; private media and dependent transcript data are removed. Failed media deletion remains pending for retry. Previously issued signed media URLs remain subject to their existing expiry and object availability.
- Playback, search and editing require a completed transcript. Supported exports are TXT, SRT, VTT and DOCX. Optional summary configuration and separate input/time limits are documented in the [main README](../README.md#transcript-summaries).

Public abuse limits, JSON body limits, readiness and logging behavior are documented in [production operations](README.md). Validate configured values and visible privacy/retention messaging together before approval.

## Repeatable repository verification

Use an isolated validation environment with Node 22+, pnpm 10 and Docker. Integration tests need PostgreSQL with `CREATEDB`, and private S3-compatible storage. Do not point release validation at production user data. Start the development dependencies and apply migrations using `pnpm dev:setup`, without starting application servers. This uses a components-only runtime check and does not provision real models.

```sh
pnpm install --frozen-lockfile
pnpm dev:setup
STORAGE_INTEGRATION=1 pnpm exec dotenv -e .env -e .env.defaults -- pnpm test
pnpm exec dotenv -e .env -e .env.defaults -- pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:ingress
```

Read the test summary: an exit code alone is insufficient if integration tests were skipped. `DATABASE_URL` enables API/database coverage; `STORAGE_INTEGRATION=1` enables real storage coverage against the configured endpoint. Worker tests create/drop disposable databases. CI sets these dependencies explicitly. A passing run still needs the separate real-model integration gate above.

## Deployment and offline inference exercise

1. Follow [production operations](README.md) and [runtime provisioning](../packages/transcription/runtime/README.md) in a clean, isolated deployment. Record the candidate SHA, runtime image digest, native/package versions, exact model artifacts, CPU/GPU device, compute type and limits. Preserve no tokens or environment dumps in the release record.
2. Provision the Whisper cache and Community-1 model using operator-authorized download access. Remove provisioning tokens and all hosted AI/STT credentials from the runtime and service environment. Retain the required database/storage/health credentials. Ensure optional summaries do not participate in the transcription test.
3. Deny runtime internet egress using the deployment network policy while retaining the private communication required by the worker, database and storage. Verify that policy rather than relying solely on `HF_HUB_OFFLINE` flags. Do not disconnect a shared user's runtime or change its network.
4. Run the strict model probe (`python /runtime/runtime_check.py` inside the provisioned container) and protected API/worker `/ready` checks. Expect HTTP 200 and all required components ready. `/health` or `--components-only` cannot satisfy this gate. Handle the health token through the deployment's secret mechanism; do not paste it into retained commands or logs.
5. Start from a fresh browser guest session. Upload a short, consented OGG conversation with two distinct speakers and known expected phrases. Verify normalization, real inference, used speaker labels, ordered nonnegative timestamps, plausible duration, persistence and refresh recovery. Compare speech/text privately; retain only pass/fail, fixture hash and timing/resource metadata.
6. Repeat with each supported format and a malformed fixture. Restart the worker during a disposable queued/processing job and verify eventual completion without duplicate persistence. In the isolated deployment, remove a model mount or stop the runtime; confirm readiness fails, no false success is stored and recovery/retry works once restored.
7. Recreate the runtime with its persisted cache and no download credentials. Repeat strict readiness and OGG inference without internet. CPU is the required baseline; if shipping GPU acceleration, repeat with the configured NVIDIA runtime and record device/driver details. An unavailable GPU is recorded as unverified and cannot support a GPU readiness claim.
8. Validate the real HTTPS ingress with signed upload/download, unsigned denial, expired signatures and external port checks from the gate table. Validate the reference Caddy configuration separately; parsing configuration does not prove TLS routing or storage signatures work live.

## Desktop/mobile smoke matrix

Run against the candidate through its public HTTPS origin. Use disposable accounts and consented fixtures. For each row record **pass/fail**, browser/version, viewport or physical device, light/dark results and a sanitized evidence reference. Responsive desktop emulation is useful but must not be recorded as a physical mobile-browser test.

| Scenario                                                                               | Desktop browser | Mobile browser |
| -------------------------------------------------------------------------------------- | --------------- | -------------- |
| Fresh guest: upload OGG, progress, completion and refresh recovery                     | Pending         | Pending        |
| Playback, seek from segments, active highlighting and scrolling                        | Pending         | Pending        |
| Text edits, shared speaker rename, save failure/recovery and refresh                   | Pending         | Pending        |
| Search, copy and all four export formats                                               | Pending         | Pending        |
| Signup retains guest work; signout/signin and protected route behavior                 | Pending         | Pending        |
| Library search, rename, pagination, states and deletion confirmation                   | Pending         | Pending        |
| Retention/privacy messages, invalid file, over-limit and runtime failure/retry         | Pending         | Pending        |
| Keyboard navigation, visible focus, touch targets, contrast and no horizontal overflow | Pending         | Pending        |

For optional summaries, either document them as unavailable in the candidate configuration or verify a configured local model can generate/regenerate, show stale results after edits, and fail without blocking transcript access. This does not replace any core release gate.

## Release evidence record

Create a private record per candidate; use this template. Keep raw recordings, transcripts, credentials, signed URLs and identifying account data out of commits, PRs and public release notes. Delete disposable accounts/recordings and check storage cleanup after the exercise.

```text
Candidate SHA / date / operator:
Deployment origin and environment identifier:
Runtime image digest / CPU or GPU configuration:
Model revisions or artifact hashes / cache recreation result:
Repository verification commands, results, test counts and skips:
Real-model integration job/result reference:
Fixture hashes / format / duration / expected speaker count:
Credential-free and egress-denial verification method/result:
Gate-by-gate results and sanitized evidence references:
Desktop/mobile browser versions / devices / light and dark results:
Private ingress and external port verification results:
Readiness failure/recovery and job restart/retry results:
Test-data cleanup result:
Unresolved blockers and linked follow-up issues:
Decision: GO or NO-GO / approver / date:
```

Approve GO only when every required gate passes for that candidate, with no unresolved core-invariant, privacy or critical-path failures. A code/model/configuration change affecting a gate invalidates its earlier evidence; repeat the affected checks before approval.
