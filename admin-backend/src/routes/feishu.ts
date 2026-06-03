import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { fmtDate } from '../lib/date';
import { buildRechargeMap } from '../lib/recharge';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import * as feishu from '../services/feishu';

const router = Router();
router.use(authMiddleware);

// GET /api/feishu/status - 检查飞书集成状态
router.get('/status', async (_req: AuthRequest, res: Response) => {
  try {
    const configured = feishu.isConfigured();
    if (!configured) return res.json({ configured: false, message: '未配置飞书凭证' });

    const token = await feishu.getAccessToken();
    const meta = await feishu.getTableMeta();
    res.json({
      configured: true,
      table: { name: meta.name, fieldCount: meta.fields?.length || 0, revision: meta.revision },
    });
  } catch (e: any) {
    res.json({ configured: feishu.isConfigured(), error: e.message });
  }
});

// POST /api/feishu/sync/consumption - 推送消耗数据到飞书
router.post('/sync/consumption', async (req: AuthRequest, res: Response) => {
  try {
    if (!feishu.isConfigured()) return res.status(400).json({ error: '飞书未配置' });

    const { days = 7 } = req.body;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const records = await prisma.consumptionRecord.findMany({
      where: { date: { gte: startDate } },
      include: { entity: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
    });

    const entityIds = [...new Set(records.map(r => r.entityId))];
    const rechargeMap = await buildRechargeMap(entityIds, startDate);

    const rows = records.map(r => {
      const recharge = rechargeMap.get(`${r.entityId}_${fmtDate(r.date)}`) || 0;
      const consumption = r.consumption < 0 ? r.consumption + recharge : r.consumption;
      return {
        fields: {
          '日期': fmtDate(r.date),
          '主体名称': r.entity.name,
          '消耗数量': consumption,
          '配额余额': r.quotaBalance,
          '推送时间': new Date().toISOString(),
        },
      };
    });

    // 分批写入（每批最多500条）
    const batchSize = 500;
    let pushed = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      await feishu.createRecords(batch);
      pushed += batch.length;
    }

    res.json({ success: true, pushed, dateRange: { from: fmtDate(startDate), to: fmtDate(new Date()) } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/feishu/sync/warnings - 推送预警数据到飞书
router.post('/sync/warnings', async (_req: AuthRequest, res: Response) => {
  try {
    if (!feishu.isConfigured()) return res.status(400).json({ error: '飞书未配置' });

    const entities = await prisma.wecomEntity.findMany({ where: { status: 'active' } });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);

    const records = await Promise.all(entities.map(async (e) => {
      const consumptions = await prisma.consumptionRecord.findMany({
        where: { entityId: e.id, date: { gte: weekAgo, lt: today } },
        orderBy: { date: 'desc' },
      });
      const weekSum = consumptions.reduce((s, c) => s + c.consumption, 0);
      const avg7d = Math.round(weekSum / 7);
      const countdown = avg7d > 0 ? Math.round((e.quotaBalance / avg7d) * 100) / 100 : -1;
      return { entity: e, avg7d, countdown };
    }));

    records.sort((a, b) => a.countdown < 0 ? 1 : b.countdown < 0 ? -1 : a.countdown - b.countdown);

    const rows = records.map(r => ({
      fields: {
        '主体名称': r.entity.name,
        '配额余额': r.entity.quotaBalance,
        '7日均消耗': r.avg7d,
        '预计可支撑(天)': r.countdown >= 0 ? r.countdown : '--',
        '状态': r.countdown >= 0 && r.countdown < 3 ? '🔴 紧急'
          : r.countdown >= 3 && r.countdown < 5 ? '🟡 警告'
          : r.countdown >= 5 ? '🟢 充足' : '⚪ 无数据',
        '更新时间': new Date().toISOString(),
      },
    }));

    await feishu.createRecords(rows);
    res.json({ success: true, pushed: rows.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/feishu/sync/entities - 推送主体配置到飞书
router.post('/sync/entities', async (_req: AuthRequest, res: Response) => {
  try {
    if (!feishu.isConfigured()) return res.status(400).json({ error: '飞书未配置' });

    const entities = await prisma.wecomEntity.findMany({ orderBy: { createdAt: 'desc' } });
    const rows = entities.map(e => ({
      fields: {
        '主体名称': e.name,
        '企业ID': e.corpid,
        'SKU': e.sku || '',
        '状态': e.status === 'active' ? '活跃' : '停用',
        '配额总额': e.quotaTotal,
        '配额余额': e.quotaBalance,
        '最后同步': e.lastSyncAt?.toISOString() || '',
      },
    }));

    await feishu.createRecords(rows);
    res.json({ success: true, pushed: rows.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/feishu/report/daily - 推送日报到飞书
router.post('/report/daily', async (_req: AuthRequest, res: Response) => {
  try {
    if (!feishu.isConfigured()) return res.status(400).json({ error: '飞书未配置' });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const now = new Date();

    const records = await prisma.consumptionRecord.findMany({
      where: { date: { gte: today, lte: new Date(today.getTime() + 86399000) } },
      include: { entity: { select: { name: true } } },
    });

    const totalConsumption = records.reduce((s, r) => s + Math.max(0, r.consumption), 0);

    const dateStr = fmtDate(today);
    await feishu.createRecords([{
      fields: {
        '日期': dateStr,
        '报告类型': '日报',
        '活跃主体数': new Set(records.map(r => r.entityId)).size,
        '今日消耗': totalConsumption,
        '生成时间': now.toISOString(),
      },
    }]);

    res.json({ success: true, date: dateStr, consumption: totalConsumption });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
