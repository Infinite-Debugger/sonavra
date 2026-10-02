import type { ServiceStatus } from '@sonavra/types';

export default function Home() {
  const status: ServiceStatus = 'ready';

  return (
    <main>
      <h1>Sonavra</h1>
      <p>Transcription workspace foundation is {status}.</p>
    </main>
  );
}
