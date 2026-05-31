import cron from 'node-cron';
import prisma from '../lib/prisma';
import { getQuotaInfo } from './wecom';

async function syncTodayData() {
  const entities = await prisma.wecomEntity.findMany({
    where: { status: 'active' },
  });

  for (const entity of entities) {
    try {
      const quota = await getQuotaInfo(entity.corpid, entity.secret);

      await prisma.wecomEntity.update({
        where: { id: entity.id },
        data: {
          quotaTotal: quota.total,
          quotaBalance: quota.balance,
          lastSyncAt: new Date(),
        },
      });

      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      const todayDate = new Date(todayStr);

      const yesterday = new Date(todayDate);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayRecord = await prisma.consumptionRecord.findFirst({
        where: { entityId: entity.id, date: yesterday },
        orderBy: { date: 'desc' },
      });
      const prevBalance = yesterdayRecord?.quotaBalance ?? quota.total;
      const todayConsumption = prevBalance - quota.balance;

      await prisma.consumptionRecord.deleteMany({
        where: { entityId: entity.id, date: todayDate },
      });
      await prisma.consumptionRecord.create({
        data: {
          entityId: entity.id,
          date: todayDate,
          consumption: todayConsumption,
          quotaBalance: quota.balance,
          calls: 0,
        },
      });

      await prisma.syncLog.create({
        data: {
          entityId: entity.id,
          status: 'success',
          message: `余额:${quota.balance} 消耗:${todayConsumption}`,
        },
      });
    } catch (error: any) {
      console.error(`[Scheduler] "${entity.name}" 同步失败:`, error.message);
    }
  }
}

// 每 5 分钟同步当日数据
cron.schedule('*/5 * * * *', async () => {
  await syncTodayData();
});

// 每天 0 点全量同步
cron.schedule('0 0 * * *', async () => {
  await syncTodayData();
});

export function startScheduler() {
  console.log('[Scheduler] 定时任务已启动');
  console.log('  - 每 5 分钟同步当日余额');
  console.log('  - 每天 0 点全量同步');
}
