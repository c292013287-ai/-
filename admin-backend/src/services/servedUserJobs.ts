import prisma from '../lib/prisma';
import { ServedUserJobs } from '../lib/servedUserJobs';
import { getServedUserCount } from './wecom';

export const servedUserJobs = new ServedUserJobs(async (id, progress) => {
  const entity = await prisma.wecomEntity.findUnique({ where: { id } });
  if (!entity) throw new Error('主体不存在');
  const servedUserCount = await getServedUserCount(entity.corpid, entity.secret, entity.wecomApiBaseUrl, progress);
  const servedUserCountUpdatedAt = new Date();
  // Commit both fields only after every page succeeded and the entity identity is unchanged.
  const updated = await prisma.wecomEntity.updateMany({
    where: { id, corpid: entity.corpid, secret: entity.secret, wecomApiBaseUrl: entity.wecomApiBaseUrl },
    data: { servedUserCount, servedUserCountUpdatedAt },
  });
  if (updated.count !== 1) throw new Error('主体配置已变化，请重新发起统计');
  return { servedUserCount, servedUserCountUpdatedAt: servedUserCountUpdatedAt.toISOString() };
});
