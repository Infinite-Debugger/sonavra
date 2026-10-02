import { serviceName } from '@sonavra/config';
import type { TranscriptionProvider } from '@sonavra/transcription';

const provider: TranscriptionProvider | undefined = undefined;

console.log(`${serviceName} worker ready`, { providerConfigured: Boolean(provider) });
