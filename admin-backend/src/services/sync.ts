/**
 * 企微配额同步共享逻辑
 * scheduler 和 entities 路由共用
 */
import prisma from '../lib/prisma';
import { startOfDay, fmtDate } from '../lib/date';
import { getQuotaInfo } from './wecom';

interface SyncParams {
  entity: { id: number; name: string; corpid: string; secret: string; quotaTotal: number };
  date?: Date; // 同步日期，默认当天
  logMessage?: string;
}

/** 同步单个主体配额，写入今日消耗 */
export async function syncEntityQuota(params: SyncParams) {
  const { entity, logMessage } = params;
  const today = startOfDay(params.date);
  // UTC 零点的 Date（避免 Prisma 时区转换导致日期漂移）
  const utcToday = new Date(fmtDate(today));

  const quota = await getQuotaInfo(entity.corpid, entity.secret);

  // 更新主体配额
  await prisma.wecomEntity.update({
    where: { id: entity.id },
    data: { quotaTotal: quota.total, quotaBalance: quota.balance, lastSyncAt: new Date() },
  });

  // 计算消耗（范围查询昨日，兼容新旧记录时区）
  const yesterdayEnd = new Date(utcToday);
  yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);
  yesterdayEnd.setHours(23, 59, 59, 999);
  const yesterdayStart = new Date(yesterdayEnd);
  yesterdayStart.setHours(0, 0, 0, 0);

  const yesterdayRecord = await prisma.consumptionRecord.findFirst({
    where: { entityId: entity.id, date: { gte: yesterdayStart, lte: yesterdayEnd } },
    orderBy: { date: 'desc' },
  });
  const hasHistory = !!(await prisma.consumptionRecord.findFirst({
    where: { entityId: entity.id, date: { lt: yesterdayEnd } },
  }));

  const prevBalance = yesterdayRecord?.quotaBalance ?? entity.quotaTotal;
  const consumption = hasHistory ? prevBalance - quota.balance : 0;

  // 写入今日消耗（先删后建，用 UTC 时间避免重复）
  await prisma.consumptionRecord.deleteMany({
    where: { entityId: entity.id, date: utcToday },
  });
  await prisma.consumptionRecord.create({
    data: { entityId: entity.id, date: utcToday, consumption, quotaBalance: quota.balance, calls: 0 },
  });

  // 写同步日志
  await prisma.syncLog.create({
    data: {
      entityId: entity.id,
      status: 'success',
      message: logMessage || `同步: 配额${quota.total} 余额${quota.balance} 消耗${consumption}`,
    },
  });

  return { quota, consumption };
}
