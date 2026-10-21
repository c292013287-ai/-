import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MigrationSnapshots } from '../src/lib/migrationSnapshots.ts';

const source = { appToken: 'wiki-test', tableId: 'table-test', viewId: 'view-test' };
const row = (id, fields = {}) => ({ recordId: id, fields: { 提交人: id, ...fields } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function until(check) {
  for (let i = 0; i < 200; i++) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Snapshot state did not settle');
}
async function setup(t, load) {
  const directory = await mkdtemp(path.join(tmpdir(), 'migration-snapshot-'));
  let now = Date.parse('2026-10-16T06:00:00Z');
  const options = { directory: () => directory, fingerprint: () => 'credentials', load, now: () => now };
  const service = new MigrationSnapshots(options);
  t.after(async () => { service.stop(); await rm(directory, { recursive: true, force: true }); });
  return { service, options, directory, advance: () => { now += 31_000; } };
}

test('first read is immediate, concurrent readers coalesce, only complete snapshots are published', async t => {
  const pending = deferred(); let calls = 0;
  const { service, directory } = await setup(t, async () => { calls++; return pending.promise; });
  const initial = await service.read(source);
  assert.equal(initial.ready, false);
  assert.equal(initial.records, undefined);
  assert.equal(initial.updatedAt, null);
  await service.read(source, '', true);
  await service.read(source);
  assert.equal(calls, 1);
  pending.resolve([row('today')]);
  const published = await until(async () => { const value = await service.read(source); return value.ready && value; });
  assert.equal(published.records[0].recordId, 'today');
  const unchanged = await service.read(source, published.revision);
  assert.equal(unchanged.records, undefined);
  assert.equal(unchanged.updatedAt, published.updatedAt);
  const [file] = await readdir(directory);
  assert.equal((await stat(path.join(directory, file))).mode & 0o777, 0o600);
});

test('periodic worker updates without browser reads; failure retains timestamp and records, then recovers', async t => {
  let result = [row('old')]; let fail = false; let calls = 0;
  const { service, advance } = await setup(t, async () => { calls++; if (fail) throw new Error('temporary'); return result; });
  await service.read(source);
  const first = await until(async () => { const value = await service.read(source); return value.ready && value; });
  advance(); fail = true;
  await service.tick();
  const failed = await service.read(source);
  assert.equal(failed.updatedAt, first.updatedAt);
  assert.equal(failed.revision, first.revision);
  assert.equal(failed.error, 'temporary');
  assert.deepEqual(failed.records, first.records);
  fail = false; result = [row('old'), row('today')]; advance();
  await service.tick();
  const updated = await service.read(source, first.revision);
  assert.equal(calls, 3);
  assert.equal(updated.records.length, 2);
  assert.notEqual(updated.updatedAt, first.updatedAt);
  assert.equal(updated.error, '');
});

test('saved source resumes on startup even with no open page, including an initial failed sync', async t => {
  const { service, options } = await setup(t, async () => { throw new Error('offline'); });
  await service.read(source);
  await until(async () => (await service.read(source)).error);
  let calls = 0;
  const restored = new MigrationSnapshots({ ...options, load: async () => { calls++; return [row('after-restart')]; } });
  t.after(() => restored.stop());
  await restored.start();
  await until(() => calls === 1);
  await until(async () => (await restored.read(source)).ready);
  assert.equal((await restored.read(source)).records[0].recordId, 'after-restart');
});

test('source edits invalidate in-flight reads and prevent stale values from replacing writes', async t => {
  let pending;
  const { service, advance } = await setup(t, async () => pending ? pending.promise : [row('first')]);
  await service.read(source);
  await until(async () => (await service.read(source)).ready);
  pending = deferred(); advance();
  const running = service.tick();
  await until(async () => (await service.read(source)).refreshing);
  service.invalidate(source.appToken, source.tableId);
  assert.equal((await service.read(source)).ready, false);
  pending.resolve([row('stale')]);
  await running;
  pending = deferred();
  const next = service.tick();
  pending.resolve([row('new')]);
  await next;
  assert.equal((await service.read(source)).records[0].recordId, 'new');
});

test('unchanged data keeps revision but advances verified timestamp; empty complete source is valid', async t => {
  let result = [row('same')];
  const { service, advance } = await setup(t, async () => result);
  await service.read(source);
  const first = await until(async () => { const value = await service.read(source); return value.ready && value; });
  advance(); await service.tick();
  const checked = await service.read(source, first.revision);
  assert.equal(checked.records, undefined);
  assert.notEqual(checked.updatedAt, first.updatedAt);
  result = []; advance(); await service.tick();
  const empty = await service.read(source, first.revision);
  assert.equal(empty.ready, true);
  assert.deepEqual(empty.records, []);
});

test('credentials and view IDs isolate snapshots; malformed results never publish', async t => {
  const { service, options, advance } = await setup(t, async value => value.viewId === 'invalid' ? undefined : [row(value.viewId)]);
  await service.read(source);
  await until(async () => (await service.read(source)).ready);
  const changedCredentials = new MigrationSnapshots({ ...options, fingerprint: () => 'other', load: async () => { throw new Error('no access'); } });
  t.after(() => changedCredentials.stop());
  assert.equal((await changedCredentials.read(source)).ready, false);
  const differentView = { ...source, viewId: 'invalid' };
  advance(); await service.read(differentView);
  await service.tick();
  await until(async () => { await service.tick(); return (await service.read(differentView)).error; });
  const invalid = await service.read(differentView);
  assert.equal(invalid.ready, false);
  assert.equal(invalid.records, undefined);
  await until(async () => (await changedCredentials.read(source)).error);
});
