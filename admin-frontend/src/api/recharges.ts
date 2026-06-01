import client from './client';

export interface RechargeRecord {
  id: number; entityId: number; amount: number; rechargeDate: string;
  method: string; remark: string | null;
  entity: { id: number; name: string; sku?: string | null };
  createdAt: string;
}

export interface RechargeListResult {
  data: RechargeRecord[]; total: number; page: number; pageSize: number; monthlyTotal: number;
}

export async function getRecharges(params: {
  entityId?: number; startDate?: string; endDate?: string; page?: number; pageSize?: number;
}): Promise<RechargeListResult> {
  const { data } = await client.get('/recharges', { params });
  return data;
}

export async function createRecharge(body: {
  entityId: number; amount: number; rechargeDate: string; method?: string; remark?: string;
}): Promise<RechargeRecord> {
  const { data } = await client.post('/recharges', body);
  return data;
}

export async function updateRecharge(id: number, body: {
  amount?: number; rechargeDate?: string; method?: string; remark?: string;
}): Promise<RechargeRecord> {
  const { data } = await client.put(`/recharges/${id}`, body);
  return data;
}

export async function deleteRecharge(id: number): Promise<{ success: boolean }> {
  const { data } = await client.delete(`/recharges/${id}`);
  return data;
}
