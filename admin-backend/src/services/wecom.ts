import axios from 'axios';

const WECOM_API_BASE = process.env.WECOM_API_BASE || 'https://qyapi.weixin.qq.com';

interface AccessTokenCache {
  [corpid: string]: {
    token: string;
    expiresAt: number;
  };
}

const tokenCache: AccessTokenCache = {};

function normalizeApiBaseUrl(apiBaseUrl?: string | null) {
  return (apiBaseUrl || WECOM_API_BASE).replace(/\/+$/, '');
}

// 获取 access_token
async function getAccessToken(corpid: string, secret: string, apiBaseUrl?: string | null): Promise<string> {
  const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const cacheKey = `${baseUrl}::${corpid}`;
  const cached = tokenCache[cacheKey];
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const res = await axios.get(`${baseUrl}/cgi-bin/gettoken`, {
    params: { corpid, corpsecret: secret },
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
