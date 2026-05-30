import cron from 'node-cron';
import prisma from '../lib/prisma';
import { getQuotaBalance } from './wecom';

// 每天凌晨 2 点同步所有活跃主体的获客助手数据
cron.schedule('0 2 * * *', async () => {
  console.log('[Scheduler] 开始同步获客助手数据...');

  const entities = await prisma.wecomEntity.findMany({
    where: { status: 'active' },
  });

  for (const entity of entities) {
    try {
      const quota = await getQuotaBalance(entity.corpid, entity.secret);

      // 更新主体配额信息
      await prisma.wecomEntity.update({
        where: { id: entity.id },
        data: {
          quotaBalance: quota.balance,
          lastSyncAt: new Date(),
        },
      });

      // 记录今日消耗
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayConsumption = entity.quotaTotal - quota.balance;

      await prisma.consumptionRecord.upsert({
        where: {
          entityId_date: {
            entityId: entity.id,
            date: today,
          },
        },
        create: {
          entityId: entity.id,
          date: today,
          consumption: todayConsumption,
          calls: quota.total,
        },
        update: {
          consumption: todayConsumption,
          calls: quota.total,
        },
      });

      // 记录同步日志
      await prisma.syncLog.create({
        data: {
          entityId: entity.id,
          status: 'success',
          message: `同步成功：余额 ${quota.balance}，今日消耗 ${todayConsumption}`,
        },
      });

      console.log(`[Scheduler] 主体"${entity.name}"同步成功`);
    } catch (error: any) {
      console.error(`[Scheduler] 主体"${entity.name}"同步失败:`, error.message);

      await prisma.syncLog.create({
        data: {
          entityId: entity.id,
          status: 'failed',
          message: error.message,
        },
      });
    }
  }

  console.log('[Scheduler] 同步完成');
});

// 每小时同步一次（用于频繁更新场景）
cron.schedule('0 * * * *', async () => {
  console.log('[Scheduler] 小时级同步...');
  // 可在此处添加更频繁的同步逻辑
});

export function startScheduler() {
  console.log('[Scheduler] 定时任务已启动');
  console.log('  - 每日凌晨 2:00 全量同步');
  console.log('  - 每小时执行轻量同步');
}
