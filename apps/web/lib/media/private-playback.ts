import type { RecordingMediaResponse } from '@sonavra/types';

export type PlaybackState =
  'ready' | 'refreshing' | 'offline' | 'denied' | 'failed' | 'resume';
export class PlaybackAccessError extends Error {}

export interface PlaybackMedia extends EventTarget {
  src: string;
  currentTime: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly duration: number;
  readonly error: { code: number } | null;
  load(): void;
  play(): Promise<void>;
}

// Own only media authorization and transport state, never transcript drafts.
export class PrivatePlayback {
  private expiresAt: number;
  private timer?: ReturnType<typeof setTimeout>;
  private restoreTimer?: ReturnType<typeof setTimeout>;
  private pending: Promise<void> | null = null;
  private stopped = false;
  private denied = false;
  private attempts = 0;
  private restore: { time: number; playing: boolean } | null = null;
  private progressAt = 0;
  private recovered = false;
  private wantsPlay: boolean;
  private readonly abort = new AbortController();

  constructor(
    private readonly media: PlaybackMedia,
    initial: RecordingMediaResponse,
    private readonly renew: (
      signal: AbortSignal,
    ) => Promise<RecordingMediaResponse>,
    private readonly state: (state: PlaybackState) => void,
  ) {
    this.wantsPlay = !media.paused && !media.ended;
    this.expiresAt = Date.parse(initial.expiresAt);
    media.src = initial.url;
    media.addEventListener('error', this.onError);
    media.addEventListener('loadedmetadata', this.onMetadata);
    media.addEventListener('canplay', this.onMetadata);
    media.addEventListener('timeupdate', this.onProgress);
    media.addEventListener('play', this.onPlay);
    media.addEventListener('pause', this.onPause);
    this.schedule();
  }

  private schedule() {
    clearTimeout(this.timer);
    if (this.stopped) return;
    const remaining = this.expiresAt - Date.now();
    const lead = Math.min(30_000, Math.max(1000, remaining / 10));
    this.timer = setTimeout(
      () => {
        this.attempts = 0;
        void this.refresh();
      },
      Math.max(1000, remaining - lead),
    );
  }

  // Also called on foregrounding: suspended browser timers may run late.
  checkExpiry = () => {
    if (!this.denied && Date.now() >= this.expiresAt - 1000)
      void this.refresh();
  };

  private onPlay = () => {
    this.wantsPlay = true;
  };
  private onPause = () => {
    if (!this.restore && !this.media.error) this.wantsPlay = false;
  };

  private onError = () => {
    if (this.denied) return;
    const code = this.media.error?.code;
    // Browsers can report a rejected signed URL as either a network error or
    // an unsupported source. Do not retry aborted or malformed decoded media.
    if (code === 2 || code === 4) void this.refresh();
    else if (code !== 1) {
      clearTimeout(this.timer);
      this.state('failed');
    }
  };

  private onProgress = () => {
    if (
      this.recovered &&
      !this.restore &&
      Math.abs(this.media.currentTime - this.progressAt) >= 1
    ) {
      this.attempts = 0;
      this.progressAt = this.media.currentTime;
    }
  };

  private onMetadata = () => {
    if (!this.restore || this.stopped || this.denied) return;
    const snapshot = this.restore;
    try {
      this.media.currentTime = Math.max(
        0,
        Number.isFinite(this.media.duration)
          ? Math.min(snapshot.time, this.media.duration)
          : snapshot.time,
      );
    } catch {
      // Some mobile players cannot seek until canplay. Keep the snapshot and
      // deadline rather than resetting to zero or losing the intended state.
      return;
    }
    this.restore = null;
    this.recovered = true;
    clearTimeout(this.restoreTimer);
    this.progressAt = this.media.currentTime;
    this.state('ready');
    this.schedule();
    if (snapshot.playing) this.play();
  };

  private play() {
    this.wantsPlay = true;
    void this.media
      .play()
      .then(() => {
        if (!this.stopped && !this.denied) this.state('ready');
      })
      .catch(() => {
        if (!this.stopped && !this.denied) this.state('resume');
      });
  }

  seek(time: number) {
    if (this.restore) this.restore = { time, playing: true };
    else {
      try {
        this.media.currentTime = time;
        this.play();
      } catch {
        this.state('failed');
      }
    }
  }

  resume() {
    this.play();
  }

  refresh(manual = false): Promise<void> {
    if (this.stopped || this.denied) return Promise.resolve();
    if (this.pending) return this.pending;
    clearTimeout(this.timer);
    if (manual) this.attempts = 0;
    if (this.attempts >= 2) {
      clearTimeout(this.restoreTimer);
      this.state('failed');
      return Promise.resolve();
    }
    this.attempts++;
    this.recovered = false;
    this.state('refreshing');
    this.pending = this.replace().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async replace() {
    try {
      const next = await this.renew(this.abort.signal);
      if (this.stopped) return;
      const expiresAt = Date.parse(next.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
        throw new Error();
      // Capture after the request: controls remain usable while it is pending.
      this.restore ??= {
        time: this.media.currentTime,
        playing: this.wantsPlay && !this.media.ended,
      };
      this.expiresAt = expiresAt;
      clearTimeout(this.restoreTimer);
      this.restoreTimer = setTimeout(() => {
        this.state('failed');
      }, 15_000);
      this.media.src = next.url;
      this.media.load();
    } catch (error) {
      if (this.stopped) return;
      clearTimeout(this.restoreTimer);
      if (error instanceof PlaybackAccessError) {
        this.denied = true;
        this.state('denied');
      } else {
        this.state('offline');
        if (this.attempts < 2)
          this.timer = setTimeout(() => void this.refresh(), 1000);
      }
    }
  }

  dispose() {
    this.stopped = true;
    this.abort.abort();
    clearTimeout(this.timer);
    clearTimeout(this.restoreTimer);
    this.media.removeEventListener('error', this.onError);
    this.media.removeEventListener('loadedmetadata', this.onMetadata);
    this.media.removeEventListener('canplay', this.onMetadata);
    this.media.removeEventListener('timeupdate', this.onProgress);
    this.media.removeEventListener('play', this.onPlay);
    this.media.removeEventListener('pause', this.onPause);
  }
}
