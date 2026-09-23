import test from 'node:test';
import assert from 'node:assert/strict';
import { ServedUserJobs } from '../src/lib/servedUserJobs.ts';
import { countServedUsers } from '../src/lib/servedUserCount.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('queues jobs, suppresses duplicates, exposes progress and commits only after completion', async () => {
  const releases = new Map();
  const committed = [];
  const jobs = new ServedUserJobs(async (id, progress) => {
    const count = await countServedUsers(async cursor => {
      if (!cursor) return { errcode: 0, info_list: [{ tmp_openid: 'a' }], next_cursor: 'next' };
      await new Promise(resolve => releases.set(id, resolve));
      return { errcode: 0, info_list: [{ tmp_openid: 'a' }, { tmp_openid: 'b' }] };
    }, progress);
    committed.push(id);
    return { servedUserCount: count, servedUserCountUpdatedAt: new Date().toISOString() };
  }, 1);
  jobs.start(1);
  jobs.start(1);
  assert.equal(jobs.start(2).status, 'queued');
  await tick();
  assert.equal(jobs.list().length, 2);
  assert.equal(jobs.list()[0].uniqueUsers, 1);
  assert.equal(jobs.list()[0].pages, 1);
  assert.equal(jobs.list()[0].result, undefined);
  assert.deepEqual(committed, []);
  releases.get(1)();
  await tick();
  assert.equal(jobs.list()[0].result.servedUserCount, 2);
  assert.equal(jobs.list()[1].status, 'running');
  releases.get(2)();
  await tick();
  assert.deepEqual(committed, [1, 2]);
});

test('partial failure does not commit and may be retried', async () => {
  let committed = false;
  const jobs = new ServedUserJobs(async (_id, progress) => {
    await countServedUsers(async cursor => {
      if (cursor) throw new Error('page failed');
      return { errcode: 0, info_list: [{ tmp_openid: 'a' }], next_cursor: 'next' };
    }, progress);
    committed = true;
  });
  jobs.start(1);
  await tick();
  assert.equal(jobs.list()[0].status, 'failed');
  assert.equal(jobs.list()[0].error, 'page failed');
  assert.equal(committed, false);
  assert.equal(jobs.start(1).status, 'running');
  await tick();
});
