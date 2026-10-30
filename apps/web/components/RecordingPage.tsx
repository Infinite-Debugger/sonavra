'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createTranscriptDocx } from '@/lib/transcript/docx';
import TranscriptSummary from '@/components/TranscriptSummary';
import KeepRecordings from '@/components/KeepRecordings';
import PrivateMediaPlayer, {
  type PrivateMediaPlayerHandle,
} from '@/components/PrivateMediaPlayer';
import { useParams } from 'next/navigation';
import {
  speakerName,
  transcriptText,
  transcriptSrt,
  transcriptVtt,
} from '@/lib/transcript/exports';
import type {
  RecordingStatusResponse,
  TranscriptEditResponse,
  TranscriptResponse,
} from '@sonavra/types';

import {
  TranscriptAutosave,
  reapplyTranscriptDrafts,
  EditConflict,
  type SaveState,
  type TranscriptDraft,
} from '@/lib/transcript/autosave';
import TranscriptEditRecovery from '@/components/TranscriptEditRecovery';
import { useUnsavedTranscriptWarning } from '@/lib/transcript/use-unsaved-warning';

async function getJson<T>(
  path: string,
  guestSessionId?: string | null,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api${path}${guestSessionId ? `?guestSessionId=${encodeURIComponent(guestSessionId)}` : ''}`,
    { cache: 'no-store', signal },
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

function SaveIndicator({ state }: { state: SaveState }) {
  const label = {
    idle: 'All changes saved',
    dirty: 'Unsaved changes',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed',
    conflict: 'Conflicting changes',
  }[state];

  return (
    <span
      role="status"
      className={`text-xs ${
        state === 'error' || state === 'conflict'
          ? 'text-red-600 dark:text-red-400'
          : 'text-zinc-500 dark:text-zinc-400'
      }`}
    >
      {label}
    </span>
  );
}

export default function RecordingPage() {
  const { recordingId } = useParams<{ recordingId: string }>();
  const playerRef = useRef<PrivateMediaPlayerHandle>(null);
  const activeSegmentRef = useRef<HTMLElement>(null);
  const autosave = useRef<TranscriptAutosave | null>(null);
  const [drafts, setDrafts] = useState<TranscriptDraft[]>([]);
  const [latest, setLatest] = useState<TranscriptResponse | null>(null);
  const [loadingLatest, setLoadingLatest] = useState(false);
  useUnsavedTranscriptWarning(drafts.length > 0);
  const [status, setStatus] = useState<RecordingStatusResponse | null>(null);
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [savedRevision, setSavedRevision] = useState(0);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [search, setSearch] = useState('');
  const [copyStatus, setCopyStatus] = useState('');

  useEffect(() => {
    const guestSessionId = localStorage.getItem('sonavraGuestSessionId');

    let stopped = false;
    let manager: TranscriptAutosave | null = null;
    setTranscript(null);
    setLatest(null);
    setDrafts([]);
    setSaveState('idle');
    setSaveError('');
    setError('');
    setLoadingLatest(false);
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const next = await getJson<RecordingStatusResponse>(
          `/recordings/${recordingId}/status`,
          guestSessionId,
        );
        if (stopped) return;
        setStatus(next);
        if (next.status === 'COMPLETED') {
          const result = await getJson<TranscriptResponse>(
            `/recordings/${recordingId}/transcript`,
            guestSessionId,
          );
          if (!stopped) {
            manager = new TranscriptAutosave(
              result.revision,
              async (draft, revision, signal) => {
                const guest = localStorage.getItem('sonavraGuestSessionId');
                const response = await fetch(
                  `/api/recordings/${recordingId}/transcript/${draft.kind === 'segment' ? 'segments' : 'speakers'}/${draft.id}`,
                  {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    signal: AbortSignal.any([
                      signal,
                      AbortSignal.timeout(10_000),
                    ]),
                    body: JSON.stringify({
                      revision,
                      guestSessionId: guest ?? undefined,
                      [draft.kind === 'segment' ? 'text' : 'displayName']:
                        draft.value,
                    }),
                  },
                );
                if (response.status === 409 || response.status === 428)
                  throw new EditConflict();
                if (!response.ok) throw new Error();
                return (await response.json()) as TranscriptEditResponse;
              },
              (state, pending) => {
                setSaveState(state);
                setDrafts(pending);
              },
              () => setSavedRevision((revision) => revision + 1),
            );
            autosave.current = manager;
            setTranscript(result);
          }
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
      manager?.dispose();
      if (autosave.current === manager) autosave.current = null;
    };
  }, [recordingId]);

  useEffect(() => {
    if (!transcript) return;
    document.title = `${transcript.title ?? transcript.filename} · Sonavra`;
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
    playerRef.current?.seek(startMs / 1000);
    setCurrentMs(startMs);
  }

  function updateSegment(segmentId: string, text: string) {
    setTranscript((current) =>
      current
        ? {
            ...current,
            segments: current.segments.map((segment) =>
              segment.id === segmentId ? { ...segment, text } : segment,
            ),
          }
        : current,
    );
    autosave.current?.edit({ kind: 'segment', id: segmentId, value: text });
  }

  function updateSpeaker(speakerId: string, displayName: string) {
    setTranscript((current) =>
      current
        ? {
            ...current,
            speakers: current.speakers.map((speaker) =>
              speaker.id === speakerId ? { ...speaker, displayName } : speaker,
            ),
          }
        : current,
    );
    autosave.current?.edit({
      kind: 'speaker',
      id: speakerId,
      value: displayName,
    });
  }

  async function loadLatest() {
    const manager = autosave.current;
    if (!manager) return;
    setLoadingLatest(true);
    setSaveError('');
    try {
      const next = await getJson<TranscriptResponse>(
        `/recordings/${recordingId}/transcript`,
        localStorage.getItem('sonavraGuestSessionId'),
        AbortSignal.timeout(10_000),
      );
      if (autosave.current === manager) setLatest(next);
    } catch {
      if (autosave.current === manager)
        setSaveError(
          'Unable to load the latest saved version. Your local edits are still here.',
        );
    } finally {
      if (autosave.current === manager) setLoadingLatest(false);
    }
  }

  function recover(discard: boolean) {
    if (!latest || !autosave.current) return;
    if (
      discard &&
      !window.confirm(
        'Discard all unsaved transcript and speaker edits and use the latest saved version?',
      )
    )
      return;
    const pending = discard ? [] : autosave.current.pending;
    const merged = reapplyTranscriptDrafts(latest, pending);
    if (!merged) {
      setSaveError(
        'Some edited fields were removed. Copy your local text before discarding it.',
      );
      return;
    }
    setTranscript((current) => ({
      ...merged,
      media: current?.media ?? merged.media,
    }));
    autosave.current.recover(latest.revision, discard);
    setLatest(null);
    setSaveError('');
    setSavedRevision((revision) => revision + 1);
  }

  async function copyTranscript() {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcriptText(transcript));
      setCopyStatus('Copied transcript');
    } catch {
      setCopyStatus('Unable to copy transcript');
    }
  }

  function downloadTranscript(format: 'txt' | 'srt' | 'vtt' | 'docx') {
    if (!transcript) return;
    const content =
      format === 'docx'
        ? createTranscriptDocx(transcript)
        : format === 'txt'
          ? transcriptText(transcript)
          : format === 'srt'
            ? transcriptSrt(transcript)
            : transcriptVtt(transcript);
    const mime =
      format === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : format === 'txt'
          ? 'text/plain'
          : format === 'srt'
            ? 'application/x-subrip'
            : 'text/vtt';
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download =
      transcript.filename.replace(/\.[^.]+$/, '') + '.' + format;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function retry() {
    const guestSessionId = localStorage.getItem('sonavraGuestSessionId');
    setRetrying(true);
    try {
      const response = await fetch(
        `/api/recordings/${recordingId}/transcription-jobs`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ guestSessionId: guestSessionId ?? undefined }),
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
    const query = search.trim().toLowerCase();
    const visibleSegments = transcript.segments.filter((segment) => {
      if (!query) return true;
      return (
        segment.text.toLowerCase().includes(query) ||
        speakerName(transcript, segment.speakerId).toLowerCase().includes(query)
      );
    });

    return (
      <main className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
          <header className="mb-8">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="text-xs font-extrabold tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
                SONAVRA
              </p>
              <SaveIndicator state={saveState} />
            </div>
            <h1 className="wrap-break-word text-2xl font-bold tracking-tight sm:text-4xl">
              {transcript.title ?? transcript.filename}
            </h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Transcript
              {transcript.language
                ? ` · ${transcript.language.toUpperCase()}`
                : ''}
            </p>
            {saveError && (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">
                {saveError}
              </p>
            )}
            <KeepRecordings
              recordingId={recordingId}
              status={status}
              onSaved={async () => {
                const next = await getJson<RecordingStatusResponse>(
                  `/recordings/${recordingId}/status`,
                  localStorage.getItem('sonavraGuestSessionId'),
                );
                if (next.ownership !== 'account')
                  throw new Error(
                    'This recording could not be kept. Please try again.',
                  );
                setStatus(next);
              }}
            />
          </header>

          {(saveState === 'error' || saveState === 'conflict') && (
            <TranscriptEditRecovery
              state={saveState}
              drafts={drafts}
              latest={latest}
              loading={loadingLatest}
              onLoad={() => void loadLatest()}
              onReapply={() => recover(false)}
              onDiscard={() => recover(true)}
              onRetry={() => {
                setLatest(null);
                autosave.current?.retry();
              }}
            />
          )}
          <TranscriptSummary
            recordingId={recordingId}
            revision={savedRevision}
            hasUnsavedChanges={
              saveState === 'dirty' ||
              saveState === 'saving' ||
              saveState === 'error' ||
              saveState === 'conflict'
            }
          />

          <div className="mb-6 flex flex-wrap items-center gap-3">
            <input
              type="search"
              aria-label="Search transcript"
              placeholder="Search transcript"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full min-w-0 flex-none rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm sm:w-auto sm:flex-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="button"
              onClick={() => void copyTranscript()}
              className="rounded-xl border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
            >
              Copy
            </button>
            {(['txt', 'srt', 'vtt', 'docx'] as const).map((format) => (
              <button
                key={format}
                type="button"
                onClick={() => downloadTranscript(format)}
                className="rounded-xl border border-zinc-300 px-4 py-2 text-sm uppercase dark:border-zinc-700"
              >
                {format}
              </button>
            ))}
            <span role="status" className="text-xs text-zinc-500">
              {copyStatus}
            </span>
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
            <article className="min-w-0 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="space-y-2">
                {visibleSegments.length === 0 && (
                  <p className="rounded-2xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                    No transcript matches.
                  </p>
                )}
                {visibleSegments.map((segment) => {
                  const active = segment.id === activeSegmentId;
                  const speaker = segment.speakerId
                    ? transcript.speakers.find(
                        (item) => item.id === segment.speakerId,
                      )
                    : null;
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
                        {speaker ? (
                          <input
                            aria-label={`Rename ${speaker.label}`}
                            value={speaker.displayName ?? speaker.label}
                            onChange={(event) =>
                              updateSpeaker(speaker.id, event.target.value)
                            }
                            className="block w-full rounded-md bg-transparent font-semibold text-zinc-800 outline-none focus:bg-white focus:ring-2 focus:ring-zinc-300 dark:text-zinc-200 dark:focus:bg-zinc-950 dark:focus:ring-zinc-700"
                          />
                        ) : (
                          <strong className="block text-zinc-800 dark:text-zinc-200">
                            Speaker
                          </strong>
                        )}
                        <button
                          type="button"
                          onClick={() => seek(segment.startMs)}
                          className="mt-1 rounded font-mono text-xs tabular-nums underline-offset-4 hover:text-zinc-950 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:text-white"
                          aria-label={`Play from ${formatTime(segment.startMs)}`}
                        >
                          {formatTime(segment.startMs)}
                        </button>
                      </div>
                      <textarea
                        aria-label={`Transcript at ${formatTime(
                          segment.startMs,
                        )}`}
                        value={segment.text}
                        rows={Math.max(2, Math.ceil(segment.text.length / 80))}
                        onChange={(event) =>
                          updateSegment(segment.id, event.target.value)
                        }
                        className="w-full resize-y rounded-xl bg-transparent px-2 py-1 leading-7 text-zinc-800 outline-none focus:bg-white focus:ring-2 focus:ring-zinc-300 dark:text-zinc-200 dark:focus:bg-zinc-950 dark:focus:ring-zinc-700"
                      />
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
                <PrivateMediaPlayer
                  media={transcript.media}
                  recordingId={recordingId}
                  playerRef={playerRef}
                  onTimeUpdate={setCurrentMs}
                />
                <p className="mt-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  Click a timestamp to jump to that moment. Edit transcript text
                  and speaker names directly; changes save automatically.
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
