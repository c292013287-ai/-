import cron from 'node-cron';
import prisma from '../lib/prisma';
import { syncEntityQuota } from './sync';

async function syncTodayData() {
  const entities = await prisma.wecomEntity.findMany({ where: { status: 'active' } });
  for (const entity of entities) {
    try {
      await syncEntityQuota({ entity, logMessage: `余额:${entity.quotaBalance}` });
    } catch (error: any) {
      console.error(`[Scheduler] "${entity.name}" 同步失败:`, error.message);
    }
  }
}

cron.schedule('*/5 * * * *', syncTodayData);
cron.schedule('0 0 * * *', syncTodayData);

export function startScheduler() {
  console.log('[Scheduler] 定时任务已启动');
  console.log('  - 每 5 分钟同步当日余额');
  console.log('  - 每天 0 点全量同步');
}
