import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { entityManagementOnly } from '../middleware/entityManagement';
import { syncEntityQuota } from '../services/sync';
import { parseCertificationDate } from '../lib/certificationDate';
import { parseExternalContactCapacity } from '../lib/externalContactForecast';
import { parseExternalContactValidity } from '../lib/externalContactValidity';
import { withContactForecasts } from '../services/externalContactForecasts';
import { servedUserJobs } from '../services/servedUserJobs';
import { getCustomerPage, getEmployeeNames } from '../services/wecom';
import { customerSyncJobs } from '../services/customerSyncJobs';
import { customerLive } from '../services/customerLive';
import { fingerprintOf } from '../lib/customerLiveStore';
import { callbackConfig } from './customerCallbacks';
import { csvCell } from '../lib/customerSnapshotStore';
import { once } from 'node:events';

const router = Router();
router.use(authMiddleware);

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
        userCount: true,
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
    res.json(await withContactForecasts(await prisma.wecomEntity.findMany({ orderBy: { createdAt: 'desc' } })));
  } catch {
    res.status(500).json({ error: '获取主体列表失败' });
  }
});

router.get('/served-users/jobs', entityManagementOnly, (_req: AuthRequest, res: Response) => {
  res.json(servedUserJobs.list());
});

router.get('/:id/customers/live-status', entityManagementOnly, async (req, res) => {
  try {
    const entity = await prisma.wecomEntity.findUnique({ where: { id: Number(req.params.id) } });
    if (!entity) { res.status(404).json({ error: '主体不存在' }); return; }
    res.json({ ...await customerLive.status(entity.id, fingerprintOf(entity)), callbackPrepared: !!await callbackConfig(entity.id) });
  } catch { res.status(500).json({ error: '读取增量同步状态失败' }); }
});

router.get('/customers/jobs', entityManagementOnly, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await customerSyncJobs.status());
});

router.post('/customers/sync', entityManagementOnly, async (req, res) => {
  const id = req.body?.entityId;
  if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) return res.status(400).json({ error: '主体ID无效' });
  try {
    const entities = await prisma.wecomEntity.findMany({ where: { status: 'active', ...(id === undefined ? {} : { id }) }, select: { id: true } });
    if (!entities.length) return res.status(404).json({ error: '没有可同步的启用主体' });
    res.status(202).json(await customerSyncJobs.start(entities.map(entity => entity.id)));
  } catch { res.status(500).json({ error: '启动用户同步失败' }); }
});

const customerFilterKeys = ['userId', 'name', 'remark', 'phone', 'externalUserId', 'unionId', 'state', 'gender', 'type', 'tagId', 'addWay', 'unionStatus', 'startDate', 'endDate'];
function snapshotFilters(query: Record<string, unknown>) {
  const filters: Record<string, string> = {};
  for (const key of customerFilterKeys) {
    const value = query[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || value.length > 256) throw new Error('筛选参数无效');
    if (['gender', 'type', 'addWay'].includes(key) && !/^\d+$/.test(value)) throw new Error('筛选参数无效');
    if (['startDate', 'endDate'].includes(key) && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))) throw new Error('日期无效');
    filters[key] = value;
  }
  return filters;
}

router.get('/:id/customers/export', entityManagementOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: '主体ID无效' });
  let filters;
  try { filters = snapshotFilters(req.query); } catch { return res.status(400).json({ error: '筛选参数无效' }); }
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  try {
    const rows = await customerSyncJobs.exportRows(id, filters, controller.signal);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="customers-${id}.csv"`);
    res.write('\uFEFF' + ['客户名称', '头像链接', '性别', '客户备注', '备注手机号', '客户标签', '添加来源代码', '渠道标记', '类型', '企业', '员工ID', '添加时间', '描述', 'external_userid', 'unionid'].map(csvCell).join(',') + '\r\n');
    for await (const item of rows) {
      const line = [item.name, item.avatar, item.gender === 1 ? '男' : item.gender === 2 ? '女' : '未知', item.remark, item.remarkMobiles?.join('\n'), item.tags?.map((tag: any) => tag.name || tag.id).join('\n'), item.addWay, item.state, item.type === 1 ? '微信客户' : '企业微信客户', item.company, item.userId, item.addedAt == null ? '' : new Date(item.addedAt * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }), item.description, item.externalUserId, item.unionId].map(csvCell).join(',') + '\r\n';
      if (!res.write(line)) await once(res, 'drain', { signal: controller.signal });
    }
    res.end();
  } catch {
    if (res.headersSent) res.destroy();
    else if (!res.destroyed) res.status(500).json({ error: '下载失败，请重试' });
  }
});

router.get('/:id/customers/snapshot', entityManagementOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: '主体ID无效' });
  const page = Number(req.query.page || 1); const pageSize = Number(req.query.pageSize || 20);
  if (!Number.isSafeInteger(page) || page < 1 || ![20, 50, 100].includes(pageSize)) return res.status(400).json({ error: '分页参数无效' });
  let filters;
  try { filters = snapshotFilters(req.query); } catch { return res.status(400).json({ error: '筛选参数无效' }); }
  const controller = new AbortController(); res.on('close', () => controller.abort());
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await customerSyncJobs.snapshot(id, filters, page, pageSize, controller.signal));
  } catch { if (!res.destroyed) res.status(500).json({ error: '读取服务器用户数据失败' }); }
});

router.get('/:id/employee-names', entityManagementOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: '主体ID无效' });
  try {
    const entity = await prisma.wecomEntity.findUnique({ where: { id } });
    if (!entity) return res.status(404).json({ error: '主体不存在' });
    const names = await getEmployeeNames(entity.corpid, entity.secret, entity.wecomApiBaseUrl);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ names });
  } catch { res.status(502).json({ error: '员工名称读取失败，暂显示员工ID；请检查通讯录权限或稍后重试' }); }
});

router.get('/:id/customers', entityManagementOnly, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const { userId, cursor } = req.query;
  if (!Number.isSafeInteger(id) || id <= 0
    || (userId !== undefined && (typeof userId !== 'string' || !userId.trim() || userId.length > 256))
    || (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 4096 || !userId))) {
    return res.status(400).json({ error: '客户查询参数无效' });
  }
  try {
    const entity = await prisma.wecomEntity.findUnique({ where: { id } });
    if (!entity) return res.status(404).json({ error: '主体不存在' });
    res.json(await getCustomerPage(entity.corpid, entity.secret, entity.wecomApiBaseUrl, userId as string | undefined, cursor as string | undefined));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error && !('code' in error) ? error.message : '客户查询失败，请重试' });
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
router.post('/:id/served-users/sync', entityManagementOnly, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: '主体ID无效' });
  try {
    const entity = await prisma.wecomEntity.findUnique({ where: { id } });
    if (!entity) return res.status(404).json({ error: '主体不存在' });
    res.status(202).json(servedUserJobs.start(id));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error && !('code' in error) ? error.message : '统计失败，请稍后重试' });
  }
});

router.post('/:id/sync', async (req: AuthRequest, res: Response) => {
  try {
    const entity = await prisma.wecomEntity.findUnique({ where: { id: Number(req.params.id) } });
    if (!entity) return res.status(404).json({ error: '主体不存在' });

    const result = await syncEntityQuota({ entity });
    const { quota, consumption, userCount } = result;

    // 补充日志
    await prisma.syncLog.create({
      data: { entityId: entity.id, status: 'success', message: `手动同步: 配额${quota.total} 余额${quota.balance} 消耗${consumption}` },
    });

    res.json({ success: true, quotaTotal: quota.total, quotaBalance: quota.balance, userCount, consumption, quotaList: quota.quotaList });
  } catch (error: any) {
    res.status(500).json({ error: `同步失败: ${error.message}` });
  }
});

// POST /api/entities
router.post('/', entityManagementOnly, async (req: AuthRequest, res: Response) => {
  let certificationExpiresAt;
  let externalContactCapacity;
  let externalContactValidity;
  try {
    certificationExpiresAt = parseCertificationDate(req.body.certificationExpiresAt);
    externalContactCapacity = parseExternalContactCapacity(req.body.externalContactCapacity);
    externalContactValidity = parseExternalContactValidity(req.body.externalContactValidFrom, req.body.externalContactValidUntil);
  }
  catch (error) { return res.status(400).json({ error: (error as Error).message }); }
  try {
    const { name, sku, corpid, secret, quotaTotal, rechargeAmount, monthlyBudget, wecomApiBaseUrl } = req.body;
    if (!name || !corpid || !secret) return res.status(400).json({ error: '名称、企业ID和Secret为必填项' });

    res.status(201).json(await prisma.wecomEntity.create({
      data: {
        name, sku: sku || null, corpid, secret, wecomApiBaseUrl: wecomApiBaseUrl || null,
        certificationExpiresAt,
        externalContactCapacity,
        ...externalContactValidity,
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
  let certificationExpiresAt;
  let externalContactCapacity;
  let externalContactValidity;
  try {
    certificationExpiresAt = parseCertificationDate(req.body.certificationExpiresAt);
    externalContactCapacity = parseExternalContactCapacity(req.body.externalContactCapacity);
    externalContactValidity = parseExternalContactValidity(req.body.externalContactValidFrom, req.body.externalContactValidUntil);
  }
  catch (error) { return res.status(400).json({ error: (error as Error).message }); }
  try {
    const { name, sku, rechargeAmount, monthlyBudget, corpid, secret, status, quotaTotal, wecomApiBaseUrl } = req.body;
    const id = Number(req.params.id);
    const current = await prisma.wecomEntity.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: '主体不存在' });

    const data: any = { name, sku, corpid, secret, status, ...externalContactValidity };
    if (certificationExpiresAt !== undefined) data.certificationExpiresAt = certificationExpiresAt;
    if (externalContactCapacity !== undefined) data.externalContactCapacity = externalContactCapacity;
    if (wecomApiBaseUrl !== undefined) data.wecomApiBaseUrl = wecomApiBaseUrl || null;
    if (rechargeAmount !== undefined) data.rechargeAmount = Number(rechargeAmount);
    if (monthlyBudget !== undefined) data.monthlyBudget = Number(monthlyBudget);
    if (quotaTotal !== undefined) { data.quotaTotal = quotaTotal; data.quotaBalance = quotaTotal; }

    Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
    if (fingerprintOf({ ...current, ...data }) !== fingerprintOf(current)) {
      data.servedUserCount = null;
      data.servedUserCountUpdatedAt = null;
    }
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
