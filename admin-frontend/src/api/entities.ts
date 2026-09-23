import client from './client';

export interface WecomEntity {
  id: number;
  name: string;
  sku: string | null;
  rechargeAmount: number;
  monthlyBudget: number;
  corpid?: string;
  secret?: string;
  wecomApiBaseUrl?: string | null;
  status: string;
  quotaTotal: number;
  quotaBalance: number;
  lastSyncAt: string | null;
  certificationExpiresAt?: string | null;
  servedUserCount?: number | null;
  servedUserCountUpdatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EntityFormData {
  certificationExpiresAt?: string | null;
  name: string;
  sku?: string;
  rechargeAmount?: number;
  monthlyBudget?: number;
  corpid: string;
  secret: string;
  wecomApiBaseUrl?: string;
  quotaTotal?: number;
}

export async function getEntities(): Promise<WecomEntity[]> {
  const { data } = await client.get('/entities');
  return data;
}

export async function getEntity(id: number): Promise<WecomEntity> {
  const { data } = await client.get(`/entities/${id}`, { headers: entityAccessHeaders() });
  return data;
}

const ENTITY_ACCESS_TOKEN_KEY = 'entity_access_token';

function entityAccessHeaders() {
  const accessToken = sessionStorage.getItem(ENTITY_ACCESS_TOKEN_KEY);
  return accessToken ? { 'X-Entity-Access-Token': accessToken } : {};
}

export function getEntityAccessToken() {
  return sessionStorage.getItem(ENTITY_ACCESS_TOKEN_KEY);
}

export function clearEntityAccessToken() {
  sessionStorage.removeItem(ENTITY_ACCESS_TOKEN_KEY);
}

export async function unlockEntityManagement(credentials: { username: string; password: string }) {
  const { data } = await client.post<{ accessToken: string; expiresIn: number }>('/entities/access', credentials);
  sessionStorage.setItem(ENTITY_ACCESS_TOKEN_KEY, data.accessToken);
  return data;
}

export async function checkEntityManagementAccess(): Promise<boolean> {
  if (!getEntityAccessToken()) return false;
  try {
    await client.get('/entities/access', { headers: entityAccessHeaders() });
    return true;
  } catch {
    clearEntityAccessToken();
    return false;
  }
}

export async function getManagedEntities(): Promise<WecomEntity[]> {
  const { data } = await client.get('/entities/manage', { headers: entityAccessHeaders() });
  return data;
}

export interface ServedUserJob {
  entityId: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  pages: number;
  rows: number;
  uniqueUsers: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  result?: { servedUserCount: number; servedUserCountUpdatedAt: string };
}

export async function getServedUserJobs(): Promise<ServedUserJob[]> {
  const { data } = await client.get('/entities/served-users/jobs', { headers: entityAccessHeaders() });
  return data;
}

export async function syncServedUsers(id: number) {
  const { data } = await client.post<ServedUserJob>(
    `/entities/${id}/served-users/sync`, undefined, { headers: entityAccessHeaders() },
  );
  return data;
}

export async function createEntity(form: EntityFormData): Promise<WecomEntity> {
  const { data } = await client.post('/entities', form, { headers: entityAccessHeaders() });
  return data;
}

export async function updateEntity(id: number, form: Partial<EntityFormData & { status: string }>): Promise<WecomEntity> {
  const { data } = await client.put(`/entities/${id}`, form, { headers: entityAccessHeaders() });
  return data;
}

export async function deleteEntity(id: number): Promise<void> {
  await client.delete(`/entities/${id}`, { headers: entityAccessHeaders() });
}

export interface SyncResult {
  success: boolean;
  quotaTotal: number;
  quotaBalance: number;
  consumption: number;
  quotaList: Array<{ expireDate: number; balance: number }>;
}

export async function syncEntity(id: number): Promise<SyncResult> {
  const { data } = await client.post(`/entities/${id}/sync`);
  return data;
}
