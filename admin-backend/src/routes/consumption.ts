import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { fmtDate } from '../lib/date';
import { buildRechargeMap } from '../lib/recharge';
import { recalculateConsumptionChain } from '../lib/consumption';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /api/consumption
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { entityId, sku, startDate, endDate, page = '1', pageSize = '20' } = req.query;
    const where: any = {};
    if (entityId) where.entityId = Number(entityId);
    if (sku) where.entity = { sku: String(sku) };
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate as string);
      if (endDate) where.date.lte = new Date(endDate as string);
    }

    const skip = (Number(page) - 1) * Number(pageSize);
    const [records, total] = await Promise.all([
      prisma.consumptionRecord.findMany({
        where, skip, take: Number(pageSize),
        orderBy: [{ date: 'desc' }, { consumption: 'desc' }, { id: 'desc' }],
        include: { entity: { select: { id: true, name: true, sku: true } } },
      }),
      prisma.consumptionRecord.count({ where }),
    ]);

    // 构建充值映射：有充值的日期，消耗需加上充值额
    const entityIds = [...new Set(records.map(r => r.entityId))];
    const minDate = records.length > 0 ? records[records.length - 1].date : new Date();
    const maxDate = records.length > 0 ? records[0].date : new Date();
    const rechargeMap = await buildRechargeMap(entityIds, minDate, maxDate);

    res.json({
      data: records.map(r => {
        const recharge = rechargeMap.get(`${r.entityId}_${fmtDate(r.date)}`) || 0;
        // DB consumption 为负数（sync 写入 prevBalance-currentBalance，充值导致余额上涨）
        // 时才加回充值额，正数代表已是实际消耗，无需补偿
        const consumption = r.consumption < 0 ? r.consumption + recharge : r.consumption;
        return {
          id: r.id, entityId: r.entityId, date: r.date,
          consumption,
          quotaBalance: r.quotaBalance,
          entity: { id: r.entity.id, name: r.entity.name, sku: r.entity.sku },
        };
      }),
      total, page: Number(page), pageSize: Number(pageSize),
    });
  } catch (error) {
    res.status(500).json({ error: '获取消耗记录失败' });
  }
});

// GET /api/consumption/trend
router.get('/trend', async (req: AuthRequest, res: Response) => {
  try {
    const { entityId, sku, days = '30' } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));
    startDate.setHours(0, 0, 0, 0);

    const where: any = { date: { gte: startDate } };
    if (entityId) where.entityId = Number(entityId);
    if (sku) where.entity = { sku: String(sku) };

    const records = await prisma.consumptionRecord.findMany({
      where, orderBy: { date: 'asc' },
      include: { entity: { select: { name: true } } },
    });

    // 构建充值映射
    const entityIds = [...new Set(records.map(r => r.entityId))];
    const rechargeMap = await buildRechargeMap(entityIds, startDate);

    const items = records.map(r => {
      const recharge = rechargeMap.get(`${r.entityId}_${fmtDate(r.date)}`) || 0;
      return {
        date: fmtDate(r.date),
        consumption: r.consumption < 0 ? r.consumption + recharge : r.consumption,
      };
    });

    if (entityId) return res.json(items.map(i => ({ date: i.date, consumption: i.consumption })));

    // 跨主体按日汇总
    const daily = new Map<string, number>();
    for (const i of items) daily.set(i.date, (daily.get(i.date) || 0) + i.consumption);
    res.json([...daily.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, consumption]) => ({ date, consumption })));
  } catch (error) {
    res.status(500).json({ error: '获取趋势数据失败' });
  }
});

// POST /api/consumption
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { entityId, date, quotaBalance } = req.body;
    if (!entityId || !date) return res.status(400).json({ error: '主体和日期为必填项' }).end();

    const eId = Number(entityId);
    const targetDate = new Date(date);

    const record = await prisma.consumptionRecord.create({
      data: { entityId: eId, date: targetDate, consumption: 0, quotaBalance: Number(quotaBalance) || 0, calls: 0 },
      include: { entity: { select: { id: true, name: true, sku: true } } },
    });

    await recalculateConsumptionChain(eId, targetDate);
    const updated = await prisma.consumptionRecord.findUnique({
      where: { id: record.id },
      include: { entity: { select: { id: true, name: true, sku: true } } },
    });

    res.status(201).json(updated);
  } catch {
    res.status(500).json({ error: '创建失败，可能该日期已存在记录' });
  }
});

// PUT /api/consumption/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { quotaBalance } = req.body;
    const record = await prisma.consumptionRecord.findUnique({ where: { id: Number(req.params.id) } });
    if (!record) return res.status(404).json({ error: '记录不存在' });

    if (quotaBalance !== undefined) {
      await prisma.consumptionRecord.update({
        where: { id: record.id },
        data: { quotaBalance: Number(quotaBalance) },
      });
    }
    await recalculateConsumptionChain(record.entityId, record.date);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '更新失败' });
  }
});

// DELETE /api/consumption/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const record = await prisma.consumptionRecord.findUnique({ where: { id: Number(req.params.id) } });
    if (!record) return res.status(404).json({ error: '记录不存在' });

    await prisma.consumptionRecord.delete({ where: { id: record.id } });

    const nextDay = new Date(record.date);
    nextDay.setDate(nextDay.getDate() + 1);
    const next = await prisma.consumptionRecord.findFirst({ where: { entityId: record.entityId, date: nextDay } });
    if (next) await recalculateConsumptionChain(record.entityId, nextDay);

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '删除失败' });
  }
});

export default router;
