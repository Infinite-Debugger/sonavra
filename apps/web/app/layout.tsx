import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Sonavra · Private self-hosted transcription',
    template: '%s · Sonavra',
  },
  description:
    'Turn audio and video recordings into private, self-hosted transcripts.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
