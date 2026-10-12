import type { Customer } from '../api/entities';

export interface CustomerFilters {
  name?: string; remark?: string; phone?: string; externalUserId?: string; unionId?: string;
  state?: string; gender?: number; type?: number; tagId?: string; addWay?: number;
  unionStatus?: 'present' | 'missing'; startDate?: string; endDate?: string;
}

export function matchesCustomer(customer: Customer, filters: CustomerFilters) {
  const contains = (value: string | undefined, query: string | undefined) => !query?.trim()
    || (value || '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  if (!contains(customer.name, filters.name) || !contains(customer.remark, filters.remark)
    || !contains(customer.externalUserId, filters.externalUserId) || !contains(customer.unionId, filters.unionId)
    || !contains(customer.state, filters.state)) return false;
  if (filters.phone?.trim() && !(customer.remarkMobiles || []).some(phone => contains(phone, filters.phone))) return false;
  if (filters.gender !== undefined && (customer.gender ?? 0) !== filters.gender) return false;
  if (filters.type !== undefined && customer.type !== filters.type) return false;
  if (filters.addWay !== undefined && customer.addWay !== filters.addWay) return false;
  if (filters.tagId && !customer.tags?.some(tag => tag.id === filters.tagId)) return false;
  const hasUnionId = !!customer.unionId?.trim();
  if (filters.unionStatus === 'present' && !hasUnionId || filters.unionStatus === 'missing' && hasUnionId) return false;
  if (filters.startDate || filters.endDate) {
    if (customer.addedAt == null || !Number.isFinite(customer.addedAt)) return false;
    const time = customer.addedAt * 1000;
    if (filters.startDate && time < Date.parse(`${filters.startDate}T00:00:00+08:00`)) return false;
    if (filters.endDate && time >= Date.parse(`${filters.endDate}T00:00:00+08:00`) + 86400000) return false;
  }
  return true;
}

export interface CustomerQueryProgress { employees: number; totalEmployees: number; pages: number; records: number }

export async function collectCustomers(
  users: string[],
  fetchPage: (userId: string, cursor: string) => Promise<{ items: Customer[]; nextCursor: string; tagWarning?: string }>,
  signal: AbortSignal,
  onProgress: (progress: CustomerQueryProgress) => void,
) {
  const records = new Map<string, Customer>();
  const warnings = new Set<string>();
  const distinctUsers = [...new Set(users)];
  let pages = 0;
  let employees = 0;
  for (const userId of distinctUsers) {
    let cursor = '';
    const seen = new Set<string>();
    do {
      signal.throwIfAborted();
      const page = await fetchPage(userId, cursor);
      signal.throwIfAborted();
      for (const item of page.items) records.set(JSON.stringify([item.externalUserId, item.userId]), item);
      if (page.tagWarning) warnings.add(page.tagWarning);
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error('客户分页游标重复，查询未完成，请重试');
      seen.add(cursor);
      pages++;
      onProgress({ employees: employees + (cursor ? 0 : 1), totalEmployees: distinctUsers.length, pages, records: records.size });
    } while (cursor);
    employees++;
  }
  return { items: [...records.values()], warning: [...warnings].join('；') };
}

export function customerSource(value: number | null | undefined) {
  return value == null ? '未获取' : ({ 0: '未知', 1: '扫描二维码', 2: '搜索手机号', 3: '名片分享', 4: '群聊' } as Record<number, string>)[value] || `来源代码 ${value}`;
}
