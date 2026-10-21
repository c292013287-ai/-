import axios from 'axios';
import { customerFields } from '../lib/customerFields';
import { countServedUsers } from '../lib/servedUserCount';
import type { ServedUserProgress } from '../lib/servedUserCount';
import { createHash } from 'node:crypto';

const WECOM_API_BASE = process.env.WECOM_API_BASE || 'https://qyapi.weixin.qq.com';

interface AccessTokenCache {
  [corpid: string]: {
    token: string;
    expiresAt: number;
  };
}

const tokenCache: AccessTokenCache = {};

function customerApiError(data: any, corpid: string, secret: string, baseUrl: string) {
  if ([40014, 42001].includes(data.errcode)) {
    delete tokenCache[createHash('sha256').update(JSON.stringify([baseUrl, corpid, secret])).digest('hex')];
    return new Error('企业微信连接失败（访问凭证已失效，下次请求将重新获取）');
  }
  if (data.errcode === -1) return new Error('企业微信系统繁忙（错误码 -1），请稍后重试');
  if (/cursor/i.test(String(data.errmsg || ''))) return new Error('企业微信分页游标失效，请重试当前员工');
  return new Error(`企业微信错误码 ${data.errcode}，请核对对应接口错误原因`);
}

function normalizeApiBaseUrl(apiBaseUrl?: string | null) {
  return (apiBaseUrl || WECOM_API_BASE).replace(/\/+$/, '');
}

// 获取 access_token
async function getAccessToken(corpid: string, secret: string, apiBaseUrl?: string | null): Promise<string> {
  const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const cacheKey = createHash('sha256').update(JSON.stringify([baseUrl, corpid, secret])).digest('hex');
  const cached = tokenCache[cacheKey];
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const res = await axios.get(`${baseUrl}/cgi-bin/gettoken`, {
    params: { corpid, corpsecret: secret },
    timeout: 15000,
  });

  if (res.data.errcode !== 0) {
    throw new Error(`获取 access_token 失败: ${res.data.errmsg}`);
  }

  tokenCache[cacheKey] = {
    token: res.data.access_token,
    expiresAt: Date.now() + (res.data.expires_in - 300) * 1000,
  };

  return res.data.access_token;
}

export function mapCustomerContact(contact: any, follow: any) {
  if (!contact || typeof contact.external_userid !== 'string' || !follow || typeof follow.userid !== 'string') throw new Error('客户详情数据不完整');
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  const fields = customerFields(contact, follow);
  if (Array.isArray(follow.tags)) fields.tags = follow.tags.filter((tag: any) => typeof tag.tag_id === 'string')
    .map((tag: any) => ({ id: tag.tag_id, name: text(tag.tag_name) }));
  return { ...fields, externalUserId: contact.external_userid as string, unionId: text(contact.unionid), name: text(contact.name),
    type: contact.type, company: text(contact.corp_full_name || contact.corp_name), userId: text(follow.userid),
    remark: text(follow.remark), description: text(follow.description), addedAt: typeof follow.createtime === 'number' ? follow.createtime : null };
}

async function customerGet(entity: { corpid: string; secret: string; wecomApiBaseUrl: string | null }, endpoint: string, params: Record<string, string>) {
  try {
    const base = normalizeApiBaseUrl(entity.wecomApiBaseUrl);
    const token = await getAccessToken(entity.corpid, entity.secret, base);
    const { data } = await axios.get(`${base}/cgi-bin/externalcontact/${endpoint}`, { params: { access_token: token, ...params }, timeout: 15000 });
    if (data.errcode !== 0) throw customerApiError(data, entity.corpid, entity.secret, base);
    return data;
  } catch (e) { if (axios.isAxiosError(e)) throw new Error('企业微信连接失败'); throw e; }
}

export async function getCustomerIds(entity: { corpid: string; secret: string; wecomApiBaseUrl: string | null }, userId: string) {
  let data;
  try { data = await customerGet(entity, 'list', { userid: userId }); }
  catch (e) {
    if (!/错误码 84061\b/.test(e instanceof Error ? e.message : '')) throw e;
    // Some empty employees produce 84061 on /list. Only a successful empty batch confirms it.
    const page = await getCustomerPage(entity.corpid, entity.secret, entity.wecomApiBaseUrl, userId);
    if (page.items?.length === 0 && page.nextCursor === '') return [];
    throw e;
  }
  if (!Array.isArray(data.external_userid) || !data.external_userid.every((id: any) => typeof id === 'string' && id.length)) throw new Error('客户ID列表不完整');
  return [...new Set<string>(data.external_userid)];
}

export async function getCustomerDetail(entity: { corpid: string; secret: string; wecomApiBaseUrl: string | null }, externalId: string) {
  const rows: ReturnType<typeof mapCustomerContact>[] = [];
  let cursor = ''; const seen = new Set<string>();
  do {
    const data = await customerGet(entity, 'get', { external_userid: externalId, cursor });
    if (data.external_contact?.external_userid !== externalId || !Array.isArray(data.follow_user)) throw new Error('客户详情数据不完整');
    rows.push(...data.follow_user.map((follow: any) => mapCustomerContact(data.external_contact, follow)));
    cursor = data.next_cursor || '';
    if (cursor && (typeof cursor !== 'string' || seen.has(cursor))) throw new Error('客户详情游标异常');
    seen.add(cursor);
    if (seen.size > 10000) throw new Error('客户详情页数异常');
  } while (cursor);
  return rows;
}

const employeeNamesCache = new Map<string, { expires: number; names: Record<string, string> }>();
const employeeNamesPending = new Map<string, Promise<Record<string, string>>>();

export async function getEmployeeNames(corpid: string, secret: string, apiBaseUrl?: string | null) {
  const base = normalizeApiBaseUrl(apiBaseUrl);
  const key = createHash('sha256').update(JSON.stringify([base, corpid, secret])).digest('hex');
  const cached = employeeNamesCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.names;
  const pending = employeeNamesPending.get(key);
  if (pending) return pending;
  const request = (async () => {
    try {
      const token = await getAccessToken(corpid, secret, base);
      const { data } = await axios.get(`${base}/cgi-bin/user/simplelist`, {
        params: { access_token: token, department_id: 1, fetch_child: 1 }, timeout: 15000,
      });
      if (data.errcode !== 0 || !Array.isArray(data.userlist)) throw new Error('员工名称读取失败，请检查通讯录可见范围及权限');
      const names: Record<string, string> = Object.create(null);
      for (const member of data.userlist) {
        if (typeof member.userid === 'string' && typeof member.name === 'string' && member.name.trim()) names[member.userid] = member.name.trim();
      }
      for (const [id, value] of employeeNamesCache) if (value.expires <= Date.now()) employeeNamesCache.delete(id);
      employeeNamesCache.set(key, { names, expires: Date.now() + 30 * 60 * 1000 });
      return names;
    } catch { throw new Error('员工名称读取失败，暂显示员工ID；请检查通讯录权限或稍后重试'); }
  })();
  employeeNamesPending.set(key, request);
  try { return await request; } finally { employeeNamesPending.delete(key); }
}

export async function getCustomerPage(corpid: string, secret: string, apiBaseUrl: string | null | undefined, userId?: string, cursor = '') {
  try {
    const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
    const token = await getAccessToken(corpid, secret, baseUrl);
    const options = { params: { access_token: token }, timeout: 15000 };
    const { data } = userId
      ? await axios.post(`${baseUrl}/cgi-bin/externalcontact/batch/get_by_user`, { userid_list: [userId], cursor, limit: 100 }, options)
      : await axios.get(`${baseUrl}/cgi-bin/externalcontact/get_follow_user_list`, options);
    if (data.errcode !== 0) throw customerApiError(data, corpid, secret, baseUrl);
    if (!userId) {
      if (!Array.isArray(data.follow_user) || !data.follow_user.every((id: unknown) => typeof id === 'string')) throw new Error('成员列表数据不完整');
      return { users: data.follow_user as string[] };
    }
    if (!Array.isArray(data.external_contact_list)) throw new Error('客户列表数据不完整');
    if (data.next_cursor != null && typeof data.next_cursor !== 'string') throw new Error('客户分页游标无效');
    const items = data.external_contact_list.map((item: any) => {
      return mapCustomerContact(item.external_contact, item.follow_info);
    });
    let tagWarning = '';
    if (items.some((item: { tags: unknown[] }) => item.tags.length)) {
      try {
        const { data: tagData } = await axios.post(`${baseUrl}/cgi-bin/externalcontact/get_corp_tag_list`, {}, { ...options, timeout: 5000 });
        if (tagData.errcode !== 0 || !Array.isArray(tagData.tag_group)) throw new Error('Tag lookup failed');
        const names = new Map<string, string>();
        for (const group of tagData.tag_group) {
          if (group.deleted || !Array.isArray(group.tag)) continue;
          for (const tag of group.tag) {
            if (!tag.deleted && typeof tag.id === 'string' && typeof tag.name === 'string') names.set(tag.id, tag.name);
          }
        }
        for (const item of items) for (const tag of item.tags) tag.name = names.get(tag.id) || '';
        if (items.some((item: { tags: Array<{ name: string }> }) => item.tags.some(tag => !tag.name))) tagWarning = '部分标签名称不可用，已保留标签ID';
      } catch {
        tagWarning = '标签名称获取失败，已保留标签ID';
      }
    }
    return { items, nextCursor: data.next_cursor || '', tagWarning };
  } catch (error) {
    if (axios.isAxiosError(error)) throw new Error('企业微信连接失败，请检查同步出口后重试');
    throw error;
  }
}

export async function getServedUserCount(corpid: string, secret: string, apiBaseUrl?: string | null, onProgress?: (progress: ServedUserProgress) => void) {
  try {
    const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
    return await countServedUsers(async cursor => {
      const token = await getAccessToken(corpid, secret, baseUrl);
      const { data } = await axios.post(`${baseUrl}/cgi-bin/externalcontact/contact_list`,
        { cursor, limit: 1000 }, { params: { access_token: token }, timeout: 15000 });
      return data;
    }, onProgress);
  } catch (error) {
    // Axios errors may contain access tokens in request URLs.
    if (axios.isAxiosError(error)) throw new Error('企业微信连接失败或请求超时，请检查同步出口');
    throw error;
  }
}

// 获客助手 - 获取获客链接列表
export async function getCustomerAcquisitionLinks(corpid: string, secret: string, apiBaseUrl?: string | null) {
  const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const token = await getAccessToken(corpid, secret, baseUrl);
  const res = await axios.post(
    `${baseUrl}/cgi-bin/externalcontact/customer_acquisition/list_link`,
    { limit: 100 },
    { params: { access_token: token } }
  );

  if (res.data.errcode !== 0) {
    throw new Error(`获取获客链接列表失败: ${res.data.errmsg}`);
  }

  return res.data;
}

// 获客助手 - 获取获客链接统计
export async function getLinkStatistics(
  corpid: string,
  secret: string,
  linkId: string,
  startTime: number,
  endTime: number,
  apiBaseUrl?: string | null
) {
  const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const token = await getAccessToken(corpid, secret, baseUrl);
  const res = await axios.post(
    `${baseUrl}/cgi-bin/externalcontact/customer_acquisition/statistic`,
    { link_id: linkId, start_time: startTime, end_time: endTime },
    { params: { access_token: token } }
  );

  if (res.data.errcode !== 0) {
    throw new Error(`获取统计失败: ${res.data.errmsg}`);
  }

  return res.data;
}

// 获客助手 - 获取获客链接详情及余额
export async function getLinkDetail(corpid: string, secret: string, linkId: string, apiBaseUrl?: string | null) {
  const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const token = await getAccessToken(corpid, secret, baseUrl);
  const res = await axios.post(
    `${baseUrl}/cgi-bin/externalcontact/customer_acquisition/get`,
    { link_id: linkId },
    { params: { access_token: token } }
  );

  if (res.data.errcode !== 0) {
    throw new Error(`获取链接详情失败: ${res.data.errmsg}`);
  }

  return res.data;
}

// 获客助手 - 获取配额信息（企业级别，不依赖获客链接）
export async function getQuotaInfo(corpid: string, secret: string, apiBaseUrl?: string | null): Promise<{
  total: number;
  balance: number;
  quotaList: Array<{ expireDate: number; balance: number }>;
}> {
  const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const token = await getAccessToken(corpid, secret, baseUrl);
  const res = await axios.post(
    `${baseUrl}/cgi-bin/externalcontact/customer_acquisition_quota`,
    {},
    { params: { access_token: token } }
  );

  if (res.data.errcode !== 0) {
    throw new Error(`获取配额失败: ${res.data.errmsg}`);
  }

  return {
    total: res.data.total,
    balance: res.data.balance,
    quotaList: res.data.quota_list || [],
  };
}

// 客户联系 - 获取当前应用可见范围内的主体成员总数
export async function getEntityUserCount(corpid: string, secret: string, apiBaseUrl?: string | null): Promise<number> {
  const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const token = await getAccessToken(corpid, secret, baseUrl);
  const res = await axios.get(
    `${baseUrl}/cgi-bin/externalcontact/get_follow_user_list`,
    { params: { access_token: token } },
  );

  if (res.data.errcode !== 0) {
    throw new Error(`获取主体用户总数失败: ${res.data.errmsg}`);
  }

  return new Set<string>(res.data.follow_user || []).size;
}

// 获客助手 - 获取剩余使用量 (仅返回配额余额)
export async function getQuotaBalance(corpid: string, secret: string, apiBaseUrl?: string | null): Promise<{
  total: number;
  balance: number;
  links: Array<{ link_id: string; link_name: string; balance: number }>;
}> {
  const linkListRes = await getCustomerAcquisitionLinks(corpid, secret, apiBaseUrl);
  const links = linkListRes.link_list || [];
  
  let totalBalance = 0;
  const linkDetails = [];

  for (const link of links) {
    try {
      const detail = await getLinkDetail(corpid, secret, link.link_id, apiBaseUrl);
      const balance = detail.range?.user_list?.length || 0;
      totalBalance += balance;
      linkDetails.push({
        link_id: link.link_id,
        link_name: link.link_name,
        balance,
      });
    } catch {
      // 单个链接获取失败不影响整体
    }
  }

  return {
    total: links.length,
    balance: totalBalance,
    links: linkDetails,
  };
}
