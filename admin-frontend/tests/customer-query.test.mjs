import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCustomers, matchesCustomer } from '../src/pages/customerQuery.ts';

const customer = {
  externalUserId: 'external-1', unionId: 'union-1', name: '客户甲', remark: '课程跟进',
  remarkMobiles: ['001234'], state: 'campaign-A', gender: 2, type: 1,
  tags: [{ id: 'tag1', name: '体验课' }], addWay: 0, userId: 'staff1',
  addedAt: Date.parse('2026-09-23T23:59:59+08:00') / 1000,
};

test('all filters compose, including zero source and partial text', () => {
  assert.ok(matchesCustomer(customer, { name: '甲', remark: '跟进', phone: '0012', externalUserId: 'external',
    unionId: 'union', state: 'CAMPAIGN', gender: 2, type: 1, tagId: 'tag1', addWay: 0, unionStatus: 'present' }));
  for (const filters of [{ name: '乙' }, { remark: '其他' }, { phone: '999' }, { externalUserId: 'zzz' },
    { unionId: 'x' }, { state: 'B' }, { gender: 1 }, { type: 2 }, { tagId: 'other' }, { addWay: 1 }, { unionStatus: 'missing' }]) {
    assert.equal(matchesCustomer(customer, filters), false, JSON.stringify(filters));
  }
  assert.ok(matchesCustomer({ ...customer, gender: undefined, unionId: ' ' }, { gender: 0, unionStatus: 'missing' }));
});

test('date range includes Shanghai start and end day but excludes missing dates', () => {
  const range = { startDate: '2026-09-23', endDate: '2026-09-23' };
  for (const time of ['2026-09-23T00:00:00+08:00', '2026-09-23T23:59:59+08:00']) {
    assert.ok(matchesCustomer({ ...customer, addedAt: Date.parse(time) / 1000 }, range));
  }
  assert.equal(matchesCustomer({ ...customer, addedAt: Date.parse('2026-09-24T00:00:00+08:00') / 1000 }, range), false);
  assert.equal(matchesCustomer({ ...customer, addedAt: null }, range), false);
});

test('collects all employee pages and preserves separate follow relationships', async () => {
  const calls = [];
  const progress = [];
  const result = await collectCustomers(['staff1', 'staff2'], async (userId, cursor) => {
    calls.push([userId, cursor]);
    return { items: [{ ...customer, userId }, ...(cursor ? [{ ...customer, externalUserId: 'second-page', userId }] : [])],
      nextCursor: userId === 'staff1' && !cursor ? 'next' : '' };
  }, new AbortController().signal, value => progress.push(value));
  assert.deepEqual(calls, [['staff1', ''], ['staff1', 'next'], ['staff2', '']]);
  assert.equal(result.items.length, 3);
  assert.deepEqual(progress.at(-1), { employees: 2, totalEmployees: 2, pages: 3, records: 3 });
  assert.equal(result.items.filter(item => matchesCustomer(item, { externalUserId: 'second-page' })).length, 1);
});

test('cancellation, page errors and repeating cursors never return partial success', async () => {
  const controller = new AbortController();
  await assert.rejects(collectCustomers(['staff1'], async () => {
    controller.abort(); return { items: [customer], nextCursor: '' };
  }, controller.signal, () => {}), { name: 'AbortError' });
  await assert.rejects(collectCustomers(['staff1'], async () => ({ items: [], nextCursor: 'loop' }), new AbortController().signal, () => {}), /游标重复/);
  await assert.rejects(collectCustomers(['staff1', 'staff2'], async userId => {
    if (userId === 'staff2') throw Error('permission denied');
    return { items: [customer], nextCursor: '' };
  }, new AbortController().signal, () => {}), /permission denied/);
});
