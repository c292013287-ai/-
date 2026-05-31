import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

/**
 * 重算某个主体下从 fromDate 开始的所有记录的消耗链
 * 公式: consumption = 上一条记录的 quotaBalance - 本条记录的 quotaBalance
 *      首条记录若无前序历史则消耗固定为 0
 */
async function recalculateChain(entityId: number, fromDate: Date) {
  const entity = await prisma.wecomEntity.findUnique({ where: { id: entityId } });
  if (!entity) return;

  // 找到 fromDate 之前一条记录，作为初始 prevBalance
  const prevDay = new Date(fromDate);
  prevDay.setDate(prevDay.getDate() - 1);
  const prevRecord = await prisma.consumptionRecord.findFirst({
    where: { entityId, date: prevDay },
    orderBy: { date: 'desc' },
  });

  let prevBalance = prevRecord?.quotaBalance ?? entity.quotaTotal;
  const isHead = !prevRecord;

  // 获取从 fromDate 开始、按日期升序的所有记录
  const records = await prisma.consumptionRecord.findMany({
    where: { entityId, date: { gte: fromDate } },
    orderBy: { date: 'asc' },
  });

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    // 该主体的首条记录消耗固定为 0
    const consumption = (isHead && i === 0) ? 0 : prevBalance - record.quotaBalance;
    await prisma.consumptionRecord.update({
      where: { id: record.id },
      data: { consumption },
    });
    prevBalance = record.quotaBalance;
  }
}

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
          entity: { select: { id: true, name: true, quotaBalance: true, sku: true } },
        },
        orderBy: { date: 'desc' },
        skip,
        take,
      }),
      prisma.consumptionRecord.count({ where }),
    ]);

    res.json({
      data: records.map(r => ({
        id: r.id,
        entityId: r.entityId,
        date: r.date,
        consumption: r.consumption,
        quotaBalance: r.quotaBalance,
        entity: { id: r.entity.id, name: r.entity.name, sku: r.entity.sku },
      })),
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

// POST /api/consumption - 创建消耗记录，自动计算消耗并重算后续链
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { entityId, date, quotaBalance } = req.body;
    if (!entityId || !date) {
      res.status(400).json({ error: '主体和日期为必填项' });
      return;
    }

    const targetDate = new Date(date);
    const eId = Number(entityId);
    const qb = Number(quotaBalance) || 0;

    const record = await prisma.consumptionRecord.create({
      data: {
        entityId: eId,
        date: targetDate,
        consumption: 0, // 占位，稍后重算
        quotaBalance: qb,
        calls: 0,
      },
      include: { entity: { select: { id: true, name: true, sku: true } } },
    });

    // 从新记录的日期开始，链式重算消耗
    await recalculateChain(eId, targetDate);

    // 重新读取更新后的记录
    const updated = await prisma.consumptionRecord.findUnique({
      where: { id: record.id },
      include: { entity: { select: { id: true, name: true, sku: true } } },
    });

    res.status(201).json(updated);
  } catch (error) {
    res.status(500).json({ error: '创建失败，可能该日期已存在记录' });
  }
});

// DELETE /api/consumption/:id - 删除消耗记录，并重算后续链
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const record = await prisma.consumptionRecord.findUnique({ where: { id } });
    if (!record) {
      res.status(404).json({ error: '记录不存在' });
      return;
    }

    const entityId = record.entityId;
    await prisma.consumptionRecord.delete({ where: { id } });

    // 检查是否有后续记录，有则从次日开始重算
    const nextDay = new Date(record.date);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextRecord = await prisma.consumptionRecord.findFirst({
      where: { entityId, date: nextDay },
    });

    if (nextRecord) {
      await recalculateChain(entityId, nextDay);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '删除失败' });
  }
});

// PUT /api/consumption/:id - 编辑消耗记录，自动重算消耗并重算后续链
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { quotaBalance } = req.body;

    const record = await prisma.consumptionRecord.findUnique({ where: { id } });
    if (!record) {
      res.status(404).json({ error: '记录不存在' });
      return;
    }

    // 更新配额余额
    if (quotaBalance !== undefined) {
      await prisma.consumptionRecord.update({
        where: { id },
        data: { quotaBalance: Number(quotaBalance) },
      });
    }

    // 从本条记录开始链式重算（包括本条及其后续）
    await recalculateChain(record.entityId, record.date);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '更新失败' });
  }
});

export default router;
