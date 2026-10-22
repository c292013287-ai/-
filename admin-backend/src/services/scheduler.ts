import cron from 'node-cron';
import prisma from '../lib/prisma';
import { syncEntityQuota } from './sync';
import { customerSyncJobs } from './customerSyncJobs';
import { servedUserJobs } from './servedUserJobs';

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

async function syncServedUserCounts() {
  try {
    const entities = await prisma.wecomEntity.findMany({ where: { status: 'active' }, select: { id: true } });
    for (const entity of entities) servedUserJobs.start(entity.id);
    console.log(`[Scheduler] 每日服务人数统计已排队：${entities.length} 个主体`);
  } catch (error) {
    console.error('[Scheduler] 每日服务人数统计排队失败:', error instanceof Error ? error.message : '未知错误');
  }
}

cron.schedule('*/5 * * * *', syncTodayData);
cron.schedule('0 0 * * *', syncTodayData);
cron.schedule('0 10 * * *', syncServedUserCounts, { timezone: 'Asia/Shanghai' });
cron.schedule('0 2 * * 0', async () => {
  if (process.env.CUSTOMER_LIVE_ENABLED !== 'true') return;
  try {
    const entities = await prisma.wecomEntity.findMany({ where: { status: 'active' }, select: { id: true } });
    await customerSyncJobs.start(entities.map(entity => entity.id));
  } catch { console.error('[CustomerLive] weekly full sync could not be queued'); }
}, { timezone: 'Asia/Shanghai' });

export function startScheduler() {
  console.log('[Scheduler] 定时任务已启动');
  console.log('  - 每 5 分钟同步当日余额');
  console.log('  - 每天 0 点全量同步');
  console.log('  - 每天北京时间 10 点统计服务人数，完成后更新人数和时间');
}
