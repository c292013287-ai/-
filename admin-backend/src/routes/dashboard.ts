import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { startOfDay, daysAgo, fmtDate } from '../lib/date';
import { buildRechargeMap } from '../lib/recharge';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /api/dashboard/stats - 仪表盘/AI页面统计
router.get('/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const entities = await prisma.wecomEntity.findMany();
    const today = startOfDay();
    const threeDaysAgo = daysAgo(3);

    // 活跃主体：近3天内有消耗记录的主体
    const recentConsumers = await prisma.consumptionRecord.findMany({
      where: { date: { gte: threeDaysAgo, lt: today }, consumption: { gt: 0 } },
      distinct: ['entityId'],
      select: { entityId: true },
    });
    const activeEntityCount = recentConsumers.length;

    // 当月范围
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // 今日消耗（含充值补偿）
    const todayRecords = await prisma.consumptionRecord.findMany({
      where: { date: { gte: today, lt: new Date(today.getTime() + 86399000) } },
    });
    const todayEntityIds = [...new Set(todayRecords.map(r => r.entityId))];
    const todayRechargeMap = await buildRechargeMap(todayEntityIds, today, new Date(today.getTime() + 86399000));
    const todayConsumption = todayRecords.reduce((sum, r) => {
      const recharge = todayRechargeMap.get(`${r.entityId}_${fmtDate(r.date)}`) || 0;
      return sum + (r.consumption < 0 ? r.consumption + recharge : r.consumption);
    }, 0);

    // 当月累计消耗（含充值补偿）
    const monthRecords = await prisma.consumptionRecord.findMany({
      where: { date: { gte: monthStart } },
    });
    const monthEntityIds = [...new Set(monthRecords.map(r => r.entityId))];
    const monthRechargeMap = await buildRechargeMap(monthEntityIds, monthStart);
    const totalConsumption = monthRecords.reduce((sum, r) => {
      const recharge = monthRechargeMap.get(`${r.entityId}_${fmtDate(r.date)}`) || 0;
      return sum + (r.consumption < 0 ? r.consumption + recharge : r.consumption);
    }, 0);

    // 排名（当月）
    const ranking = await prisma.consumptionRecord.groupBy({
      by: ['entityId'],
      where: { date: { gte: monthStart } },
      _sum: { consumption: true },
      orderBy: { _sum: { consumption: 'desc' } },
      take: 10,
    });

    const entityMap = new Map(entities.map(e => [e.id, e]));
    const entityRanking = ranking.map(r => {
      const entity = entityMap.get(r.entityId);
      return {
        id: r.entityId,
        name: entity?.name || `主体#${r.entityId}`,
        quotaTotal: entity?.quotaTotal || 0,
        quotaBalance: entity?.quotaBalance || 0,
        totalConsumption: r._sum.consumption || 0,
      };
    });

    res.json({
      entityCount: entities.length,
      activeEntityCount,
      todayConsumption,
      todayCalls: 0,
      totalConsumption,
      totalCalls: 0,
      entityRanking,
    });
  } catch (error) {
    res.status(500).json({ error: '获取统计数据失败' });
  }
});

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
      const [monthAgg, weekCons, _weekRech, monthRech] = await Promise.all([
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

      const weekTotal = Math.max(0, weekCons._sum.consumption || 0);
      const totalConsumption = Math.max(0, monthAgg._sum.consumption || 0);
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
    rows.sort((a, b) => {
      if (a.countdownDays < 0 && b.countdownDays < 0) return 0;
      if (a.countdownDays < 0) return 1;
      if (b.countdownDays < 0) return -1;
      return a.countdownDays - b.countdownDays;
    });

    // 今日消耗总额（含充值补偿，与 consumption 路由保持一致）
    const todayRecords = await prisma.consumptionRecord.findMany({
      where: { date: { gte: today, lt: new Date(today.getTime() + 86399000) } },
    });
    const todayEntityIds = [...new Set(todayRecords.map(r => r.entityId))];
    const todayRechargeMap = await buildRechargeMap(todayEntityIds, today, new Date(today.getTime() + 86399000));
    const todayConsumption = todayRecords.reduce((sum, r) => {
      const recharge = todayRechargeMap.get(`${r.entityId}_${fmtDate(r.date)}`) || 0;
      return sum + (r.consumption < 0 ? r.consumption + recharge : r.consumption);
    }, 0);

    res.json({ rows, summary: { todayConsumption } });
  } catch (error) {
    res.status(500).json({ error: '获取预算数据失败' });
  }
});

export default router;
