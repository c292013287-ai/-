import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import express from 'express';
import jwt from 'jsonwebtoken';

const require = createRequire(import.meta.url);
const prisma = require('../src/lib/prisma.ts').default;
const entities = require('../src/routes/entities.ts').default;
const { servedUserJobs } = require('../src/services/servedUserJobs.ts');
const { fmtDate } = require('../src/lib/date.ts');

test('capacity settings and successful daily history are consistent; failed pages preserve previous results', async () => {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname));
  let release;
  let reached;
  let secondPageReady = new Promise(resolve => { reached = resolve; });
  let gate = new Promise(resolve => { release = resolve; });
  let fail = false;
  const api = express();
  api.use(express.json());
  api.get('/cgi-bin/gettoken', (_req, res) => res.json({ errcode: 0, access_token: 'local-test-only', expires_in: 7200 }));
  api.post('/cgi-bin/externalcontact/contact_list', async (req, res) => {
    if (!req.body.cursor) return res.json({ errcode: 0, info_list: [{ tmp_openid: 'a' }, { tmp_openid: 'b' }], next_cursor: 'next' });
    reached();
    await gate;
    res.json(fail ? { errcode: 48002 } : { errcode: 0, info_list: [{ tmp_openid: 'a' }, { tmp_openid: 'c' }] });
  });
  const apiServer = api.listen(0, '127.0.0.1');
  await once(apiServer, 'listening');
  const app = express();
  app.use(express.json()); app.use('/api/entities', entities);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/entities`;
  const secret = process.env.JWT_SECRET || 'default-secret';
  const headers = { 'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt.sign({ userId: 1, role: 'admin' }, secret)}`,
    'X-Entity-Access-Token': jwt.sign({ userId: 1, scope: 'entity-management' }, secret) };
  let entity;
  const get = () => prisma.wecomEntity.findUniqueOrThrow({ where: { id: entity.id } });
  const history = () => prisma.servedUserDailyStat.findMany({ where: { entityId: entity.id }, orderBy: { date: 'asc' } });
  async function update(body) {
    return fetch(`${base}/${entity.id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
  }
  async function done() {
    for (let i = 0; i < 200; i++) {
      const job = servedUserJobs.list().find(item => item.entityId === entity.id);
      if (job && ['completed', 'failed'].includes(job.status)) return job;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Test job did not finish');
  }
  try {
    const previousAt = new Date(Date.now() - 7 * 86400000);
    entity = await prisma.wecomEntity.create({ data: { name: 'Forecast integration test', corpid: randomUUID(), secret: 'test-only',
      wecomApiBaseUrl: `http://127.0.0.1:${apiServer.address().port}`, servedUserCount: 0,
      servedUserCountUpdatedAt: previousAt, externalContactCapacity: 5000 } });
    assert.equal((await update({ externalContactCapacity: 10000 })).status, 400);
    assert.equal((await get()).externalContactCapacity, 5000);
    assert.equal((await update({ externalContactCapacity: 20000 })).status, 200);
    assert.equal((await get()).externalContactCapacity, 20000);
    servedUserJobs.start(entity.id);
    await secondPageReady;
    assert.equal((await get()).servedUserCount, 0);
    assert.deepEqual(await history(), []);
    release();
    const job = await done();
    assert.equal(job.status, 'completed');
    assert.equal(job.result.servedUserCount, 3);
    assert.equal(job.result.externalContactForecast.capacity, 20000);
    assert.equal(job.result.externalContactForecast.status, 'forecast');
    const rows = await history();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].count, 0);
    assert.equal(rows[1].count, 3);
    assert.equal(rows[1].date.toISOString().slice(0, 10), fmtDate(new Date()));
    servedUserJobs.start(entity.id);
    assert.equal((await done()).status, 'completed');
    assert.equal((await history()).length, 2, 'Same-day retries replace the daily observation');

    const before = await get();
    const beforeHistory = await history();
    fail = true;
    servedUserJobs.start(entity.id);
    assert.equal((await done()).status, 'failed');
    const after = await get();
    assert.equal(after.servedUserCount, before.servedUserCount);
    assert.equal(after.servedUserCountUpdatedAt.getTime(), before.servedUserCountUpdatedAt.getTime());
    assert.deepEqual(await history(), beforeHistory);
    const response = await fetch(`${base}/manage`, { headers });
    const managed = (await response.json()).find(item => item.id === entity.id);
    assert.equal(managed.externalContactForecast.status, 'forecast');
    assert.equal((await update({ externalContactCapacity: null })).status, 200);
    assert.equal((await get()).externalContactCapacity, null);

    fail = false;
    gate = new Promise(resolve => { release = resolve; });
    secondPageReady = new Promise(resolve => { reached = resolve; });
    servedUserJobs.start(entity.id);
    await secondPageReady;
    assert.equal((await update({ corpid: randomUUID() })).status, 200);
    release();
    assert.equal((await done()).status, 'failed');
    assert.equal((await get()).servedUserCount, null);
    assert.deepEqual(await history(), beforeHistory, 'An identity change must not publish the old traversal');
  } finally {
    release?.();
    if (entity) await prisma.wecomEntity.delete({ where: { id: entity.id } });
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => apiServer.close(resolve));
    await prisma.$disconnect();
  }
});
