import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { decryptCallback, parseCallbackXml } from '../src/lib/customerCallback.ts';
import { backoff, customerLive, enqueueDetail } from '../src/services/customerLive.ts';
import { getCustomerIds, mapCustomerContact } from '../src/services/wecom.ts';
import { ensureCustomerLiveSchema } from '../src/lib/customerLiveSchema.ts';
import { fingerprintOf, relationKey, upsertCustomers, readLivePage, exportLive, sql, liveState } from '../src/lib/customerLiveStore.ts';
import prismaModule from '../src/lib/prisma.ts';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import callbackModule from '../src/routes/customerCallbacks.ts';
const axios = createRequire(import.meta.url)('axios');
const prisma = prismaModule.default || prismaModule;

function encryptedMessage(payload, corp = 'corp-test') {
  const key = randomBytes(32); const token = 'test-token'; const timestamp = String(Math.floor(Date.now() / 1000)); const nonce = 'nonce';
  const text = Buffer.from(payload); const size = Buffer.alloc(4); size.writeUInt32BE(text.length);
  const raw = Buffer.concat([randomBytes(16), size, text, Buffer.from(corp)]); const pad = 32 - raw.length % 32;
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16)); cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([raw, Buffer.alloc(pad, pad)])), cipher.final()]).toString('base64');
  const signature = createHash('sha1').update([token, timestamp, nonce, encrypted].sort().join('')).digest('hex');
  return [{ token, aesKey: key.toString('base64').slice(0, -1) }, corp, encrypted, signature, timestamp, nonce];
}

test('callback verifies signature, receiver, timestamp and preserves string IDs', () => {
  const args = encryptedMessage('<xml><UserID><![CDATA[000123]]></UserID><Event>change_external_contact</Event></xml>');
  assert.equal(parseCallbackXml(decryptCallback(...args)).UserID, '000123');
  const wrong = [...args]; wrong[1] = 'another-corp'; assert.throws(() => decryptCallback(...wrong));
  const tamper = [...args]; tamper[3] = '0'.repeat(40); assert.throws(() => decryptCallback(...tamper));
  assert.throws(() => decryptCallback(...args, Date.now() + 700000));
  assert.throws(() => parseCallbackXml('<!DOCTYPE xml [<!ENTITY x SYSTEM "file:///etc/passwd">]><xml>&x;</xml>'));
});

test('relationship identity includes employee and retry delay is bounded', () => {
  assert.notEqual(relationKey('customer', 'a'), relationKey('customer', 'b'));
  assert.equal(backoff(0), 15000); assert.equal(backoff(100), 1800000);
  const row = mapCustomerContact({ external_userid: 'c', name: 'test' }, { userid: 'a', createtime: 123, tags: [{ tag_id: 'tag', tag_name: '标签' }] });
  assert.equal(row.addedAt, 123); assert.deepEqual(row.tags, [{ id: 'tag', name: '标签' }]);
});

test('MySQL incremental integration: filtering, reconciliation, resume and race guards', { skip: process.env.CUSTOMER_LIVE_TEST_DB !== 'true' }, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Integration test must run only on a local DB');
  await ensureCustomerLiveSchema();
  const entity = await prisma.wecomEntity.create({ data: { name: '__customer_live_test__', corpid: 'test-' + Date.now(), secret: 'test', wecomApiBaseUrl: 'http://wecom.test' } });
  const id = entity.id, fp = fingerprintOf(entity);
  const row = (externalUserId, userId = 'employee') => ({ externalUserId, userId, name: '测试客户', remark: '备注', unionId: '', addedAt: Date.parse('2026-10-13T00:00:00+08:00') / 1000, gender: 0, type: 1, addWay: 3, tags: [{ id: 't1', name: '标签' }], remarkMobiles: ['001234'], state: 'channel' });
  const meta = { users: ['employee'], tags: [{ id: 't1', name: '标签' }], sources: [3], warning: '', updatedAt: '2026-10-12T16:20:00Z' };
  const adapter = axios.defaults.adapter;
  t.after(async () => {
    axios.defaults.adapter = adapter;
    for (const table of ['customer_live_relations', 'customer_live_state', 'customer_live_employees', 'customer_live_tasks', 'customer_live_events']) await prisma.$executeRawUnsafe(`DELETE FROM ${table} WHERE entity_id=?`, id);
    await prisma.wecomEntity.delete({ where: { id } }); await prisma.$disconnect();
  });
  await prisma.$executeRaw(sql`INSERT INTO customer_live_state(entity_id,fingerprint,ready,meta) VALUES(${id},${fp},TRUE,${JSON.stringify(meta)})`);
  await upsertCustomers(id, fp, [row('c1'), row('c1', 'other'), { ...row('yesterday'), addedAt: row('c1').addedAt - 1 }], 100);
  await upsertCustomers(id, fp, [{ ...row('c1'), name: 'old import' }], 0);
  for (const [key, value] of Object.entries({ name: '测试', tagId: 't1', phone: '123', gender: '0', type: '1', addWay: '3', unionStatus: 'missing' })) {
    assert.equal((await readLivePage(id, fp, { [key]: value }, 1, 20)).total, 3, key);
  }
  let page = await readLivePage(id, fp, { startDate: '2026-10-13', endDate: '2026-10-13', name: '测试', tagId: 't1', phone: '123', gender: '0', type: '1', addWay: '3', unionStatus: 'missing' }, 1, 20);
  assert.equal(page.total, 2); assert.equal(page.count, 3); assert.equal(page.items[0].name, '测试客户');
  assert.equal((await readLivePage(id, fp, { userId: 'employee', externalUserId: 'c1' }, 1, 20)).total, 1);
  assert.equal((await readLivePage(id, 'different-fingerprint', {}, 1, 20)), null);
  const exported = exportLive(id, fp, {});
  const firstExported = await exported.next();
  await upsertCustomers(id, fp, [{ ...row('c1'), name: 'changed during download' }], 101);
  const exportRows = [firstExported.value]; for await (const item of exported) exportRows.push(item);
  assert.equal(exportRows.length, 3); assert.ok(exportRows.every(item => item.name === '测试客户'));
  await prisma.$executeRaw(sql`UPDATE customer_live_relations SET deleted=TRUE,observed_ms=200 WHERE entity_id=${id} AND relation_key=${relationKey('c1', 'other')}`);
  await prisma.$executeRaw(sql`UPDATE customer_live_state SET active_count=active_count-1 WHERE entity_id=${id}`);
  await upsertCustomers(id, fp, [row('c1', 'other')], 150);
  assert.equal((await readLivePage(id, fp, { userId: 'other' }, 1, 20)).total, 0);
  await upsertCustomers(id, fp, [row('c1', 'other')], 300);
  assert.equal((await readLivePage(id, fp, { userId: 'other' }, 1, 20)).total, 1);

  let requests = []; let failPage = false; let finalPage = false; let emptyEmployee = false;
  axios.defaults.adapter = async config => {
    requests.push(config.url);
    let data;
    if (config.url.endsWith('/gettoken')) data = { errcode: 0, access_token: 'test-token', expires_in: 7200 };
    else if (config.url.endsWith('/externalcontact/list')) data = emptyEmployee ? { errcode: 84061 } : { errcode: 0, external_userid: ['c1', 'new'] };
    else if (config.url.endsWith('/externalcontact/get')) data = { errcode: 0, external_contact: { external_userid: 'new', name: 'new' }, follow_user: [{ userid: 'employee', createtime: row('c1').addedAt }] };
    else if (config.url.endsWith('/externalcontact/batch/get_by_user')) {
      if (failPage) data = { errcode: 48002 };
      else if (emptyEmployee) data = { errcode: 0, external_contact_list: [], next_cursor: '' };
      else data = { errcode: 0, external_contact_list: [{ external_contact: { external_userid: 'page-new' }, follow_info: { userid: 'employee', createtime: row('c1').addedAt } }], next_cursor: finalPage ? '' : 'cursor-2' };
    } else throw new Error('Unexpected network request');
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  await prisma.$executeRaw(sql`INSERT INTO customer_live_employees(entity_id,fingerprint,user_id,full_ms) VALUES(${id},${fp},'employee',${Date.now()})`);
  const employee = () => prisma.$queryRaw(sql`SELECT * FROM customer_live_employees WHERE entity_id=${id} AND user_id='employee'`).then(rows => rows[0]);
  await customerLive.employee(await employee());
  assert.equal(requests.filter(url => url.endsWith('/externalcontact/list')).length, 1);
  assert.equal(requests.filter(url => url.endsWith('/batch/get_by_user')).length, 0);
  assert.equal((await readLivePage(id, fp, { externalUserId: 'yesterday' }, 1, 20)).total, 0);
  let tasks = await prisma.$queryRaw(sql`SELECT * FROM customer_live_tasks WHERE entity_id=${id}`);
  assert.equal(tasks.length, 1);
  await enqueueDetail(id, fp, 'new', 'employee');
  await customerLive.detail(tasks[0]);
  // A notification received during processing is retained for another read.
  assert.equal((await prisma.$queryRaw(sql`SELECT * FROM customer_live_tasks WHERE entity_id=${id}`)).length, 1);
  tasks = await prisma.$queryRaw(sql`SELECT * FROM customer_live_tasks WHERE entity_id=${id}`);
  await customerLive.detail(tasks[0]);
  assert.equal((await readLivePage(id, fp, { externalUserId: 'new' }, 1, 20)).total, 1);
  const scan = { cursor: 'cursor-1', generation: 'test-scan', started: Date.now(), pages: 0 };
  await prisma.$executeRaw(sql`UPDATE customer_live_employees SET scan=${JSON.stringify(scan)} WHERE entity_id=${id}`);
  await customerLive.employee(await employee());
  let progress = await employee();
  const parse = v => typeof v === 'string' ? JSON.parse(v) : v;
  assert.equal(parse(progress.scan).cursor, 'cursor-2');
  failPage = true; await customerLive.employee(progress);
  progress = await employee(); assert.equal(parse(progress.scan).cursor, 'cursor-2'); assert.equal(progress.failures, 1);
  await upsertCustomers(id, fp, [row('concurrent-notification')], Date.now() + 1000);
  failPage = false; finalPage = true; await customerLive.employee(progress);
  assert.equal(parse((await employee()).scan), null);
  assert.equal((await readLivePage(id, fp, { externalUserId: 'concurrent-notification' }, 1, 20)).total, 1);
  assert.equal((await readLivePage(id, fp, { userId: 'other' }, 1, 20)).total, 1);
  assert.ok(Number((await liveState(id, fp)).increment_ms) > 0);
  await Promise.all([upsertCustomers(id, fp, [row('same-concurrent-id')], Date.now()), upsertCustomers(id, fp, [row('same-concurrent-id')], Date.now() + 1)]);
  const exact = await prisma.$queryRaw(sql`SELECT COUNT(*) n FROM customer_live_relations WHERE entity_id=${id} AND deleted=FALSE`);
  assert.equal(Number((await liveState(id, fp)).active_count), Number(exact[0].n));
  emptyEmployee = true; assert.deepEqual(await getCustomerIds(entity, 'employee'), []);
  failPage = true; await assert.rejects(() => getCustomerIds(entity, 'employee'), /48002/);
  emptyEmployee = false; failPage = false;

  const temporary = await mkdtemp(path.join(tmpdir(), 'callback-test-'));
  const oldConfig = process.env.CUSTOMER_CALLBACK_CONFIG;
  process.env.CUSTOMER_CALLBACK_CONFIG = path.join(temporary, 'config.json');
  const eventXml = `<xml><ToUserName>${entity.corpid}</ToUserName><Event>change_external_contact</Event><ChangeType>add_external_contact</ChangeType><UserID>employee</UserID><ExternalUserID>callback-customer</ExternalUserID><CreateTime>123</CreateTime></xml>`;
  const args = encryptedMessage(eventXml, entity.corpid);
  await writeFile(process.env.CUSTOMER_CALLBACK_CONFIG, JSON.stringify({ [id]: args[0] }), { mode: 0o600 });
  const express = createRequire(import.meta.url)('express'); const app = express();
  app.use('/events', callbackModule.default || callbackModule);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  customerLive.enabled = true;
  t.after(async () => { customerLive.enabled = false; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); if (oldConfig) process.env.CUSTOMER_CALLBACK_CONFIG = oldConfig; else delete process.env.CUSTOMER_CALLBACK_CONFIG; await rm(temporary, { recursive: true, force: true }); });
  const query = new URLSearchParams({ msg_signature: args[3], timestamp: args[4], nonce: args[5] });
  const endpoint = `http://127.0.0.1:${server.address().port}/events/${id}`;
  for (let repeat = 0; repeat < 2; repeat++) {
    const response = await fetch(endpoint + '?' + query, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: `<xml><Encrypt><![CDATA[${args[2]}]]></Encrypt></xml>` });
    assert.equal(response.status, 200); assert.equal(await response.text(), 'success');
  }
  assert.equal((await prisma.$queryRaw(sql`SELECT COUNT(*) n FROM customer_live_events WHERE entity_id=${id}`))[0].n, 1n);
  assert.equal((await prisma.$queryRaw(sql`SELECT COUNT(*) n FROM customer_live_tasks WHERE entity_id=${id} AND external_id='callback-customer'`))[0].n, 1n);
  query.set('echostr', args[2]); const challenge = await fetch(endpoint + '?' + query); assert.equal(await challenge.text(), eventXml);
  query.set('msg_signature', '0'.repeat(40)); assert.equal((await fetch(endpoint + '?' + query)).status, 403);
});
