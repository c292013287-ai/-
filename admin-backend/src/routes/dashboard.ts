import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

// GET /api/dashboard/stats - 数据看板统计（兼容旧版）
router.get('/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      entityCount,
      activeEntityCount,
      todayRecords,
      totalConsumption,
    ] = await Promise.all([
      prisma.wecomEntity.count(),
      prisma.wecomEntity.count({ where: { status: 'active' } }),
      prisma.consumptionRecord.aggregate({
        where: { date: { gte: today, lt: tomorrow } },
        _sum: { consumption: true, calls: true },
      }),
      prisma.consumptionRecord.aggregate({
        _sum: { consumption: true, calls: true },
      }),
    ]);

    const entities = await prisma.wecomEntity.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const entityRanking = await Promise.all(
      entities.map(async (entity) => {
        const consumption = await prisma.consumptionRecord.aggregate({
          where: { entityId: entity.id },
          _sum: { consumption: true },
        });
        return {
          id: entity.id,
          name: entity.name,
          quotaTotal: entity.quotaTotal,
          quotaBalance: entity.quotaBalance,
          totalConsumption: consumption._sum.consumption || 0,
        };
      })
    );

    entityRanking.sort((a, b) => b.totalConsumption - a.totalConsumption);

    res.json({
      entityCount,
      activeEntityCount,
      todayConsumption: todayRecords._sum.consumption || 0,
      todayCalls: todayRecords._sum.calls || 0,
      totalConsumption: totalConsumption._sum.consumption || 0,
      totalCalls: totalConsumption._sum.calls || 0,
      entityRanking,
    });
  } catch (error) {
    res.status(500).json({ error: '获取统计数据失败' });
  }
});

// GET /api/dashboard/budget - 预算情况列表
router.get('/budget', async (req: AuthRequest, res: Response) => {
  try {
    const { entityId, yearMonth } = req.query;

    const entityWhere: any = {};
    if (entityId) entityWhere.id = Number(entityId);

    const entities = await prisma.wecomEntity.findMany({
      where: entityWhere,
      orderBy: { createdAt: 'desc' },
    });

    // 选择月份，默认当月
    let year: number, month: number;
    if (yearMonth && typeof yearMonth === 'string' && /^\d{4}-\d{2}$/.test(yearMonth)) {
      [year, month] = yearMonth.split('-').map(Number);
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }

    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 近7天（不含今天，取最近7天）
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const rows = await Promise.all(
      entities.map(async (entity) => {
        const [monthAgg, weekAgg] = await Promise.all([
          prisma.consumptionRecord.aggregate({
            where: { entityId: entity.id, date: { gte: monthStart, lte: monthEnd } },
            _sum: { consumption: true },
          }),
          prisma.consumptionRecord.aggregate({
            where: { entityId: entity.id, date: { gte: sevenDaysAgo, lt: today } },
            _sum: { consumption: true },
          }),
        ]);

        const totalConsumption = monthAgg._sum.consumption || 0;
        const weekTotal = weekAgg._sum.consumption || 0;
        const avg7d = Math.round(weekTotal / 7);

        // 倒计时 = 配额余额 / 近7天平均消耗（剩余天数），avg7d=0 时记为 -1 表示无限
        const countdownDays = avg7d > 0 ? Math.round((entity.quotaBalance / avg7d) * 100) / 100 : -1;

        return {
          id: entity.id,
          name: entity.name,
          sku: entity.sku,
          monthlyBudget: entity.monthlyBudget,
          actualRecharge: entity.rechargeAmount,
          actualConsumption: totalConsumption,
          avg7dConsumption: avg7d,
          countdownDays: countdownDays,
          status: entity.status,
          quotaBalance: entity.quotaBalance,
          lastSyncAt: entity.lastSyncAt,
        };
      })
    );

    // 今日累计消耗（所有主体，不受筛选影响）
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const todayAgg = await prisma.consumptionRecord.aggregate({
      where: { date: { gte: today, lt: tomorrow } },
      _sum: { consumption: true },
    });

    res.json({
      rows,
      summary: {
        todayConsumption: todayAgg._sum.consumption || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ error: '获取预算数据失败' });
  }
});

export default router;
