import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildEntityWorkbook } from '../src/pages/entityExport.ts';

test('exports every entity, numeric zero, saved timestamps and no credentials', () => {
  const entities = Array.from({ length: 25 }, (_, id) => ({
    id, name: '=SUM(1,2)', sku: null, corpid: 'ww123', secret: 'secret-not-for-export',
    status: 'active', quotaBalance: 0, servedUserCount: id === 0 ? 0 : null,
    servedUserCountUpdatedAt: id === 0 ? '2026-09-23T07:17:24.000Z' : null,
    certificationExpiresAt: '2027-09-04T00:00:00.000Z',
  }));
  const wb = buildEntityWorkbook(entities);
  const roundTrip = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const sheet = roundTrip.Sheets['主体管理'];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  assert.equal(rows.length, 26);
  assert.equal(rows[1][9], 0);
  assert.equal(rows[2][9], '未统计');
  assert.equal(rows[1][10], '未设置已购档位');
  assert.match(rows[1][11], /15:17:24/);
  assert.equal(rows[1][8], '2027-09-04');
  assert.equal(sheet.C2.t, 's');
  assert.equal(sheet.C2.f, undefined);
  assert.ok(!JSON.stringify(rows).includes('secret-not-for-export'));
});

test('empty export retains column headers', () => {
  const wb = buildEntityWorkbook([]);
  assert.equal(wb.Sheets['主体管理']['!ref'], 'A1:L1');
});
