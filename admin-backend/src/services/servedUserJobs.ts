import prisma from '../lib/prisma';
import { ServedUserJobs } from '../lib/servedUserJobs';
import { getServedUserCount } from './wecom';
import { fmtDate } from '../lib/date';
import { fingerprintOf } from '../lib/customerLiveStore';
import { externalContactForecast } from '../lib/externalContactForecast';

export const servedUserJobs = new ServedUserJobs(async (id, progress) => {
  const entity = await prisma.wecomEntity.findUnique({ where: { id } });
  if (!entity) throw new Error('主体不存在');
  const servedUserCount = await getServedUserCount(entity.corpid, entity.secret, entity.wecomApiBaseUrl, progress);
  const servedUserCountUpdatedAt = new Date();
  // Commit both fields only after every page succeeded and the entity identity is unchanged.
  const forecast = await prisma.$transaction(async tx => {
    const updated = await tx.wecomEntity.updateMany({
      where: { id, corpid: entity.corpid, secret: entity.secret, wecomApiBaseUrl: entity.wecomApiBaseUrl },
      data: { servedUserCount, servedUserCountUpdatedAt },
    });
    if (updated.count !== 1) throw new Error('主体配置已变化，请重新发起统计');
    const fingerprint = fingerprintOf(entity);
    // Preserve the previous successful daily observation before replacing the latest count.
    if (entity.servedUserCount != null && entity.servedUserCountUpdatedAt) {
      const date = new Date(`${fmtDate(entity.servedUserCountUpdatedAt)}T00:00:00Z`);
      await tx.servedUserDailyStat.upsert({
        where: { entityId_date: { entityId: id, date } },
        create: { entityId: id, date, count: entity.servedUserCount, measuredAt: entity.servedUserCountUpdatedAt, fingerprint },
        update: {},
      });
    }
    const date = new Date(`${fmtDate(servedUserCountUpdatedAt)}T00:00:00Z`);
    await tx.servedUserDailyStat.upsert({
      where: { entityId_date: { entityId: id, date } },
      create: { entityId: id, date, count: servedUserCount, measuredAt: servedUserCountUpdatedAt, fingerprint },
      update: { count: servedUserCount, measuredAt: servedUserCountUpdatedAt, fingerprint },
    });
    const samples = await tx.servedUserDailyStat.findMany({
      where: { entityId: id, fingerprint, date: { gte: new Date(date.getTime() - 7 * 86400000) } },
    });
    const current = await tx.wecomEntity.findUniqueOrThrow({ where: { id } });
    return externalContactForecast(current, samples, servedUserCountUpdatedAt);
  });
  return { servedUserCount, servedUserCountUpdatedAt: servedUserCountUpdatedAt.toISOString(), externalContactForecast: forecast };
});
