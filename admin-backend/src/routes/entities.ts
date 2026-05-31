import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { getQuotaInfo } from '../services/wecom';

const router = Router();

router.use(authMiddleware);

// GET /api/entities - 获取所有主体
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const entities = await prisma.wecomEntity.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(entities);
  } catch (error) {
    res.status(500).json({ error: '获取主体列表失败' });
  }
});

// POST /api/entities/:id/sync - 手动同步获客数据
router.post('/:id/sync', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const entity = await prisma.wecomEntity.findUnique({ where: { id } });

    if (!entity) {
      res.status(404).json({ error: '主体不存在' });
      return;
    }

    const quota = await getQuotaInfo(entity.corpid, entity.secret);

    await prisma.wecomEntity.update({
      where: { id },
      data: {
        quotaTotal: quota.total,
        quotaBalance: quota.balance,
        lastSyncAt: new Date(),
      },
    });

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const todayDate = new Date(todayStr);

    // 今日消耗 = 上日配额余额 - 当日配额余额
    // 若为首次同步（无历史记录），消耗固定为 0
    const yesterday = new Date(todayDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayRecord = await prisma.consumptionRecord.findFirst({
      where: { entityId: id, date: yesterday },
      orderBy: { date: 'desc' },
    });
    const hasHistory = await prisma.consumptionRecord.findFirst({
      where: { entityId: id, date: { lt: todayDate } },
    });
    const prevBalance = yesterdayRecord?.quotaBalance ?? quota.total;
    const consumption = hasHistory ? prevBalance - quota.balance : 0;

    // 先删除今日已有记录再创建，避免 unique key 冲突
    await prisma.consumptionRecord.deleteMany({
      where: { entityId: id, date: todayDate },
    });

    await prisma.consumptionRecord.create({
      data: { entityId: id, date: todayDate, consumption, quotaBalance: quota.balance, calls: 0 },
    });

    await prisma.syncLog.create({
      data: {
        entityId: id,
        status: 'success',
        message: `手动同步: 配额${quota.total} 余额${quota.balance} 消耗${consumption}`,
      },
    });

    res.json({
      success: true,
      quotaTotal: quota.total,
      quotaBalance: quota.balance,
      consumption,
      quotaList: quota.quotaList,
    });
  } catch (error: any) {
    res.status(500).json({ error: `同步失败: ${error.message}` });
  }
});

// GET /api/entities/:id - 获取主体详情
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const entity = await prisma.wecomEntity.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!entity) {
      res.status(404).json({ error: '主体不存在' });
      return;
    }
    res.json(entity);
  } catch (error) {
    res.status(500).json({ error: '获取主体详情失败' });
  }
});

// POST /api/entities - 创建主体
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, sku, corpid, secret, quotaTotal, rechargeAmount, monthlyBudget } = req.body;

    if (!name || !corpid || !secret) {
      res.status(400).json({ error: '名称、企业ID和Secret为必填项' });
      return;
    }

    const entity = await prisma.wecomEntity.create({
      data: {
        name,
        sku: sku || null,
        rechargeAmount: rechargeAmount || 0,
        monthlyBudget: monthlyBudget || 0,
        corpid,
        secret,
        quotaTotal: quotaTotal || 0,
        quotaBalance: quotaTotal || 0,
      },
    });

    res.status(201).json(entity);
  } catch (error) {
    res.status(500).json({ error: '创建主体失败' });
  }
});

// PUT /api/entities/:id - 更新主体
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { name, sku, rechargeAmount, monthlyBudget, corpid, secret, status, quotaTotal } = req.body;
    const id = Number(req.params.id);

    const existing = await prisma.wecomEntity.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: '主体不存在' });
      return;
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (sku !== undefined) updateData.sku = sku;
    if (rechargeAmount !== undefined) updateData.rechargeAmount = Number(rechargeAmount);
    if (monthlyBudget !== undefined) updateData.monthlyBudget = Number(monthlyBudget);
    if (corpid !== undefined) updateData.corpid = corpid;
    if (secret !== undefined) updateData.secret = secret;
    if (status !== undefined) updateData.status = status;
    if (quotaTotal !== undefined) {
      updateData.quotaTotal = quotaTotal;
      updateData.quotaBalance = quotaTotal;
    }

    const entity = await prisma.wecomEntity.update({
      where: { id },
      data: updateData,
    });

    res.json(entity);
  } catch (error) {
    res.status(500).json({ error: '更新主体失败' });
  }
});

// DELETE /api/entities/:id - 删除主体
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);

    const existing = await prisma.wecomEntity.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: '主体不存在' });
      return;
    }

    await prisma.wecomEntity.delete({ where: { id } });

    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ error: '删除主体失败' });
  }
});

export default router;
