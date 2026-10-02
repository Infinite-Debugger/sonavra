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

The web app runs on `http://localhost:3000`, the API on `http://localhost:3001`, and the worker runs as a separate process.

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
