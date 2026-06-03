/**
 * 飞书多维表格服务
 * 负责获取 token、读写 bitable 数据
 */
import axios from 'axios';

const APP_ID = process.env.FEISHU_APP_ID || '';
const APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const BITABLE_APP_TOKEN = process.env.FEISHU_BITABLE_APP_TOKEN || '';
const TABLE_ID = process.env.FEISHU_TABLE_ID || '';

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

/** 获取 tenant_access_token */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const { data } = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: APP_ID, app_secret: APP_SECRET },
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (data.code !== 0) throw new Error(`飞书token获取失败: ${data.msg}`);
  cachedToken = data.tenant_access_token;
  tokenExpiry = Date.now() + (data.expire - 300) * 1000;
  return cachedToken!;
}

const api = axios.create({ baseURL: 'https://open.feishu.cn/open-apis' });
api.interceptors.request.use(async (config) => {
  config.headers.Authorization = `Bearer ${await getAccessToken()}`;
  return config;
});

/** 从多维表格读取记录（支持过滤条件） */
export async function listRecords(filter?: string) {
  const params: any = { page_size: 100 };
  if (filter) params.filter = filter;
  const { data } = await api.get(`/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${TABLE_ID}/records`, { params });
  if (data.code !== 0) throw new Error(`读取表格失败: ${data.msg}`);
  return data.data.items || [];
}

/** 批量新增记录（最多 500 条/次） */
export async function createRecords(records: Array<{ fields: Record<string, any> }>) {
  const { data } = await api.post(
    `/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${TABLE_ID}/records/batch_create`,
    { records },
  );
  if (data.code !== 0) throw new Error(`写入表格失败: ${data.msg}`);
  return data.data.records || [];
}

/** 批量更新记录 */
export async function updateRecords(records: Array<{ record_id: string; fields: Record<string, any> }>) {
  const { data } = await api.post(
    `/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${TABLE_ID}/records/batch_update`,
    { records },
  );
  if (data.code !== 0) throw new Error(`更新表格失败: ${data.msg}`);
  return data.data.records || [];
}

/** 获取表格字段元数据 */
export async function getTableMeta() {
  const { data } = await api.get(`/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${TABLE_ID}`);
  if (data.code !== 0) throw new Error(`获取表格信息失败: ${data.msg}`);
  return data.data.table;
}

/** 检查配置是否就绪 */
export function isConfigured() {
  return !!(APP_ID && APP_SECRET && BITABLE_APP_TOKEN && TABLE_ID);
}
