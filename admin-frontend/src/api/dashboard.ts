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

export interface BudgetRow {
  id: number;
  name: string;
  sku: string | null;
  monthlyBudget: number;
  actualRecharge: number;
  actualConsumption: number;
  avg7dConsumption: number;
  countdownDays: number;
  status: string;
  quotaBalance: number;
  lastSyncAt: string | null;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const { data } = await client.get('/dashboard/stats');
  return data;
}

export interface BudgetSummary {
  todayConsumption: number;
}

export interface BudgetResponse {
  rows: BudgetRow[];
  summary: BudgetSummary;
}

export async function getBudgetList(params?: { entityId?: number; yearMonth?: string }): Promise<BudgetResponse> {
  const { data } = await client.get('/dashboard/budget', { params });
  return data;
}
