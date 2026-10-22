import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTACT_CAPACITY_TIERS, contactForecastDisplay } from '../src/pages/entityContactForecast.ts';

test('displays the approved capacity tiers and forecast states', () => {
  assert.deepEqual(CONTACT_CAPACITY_TIERS, [5000, 20000, 50000, 200000, 500000, 1000000, 2000000]);
  const now = new Date('2026-10-21T16:30:00Z');
  const entity = { externalContactCapacity: 50000, servedUserCountUpdatedAt: now.toISOString() };
  assert.equal(contactForecastDisplay({}, now).label, '未设置已购档位');
  for (const [status, label] of [['unmeasured', '未统计'], ['stale', '统计待更新'], ['limit_reached', '已达上限，建议增购'],
    ['insufficient_history', '历史数据不足'], ['not_growing', '暂无净增长']]) {
    assert.equal(contactForecastDisplay({ ...entity, externalContactForecast: { status } }, now).label, label);
  }
  const forecast = contactForecastDisplay({ ...entity, externalContactForecast: { status: 'forecast', estimatedPurchaseDate: '2026-10-23' } }, now);
  assert.equal(forecast.label, '2026-10-23');
  assert.equal(forecast.color, '#cf1322');
  assert.equal(contactForecastDisplay(entity, new Date(now.getTime() + 49 * 3600000)).label, '统计待更新');
});
