import client from './client';

export interface FeishuRecord {
  recordId: string;
  createdTime?: number;
  fields: Record<string, string>;
}

export interface MigrationSnapshot {
  ready: boolean;
  records?: FeishuRecord[];
  revision: string;
  updatedAt: string | null;
  refreshing: boolean;
  error: string;
}

export async function getMigrationSnapshot(
  params: { appToken: string; tableId: string; viewId?: string; revision?: string },
  force: boolean,
  signal: AbortSignal,
) {
  const options = { params, signal, timeout: 60_000 };
  const { data } = force
    ? await client.post<MigrationSnapshot>('/migration/feishu/sync', {}, options)
    : await client.get<MigrationSnapshot>('/migration/feishu/snapshot', options);
  if (typeof data.ready !== 'boolean' || typeof data.refreshing !== 'boolean'
    || typeof data.revision !== 'string' || typeof data.error !== 'string'
    || (data.ready && (!data.updatedAt || !Number.isFinite(Date.parse(data.updatedAt)) || !data.revision))
    || (data.records !== undefined && !Array.isArray(data.records))
    || (data.ready && data.revision !== params.revision && !Array.isArray(data.records))) {
    throw new Error('源表同步结果不完整，请重试');
  }
  return data;
}

export async function getFeishuMigrationRecords(params: { appToken: string; tableId: string; viewId?: string }) {
  const { data } = await client.get<{ records: FeishuRecord[] }>('/migration/feishu/records', { params, timeout: 60_000 });
  if (!Array.isArray(data.records)) throw new Error('源表同步结果不完整，请重试');
  return data.records;
}

export function getMigrationSyncError(error: unknown) {
  if (error && typeof error === 'object') {
    const value = error as { code?: string; message?: string; response?: { data?: { error?: string } } };
    if (value.response?.data?.error) return value.response.data.error;
    if (['ECONNABORTED', 'ETIMEDOUT'].includes(value.code || '')) return '源表读取超时，请稍后重试';
    if (value.code === 'ERR_NETWORK') return '网络连接异常，请检查网络后重试';
    if (value.message) return value.message;
  }
  return '获取飞书提交信息失败';
}

export async function updateFeishuMigrationRecord(
  recordId: string,
  params: { appToken: string; tableId: string },
  fields: Record<string, string | number>,
) {
  const { data } = await client.patch<{ success: boolean }>(`/migration/feishu/records/${recordId}`, { fields }, { params });
  return data;
}
