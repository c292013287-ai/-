import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, appendFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resumeCustomers, retryCustomerRequest } from '../src/lib/resumableCustomers.ts';
import { readSnapshotMeta, readSnapshotPage } from '../src/lib/customerSnapshotStore.ts';

test('resumes failed cursor, truncates uncheckpointed bytes, deduplicates and commits only complete data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'resume-customers-'));
  const base = { directory, id: 1, fingerprint: 'one', followers: async () => ['a', 'b'], progress: () => {}, validate: async () => {} };
  try {
    await assert.rejects(resumeCustomers({ ...base, fetchPage: async (user, cursor) => {
      if (cursor) throw new Error('系统繁忙');
      return { items: [{ userId: user, externalUserId: 'one' }], nextCursor: 'next' };
    } }), /繁忙/);
    assert.equal(await readSnapshotMeta(directory, 1), null);
    const checkpoint = JSON.parse(await readFile(path.join(directory, '1.checkpoint.json'), 'utf8'));
    await appendFile(path.join(directory, checkpoint.file), '{uncommitted');
    const requests = [];
    await resumeCustomers({ ...base, followers: async () => { throw new Error('must reuse members'); }, fetchPage: async (user, cursor) => {
      requests.push([user, cursor]);
      return { items: [{ userId: user, externalUserId: 'one' }, { userId: user, externalUserId: 'two' }], nextCursor: '' };
    } });
    assert.deepEqual(requests, [['a', 'next'], ['b', '']]);
    const meta = await readSnapshotMeta(directory, 1);
    assert.equal(meta.count, 4);
    assert.equal((await readSnapshotPage(directory, meta, {}, 1, 20)).items.length, 4);
    await assert.rejects(readFile(path.join(directory, '1.checkpoint.json')), /ENOENT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('retries transient errors at increasing intervals, but not permissions; stops after three retries', async () => {
  const delays = []; let count = 0;
  const value = await retryCustomerRequest(async () => { if (++count < 4) throw new Error('企业微信错误码 -1'); return 42; }, () => {}, async ms => { delays.push(ms); });
  assert.equal(value, 42); assert.deepEqual(delays, [5000, 15000, 45000]);
  count = 0;
  await assert.rejects(retryCustomerRequest(async () => { count++; throw new Error('45009'); }, () => {}, async () => {}));
  assert.equal(count, 4);
  count = 0;
  await assert.rejects(retryCustomerRequest(async () => { count++; throw new Error('错误码 60020'); }, () => {}, async () => {}));
  assert.equal(count, 1);
});
