import { fmtDate } from './date';

const TIERS = [5000, 20000, 50000, 200000, 500000, 1000000, 2000000];
const DAY_MS = 86400000;

export function parseExternalContactCapacity(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value > 2147483647
    || (!TIERS.includes(value) && value < 2000000)) {
    throw new Error('请选择有效的外部联系人规模档位，自定义规模须不低于200万位');
  }
  return value;
}

export interface ContactForecast {
  status: 'unconfigured' | 'unmeasured' | 'stale' | 'limit_reached' | 'insufficient_history' | 'not_growing' | 'forecast' | 'out_of_range';
  capacity: number | null;
  remaining: number | null;
  dailyNetGrowth: number | null;
  estimatedPurchaseDate: string | null;
}

export interface ForecastEntity {
  externalContactCapacity: number | null;
  servedUserCount: number | null;
  servedUserCountUpdatedAt: Date | null;
}

export interface ServedUserSample {
  date: Date;
  count: number;
}

export function externalContactForecast(entity: ForecastEntity, history: ServedUserSample[], now = new Date()): ContactForecast {
  const result: ContactForecast = { status: 'unconfigured', capacity: entity.externalContactCapacity,
    remaining: null, dailyNetGrowth: null, estimatedPurchaseDate: null };
  if (entity.externalContactCapacity == null) return result;
  if (entity.servedUserCount == null || !entity.servedUserCountUpdatedAt) return { ...result, status: 'unmeasured' };
  result.remaining = Math.max(0, entity.externalContactCapacity - entity.servedUserCount);
  if (now.getTime() - entity.servedUserCountUpdatedAt.getTime() > 2 * DAY_MS) return { ...result, status: 'stale' };
  if (!result.remaining) return { ...result, status: 'limit_reached' };
  const latestDay = new Date(`${fmtDate(entity.servedUserCountUpdatedAt)}T00:00:00Z`);
  const baselineDay = new Date(latestDay.getTime() - 7 * DAY_MS);
  const baseline = history.find(sample => sample.date.getTime() === baselineDay.getTime());
  if (!baseline) return { ...result, status: 'insufficient_history' };
  result.dailyNetGrowth = (entity.servedUserCount - baseline.count) / 7;
  if (result.dailyNetGrowth <= 0) return { ...result, status: 'not_growing' };
  const days = Math.ceil(result.remaining * 7 / (entity.servedUserCount - baseline.count));
  const expected = new Date(latestDay.getTime() + days * DAY_MS);
  if (!Number.isFinite(expected.getTime()) || expected.getUTCFullYear() > 9999) return { ...result, status: 'out_of_range' };
  return { ...result, status: 'forecast', estimatedPurchaseDate: expected.toISOString().slice(0, 10) };
}
