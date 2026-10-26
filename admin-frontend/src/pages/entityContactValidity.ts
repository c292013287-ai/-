import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { WecomEntity } from '../api/entities';

dayjs.extend(utc);

export function contactValidityInput(value?: string | null) {
  const date = value ? dayjs(value) : null;
  return date?.isValid() ? date.utcOffset(8) : null;
}

export function contactValidityTimestamp(value?: Dayjs | null) {
  // Picker wall times always represent Beijing time, regardless of the browser's timezone.
  return value?.format('YYYY-MM-DDTHH:mm:00[+08:00]') || null;
}

export function contactValidityDisplay(entity: WecomEntity, now = new Date()) {
  const from = contactValidityInput(entity.externalContactValidFrom);
  const until = contactValidityInput(entity.externalContactValidUntil);
  if (!from || !until || until.valueOf() <= from.valueOf()) {
    return { from: '', until: '', label: '未录入', status: '', color: undefined, sortTime: Number.MAX_SAFE_INTEGER };
  }
  const start = from.format('YYYY/MM/DD HH:mm');
  const end = until.format('YYYY/MM/DD HH:mm');
  const expired = now.getTime() >= until.valueOf();
  return {
    from: start, until: end, label: `自 ${start} 续期至 ${end}`,
    status: expired ? '已到期' : now.getTime() < from.valueOf() ? '未生效' : '有效',
    color: expired ? '#cf1322' : undefined,
    sortTime: until.valueOf(),
  };
}
