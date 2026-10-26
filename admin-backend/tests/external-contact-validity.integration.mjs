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
const router = require('../src/routes/entities.ts').default;

test('actual validity dates persist, preserve omitted settings, reject partial updates and retain access checks', async () => {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname));
  const app = express();
  app.use(express.json());
  app.use('/api/entities', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/entities`;
  const secret = process.env.JWT_SECRET || 'default-secret';
  const loginHeaders = { 'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt.sign({ userId: 1, role: 'admin' }, secret, { expiresIn: '2m' })}` };
  const headers = { ...loginHeaders,
    'X-Entity-Access-Token': jwt.sign({ userId: 1, scope: 'entity-management' }, secret, { expiresIn: '2m' }) };
  const period = { externalContactValidFrom: '2026-11-24T10:03:00+08:00', externalContactValidUntil: '2027-11-24T10:03:00+08:00' };
  let id;
  const update = body => fetch(`${base}/${id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
  const get = () => prisma.wecomEntity.findUniqueOrThrow({ where: { id } });
  try {
    assert.equal((await fetch(`${base}/manage`)).status, 401);
    assert.equal((await fetch(`${base}/manage`, { headers: loginHeaders })).status, 403);
    const response = await fetch(base, { method: 'POST', headers, body: JSON.stringify({
      name: 'Contact validity integration test', corpid: randomUUID(), secret: 'test-only', ...period,
    }) });
    assert.equal(response.status, 201);
    const created = await response.json();
    id = created.id;
    assert.equal(created.externalContactValidFrom, '2026-11-24T02:03:00.000Z');
    assert.equal(created.externalContactValidUntil, '2027-11-24T02:03:00.000Z');
    await prisma.wecomEntity.update({ where: { id }, data: { servedUserCount: 123, servedUserCountUpdatedAt: new Date() } });
    assert.equal((await update({ sku: 'test-validity' })).status, 200);
    assert.equal((await get()).externalContactValidUntil.toISOString(), created.externalContactValidUntil);
    for (const invalid of [{ externalContactValidFrom: period.externalContactValidFrom },
      { ...period, externalContactValidUntil: period.externalContactValidFrom },
      { ...period, externalContactValidFrom: '2026-02-30T10:03:00+08:00' }]) {
      assert.equal((await update(invalid)).status, 400);
      assert.equal((await get()).externalContactValidUntil.toISOString(), created.externalContactValidUntil);
    }
    assert.equal((await update({ ...period, externalContactValidUntil: '2028-11-24T10:03:00+08:00' })).status, 200);
    const managedResponse = await fetch(`${base}/manage`, { headers });
    assert.equal(managedResponse.status, 200);
    const managed = (await managedResponse.json()).find(entity => entity.id === id);
    assert.equal(managed.externalContactValidUntil, '2028-11-24T02:03:00.000Z');
    assert.equal(managed.servedUserCount, 123);
    assert.equal(managed.externalContactForecast.status, 'unconfigured', 'Validity is independent of purchased capacity');
    assert.equal((await update({ externalContactValidFrom: null, externalContactValidUntil: null })).status, 200);
    const cleared = await get();
    assert.equal(cleared.externalContactValidFrom, null);
    assert.equal(cleared.externalContactValidUntil, null);
    assert.equal(cleared.servedUserCount, 123);
  } finally {
    if (id) await prisma.wecomEntity.delete({ where: { id } });
    await new Promise(resolve => server.close(resolve));
    await prisma.$disconnect();
  }
});
