import client from './client';

export interface WecomEntity {
  id: number;
  name: string;
  corpid: string;
  secret: string;
  status: string;
  quotaTotal: number;
  quotaBalance: number;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EntityFormData {
  name: string;
  corpid: string;
  secret: string;
  quotaTotal?: number;
}

export async function getEntities(): Promise<WecomEntity[]> {
  const { data } = await client.get('/entities');
  return data;
}

export async function getEntity(id: number): Promise<WecomEntity> {
  const { data } = await client.get(`/entities/${id}`);
  return data;
}

export async function createEntity(form: EntityFormData): Promise<WecomEntity> {
  const { data } = await client.post('/entities', form);
  return data;
}

export async function updateEntity(id: number, form: Partial<EntityFormData & { status: string }>): Promise<WecomEntity> {
  const { data } = await client.put(`/entities/${id}`, form);
  return data;
}

export async function deleteEntity(id: number): Promise<void> {
  await client.delete(`/entities/${id}`);
}
