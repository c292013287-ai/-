export function certificationStatus(value?: string | null, now = new Date()) {
  if (!value) return { days: null, label: '未录入', color: 'default' };
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const days = Math.round((Date.parse(value.slice(0, 10)) - Date.parse(today)) / 86400000);
  if (!Number.isFinite(days)) return { days: null, label: '日期无效', color: 'default' };
  if (days < 0) return { days, label: `已过期 ${-days} 天`, color: 'red' };
  if (days === 0) return { days, label: '今日到期', color: 'red' };
  if (days <= 7) return { days, label: `紧急 · 剩余 ${days} 天`, color: 'red' };
  if (days <= 30) return { days, label: `临近到期 · 剩余 ${days} 天`, color: 'orange' };
  return { days, label: `剩余 ${days} 天`, color: 'green' };
}
