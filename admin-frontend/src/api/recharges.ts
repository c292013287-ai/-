import client from './client';

export interface RechargeRecord {
  id: number; entityId: number; amount: number; rechargeDate: string;
  rechargeType: string; method: string; orderNumber: string | null; feeAmount: number | null;
  remark: string | null;
  entity: { id: number; name: string; sku?: string | null; corpid?: string };
  createdAt: string;
}

export interface RechargeListResult {
  data: RechargeRecord[]; total: number; page: number; pageSize: number; monthlyTotal: number;
}

export async function getRecharges(params: {
  entityId?: number; rechargeType?: string; startDate?: string; endDate?: string; page?: number; pageSize?: number;
}): Promise<RechargeListResult> {
  const { data } = await client.get('/recharges', { params });
  return data;
}

export async function createRecharge(body: {
  entityId: number; amount: number; rechargeType?: string; rechargeDate: string; method?: string;
  orderNumber?: string; feeAmount?: number; remark?: string;
}): Promise<RechargeRecord> {
  const { data } = await client.post('/recharges', body);
  return data;
}

export async function updateRecharge(id: number, body: {
  amount?: number; rechargeType?: string; rechargeDate?: string; method?: string;
  orderNumber?: string; feeAmount?: number; remark?: string;
}): Promise<RechargeRecord> {
  const { data } = await client.put(`/recharges/${id}`, body);
  return data;
}

export async function deleteRecharge(id: number): Promise<{ success: boolean }> {
  const { data } = await client.delete(`/recharges/${id}`);
  return data;
}
