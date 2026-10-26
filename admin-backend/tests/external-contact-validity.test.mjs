import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExternalContactValidity } from '../src/lib/externalContactValidity.ts';

test('validity updates preserve omitted fields, allow clearing and normalize Beijing timestamps', () => {
  assert.deepEqual(parseExternalContactValidity(undefined, undefined), {});
  assert.deepEqual(parseExternalContactValidity(null, null), { externalContactValidFrom: null, externalContactValidUntil: null });
  assert.deepEqual(parseExternalContactValidity('', ''), { externalContactValidFrom: null, externalContactValidUntil: null });
  const value = parseExternalContactValidity('2026-11-24T10:03:00+08:00', '2027-11-24T10:03:00+08:00');
  assert.equal(value.externalContactValidFrom.toISOString(), '2026-11-24T02:03:00.000Z');
  assert.equal(value.externalContactValidUntil.toISOString(), '2027-11-24T02:03:00.000Z');
  assert.equal(parseExternalContactValidity('2028-02-29T02:03:00.000Z', '2029-03-01T02:03:00.000Z')
    .externalContactValidFrom.toISOString(), '2028-02-29T02:03:00.000Z');
});

test('validity rejects partial periods, invalid dates and reversed or equal times', () => {
  const from = '2026-11-24T10:03:00+08:00';
  const until = '2027-11-24T10:03:00+08:00';
  for (const pair of [[undefined, until], [from, undefined], [null, until], [from, ''], [from, from], [until, from]]) {
    assert.throws(() => parseExternalContactValidity(...pair));
  }
  for (const invalid of ['2026-02-30T10:03:00+08:00', '2027-02-29T10:03:00Z', '2026-11-24T24:00:00Z',
    '2026-11-24', '2026-11-24T10:03:00', '0001-01-01T10:03:00Z', 0, {}, []]) {
    assert.throws(() => parseExternalContactValidity(invalid, until));
  }
});
