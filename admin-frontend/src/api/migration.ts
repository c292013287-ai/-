import client from './client';

export interface FeishuRecord {
  recordId: string;
  createdTime?: number;
  fields: Record<string, string>;
}

export async function getFeishuMigrationRecords(params: { appToken: string; tableId: string; viewId?: string }) {
  const { data } = await client.get<{ records: FeishuRecord[] }>('/migration/feishu/records', { params });
  return data.records;
}

export async function updateFeishuMigrationRecord(
  recordId: string,
  params: { appToken: string; tableId: string },
  fields: Record<string, string | number>,
) {
  const { data } = await client.patch<{ success: boolean }>(`/migration/feishu/records/${recordId}`, { fields }, { params });
  return data;
}
