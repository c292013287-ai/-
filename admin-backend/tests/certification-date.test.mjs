import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCertificationDate } from '../src/lib/certificationDate.ts';

test('date updates preserve omitted values and accept clearing', () => {
  assert.equal(parseCertificationDate(undefined), undefined);
  assert.equal(parseCertificationDate(null), null);
  assert.equal(parseCertificationDate(''), null);
  assert.equal(parseCertificationDate('2028-02-29').toISOString(), '2028-02-29T00:00:00.000Z');
});
test('reject invalid dates and non-date inputs', () => {
  for (const value of ['2027-02-29', '2026-04-31', '2026-13-01', '2026-9-1', '2026-09-23T00:00:00Z', 123, {}]) {
    assert.throws(() => parseCertificationDate(value));
  }
});
