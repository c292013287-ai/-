import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import type { FeishuRecord } from '../api/migration';

export const MIGRATION_STORAGE_KEY = 'resource-admin-user-migration-records';
export const FEISHU_FORM_LINK_KEY = 'resource-admin-user-migration-feishu-form-link';
export const FEISHU_FORM_CONFIG_KEY = 'resource-admin-user-migration-feishu-form-config';
export const MANUAL_MIGRATION_FIELD_KEYS = ['转量数量', '处理人'];

export type MigrationCategory = '高价值' | '活跃用户' | '沉默用户' | '待确认';
export type MigrationStatus = '待采集' | '已采集' | '迁移中' | '已完成';
export type MigrationChannel = '企微' | '公众号' | '社群' | '线下' | '其他';

export interface MigrationRecord {
  id: number;
  name: string;
  phone: string;
  channel: MigrationChannel;
  sourceGroup: string;
  targetGroup: string;
  category: MigrationCategory;
  status: MigrationStatus;
  score: number;
  owner: string;
  plannedDate: string;
  remark?: string;
  createdAt: string;
  source?: 'local' | 'feishu';
  sourceRecordId?: string;
  rawFields?: Record<string, string>;
}

export interface MigrationFormValues {
  name: string;
  phone: string;
  channel: MigrationChannel;
  sourceGroup: string;
  targetGroup: string;
  category: MigrationCategory;
  status: MigrationStatus;
  score: number;
  owner: string;
  plannedDate?: Dayjs;
  remark?: string;
}

export const categoryOptions: MigrationCategory[] = ['高价值', '活跃用户', '沉默用户', '待确认'];
export const statusOptions: MigrationStatus[] = ['待采集', '已采集', '迁移中', '已完成'];
export const channelOptions: MigrationChannel[] = ['企微', '公众号', '社群', '线下', '其他'];

export const categoryColor: Record<MigrationCategory, string> = {
  高价值: 'gold',
  活跃用户: 'green',
  沉默用户: 'default',
  待确认: 'blue',
};

export const statusColor: Record<MigrationStatus, string> = {
  待采集: 'default',
  已采集: 'blue',
  迁移中: 'orange',
  已完成: 'green',
};

export function loadMigrationRecords(): MigrationRecord[] {
  try {
    const raw = localStorage.getItem(MIGRATION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMigrationRecords(records: MigrationRecord[]) {
  localStorage.setItem(MIGRATION_STORAGE_KEY, JSON.stringify(records));
}

export function loadFeishuFormLink() {
  return localStorage.getItem(FEISHU_FORM_LINK_KEY) || '';
}

export function saveFeishuFormLink(link: string) {
  localStorage.setItem(FEISHU_FORM_LINK_KEY, link.trim());
}

export interface FeishuFormConfig {
  formLink: string;
  appToken: string;
  tableId: string;
  viewId?: string;
}

export function loadFeishuFormConfig(): FeishuFormConfig {
  try {
    const raw = localStorage.getItem(FEISHU_FORM_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FeishuFormConfig>;
      return {
        formLink: parsed.formLink || loadFeishuFormLink(),
        appToken: parsed.appToken || '',
        tableId: parsed.tableId || '',
        viewId: parsed.viewId || '',
      };
    }
  } catch {
    // Ignore invalid local configuration and fall back to an empty config.
  }
  return { formLink: loadFeishuFormLink(), appToken: '', tableId: '', viewId: '' };
}

export function saveFeishuFormConfig(config: FeishuFormConfig) {
  const nextConfig = {
    formLink: config.formLink.trim(),
    appToken: config.appToken.trim(),
    tableId: config.tableId.trim(),
    viewId: config.viewId?.trim() || '',
  };
  localStorage.setItem(FEISHU_FORM_CONFIG_KEY, JSON.stringify(nextConfig));
  saveFeishuFormLink(nextConfig.formLink);
}

export function formatMigrationRecord(values: MigrationFormValues, id?: number): MigrationRecord {
  return {
    id: id || Date.now(),
    name: values.name,
    phone: values.phone,
    channel: values.channel,
    sourceGroup: values.sourceGroup,
    targetGroup: values.targetGroup,
    category: values.category,
    status: values.status,
    score: Number(values.score || 0),
    owner: values.owner,
    plannedDate: values.plannedDate ? values.plannedDate.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
    remark: values.remark,
    createdAt: dayjs().format('YYYY-MM-DD HH:mm'),
  };
}

function pickField(fields: Record<string, string>, keys: string[]) {
  const matchedKey = keys.find((key) => fields[key] && fields[key].trim() !== '');
  return matchedKey ? fields[matchedKey].trim() : '';
}

export function getMigrationField(record: MigrationRecord, keys: string[], fallback = '-') {
  const rawValue = record.rawFields ? pickField(record.rawFields, keys) : '';
  if (rawValue) return rawValue;

  const fallbackMap: Record<string, string | number | undefined> = {
    姓名: record.name,
    提交人: record.name,
    手机号: record.phone,
    迁移账号绑定手机号: record.phone,
    来源渠道: record.channel,
    选择要迁移用户的主体: record.sourceGroup,
    承接账号对你昵称: record.targetGroup,
    负责人: record.owner,
    处理人: record.owner,
    计划迁移日: record.plannedDate,
    备注: record.remark,
  };

  const matchedKey = keys.find((key) => fallbackMap[key] != null && String(fallbackMap[key]).trim() !== '');
  return matchedKey ? String(fallbackMap[matchedKey]) : fallback;
}

function parseFeishuTimestamp(value: string | undefined, fallback?: number) {
  const numericValue = Number(value || fallback || 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return dayjs();
  return dayjs(numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue);
}

export function formatMigrationDate(value: string, format = 'YYYY-MM-DD') {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return dayjs(numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue).format(format);
  }

  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format(format) : value;
}

function hashId(value: string) {
  return Math.abs(value.split('').reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0));
}

export function migrationRecordFromFeishu(record: FeishuRecord): MigrationRecord {
  const fields = record.fields || {};
  const channel = pickField(fields, ['来源渠道', '渠道', 'channel']) as MigrationChannel;
  const category = pickField(fields, ['用户分类', '分类', 'category']) as MigrationCategory;
  const status = pickField(fields, ['迁移状态', '状态', 'status']) as MigrationStatus;
  const plannedDate = pickField(fields, ['计划迁移日', '迁移日期', '限制账号日期', 'plannedDate']);
  const createdAt = parseFeishuTimestamp(pickField(fields, ['登记时间']), record.createdTime).format('YYYY-MM-DD HH:mm');

  return {
    id: hashId(`feishu-${record.recordId}`),
    name: pickField(fields, ['提交人', '姓名', '用户姓名', '客户姓名', 'name']) || '未命名用户',
    phone: pickField(fields, ['迁移账号绑定手机号', '承接账号绑定手机号', '手机号', '电话', '联系方式', '手机', 'phone']) || '-',
    channel: channelOptions.includes(channel) ? channel : '企微',
    sourceGroup: pickField(fields, ['选择要迁移用户的主体', '来源分组', '来源客户池', '来源', 'sourceGroup']) || '飞书采集表',
    targetGroup: pickField(fields, ['承接账号对你昵称', '目标分组', '目标客户池', '目标', 'targetGroup']) || '待分配',
    category: categoryOptions.includes(category) ? category : '待确认',
    status: statusOptions.includes(status) ? status : (pickField(fields, ['处理人']) ? '已完成' : '已采集'),
    score: Number(pickField(fields, ['迁移评分', '评分', 'score']) || 60),
    owner: pickField(fields, ['处理人', '负责人', '跟进人', 'owner']) || '未分配',
    plannedDate: parseFeishuTimestamp(plannedDate).format('YYYY-MM-DD'),
    remark: pickField(fields, ['迁移话术', '迁移客户原因', '备注', '说明', 'remark']),
    createdAt,
    source: 'feishu',
    sourceRecordId: record.recordId,
    rawFields: fields,
  };
}

export function mergeMigrationRecords(currentRecords: MigrationRecord[], incomingRecords: MigrationRecord[]) {
  const currentBySourceId = new Map(
    currentRecords
      .filter((record) => record.sourceRecordId)
      .map((record) => [record.sourceRecordId, record]),
  );
  const mergedIncomingRecords = incomingRecords.map((incomingRecord) => {
    const currentRecord = incomingRecord.sourceRecordId ? currentBySourceId.get(incomingRecord.sourceRecordId) : undefined;
    if (!currentRecord) return incomingRecord;

    const preservedManualFields = MANUAL_MIGRATION_FIELD_KEYS.reduce<Record<string, string>>((acc, key) => {
      const currentValue = currentRecord.rawFields?.[key]?.trim();
      if (currentValue) acc[key] = currentValue;
      return acc;
    }, {});

    if (Object.keys(preservedManualFields).length === 0) return incomingRecord;

    return {
      ...incomingRecord,
      owner: preservedManualFields.处理人 || incomingRecord.owner,
      rawFields: {
        ...(incomingRecord.rawFields || {}),
        ...preservedManualFields,
      },
    };
  });

  const incomingIds = new Set(incomingRecords.map((record) => record.sourceRecordId).filter(Boolean));
  const preservedRecords = currentRecords.filter((record) => !record.sourceRecordId || !incomingIds.has(record.sourceRecordId));
  return [...mergedIncomingRecords, ...preservedRecords];
}
