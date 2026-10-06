import type { Metadata } from 'next';
import RecordingPage from './recording-page';

export const metadata: Metadata = {
  title: 'Transcript',
};

export default function Page() {
  return <RecordingPage />;
}
