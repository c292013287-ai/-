import test from 'node:test';
import assert from 'node:assert/strict';
import { externalContactForecast, parseExternalContactCapacity } from '../src/lib/externalContactForecast.ts';

const now = new Date('2026-10-21T16:30:00Z');
const entity = { externalContactCapacity: 50000, servedUserCount: 25000, servedUserCountUpdatedAt: now };
const history = [{ date: new Date('2026-10-15T00:00:00Z'), count: 18000 }];

test('capacity accepts screenshot tiers, larger custom scales and clearing without guessing', () => {
  for (const capacity of [5000, 20000, 50000, 200000, 500000, 1000000, 2000000, 2500000, 2147483647]) {
    assert.equal(parseExternalContactCapacity(capacity), capacity);
  }
  assert.equal(parseExternalContactCapacity(undefined), undefined);
  assert.equal(parseExternalContactCapacity(null), null);
  for (const value of [0, -1, 10000, 1500000, 2000000.5, '5000', 2147483648, Infinity]) {
    assert.throws(() => parseExternalContactCapacity(value));
  }
});

test('uses seven Shanghai calendar days of net growth and rounds the remaining days upward', () => {
  const result = externalContactForecast(entity, history, now);
  assert.equal(result.status, 'forecast');
  assert.equal(result.dailyNetGrowth, 1000);
  assert.equal(result.remaining, 25000);
  assert.equal(result.estimatedPurchaseDate, '2026-11-16');
  assert.equal(externalContactForecast({ ...entity, externalContactCapacity: 25001 }, history, now).estimatedPurchaseDate, '2026-10-23');
});

test('never fabricates a forecast for missing, incomplete, stale or non-growing data', () => {
  assert.equal(externalContactForecast({ ...entity, externalContactCapacity: null }, history, now).status, 'unconfigured');
  assert.equal(externalContactForecast({ ...entity, servedUserCount: null }, history, now).status, 'unmeasured');
  assert.equal(externalContactForecast(entity, [], now).status, 'insufficient_history');
  assert.equal(externalContactForecast(entity, [{ date: new Date('2026-10-16T00:00:00Z'), count: 18000 }], now).status, 'insufficient_history');
  assert.equal(externalContactForecast(entity, history, new Date(now.getTime() + 48 * 3600000 + 1)).status, 'stale');
  for (const count of [25000, 26000]) assert.equal(externalContactForecast(entity, [{ ...history[0], count }], now).status, 'not_growing');
  for (const servedUserCount of [50000, 50001]) {
    const result = externalContactForecast({ ...entity, servedUserCount }, [], now);
    assert.equal(result.status, 'limit_reached');
    assert.equal(result.remaining, 0);
  }
  assert.equal(externalContactForecast({ ...entity, externalContactCapacity: 2147483647 }, [{ ...history[0], count: 24999 }], now).status, 'out_of_range');
});
