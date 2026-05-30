import client from './client';

export interface EntityRanking {
  id: number;
  name: string;
  quotaTotal: number;
  quotaBalance: number;
  totalConsumption: number;
}

export interface DashboardStats {
  entityCount: number;
  activeEntityCount: number;
  todayConsumption: number;
  todayCalls: number;
  totalConsumption: number;
  totalCalls: number;
  entityRanking: EntityRanking[];
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const { data } = await client.get('/dashboard/stats');
  return data;
}
