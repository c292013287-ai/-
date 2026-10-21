import { Router, Response } from 'express';
import axios from 'axios';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { MigrationSnapshots, MigrationSource } from '../lib/migrationSnapshots';

const router = Router();
router.use(authMiddleware);

interface FeishuTokenResponse {
  code: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

interface FeishuRecord {
  record_id: string;
  fields: Record<string, unknown>;
  created_time?: number;
}

interface FeishuRecordsResponse {
  code: number;
  msg?: string;
  data?: {
    items?: FeishuRecord[];
    page_token?: string;
    has_more?: boolean;
  };
}

interface FeishuUpdateRecordResponse {
  code: number;
  msg?: string;
}

interface FeishuWikiNodeResponse {
  code: number;
  msg?: string;
  data?: {
    node?: {
      obj_token?: string;
      obj_type?: string;
    };
  };
}

type NormalizedRecord = { recordId: string; createdTime?: number; fields: Record<string, string> };
const feishu = axios.create({ timeout: 20_000 });
let tokenCache: { key: string; token: string; expiresAt: number } | undefined;
const wikiCache = new Map<string, { token: string; expiresAt: number }>();
const recordLoads = new Map<string, Promise<NormalizedRecord[]>>();
const snapshots = new MigrationSnapshots({
  directory: () => path.resolve(process.env.MIGRATION_SNAPSHOT_DIR || 'data/migration-snapshots'),
  fingerprint: credentialsKey,
  load: async source => {
    try { return await sharedRecords(source); }
    catch (error) { throw new Error(sourceError(error).message); }
  },
});
export const startMigrationSnapshots = () => snapshots.start();

function credentialsKey() {
  return createHash('sha256').update(JSON.stringify([process.env.FEISHU_APP_ID, process.env.FEISHU_APP_SECRET])).digest('hex');
}

function normalizeFieldValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(normalizeFieldValue).filter(Boolean).join('、');
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.value === 'string' || typeof obj.value === 'number') return String(obj.value);
    if (typeof obj.link === 'string') return obj.link;
  }
  return JSON.stringify(value);
}

async function getTenantAccessToken(signal?: AbortSignal) {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('请先配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET');
  }

  const key = credentialsKey();
  if (tokenCache?.key === key && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const { data } = await feishu.post<FeishuTokenResponse>(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: appId, app_secret: appSecret },
    { signal },
  );

  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(data.msg || '获取飞书 tenant_access_token 失败');
  }

  tokenCache = {
    key, token: data.tenant_access_token,
    expiresAt: Date.now() + Math.max(0, Math.min(data.expire || 300, 7200) - 60) * 1000,
  };
  return tokenCache.token;
}

async function resolveBitableAppToken(inputToken: string, tenantAccessToken: string, signal?: AbortSignal) {
  if (/^base/i.test(inputToken) || /^basc/i.test(inputToken)) return inputToken;

  const key = `${credentialsKey()}:${inputToken}`;
  const cached = wikiCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const { data } = await feishu.get<FeishuWikiNodeResponse>(
    'https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node',
    {
      headers: { Authorization: `Bearer ${tenantAccessToken}` },
      params: { token: inputToken },
      signal,
    },
  );

  if (data.code !== 0 || !data.data?.node?.obj_token) {
    throw new Error(data.msg || '无法从飞书 Wiki 链接解析多维表格 App Token');
  }

  if (data.data.node.obj_type && data.data.node.obj_type !== 'bitable') {
    throw new Error('该飞书 Wiki 链接不是多维表格，请确认采集表链接');
  }

  if (wikiCache.size >= 50) wikiCache.clear();
  wikiCache.set(key, { token: data.data.node.obj_token, expiresAt: Date.now() + 300_000 });
  return data.data.node.obj_token;
}

async function readAllRecords(appToken: string, tableId: string, viewId: string) {
  // Keep the whole load below the proxy deadline; never publish an incomplete page set.
  const signal = AbortSignal.timeout(50_000);
  const token = await getTenantAccessToken(signal);
  const bitableAppToken = await resolveBitableAppToken(appToken, token, signal);
  const records: NormalizedRecord[] = [];
  const seenTokens = new Set<string>();
  let pageToken = '';
  do {
    const { data } = await feishu.get<FeishuRecordsResponse>(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${bitableAppToken}/tables/${tableId}/records`,
      {
        signal,
        headers: { Authorization: `Bearer ${token}` },
        params: { page_size: 500, page_token: pageToken || undefined, view_id: viewId || undefined },
      },
    );
    if (data.code !== 0) {
      tokenCache = undefined;
      throw new Error(data.msg || '获取飞书表记录失败');
    }
    if (!Array.isArray(data.data?.items) || typeof data.data.has_more !== 'boolean') {
      throw new Error('飞书返回的分页数据不完整，请重试');
    }
    for (const item of data.data.items) {
      if (!item.record_id || !item.fields || typeof item.fields !== 'object') throw new Error('飞书返回的记录不完整，请重试');
      const fields = Object.fromEntries(Object.entries(item.fields).map(([key, value]) => [key, normalizeFieldValue(value)]));
      records.push({ recordId: item.record_id, createdTime: item.created_time, fields });
    }
    pageToken = data.data.has_more ? (data.data.page_token || '') : '';
    if (data.data.has_more && (!pageToken || seenTokens.has(pageToken))) throw new Error('飞书分页游标异常，请重试');
    seenTokens.add(pageToken);
  } while (pageToken);
  return records;
}

function sharedRecords({ appToken, tableId, viewId }: MigrationSource) {
  const key = JSON.stringify([credentialsKey(), appToken, tableId, viewId]);
  let loading = recordLoads.get(key);
  if (!loading) {
    loading = readAllRecords(appToken, tableId, viewId).finally(() => recordLoads.delete(key));
    recordLoads.set(key, loading);
  }
  return loading;
}

function sourceFromQuery(query: Record<string, unknown>): MigrationSource {
  const source = { appToken: String(query.appToken || '').trim(), tableId: String(query.tableId || '').trim(), viewId: String(query.viewId || '').trim() };
  if (!source.appToken || !source.tableId || Object.values(source).some(value => value && !/^[A-Za-z0-9_-]{1,200}$/.test(value))) {
    throw new Error('缺少或无效的飞书 App Token、Table ID 或 View ID');
  }
  return source;
}

function sourceError(error: unknown) {
  const responseData = axios.isAxiosError(error) ? error.response?.data : undefined;
  const responseMessage = responseData && typeof responseData === 'object' && 'msg' in responseData
    ? String((responseData as { msg?: string }).msg || '') : '';
  const timedOut = axios.isCancel(error) || (axios.isAxiosError(error) && ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code || ''));
  return { timedOut, message: timedOut ? '飞书源表读取超时' : responseMessage || (error instanceof Error ? error.message : '获取飞书提交信息失败') };
}

router.get('/feishu/snapshot', async (req: AuthRequest, res: Response) => {
  let source: MigrationSource;
  try { source = sourceFromQuery(req.query); }
  catch (error) { return res.status(400).json({ error: (error as Error).message }); }
  try {
    const value = await snapshots.read(source, String(req.query.revision || ''));
    res.setHeader('Cache-Control', 'no-store');
    res.json(value);
  } catch { res.status(503).json({ error: '源表同步服务暂不可用，已有数据已保留' }); }
});

router.post('/feishu/sync', async (req: AuthRequest, res: Response) => {
  let source: MigrationSource;
  try { source = sourceFromQuery(req.query); }
  catch (error) { return res.status(400).json({ error: (error as Error).message }); }
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await snapshots.read(source, String(req.query.revision || ''), true));
  } catch { res.status(503).json({ error: '无法启动源表同步，已有数据已保留' }); }
});

router.get('/feishu/records', async (req: AuthRequest, res: Response) => {
  try {
    const appToken = String(req.query.appToken || '').trim();
    const tableId = String(req.query.tableId || '').trim();
    const viewId = String(req.query.viewId || '').trim();

    if (!appToken || !tableId) {
      return res.status(400).json({ error: '缺少 appToken 或 tableId' });
    }

    const records = await sharedRecords({ appToken, tableId, viewId });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ records });
  } catch (error) {
    const { timedOut, message } = sourceError(error);
    res.status(timedOut ? 504 : 502).json({ error: message });
  }
});

router.patch('/feishu/records/:recordId', async (req: AuthRequest, res: Response) => {
  try {
    const appToken = String(req.query.appToken || '').trim();
    const tableId = String(req.query.tableId || '').trim();
    const recordId = String(req.params.recordId || '').trim();
    const fields = req.body?.fields;

    if (!appToken || !tableId || !recordId) {
      return res.status(400).json({ error: '缺少 appToken、tableId 或 recordId' });
    }

    if (!fields || typeof fields !== 'object') {
      return res.status(400).json({ error: '缺少要更新的飞书字段' });
    }

    const token = await getTenantAccessToken();
    const bitableAppToken = await resolveBitableAppToken(appToken, token);
    const { data } = await feishu.put<FeishuUpdateRecordResponse>(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${bitableAppToken}/tables/${tableId}/records/${recordId}`,
      { fields },
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (data.code !== 0) {
      return res.status(502).json({ error: data.msg || '更新飞书记录失败' });
    }

    snapshots.invalidate(appToken, tableId);
    res.json({ success: true });
  } catch (error) {
    const responseData = axios.isAxiosError(error) ? error.response?.data : undefined;
    const responseMessage = responseData && typeof responseData === 'object' && 'msg' in responseData
      ? String((responseData as { msg?: string }).msg || '')
      : '';
    const message = responseMessage || (error instanceof Error ? error.message : '更新飞书记录失败');
    res.status(500).json({ error: message });
  }
});

export default router;
