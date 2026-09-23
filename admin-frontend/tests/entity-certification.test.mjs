import test from 'node:test';
import assert from 'node:assert/strict';
import { certificationStatus } from '../src/pages/entityCertification.ts';

test('certification warning boundaries follow Shanghai calendar days', () => {
  const now = new Date('2026-09-22T16:01:00Z');
  for (const [date, days, color] of [
    [null, null, 'default'], ['2026-09-22', -1, 'red'],
    ['2026-09-23', 0, 'red'], ['2026-09-30', 7, 'red'],
    ['2026-10-01', 8, 'orange'], ['2026-10-23', 30, 'orange'],
    ['2026-10-24', 31, 'green'],
  ]) {
    const result = certificationStatus(date, now);
    assert.equal(result.days, days);
    assert.equal(result.color, color);
  }
});
