'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type {
  RecordingStatusResponse,
  TranscriptResponse,
} from '@sonavra/types';

async function getJson<T>(path: string, guestSessionId: string) {
  const response = await fetch(
    `/api${path}?guestSessionId=${encodeURIComponent(guestSessionId)}`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw new Error('Unable to load this recording.');
  return (await response.json()) as T;
}

function formatTime(ms: number) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function RecordingPage() {
  const { recordingId } = useParams<{ recordingId: string }>();
  const [status, setStatus] = useState<RecordingStatusResponse | null>(null);
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const guestSessionId = localStorage.getItem('sonavraGuestSessionId');
    if (!guestSessionId) {
      setError('This guest recording is no longer available in this browser.');
      return;
    }

    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const next = await getJson<RecordingStatusResponse>(
          `/recordings/${recordingId}/status`,
          guestSessionId!,
        );
        if (stopped) return;
        setStatus(next);
        if (next.status === 'COMPLETED') {
          const result = await getJson<TranscriptResponse>(
            `/recordings/${recordingId}/transcript`,
            guestSessionId!,
          );
          if (!stopped) setTranscript(result);
          return;
        }
        if (next.status !== 'FAILED') {
          timer = setTimeout(poll, 1500);
        }
      } catch (cause) {
        if (!stopped) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load this recording.',
          );
        }
      }
    }

    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [recordingId]);

  async function retry() {
    const guestSessionId = localStorage.getItem('sonavraGuestSessionId');
    if (!guestSessionId) return;
    setRetrying(true);
    try {
      const response = await fetch(
        `/api/recordings/${recordingId}/transcription-jobs`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ guestSessionId }),
        },
      );
      if (!response.ok) throw new Error('Unable to retry transcription.');
      setStatus((current) =>
        current
          ? { ...current, status: 'QUEUED', errorMessage: null }
          : current,
      );
      window.location.reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to retry transcription.',
      );
    } finally {
      setRetrying(false);
    }
  }

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center bg-white px-5 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
        <p className="rounded-2xl bg-zinc-100 px-6 py-5 text-red-700 dark:bg-zinc-900 dark:text-red-300">
          {error}
        </p>
      </main>
    );
  }

  if (transcript) {
    const speakers = new Map(
      transcript.speakers.map((speaker) => [
        speaker.id,
        speaker.displayName ?? speaker.label,
      ]),
    );
    return (
      <main className="min-h-screen bg-white px-5 py-12 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
        <article className="mx-auto max-w-3xl">
          <p className="mb-3 text-xs font-extrabold tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
            SONAVRA
          </p>
          <h1 className="truncate text-3xl font-bold tracking-tight sm:text-4xl">
            {transcript.filename}
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Transcript
            {transcript.language
              ? ` · ${transcript.language.toUpperCase()}`
              : ''}
          </p>
          <div className="mt-10 space-y-7">
            {transcript.segments.map((segment) => (
              <section
                key={segment.id}
                className="grid gap-2 sm:grid-cols-[7rem_1fr]"
              >
                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                  <strong className="block text-zinc-800 dark:text-zinc-200">
                    {segment.speakerId
                      ? speakers.get(segment.speakerId)
                      : 'Speaker'}
                  </strong>
                  {formatTime(segment.startMs)}
                </div>
                <p className="leading-7">{segment.text}</p>
              </section>
            ))}
          </div>
        </article>
      </main>
    );
  }

  const failed = status?.status === 'FAILED';
  return (
    <main className="grid min-h-screen place-items-center bg-white px-5 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <section className="w-full max-w-md text-center">
        <p className="mb-4 text-xs font-extrabold tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
          SONAVRA
        </p>
        <h1 className="text-3xl font-bold">
          {failed
            ? 'Transcription failed'
            : status?.status === 'PROCESSING'
              ? 'Transcribing your recording'
              : 'Your recording is queued'}
        </h1>
        <p className="mt-4 leading-7 text-zinc-600 dark:text-zinc-400">
          {failed
            ? (status?.errorMessage ??
              'The transcription could not be completed.')
            : 'You can leave this page open. Sonavra will show the transcript here when it is ready.'}
        </p>
        {!failed && (
          <div className="mx-auto mt-8 h-2 w-48 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-zinc-950 dark:bg-white" />
          </div>
        )}
        {failed && status?.retryable && (
          <button
            type="button"
            disabled={retrying}
            onClick={() => void retry()}
            className="mt-7 rounded-full bg-zinc-950 px-5 py-3 font-bold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-950"
          >
            {retrying ? 'Retrying…' : 'Try again'}
          </button>
        )}
      </section>
    </main>
  );
}
