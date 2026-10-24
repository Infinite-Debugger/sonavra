# Sonavra

Sonavra is a transcription workspace for turning audio and video into searchable, editable transcripts.

## Requirements

- Node.js 22 or newer
- pnpm 10
- Docker with Docker Compose

## Setup

```sh
pnpm install
pnpm dev
```

`pnpm dev` prepares the local development environment before starting the applications. It starts PostgreSQL and the private S3-compatible object store (SeaweedFS), waits for them to become healthy, creates the local storage bucket, applies committed Prisma migrations, generates the Prisma client, and then starts the web, API, and worker processes.

Local development works without an `.env` file. Defaults are defined in `.env.defaults`: the web app runs on port `3000`, the API on port `3001`, PostgreSQL on port `5432`, and the local S3 endpoint on port `9000`.

To override the defaults, create a local `.env` file containing only the values you want to change. `S3_ENDPOINT` is the server-side S3-compatible endpoint; `S3_PUBLIC_ENDPOINT` is the endpoint placed in browser-facing presigned URLs. Objects are private by default; local storage requires the configured S3 credentials and integration tests verify anonymous reads are rejected.

Prisma owns the database schema and migrations in `packages/database/prisma`. After intentionally changing `schema.prisma`, create a new development migration with `pnpm db:migrate`. Normal startup uses `prisma migrate deploy`, so it applies existing migrations without silently creating new ones.

## Workspace

- `apps/web` - Next.js web application
- `apps/api` - NestJS API
- `apps/worker` - background worker process
- `packages/config` - shared configuration contracts
- `packages/types` - shared domain types
- `packages/database` - Prisma database client, schema, and migrations
- `packages/storage` - S3-compatible private object storage and presigning
- `packages/transcription` - transcription provider boundary

Within `apps/web`, keep route entry points, layouts, and global assets in `app`, extracted React components in `components` with PascalCase filenames, and non-UI helpers in `lib` grouped by domain. Keep helper tests beside their implementation. Use `@/` imports for paths rooted at `apps/web`.

## Accounts

Signup, signin, and signout are optional; uploading and reviewing guest recordings remain available without an account. `/account` and `/library` require a valid server-verified session. Signing up from a guest browser keeps eligible guest recordings in the new account. Existing users can select **Save to account** after a transcription finishes.

The library lists only the signed-in user's recordings, newest first, in pages of 25. Search matches recording titles and original filenames without regard to case. Titles can be renamed without changing the original filename. Processing states refresh while the library is open; completed items open in the transcript workspace.

Deleting a recording requires confirmation and permanently removes its private source media, transcript, speakers, segments, and jobs. A deletion request immediately blocks workspace access and further worker writes. An in-flight transcription may finish, but its result is discarded and its temporary media files are removed by the worker's normal cleanup. If media cleanup fails, the library shows **Deletion pending** and deletion can be retried; cleanup is complete only after a successful response. Previously issued media URLs remain subject to object availability and their original expiry. Guest recordings follow the retention policy below.

Claims use the existing opaque guest-session ID as a bearer credential and the server-verified account session as the destination owner. They transfer all unexpired recordings in that guest session whose uploads have finished, preserving transcripts, edits, and jobs. In-progress uploads remain guest-owned. The conditional ownership update is atomic and safe to retry; a retry reports zero newly claimed recordings. Claimed recordings have no guest expiry or guest ownership, survive removal of the guest session, and require the owning account session for viewing, editing, obtaining media URLs, and retries. Signing out preserves the browser's guest session but does not restore guest access to claimed recordings. Previously issued media URLs remain valid until their existing expiry.

Accounts use email/password credentials (12–128 character passwords), salted scrypt password hashes, and revocable 30-day database sessions. Only a hash of each random session token is stored. Cookies are HttpOnly, SameSite=Lax, and Secure on HTTPS. Signout revokes the current session; signin replaces the browser's previous account session. Email verification and password recovery are not included in this initial account flow.

Set `AUTH_ORIGIN` to the exact public web origin, such as `https://sonavra.example`, in production. It must use HTTPS in production and excludes a trailing slash or path. Development defaults to `http://localhost:$WEB_PORT` (port 3000 when unset). Account mutations require JSON and an Origin matching this value. Browser requests use `/api/auth/*` on Next.js; the API remains internal. Set the internal API origin/port consistently during both web build and startup, because Next.js embeds API rewrites in the build. Apply the new database migration with `pnpm db:deploy` and regenerate the client with `pnpm db:generate`.

Account HTTP/database integration tests run when `DATABASE_URL` is set (as in CI). Locally, run `pnpm exec dotenv -e .env -e .env.defaults -- pnpm --filter @sonavra/api test` after applying migrations.

Library integration tests also require the local object-storage service. Worker integration tests create and remove a disposable database, so the test database role must have `CREATEDB` permission. The default local PostgreSQL and CI roles support this. Worker test cleanup never runs against the configured application database.

## Transcript summaries

Completed transcripts have an optional **AI summary** panel with an overview, key points and explicit action items. Summaries are generated only on request and stored separately from transcript segments; they do not alter source text, playback, copy or exports. **Regenerate summary** replaces a saved summary only after successful generation. A failed request leaves the previous summary and transcript available. Saved transcript or speaker edits mark existing summaries as outdated; save edits before regenerating. Summary records are removed with their transcript, including guest retention cleanup.

The initial `SummaryGenerator` adapter uses a self-hosted [Ollama runtime with structured output](https://docs.ollama.com/capabilities/structured-outputs). Provision a local text model that supports structured output on infrastructure you control, then set `SONAVRA_SUMMARY_MODEL` to its exact installed model name in `.env`. Set `SONAVRA_SUMMARY_URL` to that runtime's internal origin if it differs from `http://localhost:11434`. Restart the API after changing configuration. Keep this endpoint private: the API sends transcript text to the configured runtime only when an authorized user requests generation. No hosted AI credentials are required, and no models are automatically downloaded. Without a configured model, the panel reports that summaries are unavailable and normal transcription remains functional.

This initial adapter accepts up to 24,000 UTF-8 input bytes including speaker labels, uses a 32,768-token context, and limits each request to 25 seconds. Choose a model/runtime with that context capacity and sufficient resources. Oversized transcripts, runtime timeouts, incomplete responses and malformed output return retryable or explicit input errors without silently truncating source text. Local model inference quality and latency depend on the model and hardware. Summaries are generated interpretations and should be checked against the recording.

Browser summary requests use same-origin Next.js `/api/recordings/:id/summary` routes. Read and generation endpoints enforce the existing account/guest access rules. Generation additionally requires the configured web Origin, rechecks ownership and expiry after inference, discards results if transcript text changed during generation, and prevents persistence once deletion is requested.

## Guest retention

Guest media and transcripts expire within 24 hours by default, measured from creation of the browser's guest session. Additional uploads in that session share its original deadline; uploads after session expiry start a new guest session. Set `SONAVRA_GUEST_RETENTION_HOURS` to an integer from 1 to 8760 to change the window for new sessions. Existing deadlines are preserved. The upload page shows the configured window and the recording workspace shows the actual expiry time. Save to an account before that deadline to retain eligible work without guest expiry.

Keep the worker running: it sweeps on startup and every minute independently of transcription, processing up to 100 expired recordings per sweep. Cleanup atomically marks expired guest recordings for deletion before removing private source media and then the recording, transcript, speakers, segments and jobs. Claimed account recordings are excluded. Storage or database failures leave the record for retry on the next sweep; empty expired guest sessions are removed only after their recordings are gone. Expired data is immediately inaccessible through the application even if physical cleanup is delayed. An active transcription discards its result after deletion is marked and removes its temporary files when processing finishes.

## Production operations

See [the production operations guide](ops/README.md) for private ingress, configuration checks, local model provisioning, operational health, JSON logs and public-endpoint limits. API and worker diagnostics distinguish service liveness from dependency/model readiness. Production startup rejects local default credentials and an externally bound API. `pnpm check:ingress` verifies Compose port bindings and runs in CI.

## Git hooks

`pnpm install` configures the repository Git hooks through Husky. Before each commit, lint-staged runs ESLint and Prettier only against relevant staged files. Full build, test, typecheck, lint, and formatting verification remains in CI.

## Root commands

```sh
pnpm test
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
```
