import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { startOfDay, daysAgo } from '../lib/date';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /api/dashboard/budget - 资源预警列表
router.get('/budget', async (req: AuthRequest, res: Response) => {
  try {
    const { entityId, yearMonth } = req.query;

    const entityWhere: any = {};
    if (entityId) entityWhere.id = Number(entityId);

    const entities = await prisma.wecomEntity.findMany({ where: entityWhere, orderBy: { createdAt: 'desc' } });

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
    const today = startOfDay();
    const sevenDaysAgo = daysAgo(7);

    const rows = await Promise.all(entities.map(async (entity) => {
      const [monthAgg, weekCons, weekRech, monthRech] = await Promise.all([
        prisma.consumptionRecord.aggregate({
          where: { entityId: entity.id, date: { gte: monthStart, lte: monthEnd } },
          _sum: { consumption: true },
        }),
        prisma.consumptionRecord.aggregate({
          where: { entityId: entity.id, date: { gte: sevenDaysAgo, lt: today } },
          _sum: { consumption: true },
        }),
        prisma.rechargeRecord.aggregate({
          where: { entityId: entity.id, rechargeDate: { gte: sevenDaysAgo, lt: today } },
          _sum: { amount: true },
        }),
        prisma.rechargeRecord.aggregate({
          where: { entityId: entity.id, rechargeDate: { gte: monthStart, lte: monthEnd } },
          _sum: { amount: true },
        }),
      ]);

      const totalConsumption = (monthAgg._sum.consumption || 0) + (monthRech._sum.amount || 0);
      const weekTotal = (weekCons._sum.consumption || 0) + (weekRech._sum.amount || 0);
      const avg7d = Math.round(weekTotal / 7);
      const countdownDays = avg7d > 0 ? Math.round((entity.quotaBalance / avg7d) * 100) / 100 : -1;

      return {
        id: entity.id, name: entity.name, sku: entity.sku,
        monthlyBudget: entity.monthlyBudget, actualRecharge: entity.rechargeAmount,
        actualConsumption: totalConsumption, avg7dConsumption: avg7d,
        countdownDays, status: entity.status, quotaBalance: entity.quotaBalance,
        lastSyncAt: entity.lastSyncAt,
      };
    }));

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const todayAgg = await prisma.consumptionRecord.aggregate({
      where: { date: { gte: today, lt: tomorrow } },
      _sum: { consumption: true },
    });

    res.json({ rows, summary: { todayConsumption: todayAgg._sum.consumption || 0 } });
  } catch (error) {
    res.status(500).json({ error: '获取预算数据失败' });
  }
});

export default router;
