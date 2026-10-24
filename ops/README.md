# Production operations

The reference deployment runs Next.js, API and worker on one host, with PostgreSQL, private object storage and the model runtime in Docker. Only a TLS ingress is public. Keep the API, worker diagnostics, database, object storage and runtime private. Multi-host deployment needs an equivalent private network and ingress policy.

## Configuration and startup

Install the configured Node.js and pnpm versions, run `pnpm install --frozen-lockfile`, apply migrations with `pnpm db:deploy`, generate the client with `pnpm db:generate` and run `pnpm build` using the deployment environment. Keep the same API port/origin at web build and startup because Next.js embeds rewrites in the build. Install all workspace dependencies: the reference host commands below use the existing TypeScript runtime.

Set `NODE_ENV=production` for API and worker. Required common settings are `DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `SONAVRA_HEALTH_TOKEN`. Use deployment credentials rather than the development defaults. Generate a random URL-safe health token of at least 32 characters. The API also requires an HTTPS `AUTH_ORIGIN` and a matching `S3_PUBLIC_ENDPOINT` origin with no path. The worker requires `SONAVRA_TRANSCRIPTION_RUNTIME_CONTAINER`, `SONAVRA_TRANSCRIPTION_MODEL` and an absolute `SONAVRA_DIARIZATION_MODEL` path inside that container. API startup is restricted to a loopback `API_HOST`; worker diagnostics always bind loopback.

Provision models using [the runtime guide](../packages/transcription/runtime/README.md), start the private services and run `pnpm storage:setup`. Deploy with a service manager using these foreground commands and the production environment (commands do not load `.env` automatically):

```sh
pnpm --filter @sonavra/api exec tsx src/main.ts
pnpm --filter @sonavra/worker exec tsx src/main.ts
pnpm --filter @sonavra/web exec next start --hostname 127.0.0.1 --port 3000
```

Use graceful termination, a restart policy, log capture/rotation and a shutdown grace period long enough for active jobs to finish or hit their processing deadline. Readiness failure should alert operators; liveness and readiness have different meanings.

## Private ingress

The root Compose file binds published database/storage ports to `127.0.0.1`; the runtime publishes no ports. Run `pnpm check:ingress` before deployment. This validates the resolved Compose configuration, including any locally configured ports, and rejects non-loopback internal bindings or host networking. CI runs the same policy. For a different Compose configuration, pipe its `docker compose ... config --format json` output to `node scripts/check-ingress.mjs`. Only an `ingress` service may publish HTTP/HTTPS ports.

[The reference Caddyfile](Caddyfile) requires `SONAVRA_DOMAIN` and `S3_BUCKET` to match the production origins/bucket. It sends application requests to Next.js, which proxies `/api/*` internally to NestJS. It separately routes only GET/HEAD/PUT requests under `/<bucket>/recordings/*` to private storage, preserving the signed Host and full object path. Uploads stream through the ingress to storage, with a 500 MiB cap; NestJS never proxies recording bodies. Storage signatures and private bucket permissions remain required. Bucket listing, administrative storage paths and deletion are not exposed by that route. Keep the default backend ports or update the reference consistently.

The ingress overwrites `X-Forwarded-For` before Next.js. Set `SONAVRA_TRUST_PROXY=true` only with that sanitizing ingress and a private API. Without this explicit trust, the API ignores forwarding headers and limits by its actual peer; requests proxied by Next.js then share a bucket. Do not expose Next.js directly alongside a trusted proxy configuration. Do not enable unredacted proxy access logging: signed media URLs contain bearer credentials in their query strings.

Caddy's [streaming proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) and [request size limits](https://caddyserver.com/docs/caddyfile/directives/request_body) define the ingress behavior. Model/container access must be restricted to trusted operators; the current worker uses the Docker CLI to invoke its configured runtime.

## Request controls

Production always enables database-backed, atomic per-client fixed-window limits shared across API processes. Development can opt in with `SONAVRA_RATE_LIMITING=true`:

| Category              | Limit          |
| --------------------- | -------------- |
| Signup/signin         | 10 per minute  |
| New uploads           | 10 per hour    |
| Transcription retries | 10 per hour    |
| Summary generation    | 6 per hour     |
| Other mutations       | 60 per minute  |
| Other reads           | 300 per minute |

Responses use HTTP 429 with `Retry-After`. A counter-store failure returns HTTP 503 rather than bypassing controls. Counters contain hashed client/category keys rather than raw addresses and are pruned by worker maintenance. These controls complement ingress/network protections; they are not an IP identity or bot-detection system.

Upload validation remains capped at 500 MiB. API JSON bodies are capped at 128 KiB. `SONAVRA_MAX_DURATION_SECONDS` defaults to 14,400 seconds; normalization bounds decoded output and rejects longer or invalid media. Normalization/inference commands have five-minute deadlines. Worker leases renew during processing, stale attempts cannot overwrite later attempts, and queue timestamps use PostgreSQL time. Jobs still use bounded retries. Summary limits are documented separately in the main README.

## Health and telemetry

- API `GET /health`: liveness only; HTTP 200 does not prove that dependencies or models are ready.
- API `GET /ready`: requires `Authorization: Bearer <SONAVRA_HEALTH_TOKEN>`; reports database/private-bucket connectivity with HTTP 200 or 503.
- Worker `GET /health` on `127.0.0.1:$SONAVRA_WORKER_HEALTH_PORT` (default 3002): liveness.
- Worker `GET /ready` on the same loopback port: requires the health token and reports database status, offline model/component checks, last probe time, queue depth/stalled leases/oldest queued age, completion/failure/retry/discard counts, active jobs and process memory/CPU signals. An active job can keep a worker live between polling iterations. Probes do not run concurrently with inference; startup/model failures stop job claiming until readiness recovers.

API and worker emit JSON events with allowlisted fields. `X-Request-Id` is generated or accepted only as a UUID and returned in the response. Upload records retain that ID; `requestId`, `recordingId` and `jobId` connect request, queue, worker and local runtime events. Runtime results add processing time, CPU time, peak memory and CUDA allocation where available. No raw request URLs, queries, cookies, credentials, media paths, filenames or transcript text are logged. Raw runtime failures are replaced by safe stored/user-facing messages.

Counters are process-local operational totals, not durable billing or audit metrics. Monitor `/ready`, queue age/depth, stalled leases, readiness component failures, retries, resource use and processing durations. Diagnostic endpoints contain no transcript content and must remain private even though token-protected.
