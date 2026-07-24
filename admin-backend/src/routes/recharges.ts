import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { parseDate, parseDateTime } from '../lib/date';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

const RECHARGE_TYPES = ['获客助手', '外部联系人规模'];
const REFUND_METHOD = '操作退费';

function validateRechargeAmount(rechargeType: string, method: string | undefined, amount: unknown) {
  if (rechargeType !== '获客助手') return null;
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return '请输入有效的充值数量';
  if (method === REFUND_METHOD) {
    return numericAmount === 0 ? '操作退费数量不能为 0' : null;
  }
  return numericAmount > 0 ? null : '非退费支付方式充值数量必须大于 0';
}

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { entityId, rechargeType, startDate, endDate, page = '1', pageSize = '20' } = req.query;
    const where: any = {};
    if (entityId) where.entityId = Number(entityId);
    if (rechargeType) where.rechargeType = String(rechargeType);
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
    const { entityId, amount, rechargeType = '获客助手', rechargeDate, method, orderNumber, feeAmount, remark } = req.body;
    if (!RECHARGE_TYPES.includes(rechargeType)) return res.status(400).json({ error: '充值类型无效' });
    const amountError = validateRechargeAmount(rechargeType, method, amount);
    if (amountError) return res.status(400).json({ error: amountError });
    const record = await prisma.rechargeRecord.create({
      data: {
        entityId: Number(entityId), amount: rechargeType === '外部联系人规模' ? 0 : Number(amount),
        rechargeType,
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
    const { amount, rechargeType, rechargeDate, method, orderNumber, feeAmount, remark } = req.body;
    const current = await prisma.rechargeRecord.findUnique({ where: { id: Number(req.params.id) } });
    if (!current) return res.status(404).json({ error: '充值记录不存在' });
    const nextRechargeType = rechargeType ?? current.rechargeType;
    const nextMethod = method ?? current.method;
    const nextAmount = amount ?? current.amount;
    const amountError = validateRechargeAmount(nextRechargeType, nextMethod, nextAmount);
    if (amountError) return res.status(400).json({ error: amountError });

    const data: any = {};
    if (amount !== undefined) data.amount = Number(amount);
    if (rechargeType !== undefined) {
      if (!RECHARGE_TYPES.includes(rechargeType)) return res.status(400).json({ error: '充值类型无效' });
      data.rechargeType = rechargeType;
      if (rechargeType === '外部联系人规模') data.amount = 0;
    }
    if (nextRechargeType === '外部联系人规模') data.amount = 0;
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
