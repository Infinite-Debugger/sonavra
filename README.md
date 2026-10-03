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

`pnpm dev` starts PostgreSQL, waits until it is healthy, applies all committed migrations, then starts the web, API and worker. Pulling database changes does not require a separate setup command.

Local development works without an `.env` file. Defaults are defined in `.env.defaults`: web `3000`, API `3001`, PostgreSQL `5432`.

To override defaults, copy `.env.example` to `.env`.

## Workspace

- `apps/web` - Next.js web application
- `apps/api` - NestJS API
- `apps/worker` - background worker process
- `packages/config` - shared configuration contracts
- `packages/types` - shared domain types
- `packages/database` - PostgreSQL schema, migrations and client
- `packages/storage` - object storage boundary
- `packages/transcription` - transcription engine boundary

## Root commands

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
```
