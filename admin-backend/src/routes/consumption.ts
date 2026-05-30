import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

// GET /api/consumption - 消耗记录列表（支持按主体、日期范围筛选）
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { entityId, startDate, endDate, page = '1', pageSize = '20' } = req.query;

    const where: any = {};
    if (entityId) where.entityId = Number(entityId);
    if (startDate) where.date = { ...(where.date || {}), gte: new Date(startDate as string) };
    if (endDate) where.date = { ...(where.date || {}), lte: new Date(endDate as string) };

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const [records, total] = await Promise.all([
      prisma.consumptionRecord.findMany({
        where,
        include: {
          entity: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
        skip,
        take,
      }),
      prisma.consumptionRecord.count({ where }),
    ]);

    res.json({
      data: records,
      total,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  } catch (error) {
    res.status(500).json({ error: '获取消耗记录失败' });
  }
});

// GET /api/consumption/trend - 消耗趋势（按日汇总）
router.get('/trend', async (req: AuthRequest, res: Response) => {
  try {
    const { entityId, days = '7' } = req.query;
    const daysNum = Number(days);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);
    startDate.setHours(0, 0, 0, 0);

    const where: any = {
      date: { gte: startDate },
    };
    if (entityId) where.entityId = Number(entityId);

    const records = await prisma.consumptionRecord.findMany({
      where,
      orderBy: { date: 'asc' },
      select: {
        date: true,
        consumption: true,
        calls: true,
        entity: { select: { name: true } },
      },
    });

    res.json(records);
  } catch (error) {
    res.status(500).json({ error: '获取趋势数据失败' });
  }
});

export default router;
