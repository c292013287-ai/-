import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { syncEntityQuota } from '../services/sync';

const router = Router();
router.use(authMiddleware);

interface EntityAccessPayload {
  userId: number;
  scope: 'entity-management';
}

function entityManagementOnly(req: AuthRequest, res: Response, next: () => void) {
  const accessToken = req.headers['x-entity-access-token'];
  if (typeof accessToken !== 'string') {
    res.status(403).json({ error: '请先验证主体管理访问权限' });
    return;
  }

  try {
    const payload = jwt.verify(
      accessToken,
      process.env.JWT_SECRET || 'default-secret',
    ) as EntityAccessPayload;

    if (payload.scope !== 'entity-management' || payload.userId !== req.userId) {
      throw new Error('Invalid entity access token');
    }
    next();
  } catch {
    res.status(403).json({ error: '主体管理授权已过期，请重新验证' });
  }
}

// POST /api/entities/access - 主体管理专用账号验证
router.post('/access', async (req: AuthRequest, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: '请输入账号和密码' });
      return;
    }

    const managementUsername = process.env.ENTITY_MANAGEMENT_USERNAME;
    const managementPasswordHash = process.env.ENTITY_MANAGEMENT_PASSWORD_HASH;
    if (!managementUsername || !managementPasswordHash) {
      res.status(503).json({ error: '主体管理专用账号尚未配置' });
      return;
    }

    const isValid = username === managementUsername
      && await bcrypt.compare(password, managementPasswordHash);

    if (!isValid) {
      res.status(403).json({ error: '账号或密码不正确' });
      return;
    }

    const accessToken = jwt.sign(
      { userId: req.userId, scope: 'entity-management' },
      process.env.JWT_SECRET || 'default-secret',
      { expiresIn: '2h' },
    );
    res.json({ accessToken, expiresIn: 2 * 60 * 60 });
  } catch {
    res.status(500).json({ error: '权限验证失败' });
  }
});

// GET /api/entities/access - 校验当前专用权限
router.get('/access', entityManagementOnly, (_req: AuthRequest, res: Response) => {
  res.json({ valid: true });
});

// GET /api/entities
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    res.json(await prisma.wecomEntity.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        sku: true,
        status: true,
        quotaTotal: true,
        quotaBalance: true,
        lastSyncAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }));
  } catch {
    res.status(500).json({ error: '获取主体列表失败' });
  }
});

// GET /api/entities/manage - 主体管理完整列表
router.get('/manage', entityManagementOnly, async (_req: AuthRequest, res: Response) => {
  try {
    res.json(await prisma.wecomEntity.findMany({ orderBy: { createdAt: 'desc' } }));
  } catch {
    res.status(500).json({ error: '获取主体列表失败' });
  }
});

// GET /api/entities/:id
router.get('/:id', entityManagementOnly, async (req: AuthRequest, res: Response) => {
  try {
    const entity = await prisma.wecomEntity.findUnique({ where: { id: Number(req.params.id) } });
    if (!entity) return res.status(404).json({ error: '主体不存在' });
    res.json(entity);
  } catch {
    res.status(500).json({ error: '获取主体详情失败' });
  }
});

// POST /api/entities/:id/sync
router.post('/:id/sync', async (req: AuthRequest, res: Response) => {
  try {
    const entity = await prisma.wecomEntity.findUnique({ where: { id: Number(req.params.id) } });
    if (!entity) return res.status(404).json({ error: '主体不存在' });

    const result = await syncEntityQuota({ entity });
    const { quota, consumption } = result;

    // 补充日志
    await prisma.syncLog.create({
      data: { entityId: entity.id, status: 'success', message: `手动同步: 配额${quota.total} 余额${quota.balance} 消耗${consumption}` },
    });

    res.json({ success: true, quotaTotal: quota.total, quotaBalance: quota.balance, consumption, quotaList: quota.quotaList });
  } catch (error: any) {
    res.status(500).json({ error: `同步失败: ${error.message}` });
  }
});

// POST /api/entities
router.post('/', entityManagementOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { name, sku, corpid, secret, quotaTotal, rechargeAmount, monthlyBudget, wecomApiBaseUrl } = req.body;
    if (!name || !corpid || !secret) return res.status(400).json({ error: '名称、企业ID和Secret为必填项' });

    res.status(201).json(await prisma.wecomEntity.create({
      data: {
        name, sku: sku || null, corpid, secret, wecomApiBaseUrl: wecomApiBaseUrl || null,
        rechargeAmount: Number(rechargeAmount || 0),
        monthlyBudget: Number(monthlyBudget || 0),
        quotaTotal: Number(quotaTotal || 0),
        quotaBalance: Number(quotaTotal || 0),
      },
    }));
  } catch {
    res.status(500).json({ error: '创建主体失败' });
  }
});

// PUT /api/entities/:id
router.put('/:id', entityManagementOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { name, sku, rechargeAmount, monthlyBudget, corpid, secret, status, quotaTotal, wecomApiBaseUrl } = req.body;
    const id = Number(req.params.id);
    if (!(await prisma.wecomEntity.findUnique({ where: { id } }))) return res.status(404).json({ error: '主体不存在' });

    const data: any = { name, sku, corpid, secret, status };
    if (wecomApiBaseUrl !== undefined) data.wecomApiBaseUrl = wecomApiBaseUrl || null;
    if (rechargeAmount !== undefined) data.rechargeAmount = Number(rechargeAmount);
    if (monthlyBudget !== undefined) data.monthlyBudget = Number(monthlyBudget);
    if (quotaTotal !== undefined) { data.quotaTotal = quotaTotal; data.quotaBalance = quotaTotal; }

    Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
    res.json(await prisma.wecomEntity.update({ where: { id }, data }));
  } catch {
    res.status(500).json({ error: '更新主体失败' });
  }
});

// DELETE /api/entities/:id
router.delete('/:id', entityManagementOnly, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!(await prisma.wecomEntity.findUnique({ where: { id } }))) return res.status(404).json({ error: '主体不存在' });
    await prisma.wecomEntity.delete({ where: { id } });
    res.json({ message: '删除成功' });
  } catch {
    res.status(500).json({ error: '删除主体失败' });
  }
});

export default router;
