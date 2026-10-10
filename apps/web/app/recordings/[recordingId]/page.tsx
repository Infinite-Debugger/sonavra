import type { Metadata } from 'next';
import RecordingPage from '../../../components/RecordingPage';

export const metadata: Metadata = {
  title: 'Transcript',
};

export default function Page() {
  return <RecordingPage />;
}
