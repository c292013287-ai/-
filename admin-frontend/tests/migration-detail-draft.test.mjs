import assert from 'node:assert/strict';
import test from 'node:test';
import dayjs from 'dayjs';
import { getMigrationDetailDraft, migrationRecordFromFeishu } from '../src/pages/userMigrationData.ts';

const record = (fields) => migrationRecordFromFeishu({ recordId: 'detail-test', fields });

test('previously pushed values populate all three fields', () => {
  const saved = record({ '操作状态': '推送', '转量数量': '4386', '处理人': '李娜', '处理时间': '2026-09-10 16:30:00' });
  assert.deepEqual(getMigrationDetailDraft(saved), {
    transferCount: '4386', handler: '李娜', processedAt: '2026-09-10 16:30:00',
  });
});

test('Feishu seconds and milliseconds timestamps retain the correct instant', () => {
  const timestamp = 1789097400000;
  for (const value of [String(timestamp), String(timestamp / 1000)]) {
    const draft = getMigrationDetailDraft(record({ '处理时间': value }));
    assert.equal(dayjs(draft.processedAt).valueOf(), timestamp);
  }
});

test('zero transfers and historical handlers are not lost', () => {
  const draft = getMigrationDetailDraft(record({ '转量数量': '0', '处理人': '历史处理人' }));
  assert.equal(draft.transferCount, '0');
  assert.equal(draft.handler, '历史处理人');
});

test('missing or invalid saved values leave the inputs empty', () => {
  const empty = { transferCount: '', handler: undefined, processedAt: '' };
  assert.deepEqual(getMigrationDetailDraft(null), empty);
  assert.deepEqual(getMigrationDetailDraft(record({})), empty);
  assert.deepEqual(getMigrationDetailDraft(record({ '转量数量': '-', '处理人': '未分配', '处理时间': '-' })), empty);
});

test('edited fields override refreshed values, including intentionally cleared inputs', () => {
  const edits = { transferCount: '', handler: undefined };
  const refreshed = getMigrationDetailDraft(record({ '转量数量': '100', '处理人': '李娜', '处理时间': '2026-09-10 16:30:00' }));
  assert.deepEqual({ ...refreshed, ...edits }, { transferCount: '', handler: undefined, processedAt: '2026-09-10 16:30:00' });
});
