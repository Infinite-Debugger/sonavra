'use client';

import { useEffect, useState } from 'react';
import type { TranscriptSummaryResponse } from '@sonavra/types';

export default function TranscriptSummary({
  recordingId,
  revision,
  hasUnsavedChanges,
}: {
  recordingId: string;
  revision: number;
  hasUnsavedChanges: boolean;
}) {
  const [data, setData] = useState<TranscriptSummaryResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const path = `/api/recordings/${recordingId}/summary`;

  useEffect(() => {
    let stopped = false;
    const guest = localStorage.getItem('sonavraGuestSessionId');
    void fetch(
      `${path}${guest ? `?guestSessionId=${encodeURIComponent(guest)}` : ''}`,
      { cache: 'no-store' },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            'Unable to load the summary. You can still review the transcript.',
          );
        const next = (await response.json()) as TranscriptSummaryResponse;
        if (!stopped) {
          setData(next);
          setError('');
        }
      })
      .catch((cause: unknown) => {
        if (!stopped)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load the summary.',
          );
      });
    return () => {
      stopped = true;
    };
  }, [path, revision]);

  async function generate() {
    setPending(true);
    setError('');
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          guestSessionId:
            localStorage.getItem('sonavraGuestSessionId') ?? undefined,
        }),
      });
      const next = (await response.json()) as TranscriptSummaryResponse & {
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          next.message ?? 'Unable to generate a summary. Please try again.',
        );
      setData(next);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to generate a summary. Please try again.',
      );
    } finally {
      setPending(false);
    }
  }

  const summary = data?.summary;
  return (
    <section
      aria-labelledby="summary-heading"
      aria-busy={pending}
      className="mb-8 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 sm:p-6 dark:border-emerald-900 dark:bg-emerald-950/20"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="summary-heading" className="text-lg font-semibold">
          AI summary
        </h2>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={pending || data?.available === false || hasUnsavedChanges}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-400 dark:text-zinc-950 dark:hover:bg-emerald-300"
        >
          {pending
            ? 'Generating…'
            : summary
              ? 'Regenerate summary'
              : 'Generate summary'}
        </button>
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Generated interpretation, separate from the verbatim transcript. Check
        it against the recording.
      </p>
      {summary ? (
        <div className="mt-4 space-y-4 wrap-break-word text-sm leading-6">
          <p className="whitespace-pre-wrap">{summary.text}</p>
          {summary.keyPoints.length > 0 && (
            <div>
              <h3 className="font-semibold">Key points</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {summary.keyPoints.map((point, i) => (
                  <li key={i}>{point}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="font-semibold">Action items</h3>
            {summary.actionItems.length ? (
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {summary.actionItems.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ) : (
              <p>No explicit action items identified.</p>
            )}
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Generated {new Date(summary.generatedAt).toLocaleString()}.{' '}
            {summary.stale &&
              'The transcript has changed. Regenerate to include saved edits.'}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          {!data
            ? error
              ? 'Try generating the summary again.'
              : 'Loading summary…'
            : data.available
              ? 'Generate an overview, key points and any explicit action items.'
              : 'Summary generation is currently unavailable. Your transcript remains available below.'}
        </p>
      )}
      {hasUnsavedChanges && (
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Save transcript edits before generating a summary.
        </p>
      )}
      {pending && (
        <p
          role="status"
          className="mt-3 text-sm text-zinc-600 dark:text-zinc-400"
        >
          Preparing your summary. You can continue reviewing the transcript.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
