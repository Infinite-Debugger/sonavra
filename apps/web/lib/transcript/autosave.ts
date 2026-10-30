import type { TranscriptResponse } from '@sonavra/types';

export function reapplyTranscriptDrafts(
  latest: TranscriptResponse,
  drafts: TranscriptDraft[],
): TranscriptResponse | null {
  if (
    drafts.some((draft) =>
      draft.kind === 'segment'
        ? !latest.segments.some((item) => item.id === draft.id)
        : !latest.speakers.some((item) => item.id === draft.id),
    )
  )
    return null;
  return {
    ...latest,
    segments: latest.segments.map((segment) => ({
      ...segment,
      text:
        drafts.find(
          (draft) => draft.kind === 'segment' && draft.id === segment.id,
        )?.value ?? segment.text,
    })),
    speakers: latest.speakers.map((speaker) => ({
      ...speaker,
      displayName:
        drafts.find(
          (draft) => draft.kind === 'speaker' && draft.id === speaker.id,
        )?.value ?? speaker.displayName,
    })),
  };
}

export type SaveState =
  'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';
export type TranscriptDraft = {
  kind: 'segment' | 'speaker';
  id: string;
  value: string;
};
export const draftKey = (draft: Pick<TranscriptDraft, 'kind' | 'id'>) =>
  `${draft.kind}:${draft.id}`;
export class EditConflict extends Error {}

// One queue and revision across text and speaker fields. Acknowledgments never
// write into the editor: a response can only remove the exact draft it sent.
export class TranscriptAutosave {
  private readonly drafts = new Map<
    string,
    TranscriptDraft & { sequence: number }
  >();
  private sequence = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private busy = false;
  private stopped = false;
  private blocked: 'error' | 'conflict' | null = null;
  private readonly abort = new AbortController();

  constructor(
    private revision: string,
    private readonly save: (
      draft: TranscriptDraft,
      revision: string,
      signal: AbortSignal,
    ) => Promise<{ revision: string }>,
    private readonly changed: (
      state: SaveState,
      drafts: TranscriptDraft[],
    ) => void,
    private readonly saved: () => void,
  ) {}

  get unsaved() {
    return this.drafts.size > 0;
  }
  get pending(): TranscriptDraft[] {
    return [...this.drafts.values()].map(({ kind, id, value }) => ({
      kind,
      id,
      value,
    }));
  }
  private emit(state: SaveState) {
    if (!this.stopped) this.changed(state, this.pending);
  }

  edit(draft: TranscriptDraft) {
    if (this.stopped) return;
    this.drafts.set(draftKey(draft), { ...draft, sequence: ++this.sequence });
    this.emit(this.blocked ?? (this.busy ? 'saving' : 'dirty'));
    if (!this.blocked && !this.busy) this.schedule();
  }

  private schedule(delay = 650) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  async flush() {
    if (this.stopped || this.busy || this.blocked || !this.unsaved) return;
    clearTimeout(this.timer);
    const draft = this.drafts.values().next().value!;
    this.busy = true;
    this.emit('saving');
    try {
      const result = await this.save(draft, this.revision, this.abort.signal);
      if (this.stopped) return;
      this.revision = result.revision;
      if (this.drafts.get(draftKey(draft))?.sequence === draft.sequence)
        this.drafts.delete(draftKey(draft));
      this.saved();
    } catch (error) {
      if (!this.stopped)
        this.blocked = error instanceof EditConflict ? 'conflict' : 'error';
    } finally {
      this.busy = false;
      if (!this.stopped) {
        this.emit(this.blocked ?? (this.unsaved ? 'dirty' : 'saved'));
        if (this.unsaved && !this.blocked) this.schedule();
      }
    }
  }

  retry() {
    if (this.blocked !== 'error') return;
    this.blocked = null;
    this.emit('dirty');
    this.schedule(0);
  }

  recover(revision: string, discard = false) {
    if (this.busy || this.stopped) return;
    this.revision = revision;
    this.blocked = null;
    if (discard) this.drafts.clear();
    this.emit(this.unsaved ? 'dirty' : 'saved');
    if (this.unsaved) this.schedule(0);
  }

  dispose() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.abort.abort();
  }
}
