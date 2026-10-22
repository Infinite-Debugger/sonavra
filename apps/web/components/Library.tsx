'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { LibraryItem, LibraryResponse } from '@sonavra/types';

const statuses = {
  UPLOADING: 'Uploading',
  UPLOADED: 'Preparing',
  QUEUED: 'Queued',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};
const inputClass =
  'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-emerald-600 dark:border-zinc-700 dark:bg-zinc-900';
const iconClass =
  'grid size-9 shrink-0 place-items-center rounded-md hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:opacity-40 dark:hover:bg-zinc-800';

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`/api/library/recordings${path}`, {
    cache: 'no-store',
    ...init,
  });
  if (response.status === 401) {
    window.location.assign('/signin?next=/library');
    throw new Error('Sign in to access your library.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      data?.message ?? 'Unable to update your library. Please try again.',
    );
  return data;
}

export default function Library() {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<LibraryItem | null>(null);
  const [title, setTitle] = useState('');
  const [remove, setRemove] = useState<LibraryItem | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const latest = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++latest.current;
    setBusy(true);
    try {
      const next = (await request(
        `?q=${encodeURIComponent(search)}&page=${page}`,
      )) as LibraryResponse;
      if (sequence === latest.current) {
        setData(next);
        setError('');
      }
    } catch (error) {
      if (sequence === latest.current)
        setError(
          error instanceof Error ? error.message : 'Unable to load library.',
        );
    } finally {
      if (sequence === latest.current) setBusy(false);
    }
  }, [search, page]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => {
      clearTimeout(timer);
      latest.current++;
    };
  }, [load]);
  useEffect(() => {
    if (
      !data?.items.some(
        (item) =>
          !item.deletionPending &&
          ['UPLOADING', 'UPLOADED', 'QUEUED', 'PROCESSING'].includes(
            item.status,
          ),
      )
    )
      return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [data, load]);
  useEffect(() => {
    if (remove) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [remove]);
  async function rename() {
    if (!edit || actionPending) return;
    setActionPending(true);
    setError('');
    try {
      await request(`/${edit.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      setEdit(null);
      await load();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Unable to rename recording.',
      );
    } finally {
      setActionPending(false);
    }
  }
  async function deleteRecording() {
    if (!remove || actionPending) return;
    setActionPending(true);
    setError('');
    try {
      await request(`/${remove.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      setRemove(null);
      if (data?.items.length === 1 && page > 1) setPage(page - 1);
      else await load();
    } catch (error) {
      setRemove(null);
      await load();
      setError(
        error instanceof Error ? error.message : 'Unable to delete recording.',
      );
    } finally {
      setActionPending(false);
    }
  }
  return (
    <main className="min-h-[calc(100svh-4rem)] bg-white px-4 py-8 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Library</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {data
                ? `${data.total} recording${data.total === 1 ? '' : 's'}`
                : 'Loading recordings'}
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 dark:bg-emerald-400 dark:text-zinc-950"
          >
            <Plus size={16} />
            Upload recording
          </Link>
        </header>
        <div className="my-6 flex items-center gap-3">
          <input
            type="search"
            aria-label="Search recordings"
            placeholder="Search recordings"
            maxLength={200}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            className={`${inputClass} w-full max-w-md`}
          />
          {busy && (
            <Loader2
              size={18}
              className="animate-spin text-zinc-500"
              aria-label="Loading"
            />
          )}
        </div>
        {error && (
          <div className="mb-4 flex flex-wrap items-center gap-3" role="alert">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="text-sm underline focus-visible:outline-2 focus-visible:outline-emerald-600"
            >
              Retry
            </button>
          </div>
        )}
        <div
          className="border-y border-zinc-200 dark:border-zinc-800"
          aria-busy={busy}
        >
          {data?.items.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-zinc-200 py-4 last:border-b-0 dark:border-zinc-800 sm:grid-cols-[minmax(0,1fr)_8rem_9rem_auto] sm:items-center"
            >
              <div className="min-w-0">
                {edit?.id === item.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void rename();
                    }}
                    className="flex gap-1"
                  >
                    <input
                      aria-label="Recording title"
                      autoFocus
                      maxLength={200}
                      required
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      className={`${inputClass} min-w-0 flex-1`}
                    />
                    <button
                      className={iconClass}
                      aria-label="Save title"
                      title="Save title"
                      disabled={actionPending}
                    >
                      <Check size={16} />
                    </button>
                    <button
                      type="button"
                      className={iconClass}
                      aria-label="Cancel rename"
                      title="Cancel rename"
                      onClick={() => setEdit(null)}
                    >
                      <X size={16} />
                    </button>
                  </form>
                ) : item.deletionPending ? (
                  <p className="break-words font-medium">{item.title}</p>
                ) : (
                  <Link
                    href={`/recordings/${item.id}`}
                    className="block break-words rounded-sm font-medium hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-emerald-600 dark:hover:text-emerald-300"
                  >
                    {item.title}
                  </Link>
                )}
                {item.title !== item.originalFilename && (
                  <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {item.originalFilename}
                  </p>
                )}
              </div>
              <span
                className={`col-start-1 text-xs sm:col-auto ${item.deletionPending || item.status === 'FAILED' ? 'text-red-700 dark:text-red-300' : item.status === 'COMPLETED' ? 'text-emerald-700 dark:text-emerald-300' : 'text-zinc-600 dark:text-zinc-400'}`}
              >
                {item.deletionPending
                  ? 'Deletion pending'
                  : statuses[item.status]}
              </span>
              <time
                dateTime={item.createdAt}
                className="col-start-1 text-xs text-zinc-500 dark:text-zinc-400 sm:col-auto"
              >
                {new Date(item.createdAt).toLocaleDateString()}
              </time>
              <div className="col-start-2 row-start-1 flex gap-1 sm:col-auto sm:row-auto">
                <button
                  type="button"
                  className={iconClass}
                  aria-label={`Rename ${item.title}`}
                  title="Rename"
                  disabled={item.deletionPending || actionPending}
                  onClick={() => {
                    setEdit(item);
                    setTitle(item.title);
                  }}
                >
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  className={`${iconClass} text-red-700 dark:text-red-300`}
                  aria-label={`Delete ${item.title}`}
                  title={item.deletionPending ? 'Retry deletion' : 'Delete'}
                  disabled={actionPending}
                  onClick={() => setRemove(item)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
          {data && !data.items.length && (
            <p className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {search
                ? 'No recordings match your search.'
                : 'No saved recordings yet.'}
            </p>
          )}
          {!data && !error && (
            <p
              role="status"
              className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400"
            >
              Loading recordings
            </p>
          )}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            className={iconClass}
            aria-label="Previous page"
            title="Previous page"
            disabled={page === 1 || busy}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm">Page {page}</span>
          <button
            className={iconClass}
            aria-label="Next page"
            title="Next page"
            disabled={!data?.hasMore || busy}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <dialog
          ref={dialogRef}
          onCancel={(event) => {
            if (actionPending) event.preventDefault();
            else setRemove(null);
          }}
          onClose={() => setRemove(null)}
          className="m-auto w-[calc(100%_-_2rem)] max-w-md rounded-lg border border-zinc-300 bg-white p-6 text-zinc-950 backdrop:bg-black/50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          aria-labelledby="delete-title"
        >
          <h2 id="delete-title" className="text-lg font-semibold">
            Delete recording?
          </h2>
          <p className="mt-3 break-words text-sm text-zinc-600 dark:text-zinc-400">
            {remove?.title}
          </p>
          <p className="mt-3 text-sm">
            The media and transcript will be permanently removed.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              disabled={actionPending}
              onClick={() => setRemove(null)}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-emerald-600 dark:border-zinc-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={actionPending}
              onClick={() => void deleteRecording()}
              className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-600 disabled:opacity-50"
            >
              {actionPending ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </dialog>
      </div>
    </main>
  );
}
