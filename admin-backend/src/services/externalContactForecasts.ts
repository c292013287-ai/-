import prisma from '../lib/prisma';
import { fingerprintOf } from '../lib/customerLiveStore';
import { fmtDate } from '../lib/date';
import { externalContactForecast, type ForecastEntity } from '../lib/externalContactForecast';

interface Entity extends ForecastEntity {
  id: number;
  corpid: string;
  secret: string;
  wecomApiBaseUrl: string | null;
}

export async function withContactForecasts<T extends Entity>(entities: T[], now = new Date()) {
  if (!entities.length) return [];
  const earliest = new Date(`${fmtDate(new Date(now.getTime() - 9 * 86400000))}T00:00:00Z`);
  const samples = await prisma.servedUserDailyStat.findMany({
    where: { entityId: { in: entities.map(entity => entity.id) }, date: { gte: earliest } },
  });
  return entities.map(entity => ({ ...entity, externalContactForecast: externalContactForecast(entity,
    samples.filter(sample => sample.entityId === entity.id && sample.fingerprint === fingerprintOf(entity)), now) }));
}
