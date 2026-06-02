import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { parseDate, parseDateTime } from '../lib/date';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

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
        include: { entity: { select: { id: true, name: true, sku: true, corpid: true } } },
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
      _sum: { feeAmount: true },
    });
    res.json({ data: rows, total, page: Number(page), pageSize: Number(pageSize), monthlyTotal: monthAgg._sum.feeAmount || 0 });
  } catch {
    res.status(500).json({ error: '获取充值记录失败' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { entityId, amount, rechargeDate, method, orderNumber, feeAmount, remark } = req.body;
    const record = await prisma.rechargeRecord.create({
      data: {
        entityId: Number(entityId), amount: Number(amount),
        rechargeDate: parseDateTime(rechargeDate), method: method || '微信支付',
        orderNumber: orderNumber || null,
        feeAmount: feeAmount !== undefined ? Number(feeAmount) : null,
        remark: remark || null,
      },
      include: { entity: { select: { id: true, name: true } } },
    });
    res.json(record);
  } catch {
    res.status(500).json({ error: '新增充值记录失败' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { amount, rechargeDate, method, orderNumber, feeAmount, remark } = req.body;
    const data: any = {};
    if (amount !== undefined) data.amount = Number(amount);
    if (rechargeDate) data.rechargeDate = parseDateTime(rechargeDate);
    if (method !== undefined) data.method = method;
    if (orderNumber !== undefined) data.orderNumber = orderNumber;
    if (feeAmount !== undefined) data.feeAmount = Number(feeAmount);
    if (remark !== undefined) data.remark = remark;
    res.json(await prisma.rechargeRecord.update({
      where: { id: Number(req.params.id) }, data,
      include: { entity: { select: { id: true, name: true } } },
    }));
  } catch {
    res.status(500).json({ error: '更新充值记录失败' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.rechargeRecord.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '删除充值记录失败' });
  }
});

export default router;
