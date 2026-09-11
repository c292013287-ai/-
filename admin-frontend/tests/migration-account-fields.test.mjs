import assert from 'node:assert/strict';
import test from 'node:test';
import { getMigrationField, migrationRecordFromFeishu } from '../src/pages/userMigrationData.ts';

const makeRecord = (fields) => migrationRecordFromFeishu({ recordId: 'test-account-mapping', fields });

test('current Feishu account names are available to existing list, detail and export callers', () => {
  const record = makeRecord({ '迁移账号姓名': 'source999', '承接账号姓名': 'destination2' });
  assert.equal(getMigrationField(record, ['迁移账号对内昵称']), 'source999');
  assert.equal(getMigrationField(record, ['承接账号对你昵称']), 'destination2');
  assert.equal(record.targetGroup, 'destination2');
});

test('cached records use renamed raw fields even when targetGroup is still a placeholder', () => {
  const record = { ...makeRecord({}), targetGroup: '待分配', rawFields: { '承接账号姓名': 'destination2' } };
  assert.equal(getMigrationField(record, ['承接账号对你昵称']), 'destination2');
});

test('old account columns remain readable with both receiver nickname spellings', () => {
  for (const key of ['承接账号对你昵称', '承接账号对内昵称']) {
    const record = makeRecord({ '迁移账号对内昵称': 'old-source', [key]: 'old-target' });
    assert.equal(getMigrationField(record, ['迁移账号姓名']), 'old-source');
    assert.equal(getMigrationField(record, ['承接账号对你昵称']), 'old-target');
    assert.equal(record.targetGroup, 'old-target');
  }
});

test('current columns take precedence, with blank values falling back to old columns', () => {
  const record = makeRecord({ '承接账号姓名': ' current ', '承接账号对你昵称': 'old' });
  assert.equal(getMigrationField(record, ['承接账号对你昵称']), 'current');
  record.rawFields['承接账号姓名'] = ' ';
  assert.equal(getMigrationField(record, ['承接账号对你昵称']), 'old');
});

test('unrelated fields and manual record fallback behavior are preserved', () => {
  const record = { ...makeRecord({ '备注': 'note' }), targetGroup: 'manual-target' };
  assert.equal(getMigrationField(record, ['备注']), 'note');
  assert.equal(getMigrationField(record, ['承接账号对你昵称']), 'manual-target');
  assert.equal(getMigrationField(record, ['迁移账号对内昵称']), '-');
});
