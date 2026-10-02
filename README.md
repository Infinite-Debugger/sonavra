# Sonavra

Sonavra is a transcription workspace for turning audio and video into searchable, editable transcripts.

## Requirements

- Node.js 22 or newer
- pnpm 10

## Setup

```sh
pnpm install
pnpm dev
```

Local development works without an `.env` file. Defaults are defined in `.env.defaults`: the web app runs on port `3000` and the API on port `3001`.

To override the defaults, copy `.env.example` to `.env` and change the values as needed.

## Workspace

- `apps/web` - Next.js web application
- `apps/api` - NestJS API
- `apps/worker` - background worker process
- `packages/config` - shared configuration contracts
- `packages/types` - shared domain types
- `packages/database` - database boundary
- `packages/storage` - object storage boundary
- `packages/transcription` - transcription provider boundary

## Root commands

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
```
