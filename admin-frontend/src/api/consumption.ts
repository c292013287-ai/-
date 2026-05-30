import client from './client';

export interface ConsumptionRecord {
  id: number;
  entityId: number;
  date: string;
  consumption: number;
  calls: number;
  entity: { id: number; name: string };
}

export interface ConsumptionListResult {
  data: ConsumptionRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TrendItem {
  date: string;
  consumption: number;
  calls: number;
  entity: { name: string };
}

export async function getConsumptionList(params: {
  entityId?: number;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}): Promise<ConsumptionListResult> {
  const { data } = await client.get('/consumption', { params });
  return data;
}

export async function getConsumptionTrend(params: {
  entityId?: number;
  days?: number;
}): Promise<TrendItem[]> {
  const { data } = await client.get('/consumption/trend', { params });
  return data;
}
