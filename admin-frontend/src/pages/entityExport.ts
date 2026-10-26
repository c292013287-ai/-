import * as XLSX from 'xlsx';
import type { WecomEntity } from '../api/entities';
import { contactForecastDisplay } from './entityContactForecast';
import { contactValidityDisplay } from './entityContactValidity';

function formatTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', hour12: false,
  });
}

export function buildEntityWorkbook(entities: WecomEntity[], now = new Date()) {
  // Explicit columns keep credentials and unfinished job counts out of downloads.
  const rows = entities.map((entity, index) => {
    const forecast = contactForecastDisplay(entity, now);
    return [
      index + 1, entity.sku || '', entity.name, entity.corpid || '',
      entity.wecomApiBaseUrl || '默认出口', entity.status === 'active' ? '启用' : '停用',
      entity.quotaBalance, formatTime(entity.lastSyncAt),
      entity.certificationExpiresAt?.slice(0, 10) || '',
      entity.servedUserCount ?? '未统计', contactValidityDisplay(entity, now).label,
      forecast.label, formatTime(entity.servedUserCountUpdatedAt),
    ];
  });
  const sheet = XLSX.utils.aoa_to_sheet([
    ['序号', 'SKU', '主体名称', '企业ID', '同步出口', '状态', '获客助手余额', '获客助手同步时间', '企业微信主体认证到期日期', '去重已服务人数', '外部联系人有效时长', '外部联系人规模预计增购时间', '服务人数统计更新时间'],
    ...rows,
  ]);
  sheet['!cols'] = [8, 14, 32, 26, 32, 10, 18, 24, 32, 22, 60, 36, 30].map(wch => ({ wch }));
  sheet['!autofilter'] = { ref: sheet['!ref']! };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '主体管理');
  return workbook;
}
