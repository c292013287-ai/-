/**
 * 日期工具函数
 */

/** 将 Date 转为 YYYY-MM-DD 字符串（用于匹配/分组） */
export function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 将 YYYY-MM-DD 字符串转为本地零点 Date（避免 UTC 时区偏移） */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 将 Date 归零到当天 00:00:00（本地时区） */
export function startOfDay(d?: Date): Date {
  const t = d || new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

/** N 天前的零点 */
export function daysAgo(n: number): Date {
  const d = startOfDay();
  d.setDate(d.getDate() - n);
  return d;
}

/** 解析日期时间字符串 */
export function parseDateTime(s: string): Date {
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, m - 1, day);
}
