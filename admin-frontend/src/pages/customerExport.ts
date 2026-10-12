import * as XLSX from 'xlsx';
import type { Customer } from '../api/entities';
import type { CustomerFilters } from './customerQuery';

interface ExportContext {
  entityName: string;
  scope: string;
  updatedAt: string;
  filters: CustomerFilters;
  sourceLabel: (value: number | null | undefined) => string;
}

function dateText(value: string | number) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

export function buildCustomerWorkbook(customers: Customer[], context: ExportContext) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['序号', '主体', '头像链接', '客户名称', '性别', '客户备注', '备注手机号', '客户标签', '标签ID', '添加来源', '添加来源代码', '渠道标记', '类型', '企业', '员工ID', '添加时间', '描述', 'external_userid', 'unionid'],
    ...customers.map((customer, index) => [
      index + 1, context.entityName, customer.avatar || '', customer.name || '',
      customer.gender === 1 ? '男' : customer.gender === 2 ? '女' : '未知',
      customer.remark || '', (customer.remarkMobiles || []).join('\n'),
      (customer.tags || []).map(tag => tag.name || tag.id).join('\n'),
      (customer.tags || []).map(tag => tag.id).join('\n'), context.sourceLabel(customer.addWay),
      customer.addWay ?? '', customer.state || '', customer.type === 1 ? '微信客户' : customer.type === 2 ? '企业微信客户' : '未知',
      customer.company || '', customer.userId, customer.addedAt == null ? '' : dateText(customer.addedAt * 1000),
      customer.description || '', customer.externalUserId, customer.unionId || '未获取',
    ]),
  ]);
  sheet['!cols'] = [8, 28, 36, 24, 8, 28, 20, 28, 32, 20, 16, 24, 18, 30, 26, 24, 36, 40, 40].map(wch => ({ wch }));
  sheet['!autofilter'] = { ref: sheet['!ref']! };
  const labels: Record<keyof CustomerFilters, string> = {
    name: '客户名称', remark: '客户备注', phone: '备注手机号', externalUserId: 'external_userid', unionId: 'unionid',
    state: '渠道标记', gender: '性别', type: '客户类型', tagId: '客户标签ID', addWay: '添加来源',
    unionStatus: 'unionid 状态', startDate: '添加起始日期（北京时间）', endDate: '添加结束日期（含当日）',
  };
  const filters = Object.entries(context.filters).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => {
    let display = String(value);
    if (key === 'gender') display = value === 1 ? '男' : value === 2 ? '女' : '未知';
    if (key === 'type') display = value === 1 ? '微信客户' : '企业微信客户';
    if (key === 'addWay') display = `${context.sourceLabel(Number(value))} (${value})`;
    if (key === 'unionStatus') display = value === 'present' ? '已获取' : '未获取';
    return [labels[key as keyof CustomerFilters], display];
  });
  const info = XLSX.utils.aoa_to_sheet([
    ['项目', '内容'], ['主体', context.entityName], ['查询范围', context.scope],
    ['数据更新时间（北京时间）', dateText(context.updatedAt)], ['导出时间（北京时间）', dateText(Date.now())],
    ['导出客户跟进关系数', customers.length], ['统计口径', '同一客户由不同员工跟进时分别保留；导出全部筛选结果，不受页面分页限制'],
    ...(filters.length ? filters : [['筛选条件', '无']]),
  ]);
  info['!cols'] = [{ wch: 32 }, { wch: 80 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '客户数据');
  XLSX.utils.book_append_sheet(workbook, info, '导出信息');
  return workbook;
}
