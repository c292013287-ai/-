import test from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('server jobs persist complete snapshots only, suppress duplicates and retain old data on failure', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'customer-snapshot-test-'));
  process.env.CUSTOMER_SNAPSHOT_DIR = directory;
  const require = createRequire(import.meta.url);
  const original = Module._load;
  let fail = false;
  let pages = 0;
  let release;
  const pause = new Promise(resolve => { release = resolve; });
  const entity = { id: 1, status: 'active', corpid: 'fake', secret: 'fake', wecomApiBaseUrl: null };
  Module._load = function (name, parent, isMain) {
    if (parent?.filename.endsWith('services/customerSyncJobs.js')) {
      if (name === '../lib/prisma') return { __esModule: true, default: { wecomEntity: { findUnique: async () => ({ ...entity }) } } };
      if (name === './wecom') return { getCustomerPage: async (_corp, _secret, _base, user, cursor) => {
        if (!user) return { users: ['a'] };
        pages++;
        if (cursor) { await pause; if (fail) throw new Error('page failed'); }
        return { items: [{ externalUserId: cursor ? 'two' : 'one', userId: user }], nextCursor: cursor ? '' : 'next' };
      } };
    }
    return original.call(this, name, parent, isMain);
  };
  let jobs;
  try { jobs = require('../dist/services/customerSyncJobs.js').customerSyncJobs; }
  finally { Module._load = original; }
  const wait = async () => {
    for (let n = 0; n < 200; n++) {
      if (['completed', 'failed'].includes((await jobs.status())[0]?.status)) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('job timeout');
  };
  try {
    await jobs.start([1]); await jobs.start([1]);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(await jobs.snapshot(1), null);
    release(); await wait();
    const snapshot = await jobs.snapshot(1);
    assert.equal(snapshot.items.length, 2);
    assert.equal(pages, 2);
    const meta = JSON.parse(await readFile(path.join(directory, '1.meta.json'), 'utf8'));
    assert.equal((await stat(path.join(directory, meta.file))).mode & 0o777, 0o600);
    fail = true;
    await jobs.start([1]); await wait();
    assert.equal((await jobs.status())[0].status, 'failed');
    assert.deepEqual(await jobs.snapshot(1), snapshot);
    entity.secret = 'changed';
    assert.equal(await jobs.snapshot(1), null);
    assert.equal(JSON.parse(await readFile(path.join(directory, '1.meta.json'), 'utf8')).count, 2);
  } finally {
    await new Promise(resolve => setTimeout(resolve, 100));
    await rm(directory, { recursive: true, force: true });
    delete process.env.CUSTOMER_SNAPSHOT_DIR;
  }
});
