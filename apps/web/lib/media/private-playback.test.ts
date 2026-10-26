import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PlaybackAccessError,
  PrivatePlayback,
  type PlaybackState,
} from './private-playback';

class Media extends EventTarget {
  src = '';
  currentTime = 42;
  duration = 120;
  paused = true;
  ended = false;
  error: { code: number } | null = null;
  plays = 0;
  blocked = false;
  load() {
    this.currentTime = 0;
    this.paused = true;
  }
  async play() {
    if (this.blocked) throw new Error('autoplay policy');
    this.plays++;
    this.paused = false;
  }
  emit(name: string) {
    this.dispatchEvent(new Event(name));
  }
}

const authorization = (url = 'private-url') => ({
  url,
  mimeType: 'audio/ogg',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
});

for (const playing of [false, true]) {
  test(`renews expired authorization and restores position while ${playing ? 'playing' : 'paused'}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
    const media = new Media();
    media.paused = !playing;
    let renewals = 0;
    const states: PlaybackState[] = [];
    const controller = new PrivatePlayback(
      media,
      authorization(),
      async () => {
        renewals++;
        return authorization('renewed-url');
      },
      (state) => states.push(state),
    );
    t.after(() => controller.dispose());
    t.mock.timers.tick(3570_000);
    await controller.refresh(); // Coalesces with the pre-expiry request.
    assert.equal(renewals, 1);
    assert.equal(media.src, 'renewed-url');
    assert.equal(media.currentTime, 0);
    media.emit('loadedmetadata');
    assert.equal(media.currentTime, 42);
    assert.equal(media.paused, !playing);
    assert.equal(media.plays, playing ? 1 : 0);
    assert.ok(states.includes('refreshing'));
    assert.equal(states.at(-1), 'ready');
  });
}

test('captures controls used during renewal and preserves seek requests during source loading', async (t) => {
  const media = new Media();
  let resolve!: (value: ReturnType<typeof authorization>) => void;
  const controller = new PrivatePlayback(
    media,
    authorization(),
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    () => {},
  );
  t.after(() => controller.dispose());
  const pending = controller.refresh();
  media.currentTime = 65;
  media.paused = false;
  media.emit('play');
  resolve(authorization('new'));
  await pending;
  controller.seek(80);
  media.emit('loadedmetadata');
  assert.equal(media.currentTime, 80);
  assert.equal(media.paused, false);
});

test('bounds unsupported/network recovery and ignores decode failures', async (t) => {
  const media = new Media();
  const states: PlaybackState[] = [];
  let renewals = 0;
  const controller = new PrivatePlayback(
    media,
    authorization(),
    async () => {
      renewals++;
      return authorization(`new-${renewals}`);
    },
    (state) => states.push(state),
  );
  t.after(() => controller.dispose());
  media.error = { code: 3 };
  media.emit('error');
  assert.equal(renewals, 0);
  assert.equal(states.at(-1), 'failed');
  for (let i = 0; i < 4; i++) {
    media.error = { code: i % 2 ? 2 : 4 };
    media.emit('error');
    await controller.refresh();
  }
  assert.equal(renewals, 2);
  assert.equal(states.at(-1), 'failed');
  await controller.refresh(true);
  media.emit('loadedmetadata');
  assert.equal(media.currentTime, 42);
  assert.equal(states.at(-1), 'ready');
});

test('resumes intended playback after a media error has automatically paused the element', async (t) => {
  const media = new Media();
  media.paused = false;
  const controller = new PrivatePlayback(
    media,
    authorization(),
    async () => authorization('new'),
    () => {},
  );
  t.after(() => controller.dispose());
  media.error = { code: 2 };
  media.paused = true;
  media.emit('pause');
  media.emit('error');
  await controller.refresh();
  media.error = null;
  media.emit('loadedmetadata');
  assert.equal(media.currentTime, 42);
  assert.equal(media.paused, false);
});

test('honors a user pause while authorization is in flight', async (t) => {
  const media = new Media();
  media.paused = false;
  let resolve!: (value: ReturnType<typeof authorization>) => void;
  const controller = new PrivatePlayback(
    media,
    authorization(),
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    () => {},
  );
  t.after(() => controller.dispose());
  const pending = controller.refresh();
  media.paused = true;
  media.emit('pause');
  resolve(authorization('new'));
  await pending;
  media.emit('loadedmetadata');
  assert.equal(media.currentTime, 42);
  assert.equal(media.paused, true);
});

test('retries a disconnected renewal once then waits for explicit recovery', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const media = new Media();
  let renewals = 0;
  const states: PlaybackState[] = [];
  const controller = new PrivatePlayback(
    media,
    authorization(),
    async () => {
      renewals++;
      throw new Error('sensitive transport details');
    },
    (state) => states.push(state),
  );
  t.after(() => controller.dispose());
  await controller.refresh();
  media.currentTime += 2;
  media.emit('timeupdate');
  t.mock.timers.tick(1000);
  await controller.refresh();
  media.currentTime += 2;
  media.emit('timeupdate');
  t.mock.timers.tick(3600_000);
  assert.equal(renewals, 2);
  assert.equal(media.currentTime, 46);
  assert.equal(states.at(-1), 'offline');
});

test('access denial stops automatic renewal even on foreground and media errors', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const media = new Media();
  let renewals = 0;
  const states: PlaybackState[] = [];
  const controller = new PrivatePlayback(
    media,
    authorization(),
    async () => {
      renewals++;
      throw new PlaybackAccessError();
    },
    (state) => states.push(state),
  );
  t.after(() => controller.dispose());
  await controller.refresh();
  t.mock.timers.tick(3600_000);
  controller.checkExpiry();
  media.error = { code: 4 };
  media.emit('error');
  await controller.refresh(true);
  assert.equal(renewals, 1);
  assert.equal(states.at(-1), 'denied');
});

test('aborts renewal and ignores its late result after disposal', async () => {
  const media = new Media();
  let resolve!: (value: ReturnType<typeof authorization>) => void;
  let signal!: AbortSignal;
  const states: PlaybackState[] = [];
  const controller = new PrivatePlayback(
    media,
    authorization(),
    (nextSignal) => {
      signal = nextSignal;
      return new Promise((done) => {
        resolve = done;
      });
    },
    (state) => states.push(state),
  );
  const pending = controller.refresh();
  controller.dispose();
  assert.equal(signal.aborted, true);
  resolve(authorization('late'));
  await pending;
  assert.equal(media.src, 'private-url');
  assert.deepEqual(states, ['refreshing']);
});

test('handles blocked autoplay without losing restored position', async (t) => {
  const media = new Media();
  media.paused = false;
  media.blocked = true;
  const states: PlaybackState[] = [];
  const controller = new PrivatePlayback(
    media,
    authorization(),
    async () => authorization('new'),
    (state) => states.push(state),
  );
  t.after(() => controller.dispose());
  await controller.refresh();
  media.emit('loadedmetadata');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(media.currentTime, 42);
  assert.equal(states.at(-1), 'resume');
  media.blocked = false;
  controller.resume();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(media.currentTime, 42);
  assert.equal(media.paused, false);
  assert.equal(states.at(-1), 'ready');
});
