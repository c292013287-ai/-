import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest, authMiddleware } from '../middleware/auth';

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
    const { name, corpid, secret, quotaTotal } = req.body;

    if (!name || !corpid || !secret) {
      res.status(400).json({ error: '名称、企业ID和Secret为必填项' });
      return;
    }

    const entity = await prisma.wecomEntity.create({
      data: {
        name,
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
    const { name, corpid, secret, status, quotaTotal } = req.body;
    const id = Number(req.params.id);

    const existing = await prisma.wecomEntity.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: '主体不存在' });
      return;
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
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
