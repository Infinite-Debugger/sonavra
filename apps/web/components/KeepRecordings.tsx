'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { RecordingStatusResponse } from '@sonavra/types';

export default function KeepRecordings({
  recordingId,
  status,
  onSaved,
}: {
  recordingId: string;
  status: RecordingStatusResponse | null;
  onSaved: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (!status) return null;
  if (status.ownership === 'account')
    return (
      <p
        role="status"
        className="mt-4 text-sm text-emerald-700 dark:text-emerald-300"
      >
        Saved to your account
      </p>
    );
  const commandClass =
    'rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 disabled:cursor-wait disabled:opacity-60 dark:bg-emerald-400 dark:text-zinc-950 dark:hover:bg-emerald-300';
  async function save() {
    setPending(true);
    setError('');
    try {
      const guestSessionId = localStorage.getItem('sonavraGuestSessionId');
      if (!guestSessionId)
        throw new Error('This guest session is no longer available.');
      const response = await fetch('/api/auth/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ guestSessionId }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(
          data?.message ?? 'Unable to keep your recordings. Please try again.',
        );
      }
      await onSaved();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to keep your recordings. Please try again.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Guest recording
          {status.expiresAt
            ? ` · Media and transcript expire ${new Date(status.expiresAt).toLocaleString()}`
            : ''}
        </p>
        {status.canClaim ? (
          <button
            type="button"
            onClick={() => void save()}
            disabled={pending}
            className={commandClass}
          >
            {pending ? 'Saving…' : 'Save to account'}
          </button>
        ) : (
          <Link
            className={commandClass}
            href={`/signup?next=${encodeURIComponent(`/recordings/${recordingId}`)}`}
          >
            Create account to keep
          </Link>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
