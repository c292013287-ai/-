import test from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { contactValidityDisplay, contactValidityInput, contactValidityTimestamp } from '../src/pages/entityContactValidity.ts';

const entity = { externalContactCapacity: null, externalContactValidFrom: '2026-11-24T02:03:00.000Z',
  externalContactValidUntil: '2027-11-24T02:03:00.000Z' };

test('validity displays actual Beijing start/end times independently of capacity and forecasts', () => {
  const display = contactValidityDisplay(entity, new Date('2026-10-26T02:00:00Z'));
  assert.equal(display.from, '2026/11/24 10:03');
  assert.equal(display.until, '2027/11/24 10:03');
  assert.equal(display.label, '自 2026/11/24 10:03 续期至 2027/11/24 10:03');
  assert.equal(display.status, '未生效');
  assert.equal(contactValidityDisplay(entity, new Date(entity.externalContactValidFrom)).status, '有效');
  const expired = contactValidityDisplay(entity, new Date(entity.externalContactValidUntil));
  assert.equal(expired.status, '已到期');
  assert.equal(expired.color, '#cf1322');
});

test('missing or invalid periods do not fall back to growth estimates', () => {
  for (const value of [{}, { externalContactValidFrom: entity.externalContactValidFrom },
    { ...entity, externalContactValidUntil: 'invalid' },
    { ...entity, externalContactValidUntil: entity.externalContactValidFrom }]) {
    const display = contactValidityDisplay(value);
    assert.equal(display.label, '未录入');
    assert.equal(display.sortTime, Number.MAX_SAFE_INTEGER);
  }
});

test('picker wall times represent Beijing time even in browsers in another timezone', () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ['Asia/Shanghai', 'America/New_York', 'UTC']) {
      process.env.TZ = timezone;
      const input = contactValidityInput(entity.externalContactValidFrom);
      assert.equal(input.format('YYYY/MM/DD HH:mm'), '2026/11/24 10:03');
      assert.equal(Date.parse(contactValidityTimestamp(input)), Date.parse(entity.externalContactValidFrom));
      assert.equal(contactValidityTimestamp(dayjs('2026-11-24T10:03:00')), '2026-11-24T10:03:00+08:00');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
  assert.equal(contactValidityTimestamp(null), null);
  assert.equal(contactValidityInput(null), null);
});
