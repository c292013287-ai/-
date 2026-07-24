import prisma from './prisma';
import { fmtDate, parseDate } from './date';
import { buildRechargeMap } from './recharge';

/**
 * 链式重算消耗：consumption = 昨日余额 + 当日获客助手充值/退费 - 今日余额。
 */
export async function recalculateConsumptionChain(entityId: number, fromDate: Date) {
  const entity = await prisma.wecomEntity.findUnique({ where: { id: entityId } });
  if (!entity) return;

  const targetDate = parseDate(fmtDate(fromDate));
  const prevRecord = await prisma.consumptionRecord.findFirst({
    where: { entityId, date: { lt: targetDate } },
    orderBy: { date: 'desc' },
  });

  let prevBalance = prevRecord?.quotaBalance ?? entity.quotaTotal;
  const isHead = !prevRecord;

  const records = await prisma.consumptionRecord.findMany({
    where: { entityId, date: { gte: targetDate } },
    orderBy: { date: 'asc' },
  });

  const dateRange = records.map(r => r.date);
  const minDate = dateRange.length ? new Date(Math.min(...dateRange.map(d => d.getTime()))) : targetDate;
  minDate.setDate(minDate.getDate() - 1);
  const maxDate = dateRange.length ? new Date(Math.max(...dateRange.map(d => d.getTime()))) : targetDate;
  const rechargeMap = await buildRechargeMap([entityId], minDate, maxDate);

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const raw = (isHead && i === 0) ? 0 : prevBalance - record.quotaBalance;
    const recharge = rechargeMap.get(`${entityId}_${fmtDate(record.date)}`) || 0;
    const consumption = Math.max(0, raw + recharge);
    await prisma.consumptionRecord.update({ where: { id: record.id }, data: { consumption } });
    prevBalance = record.quotaBalance;
  }
}
