import assert from 'node:assert/strict';
import { it } from 'node:test';
import { guestSessionFrom } from './guest-claims.js';

it('accepts only well-formed guest bearer credentials', () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  assert.equal(guestSessionFrom({ guestSessionId: id }), id);
  assert.equal(guestSessionFrom({}), undefined);
  for (const value of [
    null,
    '',
    'not-a-uuid',
    1,
    {},
    '12345678-1234-1234-1234-123456789abc-extra',
  ]) {
    assert.throws(() => guestSessionFrom({ guestSessionId: value }));
  }
});
