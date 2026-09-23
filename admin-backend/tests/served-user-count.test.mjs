import test from 'node:test';
import assert from 'node:assert/strict';
import { countServedUsers } from '../src/lib/servedUserCount.ts';

test('background traversal can exceed the former two-minute limit', async (t) => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  const count = await countServedUsers(async cursor => {
    now += 180000;
    return { errcode: 0, info_list: [{ tmp_openid: cursor || 'first' }], next_cursor: cursor ? '' : 'last' };
  });
  assert.equal(count, 2);
});

test('deduplicates contacts across people, groups and pages', async () => {
  const calls = [];
  const total = await countServedUsers(async cursor => {
    calls.push(cursor);
    return cursor ? { errcode: 0, info_list: [{ tmp_openid: 'a' }, { tmp_openid: 'b' }] }
      : { errcode: 0, info_list: [{ tmp_openid: 'a' }, { tmp_openid: 'a' }], next_cursor: 'next' };
  });
  assert.equal(total, 2);
  assert.deepEqual(calls, ['', 'next']);
});
test('accepts verified empty result but rejects incomplete and failed results', async () => {
  assert.equal(await countServedUsers(async () => ({ errcode: 0, info_list: [] })), 0);
  for (const page of [{ errcode: 48002 }, { errcode: 0 }, { errcode: 0, info_list: [{}] }]) {
    await assert.rejects(countServedUsers(async () => page));
  }
  await assert.rejects(countServedUsers(async () => ({ errcode: 0, info_list: [], next_cursor: 'loop' })));
  await assert.rejects(countServedUsers(async cursor => {
    if (cursor) throw new Error('network failure');
    return { errcode: 0, info_list: [{ tmp_openid: 'a' }], next_cursor: 'next' };
  }));
});
