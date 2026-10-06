'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

export default function RecordingPage() {
  const { recordingId } = useParams<{ recordingId: string }>();
  const mediaRef = useRef<HTMLMediaElement>(null);
  const activeSegmentRef = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<RecordingStatusResponse | null>(null);
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
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
        if (next.status !== 'FAILED') timer = setTimeout(poll, 1500);
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

  useEffect(() => {
    if (!transcript) return;
    document.title = `${transcript.filename} · Sonavra`;
  }, [transcript]);

  const activeSegmentId = useMemo(() => {
    if (!transcript) return null;
    return (
      transcript.segments.find(
        (segment) => currentMs >= segment.startMs && currentMs < segment.endMs,
      )?.id ?? null
    );
  }, [currentMs, transcript]);

  useEffect(() => {
    activeSegmentRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [activeSegmentId]);

  function seek(startMs: number) {
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = startMs / 1000;
    setCurrentMs(startMs);
    void media.play();
  }

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
      <main className="grid min-h-screen place-items-center bg-zinc-50 px-5 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
        <p className="rounded-2xl border border-red-200 bg-red-50 px-6 py-5 text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300">
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
    const isVideo = transcript.media.mimeType.startsWith('video/');

    return (
      <main className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
          <header className="mb-8">
            <p className="mb-3 text-xs font-extrabold tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
              SONAVRA
            </p>
            <h1 className="break-words text-2xl font-bold tracking-tight sm:text-4xl">
              {transcript.filename}
            </h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Transcript
              {transcript.language
                ? ` · ${transcript.language.toUpperCase()}`
                : ''}
            </p>
          </header>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
            <article className="min-w-0 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="space-y-2">
                {transcript.segments.map((segment) => {
                  const active = segment.id === activeSegmentId;
                  return (
                    <section
                      key={segment.id}
                      ref={active ? activeSegmentRef : undefined}
                      className={`group grid scroll-m-24 gap-2 rounded-2xl p-3 transition sm:grid-cols-[7rem_1fr] sm:p-4 ${
                        active
                          ? 'bg-zinc-100 ring-1 ring-zinc-300 dark:bg-zinc-800 dark:ring-zinc-700'
                          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      <div className="text-sm text-zinc-500 dark:text-zinc-400">
                        <strong className="block truncate text-zinc-800 dark:text-zinc-200">
                          {segment.speakerId
                            ? speakers.get(segment.speakerId)
                            : 'Speaker'}
                        </strong>
                        <button
                          type="button"
                          onClick={() => seek(segment.startMs)}
                          className="mt-1 rounded font-mono text-xs tabular-nums underline-offset-4 hover:text-zinc-950 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:text-white"
                          aria-label={`Play from ${formatTime(segment.startMs)}`}
                        >
                          {formatTime(segment.startMs)}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => seek(segment.startMs)}
                        className="text-left leading-7 text-zinc-800 focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-zinc-200"
                      >
                        {segment.text}
                      </button>
                    </section>
                  );
                })}
              </div>
            </article>

            <aside className="lg:sticky lg:top-6">
              <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Playback
                </p>
                {isVideo ? (
                  <video
                    ref={mediaRef as React.RefObject<HTMLVideoElement>}
                    src={transcript.media.url}
                    controls
                    preload="metadata"
                    onTimeUpdate={(event) =>
                      setCurrentMs(event.currentTarget.currentTime * 1000)
                    }
                    className="aspect-video w-full rounded-2xl bg-black"
                  />
                ) : (
                  <audio
                    ref={mediaRef as React.RefObject<HTMLAudioElement>}
                    src={transcript.media.url}
                    controls
                    preload="metadata"
                    onTimeUpdate={(event) =>
                      setCurrentMs(event.currentTarget.currentTime * 1000)
                    }
                    className="w-full"
                  />
                )}
                <p className="mt-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  Click any timestamp or transcript segment to jump to that
                  moment.
                </p>
              </div>
            </aside>
          </div>
        </div>
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
