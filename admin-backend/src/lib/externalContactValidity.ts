function parseTimestamp(value: unknown): Date {
  const error = '外部联系人有效时间无效，请重新选择';
  if (typeof value !== 'string') throw new Error(error);
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{3})?(Z|\+08:00)$/.exec(value);
  if (!match) throw new Error(error);
  const wallTime = `${match[1]}${match[2] || '.000'}Z`;
  const wallDate = new Date(wallTime);
  if (!Number.isFinite(wallDate.getTime()) || wallDate.toISOString() !== wallTime || wallTime < '1000-01-01') {
    throw new Error(error);
  }
  const date = new Date(value);
  if (date.toISOString() < '1000-01-01') throw new Error(error);
  return date;
}

export function parseExternalContactValidity(from: unknown, until: unknown): {
  externalContactValidFrom?: Date | null;
  externalContactValidUntil?: Date | null;
} {
  if (from === undefined && until === undefined) return {};
  const fromEmpty = from === null || from === '';
  const untilEmpty = until === null || until === '';
  if (fromEmpty && untilEmpty) return { externalContactValidFrom: null, externalContactValidUntil: null };
  if (from === undefined || until === undefined || fromEmpty || untilEmpty) {
    throw new Error('请同时填写外部联系人有效期的开始和截止时间，或同时清空');
  }
  const start = parseTimestamp(from);
  const end = parseTimestamp(until);
  if (end.getTime() <= start.getTime()) throw new Error('外部联系人有效期截止时间须晚于开始时间');
  return { externalContactValidFrom: start, externalContactValidUntil: end };
}
