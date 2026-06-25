/**
 * 充值记录查询辅助函数
 */
import prisma from './prisma';
import { fmtDate, parseDate } from './date';

const DAY_MS = 24 * 60 * 60 * 1000;

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

  const from = parseDate(fmtDate(dateFrom));
  const to = dateTo ? new Date(parseDate(fmtDate(dateTo)).getTime() + DAY_MS - 1) : undefined;
  const where: any = {
    entityId: { in: entityIds },
    rechargeType: '获客助手',
    rechargeDate: { gte: from },
  };
  if (to) where.rechargeDate.lte = to;

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
