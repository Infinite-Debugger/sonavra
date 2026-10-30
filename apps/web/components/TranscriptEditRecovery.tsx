import type { TranscriptResponse } from '@sonavra/types';
import type { TranscriptDraft } from '@/lib/transcript/autosave';

export default function TranscriptEditRecovery({
  state,
  drafts,
  latest,
  loading,
  onLoad,
  onReapply,
  onDiscard,
  onRetry,
}: {
  state: 'error' | 'conflict';
  drafts: TranscriptDraft[];
  latest: TranscriptResponse | null;
  loading: boolean;
  onLoad: () => void;
  onReapply: () => void;
  onDiscard: () => void;
  onRetry: () => void;
}) {
  const rows = drafts.map((draft) => {
    const field =
      draft.kind === 'segment'
        ? latest?.segments.find((item) => item.id === draft.id)
        : latest?.speakers.find((item) => item.id === draft.id);
    const saved = field
      ? 'text' in field
        ? field.text
        : (field.displayName ?? field.label)
      : null;
    return { ...draft, saved };
  });
  const missing = rows.some((row) => row.saved === null);
  const button =
    'rounded-lg border border-amber-400 px-3 py-2 text-sm font-semibold hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 dark:border-amber-700 dark:hover:bg-amber-900';
  return (
    <section
      aria-labelledby="edit-recovery-heading"
      className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
    >
      <h2 id="edit-recovery-heading" className="font-semibold">
        {state === 'conflict'
          ? 'This transcript changed elsewhere'
          : 'Your edits could not be saved'}
      </h2>
      <p role="status" className="mt-2 text-sm">
        Your local edits are retained below. Load the latest saved version to
        compare, then explicitly reapply your edits or discard them.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {state === 'error' && (
          <button
            type="button"
            className={button}
            disabled={loading}
            onClick={onRetry}
          >
            Retry saving
          </button>
        )}
        <button
          type="button"
          className={button}
          disabled={loading}
          onClick={onLoad}
        >
          {loading ? 'Loading latest…' : 'Load latest for comparison'}
        </button>
      </div>
      {latest && (
        <>
          <ul className="mt-4 space-y-4">
            {rows.map((row, index) => (
              <li key={`${row.kind}:${row.id}`} className="min-w-0 text-sm">
                <h3 className="font-semibold">
                  {row.kind === 'segment' ? 'Transcript edit' : 'Speaker edit'}{' '}
                  {index + 1}
                </h3>
                <p className="mt-2 font-medium">Latest saved version</p>
                <p className="max-h-32 overflow-auto whitespace-pre-wrap break-words">
                  {row.saved ??
                    'This field was removed. Copy your local text before discarding it.'}
                </p>
                <p className="mt-2 font-medium">Your local edit</p>
                <p className="max-h-32 select-text overflow-auto whitespace-pre-wrap break-words">
                  {row.value}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className={button}
              disabled={missing || loading}
              onClick={onReapply}
            >
              Reapply my edits
            </button>
            <button
              type="button"
              className={button}
              disabled={loading}
              onClick={onDiscard}
            >
              Use latest and discard my edits
            </button>
          </div>
          {missing && (
            <p className="mt-2 text-sm">
              Some edited fields no longer exist. Your local text remains
              available to copy; it cannot be automatically reapplied.
            </p>
          )}
        </>
      )}
    </section>
  );
}
