/**
 * 日期工具函数
 */

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 将 Date 转为 YYYY-MM-DD 字符串（用于匹配/分组） */
export function fmtDate(d: Date): string {
  const shifted = new Date(d.getTime() + SHANGHAI_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 将 YYYY-MM-DD 字符串转为北京时间零点对应的 Date */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - SHANGHAI_OFFSET_MS);
}

/** 将 Date 归零到当天北京时间 00:00:00 */
export function startOfDay(d?: Date): Date {
  return parseDate(fmtDate(d || new Date()));
}

/** 获取北京时间自然日的起止时间 */
export function dayRange(d: Date): { start: Date; end: Date } {
  const start = startOfDay(d);
  return { start, end: new Date(start.getTime() + DAY_MS - 1) };
}

/** N 天前的零点 */
export function daysAgo(n: number): Date {
  const d = startOfDay();
  return new Date(d.getTime() - n * DAY_MS);
}

/** 解析日期时间字符串 */
export function parseDateTime(s: string): Date {
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, m - 1, day);
}
