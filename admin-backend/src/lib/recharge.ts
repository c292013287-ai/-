/**
 * 充值记录查询辅助函数
 */
import prisma from './prisma';
import { fmtDate } from './date';

/**
 * 批量查询充值记录，构建 entityId_date → amount 映射
 * consumption + recharge 动态累加用
 */
export async function buildRechargeMap(
  entityIds: number[],
  dateFrom: Date,
  dateTo?: Date,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!entityIds.length) return map;

  const where: any = {
    entityId: { in: entityIds },
    rechargeDate: { gte: dateFrom },
  };
  if (dateTo) where.rechargeDate.lte = dateTo;

  const recharges = await prisma.rechargeRecord.findMany({
    where,
    select: { entityId: true, amount: true, rechargeDate: true },
  });

  for (const rc of recharges) {
    const key = `${rc.entityId}_${fmtDate(rc.rechargeDate)}`;
    map.set(key, (map.get(key) || 0) + rc.amount);
  }
  return map;
}
