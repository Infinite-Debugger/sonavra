'use client';

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import type { RecordingMediaResponse } from '@sonavra/types';
import {
  PlaybackAccessError,
  PrivatePlayback,
  type PlaybackState,
} from '@/lib/media/private-playback';

export interface PrivateMediaPlayerHandle {
  seek(time: number): void;
}

const messages: Record<PlaybackState, string> = {
  ready: '',
  refreshing: 'Refreshing private playback…',
  offline: 'Unable to reconnect. Check your connection and retry playback.',
  denied:
    'Playback access ended. Sign in again, or return to your library. Guest work may have expired or the recording may have been deleted.',
  failed:
    'Playback could not be restored. Retry playback or try a supported browser.',
  resume: 'Playback is ready. Press play to resume from your position.',
};

export default function PrivateMediaPlayer({
  media,
  recordingId,
  playerRef,
  onTimeUpdate,
}: {
  media: RecordingMediaResponse;
  recordingId: string;
  playerRef: Ref<PrivateMediaPlayerHandle>;
  onTimeUpdate: (milliseconds: number) => void;
}) {
  const element = useRef<HTMLMediaElement>(null);
  const playback = useRef<PrivatePlayback | null>(null);
  const [state, setState] = useState<PlaybackState>('ready');
  useImperativeHandle(
    playerRef,
    () => ({ seek: (time) => playback.current?.seek(time) }),
    [],
  );

  useEffect(() => {
    if (!element.current) return;
    const controller = new PrivatePlayback(
      element.current,
      media,
      async (signal) => {
        const guest = localStorage.getItem('sonavraGuestSessionId');
        const query = guest
          ? `?guestSessionId=${encodeURIComponent(guest)}`
          : '';
        const response = await fetch(
          `/api/recordings/${encodeURIComponent(recordingId)}/media${query}`,
          {
            cache: 'no-store',
            signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
          },
        );
        if ([401, 403, 404].includes(response.status))
          throw new PlaybackAccessError();
        if (!response.ok) throw new Error();
        return (await response.json()) as RecordingMediaResponse;
      },
      setState,
    );
    playback.current = controller;
    window.addEventListener('focus', controller.checkExpiry);
    const visible = () => {
      if (document.visibilityState === 'visible') controller.checkExpiry();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.dispose();
      playback.current = null;
      window.removeEventListener('focus', controller.checkExpiry);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [media, recordingId]);

  const shared = {
    controls: true,
    preload: 'metadata',
    onTimeUpdate: (event: React.SyntheticEvent<HTMLMediaElement>) =>
      onTimeUpdate(event.currentTarget.currentTime * 1000),
  };
  return (
    <>
      {media.mimeType.startsWith('video/') ? (
        <video
          ref={element as React.RefObject<HTMLVideoElement>}
          {...shared}
          className="aspect-video w-full rounded-2xl bg-black"
        />
      ) : (
        <audio
          ref={element as React.RefObject<HTMLAudioElement>}
          {...shared}
          className="w-full"
        />
      )}
      {state !== 'ready' && (
        <div className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
          <p role="status" aria-live="polite">
            {messages[state]}
          </p>
          {state !== 'refreshing' && state !== 'denied' && (
            <button
              type="button"
              onClick={() =>
                state === 'resume'
                  ? playback.current?.resume()
                  : void playback.current?.refresh(true)
              }
              className="mt-2 rounded-lg border border-zinc-300 px-3 py-2 font-semibold hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-600 dark:hover:bg-zinc-800"
            >
              {state === 'resume' ? 'Play' : 'Retry playback'}
            </button>
          )}
        </div>
      )}
    </>
  );
}
