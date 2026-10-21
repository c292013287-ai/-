import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerStorageGuard, CustomerStorageError } from '../src/lib/customerStorageGuard.ts';

const GB = 1024 ** 3;

test('pauses below 1GiB, preserves headroom and resumes only at 2GiB', async () => {
  let bytes = 3 * GB;
  let time = 0;
  const guard = createCustomerStorageGuard(async () => bytes, () => time);
  assert.equal(await guard.available(), true);
  bytes = GB - 1; time += 5001;
  await assert.rejects(guard.assertAvailable(), CustomerStorageError);
  assert.match(guard.reason, /进度已保留/);
  bytes = 1.5 * GB; time += 5001;
  assert.equal(await guard.available(), false);
  bytes = 2 * GB; time += 5001;
  await guard.assertAvailable();
  assert.equal(guard.reason, '');
});

test('disk inspection failure pauses writes and can recover', async () => {
  let time = 0;
  let broken = true;
  const guard = createCustomerStorageGuard(async () => { if (broken) throw new Error('EACCES'); return 3 * GB; }, () => time);
  await assert.rejects(guard.assertAvailable(), CustomerStorageError);
  assert.match(guard.reason, /无法检查/);
  broken = false; time += 5001;
  assert.equal(await guard.available(), true);
});

test('concurrent callers share checks and do not repeatedly access the disk', async () => {
  let calls = 0;
  let finish;
  let time = 0;
  const guard = createCustomerStorageGuard(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, () => time);
  const first = guard.available();
  const second = guard.available();
  finish(0);
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(calls, 1);
  assert.equal(await guard.available(), false);
  assert.equal(calls, 1);
  time += 5001;
  const third = guard.available(); finish(3 * GB);
  assert.equal(await third, true);
  assert.equal(calls, 2);
});
