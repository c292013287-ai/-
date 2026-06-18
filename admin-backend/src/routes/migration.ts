import { Router, Response } from 'express';
import axios from 'axios';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

interface FeishuTokenResponse {
  code: number;
  msg?: string;
  tenant_access_token?: string;
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

async function getTenantAccessToken() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('请先配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET');
  }

  const { data } = await axios.post<FeishuTokenResponse>(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: appId, app_secret: appSecret },
  );

  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(data.msg || '获取飞书 tenant_access_token 失败');
  }

  return data.tenant_access_token;
}

async function resolveBitableAppToken(inputToken: string, tenantAccessToken: string) {
  if (/^base/i.test(inputToken) || /^basc/i.test(inputToken)) return inputToken;

  const { data } = await axios.get<FeishuWikiNodeResponse>(
    'https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node',
    {
      headers: { Authorization: `Bearer ${tenantAccessToken}` },
      params: { token: inputToken },
    },
  );

  if (data.code !== 0 || !data.data?.node?.obj_token) {
    throw new Error(data.msg || '无法从飞书 Wiki 链接解析多维表格 App Token');
  }

  if (data.data.node.obj_type && data.data.node.obj_type !== 'bitable') {
    throw new Error('该飞书 Wiki 链接不是多维表格，请确认采集表链接');
  }

  return data.data.node.obj_token;
}

router.get('/feishu/records', async (req: AuthRequest, res: Response) => {
  try {
    const appToken = String(req.query.appToken || '').trim();
    const tableId = String(req.query.tableId || '').trim();
    const viewId = String(req.query.viewId || '').trim();

    if (!appToken || !tableId) {
      return res.status(400).json({ error: '缺少 appToken 或 tableId' });
    }

    const token = await getTenantAccessToken();
    const bitableAppToken = await resolveBitableAppToken(appToken, token);
    const records: Array<{ recordId: string; createdTime?: number; fields: Record<string, string> }> = [];
    let pageToken = '';

    do {
      const { data } = await axios.get<FeishuRecordsResponse>(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${bitableAppToken}/tables/${tableId}/records`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            page_size: 500,
            page_token: pageToken || undefined,
            view_id: viewId || undefined,
          },
        },
      );

      if (data.code !== 0) {
        return res.status(502).json({ error: data.msg || '获取飞书表记录失败' });
      }

      (data.data?.items || []).forEach((item) => {
        const fields = Object.entries(item.fields || {}).reduce<Record<string, string>>((acc, [key, value]) => {
          acc[key] = normalizeFieldValue(value);
          return acc;
        }, {});
        records.push({ recordId: item.record_id, createdTime: item.created_time, fields });
      });

      pageToken = data.data?.has_more ? (data.data.page_token || '') : '';
    } while (pageToken);

    res.json({ records });
  } catch (error) {
    const responseData = axios.isAxiosError(error) ? error.response?.data : undefined;
    const responseMessage = responseData && typeof responseData === 'object' && 'msg' in responseData
      ? String((responseData as { msg?: string }).msg || '')
      : '';
    const message = responseMessage || (error instanceof Error ? error.message : '获取飞书提交信息失败');
    res.status(500).json({ error: message });
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
    const { data } = await axios.put<FeishuUpdateRecordResponse>(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${bitableAppToken}/tables/${tableId}/records/${recordId}`,
      { fields },
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (data.code !== 0) {
      return res.status(502).json({ error: data.msg || '更新飞书记录失败' });
    }

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
