import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createRequire } from 'node:module';
import jwt from 'jsonwebtoken';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const axios = createRequire(import.meta.url)('axios');

process.env.FEISHU_APP_ID = 'migration-sync-test';
process.env.FEISHU_APP_SECRET = 'test-only';
process.env.JWT_SECRET = 'test-only-migration-signing';
process.env.MIGRATION_SNAPSHOT_DIR = await mkdtemp(path.join(tmpdir(), 'migration-route-'));
const calls = [];
let recordsAdapter = () => { throw new Error('Unexpected records request'); };
axios.defaults.adapter = async config => {
  calls.push(config);
  assert.equal(config.timeout, 20_000);
  let data;
  if (config.url.includes('/auth/v3/')) data = { code: 0, tenant_access_token: 'test-only', expire: 7200 };
  else if (config.url.includes('/wiki/v2/')) data = { code: 0, data: { node: { obj_type: 'bitable', obj_token: 'base-test' } } };
  else data = await recordsAdapter(config);
  return { data, status: 200, statusText: 'OK', headers: {}, config };
};
const { default: migration } = await import('../src/routes/migration.ts');
let server, base;
const authorization = 'Bearer ' + jwt.sign({ userId: 1, role: 'admin' }, process.env.JWT_SECRET);
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/migration', migration);
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${server.address().port}/migration/feishu/records`;
});
after(() => new Promise(resolve => server.close(resolve)));
after(() => rm(process.env.MIGRATION_SNAPSHOT_DIR, { recursive: true, force: true }));
const read = (tableId, viewId = 'view-a', appToken = 'wiki-test') => fetch(`${base}?${new URLSearchParams({ appToken, tableId, viewId })}`, { headers: { authorization } });
const page = (items, has_more = false, page_token) => ({ code: 0, data: { items, has_more, page_token } });
const record = (record_id, fields = { 提交人: [{ name: '测试' }], 转量数量: 0 }) => ({ record_id, fields });

test('returns all pages, preserves view and normalizes values; reuses only token/wiki lookup', async () => {
  calls.length = 0;
  recordsAdapter = config => {
    assert.equal(config.params.view_id, 'view-a');
    assert.ok(config.signal);
    return config.params.page_token ? page([record('last')]) : page([record('first')], true, 'next');
  };
  const response = await read('all-pages');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await response.json()).records.map(r => r.recordId), ['first', 'last']);
  const response2 = await read('all-pages');
  assert.deepEqual((await response2.json()).records[0].fields, { 提交人: '测试', 转量数量: '0' });
  assert.equal(calls.filter(c => c.url.includes('/auth/v3/')).length, 1);
  assert.equal(calls.filter(c => c.url.includes('/wiki/v2/')).length, 1);
  assert.equal(calls.filter(c => c.url.includes('/records')).length, 4);
});

test('simultaneous readers share a load, but later reads fetch fresh records', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let reads = 0;
  recordsAdapter = async () => { reads++; await gate; return page([record('shared')]); };
  const first = read('shared');
  const second = read('shared');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(reads, 1);
  release();
  for (const response of await Promise.all([first, second])) assert.equal((await response.json()).records.length, 1);
  recordsAdapter = () => page([record('new-record')]);
  assert.equal((await (await read('shared')).json()).records[0].recordId, 'new-record');
});

test('page failures never publish partial data and subsequent retry is not stuck', async () => {
  recordsAdapter = config => config.params.page_token ? { code: 1254290, msg: 'Source unavailable' } : page([record('partial')], true, 'next');
  const failed = await read('retry');
  assert.equal(failed.status, 502);
  const body = await failed.json();
  assert.equal(body.records, undefined);
  assert.match(body.error, /Source unavailable/);
  recordsAdapter = () => page([record('complete')]);
  assert.equal((await (await read('retry')).json()).records[0].recordId, 'complete');
});

test('invalid pages and repeated cursors are failures; valid empty tables remain valid', async () => {
  for (const result of [page([], true), { code: 0 }, { code: 0, data: { items: [] } }, page([{ fields: {} }])]) {
    recordsAdapter = () => result;
    assert.equal((await read('invalid')).status, 502);
  }
  recordsAdapter = () => page([record('repeat')], true, 'same');
  assert.equal((await read('loop')).status, 502);
  recordsAdapter = () => page([]);
  assert.deepEqual(await (await read('empty')).json(), { records: [] });
});

test('timeout is explicit, view requests stay separate and unauthorized readers are denied', async () => {
  recordsAdapter = () => { throw new axios.AxiosError('timed out', 'ECONNABORTED'); };
  const timeout = await read('timeout');
  assert.equal(timeout.status, 504);
  assert.match((await timeout.json()).error, /超时/);
  recordsAdapter = config => page([record(config.params.view_id)]);
  const a = await read('views', 'a'); const b = await read('views', 'b');
  assert.equal((await a.json()).records[0].recordId, 'a');
  assert.equal((await b.json()).records[0].recordId, 'b');
  assert.equal((await fetch(base + '?appToken=base-test&tableId=secret')).status, 401);
});

test('snapshot endpoints return immediately, require auth, and send records only when changed', async () => {
  const endpoint = base.replace('/records', '/snapshot');
  assert.equal((await fetch(endpoint)).status, 401);
  assert.equal((await fetch(endpoint, { headers: { authorization } })).status, 400);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  recordsAdapter = async () => { await gate; return page([record('snapshot-today')]); };
  const query = new URLSearchParams({ appToken: 'wiki-test', tableId: 'snapshot', viewId: 'a' });
  const queued = await fetch(endpoint + '?' + query, { headers: { authorization } });
  assert.equal(queued.headers.get('cache-control'), 'no-store');
  const initial = await queued.json();
  assert.equal(initial.ready, false);
  assert.equal(initial.records, undefined);
  release();
  let ready;
  for (let attempt = 0; attempt < 100; attempt++) {
    ready = await (await fetch(endpoint + '?' + query, { headers: { authorization } })).json();
    if (ready.ready) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(ready.records[0].recordId, 'snapshot-today');
  query.set('revision', ready.revision);
  const unchanged = await (await fetch(endpoint + '?' + query, { headers: { authorization } })).json();
  assert.equal(unchanged.records, undefined);
  assert.equal(unchanged.updatedAt, ready.updatedAt);
  recordsAdapter = () => { throw new axios.AxiosError('timed out', 'ETIMEDOUT'); };
  const sync = await fetch(endpoint.replace('/snapshot', '/sync') + '?' + query, { method: 'POST', headers: { authorization } });
  assert.equal(sync.status, 200);
  let failed;
  for (let attempt = 0; attempt < 100; attempt++) {
    failed = await (await fetch(endpoint + '?' + query, { headers: { authorization } })).json();
    if (failed.error) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.match(failed.error, /超时/);
  assert.equal(failed.updatedAt, ready.updatedAt);
});
