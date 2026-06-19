import client from './client';

export interface ConsumptionRecord {
  id: number;
  entityId: number;
  date: string;
  consumption: number;
  calls: number;
  quotaBalance: number;
  entity: { id: number; name: string; quotaBalance?: number; sku?: string | null };
}

export interface ConsumptionListResult {
  data: ConsumptionRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getConsumptionList(params: {
  entityId?: number;
  sku?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}): Promise<ConsumptionListResult> {
  const { data } = await client.get('/consumption', { params });
  return data;
}

export async function updateConsumption(id: number, body: { quotaBalance?: number; consumption?: number }): Promise<{ success: boolean }> {
  const { data } = await client.put(`/consumption/${id}`, body);
  return data;
}

export async function createConsumption(body: { entityId: number; date: string; consumption?: number; quotaBalance?: number }): Promise<ConsumptionRecord> {
  const { data } = await client.post('/consumption', body);
  return data;
}

export async function deleteConsumption(id: number): Promise<{ success: boolean }> {
  const { data } = await client.delete(`/consumption/${id}`);
  return data;
}

export interface TrendItem {
  date: string;
  consumption: number;
  entity?: { name: string; sku?: string | null };
}

export async function getConsumptionTrend(params: {
  entityId?: number;
  sku?: string;
  days?: number;
}): Promise<TrendItem[]> {
  const { data } = await client.get('/consumption/trend', { params });
  return data;
}
