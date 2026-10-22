import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cron = require('node-cron');
const prisma = require('../src/lib/prisma.ts').default;
const { servedUserJobs } = require('../src/services/servedUserJobs.ts');

test('daily 10am Shanghai schedule queues active entities through the existing background jobs', async t => {
  const schedules = [];
  const queries = [];
  const queued = [];
  const errors = [];
  t.mock.method(cron, 'schedule', (expression, callback, options) => {
    schedules.push({ expression, callback, options });
    return {};
  });
  const delegate = prisma.wecomEntity;
  const previousFindMany = delegate.findMany;
  const findMany = t.mock.fn(async query => {
    queries.push(query);
    return [{ id: 4 }, { id: 18 }];
  });
  delegate.findMany = findMany;
  t.after(() => { delegate.findMany = previousFindMany; });
  t.mock.method(servedUserJobs, 'start', id => {
    queued.push(id);
    return { entityId: id, status: id === 4 ? 'running' : 'queued' };
  });
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', (...args) => errors.push(args));
  require('../src/services/scheduler.ts');
  const daily = schedules.filter(item => item.expression === '0 10 * * *');
  assert.equal(daily.length, 1);
  assert.equal(daily[0].options.timezone, 'Asia/Shanghai');
  await daily[0].callback();
  assert.deepEqual(queries, [{ where: { status: 'active' }, select: { id: true } }]);
  assert.deepEqual(queued, [4, 18]);
  assert.deepEqual(errors, []);

  findMany.mock.mockImplementation(async () => { throw new Error('database unavailable'); });
  await daily[0].callback();
  assert.deepEqual(queued, [4, 18]);
  assert.equal(errors.length, 1);
  assert.match(errors[0].join(' '), /每日服务人数统计排队失败.*database unavailable/);
});
