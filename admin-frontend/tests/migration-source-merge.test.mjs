import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeMigrationRecords, migrationRecordFromFeishu, DELETED_MIGRATION_SOURCE_IDS_KEY } from '../src/pages/userMigrationData.ts';

const store = new Map();
globalThis.localStorage = { getItem: key => store.get(key) ?? null };
const row = (id, fields = {}) => migrationRecordFromFeishu({ recordId: id, fields });

test('fresh source fields replace cached count, handler and remarks, including cleared values', () => {
  const cached = row('existing', { 转量数量: '10', 处理人: 'Old', 备注: 'old' });
  const incoming = row('existing', { 转量数量: '25', 处理人: 'New', 备注: 'new' });
  assert.deepEqual(mergeMigrationRecords([cached], [incoming]), [incoming]);
  const cleared = row('existing', { 转量数量: '', 处理人: '', 备注: '' });
  assert.deepEqual(mergeMigrationRecords([incoming], [cleared]), [cleared]);
});

test('new records merge without discarding local/history records or resurrecting hidden source rows', () => {
  store.set(DELETED_MIGRATION_SOURCE_IDS_KEY, JSON.stringify(['hidden']));
  const local = { id: 1, source: 'local', name: 'Manual' };
  const history = row('history');
  const newest = row('today');
  const merged = mergeMigrationRecords([local, history], [newest, row('hidden')]);
  assert.deepEqual(merged, [newest, local, history]);
  store.clear();
});
