# Sonavra

Sonavra is a transcription workspace for turning audio and video into searchable, editable transcripts.

## Requirements

- Node.js 22 or newer
- pnpm 10
- Docker with Docker Compose

## Setup

```sh
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Local development works without an `.env` file. Defaults are defined in `.env.defaults`: the web app runs on port `3000`, the API on port `3001`, and PostgreSQL on port `5432`.

To override the defaults, copy `.env.example` to `.env` and change the values as needed.

Prisma owns the database schema and migrations in `packages/database/prisma`. After changing `schema.prisma`, create a migration with `pnpm db:migrate`. Existing migrations must not be rewritten after they have been applied.

## Workspace

- `apps/web` - Next.js web application
- `apps/api` - NestJS API
- `apps/worker` - background worker process
- `packages/config` - shared configuration contracts
- `packages/types` - shared domain types
- `packages/database` - Prisma database client, schema, and migrations
- `packages/storage` - object storage boundary
- `packages/transcription` - transcription provider boundary

## Root commands

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
```
