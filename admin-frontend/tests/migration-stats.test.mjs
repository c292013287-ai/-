import assert from 'node:assert/strict';
import test from 'node:test';
import { getMigrationStats, migrationRecordFromFeishu } from '../src/pages/userMigrationData.ts';

const makeRecord = (recordId, fields) => migrationRecordFromFeishu({ recordId, fields });

test('total collected counts rows with a source submitter', () => {
  const stats = getMigrationStats([
    makeRecord('with-submitter', { 提交人: '张三' }),
    makeRecord('without-submitter', { 转量数量: '100', 处理人: '李娜', 备注: '已处理' }),
  ]);

  assert.equal(stats.totalCollected, 1);
});

test('migrating counts records whose transfer count, handler and remark are all empty', () => {
  const stats = getMigrationStats([
    makeRecord('empty', { 提交人: '张三', 转量数量: '', 处理人: '待分配', 备注: '-' }),
    makeRecord('filled', { 提交人: '李四', 转量数量: '50' }),
  ]);

  assert.equal(stats.migratingCount, 1);
});

test('completion rate counts any non-empty transfer count, handler or remark', () => {
  const stats = getMigrationStats([
    makeRecord('transfer', { 提交人: '张三', 转量数量: '0' }),
    makeRecord('handler', { 提交人: '李四', 处理人: '李娜' }),
    makeRecord('remark', { 提交人: '王五', 备注: '无法转量' }),
    makeRecord('empty', { 提交人: '赵六' }),
  ]);

  assert.equal(stats.completedCount, 3);
  assert.equal(stats.migratingCount, 1);
  assert.equal(stats.completionRate, 75);
});
