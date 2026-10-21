import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import express from 'express';
import jwt from 'jsonwebtoken';
const require = createRequire(import.meta.url);
const prisma = require('../src/lib/prisma.ts').default;
const workbench = require('../src/routes/workbench.ts').default;

test('workbench database persistence, ownership, access control and conflicts', async () => {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname), 'Integration tests require a local database');
  const app = express();
  app.use(express.json()); app.use('/api/workbench', workbench);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/workbench`;
  const users = [];
  const secret = process.env.JWT_SECRET || 'default-secret';
  const note = { title: '测试笔记', content: '第一行\n第二行', pinned: false };
  const todo = { title: '测试待办', completed: false, priority: 'high', dueDate: '2028-02-29' };
  const headers = userId => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt.sign({ userId, role: 'admin' }, secret, { expiresIn: '5m' })}`,
    'X-Entity-Access-Token': jwt.sign({ userId, scope: 'entity-management' }, secret, { expiresIn: '5m' }),
  });
  async function request(path, { method = 'GET', body, userId = users[0]?.id, override = {} } = {}) {
    const response = await fetch(`${base}${path}`, { method, headers: { ...headers(userId), ...override }, body: body && JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  try {
    for (let i = 0; i < 2; i++) users.push(await prisma.user.create({ data: { username: `workbench-test-${randomUUID()}`, password: 'not-a-login-hash', name: '工作台自动测试' } }));
    for (const resource of ['notes', 'todos']) {
      assert.equal((await request(`/${resource}`, { override: { Authorization: '' } })).status, 401);
      for (const token of ['', jwt.sign({ userId: users[0].id, scope: 'entity-management' }, secret, { expiresIn: -1 }),
        jwt.sign({ userId: users[1].id, scope: 'entity-management' }, secret), jwt.sign({ userId: users[0].id, scope: 'wrong' }, secret)]) {
        assert.equal((await request(`/${resource}`, { override: { 'X-Entity-Access-Token': token } })).status, 403);
        assert.equal((await request(`/${resource}`, { method: 'POST', body: resource === 'notes' ? note : todo, override: { 'X-Entity-Access-Token': token } })).status, 403);
      }
      const input = resource === 'notes' ? note : todo;
      const created = await request(`/${resource}`, { method: 'POST', body: { ...input, userId: users[1].id } });
      assert.equal(created.status, 201);
      assert.equal(created.data.userId, users[0].id);
      assert.equal(created.data.version, 1);
      const id = created.data.id;
      assert.equal((await request(`/${resource}`)).data.length, 1);
      assert.deepEqual((await request(`/${resource}`, { userId: users[1].id })).data, []);
      assert.equal((await request(`/${resource}/${id}`, { method: 'PUT', userId: users[1].id, body: { ...input, version: 1 } })).status, 404);
      assert.equal((await request(`/${resource}/${id}`, { method: 'DELETE', userId: users[1].id, body: { version: 1 } })).status, 404);
      const changed = await request(`/${resource}/${id}`, { method: 'PUT', body: { ...input, title: '已更新', pinned: true, completed: true, version: 1 } });
      assert.equal(changed.status, 200);
      assert.equal(changed.data.title, '已更新');
      assert.equal(changed.data.version, 2);
      if (resource === 'todos') {
        assert.ok(changed.data.completedAt);
        assert.equal(changed.data.dueDate.slice(0, 10), todo.dueDate);
      }
      assert.equal((await request(`/${resource}/${id}`, { method: 'PUT', body: { ...input, version: 1 } })).status, 409);
      assert.equal((await request(`/${resource}/${id}`, { method: 'DELETE', body: { version: 1 } })).status, 409);
      const restored = await request(`/${resource}/${id}`, { method: 'PUT', body: { ...input, version: 2 } });
      assert.equal(restored.status, 200);
      if (resource === 'todos') assert.equal(restored.data.completedAt, null);
      assert.equal((await request(`/${resource}/${id}`, { method: 'DELETE', body: { version: 3 } })).status, 200);
      assert.deepEqual((await request(`/${resource}`)).data, []);
      assert.equal((await request(`/${resource}`, { method: 'POST', body: { ...input, title: ' ' } })).status, 400);
      assert.equal((await request(`/${resource}/invalid`, { method: 'DELETE', body: { version: 1 } })).status, 400);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
    await prisma.$disconnect();
  }
});
