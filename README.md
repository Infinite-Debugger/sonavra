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

Signup, signin, and signout are optional; uploading and reviewing guest recordings remain available without an account. `/account` requires a valid server-verified session. Authentication never clears the browser's guest session or claims guest recordings; recording claims and the account library are separate features.

Accounts use email/password credentials (12–128 character passwords), salted scrypt password hashes, and revocable 30-day database sessions. Only a hash of each random session token is stored. Cookies are HttpOnly, SameSite=Lax, and Secure on HTTPS. Signout revokes the current session; signin replaces the browser's previous account session. Email verification and password recovery are not included in this initial account flow.

Set `AUTH_ORIGIN` to the exact public web origin, such as `https://sonavra.example`, in production. It must use HTTPS in production and excludes a trailing slash or path. Development defaults to `http://localhost:$WEB_PORT` (port 3000 when unset). Account mutations require JSON and an Origin matching this value. Browser requests use `/api/auth/*` on Next.js; the API remains internal. Apply the new database migration with `pnpm db:deploy` and regenerate the client with `pnpm db:generate`.

Account HTTP/database integration tests run when `DATABASE_URL` is set (as in CI). Locally, run `pnpm exec dotenv -e .env -e .env.defaults -- pnpm --filter @sonavra/api test` after applying migrations.

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
