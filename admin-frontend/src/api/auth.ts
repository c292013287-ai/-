import client from './client';

export interface LoginParams {
  username: string;
  password: string;
}

export interface UserInfo {
  id: number;
  username: string;
  name: string;
  role: string;
}

export interface LoginResult {
  token: string;
  user: UserInfo;
}

export async function login(params: LoginParams): Promise<LoginResult> {
  const { data } = await client.post('/auth/login', params);
  return data;
}

export async function getCurrentUser(): Promise<UserInfo> {
  const { data } = await client.get('/auth/me');
  return data;
}
