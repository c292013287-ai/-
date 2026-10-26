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
  userCount: number;
  lastSyncAt: string | null;
  certificationExpiresAt?: string | null;
  servedUserCount?: number | null;
  servedUserCountUpdatedAt?: string | null;
  externalContactCapacity?: number | null;
  externalContactValidFrom?: string | null;
  externalContactValidUntil?: string | null;
  externalContactForecast?: ExternalContactForecast;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalContactForecast {
  status: 'unconfigured' | 'unmeasured' | 'stale' | 'limit_reached' | 'insufficient_history' | 'not_growing' | 'forecast' | 'out_of_range';
  capacity: number | null;
  remaining: number | null;
  dailyNetGrowth: number | null;
  estimatedPurchaseDate: string | null;
}

export interface EntityFormData {
  certificationExpiresAt?: string | null;
  externalContactCapacity?: number | null;
  externalContactValidFrom?: string | null;
  externalContactValidUntil?: string | null;
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

export interface Customer {
  avatar?: string;
  gender?: number;
  remarkMobiles?: string[];
  tags?: Array<{ id: string; name: string }>;
  addWay?: number | null;
  state?: string;
  externalUserId: string;
  unionId?: string;
  name: string;
  type: number;
  company: string;
  userId: string;
  remark: string;
  description: string;
  addedAt: number | null;
}

export async function getCustomerFollowers(id: number): Promise<string[]> {
  const { data } = await client.get(`/entities/${id}/customers`, { headers: entityAccessHeaders() });
  return data.users;
}

export async function getEmployeeNames(id: number, signal?: AbortSignal): Promise<Record<string, string>> {
  return (await client.get(`/entities/${id}/employee-names`, { headers: entityAccessHeaders(), signal })).data.names;
}

export async function getCustomers(id: number, userId: string, cursor: string, signal?: AbortSignal): Promise<{ items: Customer[]; nextCursor: string; tagWarning?: string }> {
  const { data } = await client.get(`/entities/${id}/customers`, { params: { userId, cursor }, headers: entityAccessHeaders(), signal });
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
  result?: { servedUserCount: number; servedUserCountUpdatedAt: string; externalContactForecast?: ExternalContactForecast };
}

export interface CustomerSyncJob {
  message?: string;
  entityId: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  employees: number;
  totalEmployees: number;
  pages: number;
  records: number;
  startedAt: string;
  finishedAt?: string;
  updatedAt?: string;
  error?: string;
}
export interface CustomerServerSnapshot {
  revision?: string;
  fullUpdatedAt?: string;
  mode?: 'incremental';
  items: Customer[];
  users: string[];
  warning: string;
  updatedAt: string;
  total: number;
  count: number;
  tags: Array<{ id: string; name: string }>;
  sources: number[];
}
export interface CustomerLiveStatus {
  enabled: boolean; ready?: boolean; importRows?: number; incrementAt?: number | null;
  eventAt?: number | null; revision?: string; employees?: number; checked?: number;
  failed?: number; pending?: number; oldestCheckAt?: number | null; latestCheckAt?: number | null;
  error?: string; callbackPrepared?: boolean;
}
export async function getCustomerLiveStatus(id: number, signal?: AbortSignal): Promise<CustomerLiveStatus> {
  return (await client.get(`/entities/${id}/customers/live-status`, { headers: entityAccessHeaders(), signal })).data;
}
export async function getCustomerSnapshot(id: number, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<CustomerServerSnapshot | null> {
  return (await client.get(`/entities/${id}/customers/snapshot`, { headers: entityAccessHeaders(), params, signal })).data;
}
export async function downloadCustomerCsv(id: number, params: Record<string, unknown>) {
  return (await client.get(`/entities/${id}/customers/export`, { headers: entityAccessHeaders(), params, responseType: 'blob', timeout: 300000 })).data as Blob;
}
export async function getCustomerSyncJobs(): Promise<CustomerSyncJob[]> {
  return (await client.get('/entities/customers/jobs', { headers: entityAccessHeaders() })).data;
}
export async function startCustomerSync(entityId?: number): Promise<CustomerSyncJob[]> {
  return (await client.post('/entities/customers/sync', { entityId }, { headers: entityAccessHeaders() })).data;
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
  userCount?: number;
  consumption: number;
  quotaList: Array<{ expireDate: number; balance: number }>;
}

export async function syncEntity(id: number): Promise<SyncResult> {
  const { data } = await client.post(`/entities/${id}/sync`);
  return data;
}
