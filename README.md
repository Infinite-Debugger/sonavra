# Sonavra

Sonavra is a transcription workspace for turning audio and video into searchable, editable transcripts.

## Requirements

- Node.js 22 or newer
- pnpm 10

## Setup

```sh
cp .env.example .env
pnpm install
pnpm dev
```

Local ports are configured in `.env`. The example configuration uses port `3000` for the web app and `3001` for the API.

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
