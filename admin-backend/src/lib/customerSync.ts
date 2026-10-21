export interface CustomerRow { externalUserId: string; userId: string; [key: string]: unknown }
export interface CustomerProgress { employees: number; totalEmployees: number; pages: number; records: number }

export async function collectCustomerSnapshot(
  users: string[],
  fetchPage: (user: string, cursor: string) => Promise<{ items: CustomerRow[]; nextCursor: string; tagWarning?: string }>,
  progress: (value: CustomerProgress) => void,
  deadline = Date.now() + 3 * 60 * 60 * 1000,
  sink?: (items: CustomerRow[]) => Promise<void>,
) {
  const records = new Map<string, CustomerRow>();
  const warnings = new Set<string>();
  const employees = [...new Set(users)];
  let pages = 0;
  let count = 0;
  progress({ employees: 0, totalEmployees: employees.length, pages, records: 0 });
  for (let index = 0; index < employees.length; index++) {
    const identifiers = new Set<string>();
    let cursor = '';
    const seen = new Set<string>();
    do {
      if (Date.now() >= deadline) throw new Error('同步超过三小时，请重试');
      const page = await fetchPage(employees[index], cursor);
      const fresh: CustomerRow[] = [];
      for (const item of page.items) {
        if (!item.externalUserId || !item.userId) throw new Error('客户标识或员工ID不完整');
        if (item.userId !== employees[index]) throw new Error('客户员工ID与查询员工不一致');
        const key = JSON.stringify([item.externalUserId, item.userId]);
        if (!identifiers.has(key)) { identifiers.add(key); fresh.push(item); count++; }
        if (!sink) records.set(key, item);
      }
      if (sink) await sink(fresh);
      if (page.tagWarning) warnings.add(page.tagWarning);
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error('分页游标重复，未覆盖旧数据');
      seen.add(cursor);
      progress({ employees: index + (cursor ? 0 : 1), totalEmployees: employees.length, pages: ++pages, records: count });
    } while (cursor);
  }
  return { items: [...records.values()], users: employees, warning: [...warnings].join('；'), updatedAt: new Date().toISOString() };
}
