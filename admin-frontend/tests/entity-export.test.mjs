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
  assert.equal(rows[1][10], '未录入');
  assert.equal(rows[1][11], '未设置已购档位');
  assert.match(rows[1][12], /15:17:24/);
  assert.equal(rows[1][8], '2027-09-04');
  assert.equal(sheet.C2.t, 's');
  assert.equal(sheet.C2.f, undefined);
  assert.ok(!JSON.stringify(rows).includes('secret-not-for-export'));
});

test('empty export retains column headers', () => {
  const wb = buildEntityWorkbook([]);
  assert.equal(wb.Sheets['主体管理']['!ref'], 'A1:M1');
});

test('exports actual validity periods separately from capacity forecasts', () => {
  const now = new Date('2026-10-22T02:00:00Z');
  const base = { name: '测试主体', status: 'active', quotaBalance: 0,
    externalContactCapacity: 50000, servedUserCountUpdatedAt: now.toISOString() };
  const entities = [
    { ...base, externalContactValidFrom: '2026-11-24T02:03:00Z', externalContactValidUntil: '2027-11-24T02:03:00Z',
      externalContactForecast: { status: 'forecast', estimatedPurchaseDate: '2026-10-30' } },
    { ...base, externalContactValidFrom: '2025-11-24T02:03:00Z', externalContactValidUntil: '2026-10-22T02:00:00Z',
      externalContactForecast: { status: 'limit_reached' } },
    { ...base, externalContactForecast: { status: 'insufficient_history' } },
  ];
  const wb = buildEntityWorkbook(entities, now);
  const roundTrip = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const sheet = roundTrip.Sheets['主体管理'];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  assert.deepEqual(rows[0].slice(9, 13), ['去重已服务人数', '外部联系人有效时长', '外部联系人规模预计增购时间', '服务人数统计更新时间']);
  assert.equal(rows[1][10], '自 2026/11/24 10:03 续期至 2027/11/24 10:03');
  assert.equal(rows[2][10], '自 2025/11/24 10:03 续期至 2026/10/22 10:00');
  assert.equal(rows[3][10], '未录入');
  assert.equal(sheet.K2.t, 's');
  assert.equal(rows[1][11], '2026-10-30');
});
