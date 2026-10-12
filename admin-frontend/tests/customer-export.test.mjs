import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildCustomerWorkbook } from '../src/pages/customerExport.ts';
import { matchesCustomer, customerSource } from '../src/pages/customerQuery.ts';

test('exports all filtered relationships across pages with metadata and text identifiers', () => {
  const items = Array.from({ length: 45 }, (_, i) => ({
    externalUserId: `000${i}`, unionId: i ? 'union' : '', userId: '00123', name: '=1+1',
    remarkMobiles: ['001234', '002345'], tags: [{ id: 'tag-id', name: '' }], gender: i < 25 ? 2 : 1,
    addWay: 0, type: 1, addedAt: Date.parse('2026-10-12T08:00:00+08:00') / 1000,
  }));
  const filters = { gender: 2, addWay: 0 };
  const workbook = buildCustomerWorkbook(items.filter(item => matchesCustomer(item, filters)), {
    entityName: '测试主体', scope: '整个主体', updatedAt: '2026-10-12T00:00:00Z', filters, sourceLabel: customerSource,
  });
  const actual = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const sheet = actual.Sheets['客户数据'];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  assert.equal(rows.length, 26);
  assert.equal(rows[1][4], '女');
  assert.equal(rows[1][6], '001234\n002345');
  assert.equal(rows[1][7], 'tag-id');
  assert.equal(rows[1][10], 0);
  assert.equal(rows[1][14], '00123');
  assert.equal(rows[1][18], '未获取');
  assert.equal(sheet.D2.t, 's');
  assert.equal(sheet.D2.f, undefined);
  const info = XLSX.utils.sheet_to_json(actual.Sheets['导出信息'], { header: 1 });
  assert.ok(info.some(row => row[0] === '性别' && row[1] === '女'));
  assert.ok(info.some(row => row[0] === '导出客户跟进关系数' && row[1] === 25));
  assert.ok(info.some(row => row[0] === '数据更新时间（北京时间）' && row[1].includes('08:00:00')));
});
