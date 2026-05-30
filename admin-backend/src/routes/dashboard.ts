import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

// GET /api/dashboard/stats - 数据看板统计
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

    // 各主体消耗排名（分别查询聚合）
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

export default router;
