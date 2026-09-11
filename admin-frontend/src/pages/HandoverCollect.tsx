import { useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Input, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeftOutlined, CopyOutlined, LinkOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { getFeishuMigrationRecords, type FeishuRecord } from '../api/migration';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';

const { Text } = Typography;

const HANDOVER_RECORDS_KEY = 'handover-feishu-records';
const HANDOVER_SYNC_TIME_KEY = 'handover-feishu-last-synced-at';
const HANDOVER_CONFIG_KEY = 'handover-feishu-form-config';
const DEFAULT_FORM_LINK = 'https://opensplendid.feishu.cn/wiki/BMInwED56iwDFHkmXP7cdodbnF5?table=tblDWJVvByHrpdC1&view=vewPhVPbL7';

interface LinkFormValues {
  formLink: string;
  appToken: string;
  tableId: string;
  viewId?: string;
}

const defaultConfig: LinkFormValues = {
  formLink: DEFAULT_FORM_LINK,
  appToken: 'BMInwED56iwDFHkmXP7cdodbnF5',
  tableId: 'tblDWJVvByHrpdC1',
  viewId: 'vewPhVPbL7',
};

const preferredFieldOrder = [
  '提交人',
  '姓名',
  '离职人员',
  '离职员工',
  '员工姓名',
  '部门',
  '岗位',
  '手机号',
  '企业微信账号',
  '交接账号',
  '接收人',
  '承接人',
  '交接内容',
  '交接事项',
  '确认状态',
  '状态',
  '备注',
  '提交时间',
];

function parseFeishuConfigFromLink(link: string) {
  try {
    const url = new URL(link);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const appToken = pathParts.find((part, index) => (
      /^base[a-zA-Z0-9]+$/.test(part)
      || /^basc[a-zA-Z0-9]+$/.test(part)
      || (pathParts[index - 1] === 'wiki' && /^[a-zA-Z0-9]+$/.test(part))
    )) || '';
    return {
      appToken,
      tableId: url.searchParams.get('table') || url.searchParams.get('table_id') || '',
      viewId: url.searchParams.get('view') || url.searchParams.get('view_id') || '',
    };
  } catch {
    return { appToken: '', tableId: '', viewId: '' };
  }
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(HANDOVER_CONFIG_KEY);
    return raw ? { ...defaultConfig, ...JSON.parse(raw) as Partial<LinkFormValues> } : defaultConfig;
  } catch {
    return defaultConfig;
  }
}

function saveConfig(config: LinkFormValues) {
  localStorage.setItem(HANDOVER_CONFIG_KEY, JSON.stringify(config));
}

function loadRecords() {
  try {
    const raw = localStorage.getItem(HANDOVER_RECORDS_KEY);
    return raw ? JSON.parse(raw) as FeishuRecord[] : [];
  } catch {
    return [];
  }
}

function saveRecords(records: FeishuRecord[]) {
  localStorage.setItem(HANDOVER_RECORDS_KEY, JSON.stringify(records));
}

function saveLastSyncedAt(value: string) {
  localStorage.setItem(HANDOVER_SYNC_TIME_KEY, value);
}

function formatFeishuTime(value?: number) {
  if (!value) return '';
  return dayjs(value < 1_000_000_000_000 ? value * 1000 : value).format('YYYY-MM-DD HH:mm');
}

function collectFieldNames(records: FeishuRecord[]) {
  const fieldNames = new Set<string>();
  records.forEach((record) => {
    Object.keys(record.fields || {}).forEach((fieldName) => fieldNames.add(fieldName));
  });

  return Array.from(fieldNames).sort((a, b) => {
    const aIndex = preferredFieldOrder.indexOf(a);
    const bIndex = preferredFieldOrder.indexOf(b);
    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
    }
    return a.localeCompare(b, 'zh-Hans-CN');
  });
}

function renderCell(value: string) {
  if (!value) return <Text type="secondary">-</Text>;
  if (['已确认', '已完成', '完成'].includes(value)) return <Tag color="green">{value}</Tag>;
  if (['待确认', '待交接', '进行中'].includes(value)) return <Tag color="orange">{value}</Tag>;
  if (['异常', '未完成', '驳回'].includes(value)) return <Tag color="red">{value}</Tag>;
  return <span>{value}</span>;
}

export default function HandoverCollect() {
  const navigate = useNavigate();
  const [form] = Form.useForm<LinkFormValues>();
  const [formConfig, setFormConfig] = useState<LinkFormValues>(() => loadConfig());
  const [records, setRecords] = useState<FeishuRecord[]>(() => loadRecords());
  const [syncing, setSyncing] = useState(false);
  const todayCount = records.filter((record) => formatFeishuTime(record.createdTime).startsWith(dayjs().format('YYYY-MM-DD'))).length;

  const syncFeishuRecords = async (config = formConfig) => {
    if (!config.appToken || !config.tableId) {
      message.info('请先配置飞书 App Token 和 Table ID');
      return;
    }

    setSyncing(true);
    try {
      const rows = await getFeishuMigrationRecords({
        appToken: config.appToken,
        tableId: config.tableId,
        viewId: config.viewId || undefined,
      });
      const syncedAt = dayjs().format('YYYY-MM-DD HH:mm:ss');
      saveRecords(rows);
      saveLastSyncedAt(syncedAt);
      setRecords(rows);
      message.success(`已同步 ${rows.length} 条离职交接记录`);
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      message.error(errorMessage || '自动获取飞书提交信息失败');
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveLink = async () => {
    const values = await form.validateFields();
    const nextConfig = {
      formLink: values.formLink.trim(),
      appToken: values.appToken.trim(),
      tableId: values.tableId.trim(),
      viewId: values.viewId?.trim() || '',
    };
    saveConfig(nextConfig);
    setFormConfig(nextConfig);
    message.success('飞书采集表配置已保存');
    await syncFeishuRecords(nextConfig);
  };

  const handleCopy = async () => {
    if (!formConfig.formLink) {
      message.info('请先配置飞书采集表链接');
      return;
    }
    await navigator.clipboard.writeText(formConfig.formLink);
    message.success('链接已复制');
  };

  const handleLinkBlur = () => {
    const link = form.getFieldValue('formLink');
    const parsed = parseFeishuConfigFromLink(link || '');
    if (parsed.appToken || parsed.tableId || parsed.viewId) {
      form.setFieldsValue(parsed);
    }
  };

  const columns = useMemo<ColumnsType<FeishuRecord>>(() => {
    const fieldColumns = collectFieldNames(records).map((fieldName) => ({
      title: fieldName,
      key: fieldName,
      width: 180,
      ellipsis: true,
      render: (_: unknown, record: FeishuRecord) => renderCell(record.fields[fieldName] || ''),
    }));

    return [
      { title: '序号', key: 'index', width: 70, fixed: 'left', align: 'center', render: (_: unknown, __: FeishuRecord, index: number) => index + 1 },
      ...fieldColumns,
      { title: '提交时间', key: 'createdTime', width: 170, render: (_: unknown, record: FeishuRecord) => record.createdTime ? formatFeishuTime(record.createdTime) : <Text type="secondary">-</Text> },
    ];
  }, [records]);

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      <PageHeader
        title="离职交接信息采集"
        desc="配置飞书确认单链接，并展示飞书表单提交后同步到系统的离职交接信息"
        extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/handover')}>返回列表</Button>}
      />

      <div className="summary-grid">
        <StatCard title="已同步提交" value={records.length} suffix="条" gradient="blue" color="#1677ff" />
        <StatCard title="今日新增" value={todayCount} suffix="条" gradient="green" color="#52c41a" />
      </div>

      <Card size="small" title={<span><LinkOutlined style={{ color: '#ed6a1c', marginRight: 8 }} />飞书采集表配置</span>} style={{ marginBottom: 16 }}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="配置飞书多维表格链接后，系统会调用后端接口读取提交记录并展示到下方表格。"
        />
        <Form form={form} layout="vertical" initialValues={formConfig}>
          <Form.Item
            name="formLink"
            label="飞书采集表链接"
            rules={[{ required: true, message: '请输入飞书采集表链接' }, { type: 'url', message: '请输入有效链接' }]}
          >
            <Input placeholder="https://... 飞书采集表或多维表格链接" onBlur={handleLinkBlur} />
          </Form.Item>
          <div className="migration-form-grid">
            <Form.Item name="appToken" label="App Token" rules={[{ required: true, message: '请输入或自动解析 App Token' }]}>
              <Input placeholder="例如：base... 或 wiki token" />
            </Form.Item>
            <Form.Item name="tableId" label="Table ID" rules={[{ required: true, message: '请输入或自动解析 Table ID' }]}>
              <Input placeholder="例如：tbl..." />
            </Form.Item>
            <Form.Item name="viewId" label="View ID">
              <Input placeholder="可选，例如：vew..." />
            </Form.Item>
          </div>
          <Space wrap>
            <Button type="primary" icon={<SaveOutlined />} loading={syncing} onClick={handleSaveLink}>保存并同步</Button>
            <Button icon={<CopyOutlined />} onClick={handleCopy}>复制链接</Button>
            <Button icon={<LinkOutlined />} disabled={!formConfig.formLink} onClick={() => window.open(formConfig.formLink, '_blank', 'noopener,noreferrer')}>打开采集表</Button>
            <Button icon={<ReloadOutlined />} loading={syncing} onClick={() => syncFeishuRecords()}>刷新提交信息</Button>
          </Space>
        </Form>
      </Card>

      <Card size="small" title="采集表提交信息">
        <Table
          dataSource={records}
          columns={columns}
          rowKey="recordId"
          size="middle"
          scroll={{ x: Math.max(960, columns.length * 180) }}
          pagination={{ pageSize: 12, showTotal: (total: number) => `共 ${total} 条提交信息` }}
        />
      </Card>
    </div>
  );
}
