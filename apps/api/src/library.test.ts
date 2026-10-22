import assert from 'node:assert/strict';
import { it } from 'node:test';
import { libraryQuery, recordingTitle } from './library.js';

it('validates titles and bounded library queries', () => {
  assert.equal(recordingTitle({ title: ' Meeting notes ' }), 'Meeting notes');
  for (const title of ['', ' ', null, 123, 'a'.repeat(201)])
    assert.throws(() => recordingTitle({ title }));
  assert.deepEqual(libraryQuery(' meeting ', '2'), {
    search: 'meeting',
    page: 2,
  });
  for (const page of ['0', '-1', '1.5', 'abc', '1000000'])
    assert.throws(() => libraryQuery('', page));
  assert.throws(() => libraryQuery('a'.repeat(201)));
});
