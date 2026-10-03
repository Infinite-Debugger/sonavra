import { serviceName } from '@sonavra/config';
import type { TranscriptionEngine } from '@sonavra/transcription';

const engine: TranscriptionEngine | undefined = undefined;

console.log(`${serviceName} worker ready`, {
  engineConfigured: Boolean(engine),
});
