import assert from 'node:assert/strict';
import { it } from 'node:test';
import { safeReturnTo } from '@/lib/auth/return-to';

it('returns only to known local routes after authentication', () => {
  const recording = '/recordings/12345678-1234-1234-1234-123456789abc';
  assert.equal(safeReturnTo(recording), recording);
  assert.equal(safeReturnTo('/'), '/');
  assert.equal(safeReturnTo('/account'), '/account');
  assert.equal(safeReturnTo('/library'), '/library');
  for (const path of [
    undefined,
    '//untrusted.example',
    'https://untrusted.example',
    '/\\untrusted.example',
    '/signin',
    '/signup',
    '/account?next=//untrusted.example',
  ]) {
    assert.equal(safeReturnTo(path), '/account');
  }
});
