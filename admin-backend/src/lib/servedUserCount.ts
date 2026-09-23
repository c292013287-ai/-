interface ContactPage {
  errcode: number;
  info_list?: Array<{ tmp_openid?: string }>;
  next_cursor?: string;
}

export interface ServedUserProgress { pages: number; rows: number; uniqueUsers: number }

export async function countServedUsers(
  fetchPage: (cursor: string) => Promise<ContactPage>,
  onProgress?: (progress: ServedUserProgress) => void,
) {
  const users = new Set<string>();
  const cursors = new Set<string>();
  const started = Date.now();
  let cursor = '';
  let pages = 0;
  let rows = 0;
  do {
    // Temporary contact IDs/cursors expire after four hours; never resume an old traversal.
    if (Date.now() - started > 3 * 60 * 60 * 1000) throw new Error('统计超过3小时，请重新发起');
    const page = await fetchPage(cursor);
    if (page.errcode !== 0) {
      throw new Error(`企业微信错误码 ${page.errcode}，请检查客户联系应用权限及可信 IP`);
    }
    if (!Array.isArray(page.info_list)) throw new Error('企业微信返回数据不完整，未更新统计');
    for (const item of page.info_list) {
      if (typeof item.tmp_openid !== 'string' || !item.tmp_openid.trim()) {
        throw new Error('缺少外部联系人唯一标识，未更新统计');
      }
      users.add(item.tmp_openid);
    }
    if (page.next_cursor != null && typeof page.next_cursor !== 'string') throw new Error('分页游标无效');
    cursor = page.next_cursor || '';
    if (cursor && cursors.has(cursor)) throw new Error('分页游标重复，未更新统计');
    cursors.add(cursor);
    pages += 1;
    rows += page.info_list.length;
    onProgress?.({ pages, rows, uniqueUsers: users.size });
  } while (cursor);
  return users.size;
}
