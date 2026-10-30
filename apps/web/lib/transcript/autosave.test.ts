import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TranscriptAutosave,
  EditConflict,
  reapplyTranscriptDrafts,
  type SaveState,
  type TranscriptDraft,
} from './autosave';
import type { TranscriptResponse } from '@sonavra/types';

const latest: TranscriptResponse = {
  revision: 'latest',
  recordingId: 'recording',
  filename: 'synthetic.ogg',
  language: null,
  durationMs: 1000,
  media: { url: 'private', mimeType: 'audio/ogg', expiresAt: 'later' },
  segments: [
    {
      id: 'a',
      sequence: 0,
      startMs: 0,
      endMs: 1000,
      text: 'Saved remotely',
      speakerId: 's',
    },
    {
      id: 'b',
      sequence: 1,
      startMs: 1000,
      endMs: 2000,
      text: 'Keep remote correction',
      speakerId: 's',
    },
  ],
  speakers: [{ id: 's', label: 'Speaker 1', displayName: 'Remote speaker' }],
};

test('reapplication overlays only pending fields onto the loaded saved version', () => {
  const merged = reapplyTranscriptDrafts(latest, [
    { kind: 'segment', id: 'a', value: 'My local draft' },
  ])!;
  assert.equal(merged.revision, 'latest');
  assert.equal(merged.segments[0]?.text, 'My local draft');
  assert.equal(merged.segments[1]?.text, 'Keep remote correction');
  assert.equal(merged.speakers[0]?.displayName, 'Remote speaker');
  assert.equal(latest.segments[0]?.text, 'Saved remotely');
  const renamed = reapplyTranscriptDrafts(latest, [
    { kind: 'speaker', id: 's', value: 'My speaker label' },
  ])!;
  assert.equal(renamed.speakers[0]?.displayName, 'My speaker label');
  assert.deepEqual(renamed.segments, latest.segments);
});

test('removed fields cannot be silently discarded during reapplication', () => {
  const drafts: TranscriptDraft[] = [
    { kind: 'segment', id: 'removed', value: 'Retain this local text' },
  ];
  assert.equal(reapplyTranscriptDrafts(latest, drafts), null);
  assert.equal(drafts[0]?.value, 'Retain this local text');
  assert.deepEqual(reapplyTranscriptDrafts(latest, []), latest);
});

const draft = (value: string, id = 'a'): TranscriptDraft => ({
  kind: 'segment',
  id,
  value,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test('serializes fields and sends the latest local draft with each acknowledged revision', async (t) => {
  const first = deferred<{ revision: string }>();
  const calls: { value: string; revision: string }[] = [];
  const states: SaveState[] = [];
  let saved = 0;
  const queue = new TranscriptAutosave(
    'r0',
    async (edit, revision) => {
      calls.push({ value: edit.value, revision });
      return calls.length === 1
        ? first.promise
        : { revision: `r${calls.length}` };
    },
    (state) => states.push(state),
    () => {
      saved++;
    },
  );
  t.after(() => queue.dispose());
  queue.edit(draft('first'));
  const pending = queue.flush();
  queue.edit(draft('latest'));
  queue.edit({ kind: 'speaker', id: 'b', value: 'Ada' });
  await queue.flush();
  assert.equal(calls.length, 1); // No concurrent or reordered writes.
  first.resolve({ revision: 'r1' });
  await pending;
  assert.equal(saved, 1);
  assert.equal(queue.unsaved, true);
  assert.equal(states.at(-1), 'dirty');
  assert.equal(queue.pending[0]?.value, 'latest');
  await queue.flush();
  await queue.flush();
  assert.deepEqual(calls, [
    { value: 'first', revision: 'r0' },
    { value: 'latest', revision: 'r1' },
    { value: 'Ada', revision: 'r2' },
  ]);
  assert.equal(queue.unsaved, false);
  assert.equal(states.at(-1), 'saved');
});

test('keeps newer input after an older save fails and retries without losing other fields', async (t) => {
  const first = deferred<{ revision: string }>();
  const seen: string[] = [];
  const states: SaveState[] = [];
  const queue = new TranscriptAutosave(
    'r0',
    async (edit) => {
      seen.push(edit.value);
      return seen.length === 1 ? first.promise : { revision: 'r1' };
    },
    (state) => states.push(state),
    () => {},
  );
  t.after(() => queue.dispose());
  queue.edit(draft('older'));
  const pending = queue.flush();
  queue.edit(draft('latest'));
  first.reject(new Error('network failure'));
  await pending;
  assert.equal(states.at(-1), 'error');
  assert.equal(queue.pending[0]?.value, 'latest');
  await queue.flush();
  assert.equal(seen.length, 1);
  queue.retry();
  await queue.flush();
  assert.deepEqual(seen, ['older', 'latest']);
  assert.equal(states.at(-1), 'saved');
});

test('never retries a conflict automatically and reapplies only after explicit recovery', async (t) => {
  let conflict = true;
  const revisions: string[] = [];
  const states: SaveState[] = [];
  const queue = new TranscriptAutosave(
    'r0',
    async (_, revision) => {
      revisions.push(revision);
      if (conflict) throw new EditConflict();
      return { revision: 'r3' };
    },
    (state) => states.push(state),
    () => {},
  );
  t.after(() => queue.dispose());
  queue.edit(draft('local'));
  await queue.flush();
  queue.edit(draft('newer local'));
  queue.retry();
  await queue.flush();
  assert.equal(states.at(-1), 'conflict');
  assert.equal(revisions.length, 1);
  assert.equal(queue.pending[0]?.value, 'newer local');
  conflict = false;
  queue.recover('r2');
  await queue.flush();
  assert.deepEqual(revisions, ['r0', 'r2']);
  assert.equal(queue.unsaved, false);
});

test('discard recovery clears local drafts without issuing a write', async (t) => {
  let calls = 0;
  const queue = new TranscriptAutosave(
    'r0',
    async () => {
      calls++;
      throw new EditConflict();
    },
    () => {},
    () => {},
  );
  t.after(() => queue.dispose());
  queue.edit(draft('local'));
  await queue.flush();
  queue.recover('r1', true);
  await queue.flush();
  assert.equal(calls, 1);
  assert.equal(queue.unsaved, false);
});

test('ignores a late acknowledgment after the recording was left', async () => {
  const response = deferred<{ revision: string }>();
  let signal!: AbortSignal;
  let saved = 0;
  const states: SaveState[] = [];
  const queue = new TranscriptAutosave(
    'r0',
    async (_, __, nextSignal) => {
      signal = nextSignal;
      return response.promise;
    },
    (state) => states.push(state),
    () => {
      saved++;
    },
  );
  queue.edit(draft('local'));
  const pending = queue.flush();
  queue.dispose();
  response.resolve({ revision: 'r1' });
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(saved, 0);
  assert.deepEqual(states, ['dirty', 'saving']);
});
