import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { parseDate, fmtDate } from '../lib/date';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /api/recharges
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { entityId, startDate, endDate, page = '1', pageSize = '20' } = req.query;
    const where: any = {};
    if (entityId) where.entityId = Number(entityId);
    if (startDate || endDate) {
      where.rechargeDate = {};
      if (startDate) where.rechargeDate.gte = parseDate(startDate as string);
      if (endDate) {
        const end = parseDate(endDate as string);
        end.setHours(23, 59, 59, 999);
        where.rechargeDate.lte = end;
      }
    }
    const [rows, total] = await Promise.all([
      prisma.rechargeRecord.findMany({
        where, orderBy: { rechargeDate: 'desc' },
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
        include: { entity: { select: { id: true, name: true, sku: true } } },
      }),
      prisma.rechargeRecord.count({ where }),
    ]);
    const now = new Date();
    const monthAgg = await prisma.rechargeRecord.aggregate({
      where: {
        rechargeDate: {
          gte: new Date(now.getFullYear(), now.getMonth(), 1),
          lte: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
        },
      },
      _sum: { amount: true },
    });
    res.json({ data: rows, total, page: Number(page), pageSize: Number(pageSize), monthlyTotal: monthAgg._sum.amount || 0 });
  } catch {
    res.status(500).json({ error: '获取充值记录失败' });
  }
});

// POST /api/recharges
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { entityId, amount, rechargeDate, method, remark } = req.body;
    const record = await prisma.rechargeRecord.create({
      data: { entityId: Number(entityId), amount: Number(amount), rechargeDate: parseDate(rechargeDate), method: method || '银行转账', remark: remark || null },
      include: { entity: { select: { id: true, name: true } } },
    });
    res.json(record);
  } catch {
    res.status(500).json({ error: '新增充值记录失败' });
  }
});

// PUT /api/recharges/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { amount, rechargeDate, method, remark } = req.body;
    const data: any = {};
    if (amount !== undefined) data.amount = Number(amount);
    if (rechargeDate) data.rechargeDate = parseDate(rechargeDate);
    if (method !== undefined) data.method = method;
    if (remark !== undefined) data.remark = remark;
    res.json(await prisma.rechargeRecord.update({
      where: { id: Number(req.params.id) }, data,
      include: { entity: { select: { id: true, name: true } } },
    }));
  } catch {
    res.status(500).json({ error: '更新充值记录失败' });
  }
});

// DELETE /api/recharges/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.rechargeRecord.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '删除充值记录失败' });
  }
});

export default router;
