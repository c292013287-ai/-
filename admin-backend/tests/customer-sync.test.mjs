import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCustomerSnapshot } from '../src/lib/customerSync.ts';

test('collects every employee/page and deduplicates relationships, not customers', async () => {
  const progress = [];
  const value = await collectCustomerSnapshot(['a', 'a', 'b'], async (user, cursor) => ({
    items: [{ externalUserId: 'same', userId: user }, ...(cursor ? [{ externalUserId: 'second', userId: user }] : [])],
    nextCursor: cursor ? '' : 'next', tagWarning: 'tag warning',
  }), p => progress.push(p));
  assert.equal(value.items.length, 4);
  assert.deepEqual(value.users, ['a', 'b']);
  assert.equal(value.warning, 'tag warning');
  assert.deepEqual(progress.at(-1), { employees: 2, totalEmployees: 2, pages: 4, records: 4 });
});

test('partial errors, repeated cursors, missing identifiers and deadlines cannot yield a snapshot', async () => {
  await assert.rejects(collectCustomerSnapshot(['a'], async (_, cursor) => {
    if (cursor) throw new Error('failed');
    return { items: [{ externalUserId: 'one', userId: 'a' }], nextCursor: 'next' };
  }, () => {}), /failed/);
  await assert.rejects(collectCustomerSnapshot(['a'], async () => ({ items: [], nextCursor: 'repeat' }), () => {}), /重复/);
  await assert.rejects(collectCustomerSnapshot(['a'], async () => ({ items: [{ externalUserId: 'one', userId: '' }], nextCursor: '' }), () => {}), /不完整/);
  await assert.rejects(collectCustomerSnapshot(['a'], async () => { throw new Error('should not run'); }, () => {}, 0), /三小时/);
});

test('empty authorized employee list is a completed empty snapshot', async () => {
  const value = await collectCustomerSnapshot([], async () => { throw new Error('should not run'); }, () => {});
  assert.deepEqual(value.items, []);
  assert.ok(value.updatedAt);
});

test('large streamed sync does not retain customer payloads or hit the old 500k cap', async () => {
  let written = 0;
  const result = await collectCustomerSnapshot(Array.from({ length: 200 }, (_, i) => `employee-${i}`), async (user, cursor) => {
    const page = Number(cursor || 0);
    return { items: Array.from({ length: 100 }, (_, i) => ({ externalUserId: `${page}-${i}`, userId: user, description: 'x'.repeat(2000) })), nextCursor: page < 29 ? String(page + 1) : '' };
  }, () => {}, undefined, async rows => { written += rows.length; });
  assert.equal(written, 600000);
  assert.equal(result.items.length, 0);
});
