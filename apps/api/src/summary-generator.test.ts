import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_SUMMARY_SOURCE_CHARACTERS,
  OllamaSummaryGenerator,
  SummaryError,
} from './summary-generator.js';

const content = {
  text: 'A short planning meeting.',
  keyPoints: ['Release on Friday.'],
  actionItems: ['Sam will prepare notes.'],
};
const response = (value: unknown, extra = {}) =>
  new Response(
    JSON.stringify({
      done: true,
      message: { content: JSON.stringify(value) },
      ...extra,
    }),
    { headers: { 'content-type': 'application/json' } },
  );

test('requests structured local summaries without external credentials', async () => {
  let called = false;
  const request: typeof fetch = async (url, init) => {
    called = true;
    assert.equal(String(url), 'http://localhost:11434/api/chat');
    assert.equal(init?.redirect, 'error');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'local-test');
    assert.equal(body.stream, false);
    assert.equal(body.messages[1].content, 'Speaker: Release on Friday.');
    assert.match(body.messages[0].content, /untrusted data/);
    assert.equal(body.format.type, 'object');
    return response(content);
  };
  const generator = new OllamaSummaryGenerator(
    'local-test',
    'http://localhost:11434',
    request,
  );
  assert.deepEqual(await generator.generate('Speaker: Release on Friday.'), {
    ...content,
    model: 'local-test',
  });
  assert.equal(called, true);
});

test('accepts an empty action list and rejects malformed or incomplete model output', async () => {
  const good = new OllamaSummaryGenerator('test', undefined, async () =>
    response({ ...content, actionItems: [] }),
  );
  assert.deepEqual((await good.generate('text')).actionItems, []);
  for (const value of [
    null,
    { text: '', keyPoints: [], actionItems: [] },
    { ...content, keyPoints: 'invalid' },
    { ...content, actionItems: [42] },
  ]) {
    const generator = new OllamaSummaryGenerator('test', undefined, async () =>
      response(value),
    );
    await assert.rejects(() => generator.generate('text'), SummaryError);
  }
  const truncated = new OllamaSummaryGenerator('test', undefined, async () =>
    response(content, { done_reason: 'length' }),
  );
  await assert.rejects(() => truncated.generate('text'), SummaryError);
});

test('bounds input and sanitizes runtime failures without echoing transcript content', async () => {
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    throw new Error('sensitive transcript content');
  };
  const generator = new OllamaSummaryGenerator('test', undefined, request);
  await assert.rejects(
    () => generator.generate('x'.repeat(MAX_SUMMARY_SOURCE_CHARACTERS + 1)),
    /24,000/,
  );
  await assert.rejects(() => generator.generate(' '), /no text/);
  assert.equal(calls, 0);
  await assert.rejects(
    () => generator.generate('text'),
    (error: unknown) =>
      error instanceof SummaryError && !error.message.includes('sensitive'),
  );
  const disabled = new OllamaSummaryGenerator('', undefined, request);
  assert.equal(disabled.available, false);
  await assert.rejects(() => disabled.generate('text'), /unavailable/);
});
