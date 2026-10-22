import type { WecomEntity } from '../api/entities';

export const CONTACT_CAPACITY_TIERS = [5000, 20000, 50000, 200000, 500000, 1000000, 2000000];

const labels = {
  unconfigured: '未设置已购档位', unmeasured: '未统计', stale: '统计待更新',
  limit_reached: '已达上限，建议增购', insufficient_history: '历史数据不足',
  not_growing: '暂无净增长', out_of_range: '暂无法估算',
};

export function contactForecastDisplay(entity: WecomEntity, now = new Date()) {
  const forecast = entity.externalContactForecast;
  const status = entity.externalContactCapacity == null ? 'unconfigured'
    : !entity.servedUserCountUpdatedAt ? 'unmeasured'
    : now.getTime() - Date.parse(entity.servedUserCountUpdatedAt) > 2 * 86400000 ? 'stale'
    : forecast?.status || 'insufficient_history';
  const date = status === 'forecast' ? forecast?.estimatedPurchaseDate : null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
  const days = date ? Math.round((Date.parse(date) - Date.parse(today)) / 86400000) : null;
  return {
    label: date || labels[status as keyof typeof labels] || '暂无法估算',
    color: status === 'limit_reached' || days !== null && days <= 7 ? '#cf1322'
      : days !== null && days <= 30 ? '#d46b08' : undefined,
    sortDate: status === 'limit_reached' ? '0000' : date || '9999',
  };
}
