import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Space, Table, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined, CopyOutlined, ExportOutlined, LinkOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { getFeishuMigrationRecords } from '../api/migration';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import {
  categoryOptions,
  channelOptions,
  formatMigrationRecord,
  getMigrationField,
  loadFeishuFormConfig,
  loadMigrationRecords,
  mergeMigrationRecords,
  migrationRecordFromFeishu,
  saveFeishuFormConfig,
  saveMigrationRecords,
  statusOptions,
  type MigrationCategory,
  type MigrationChannel,
  type MigrationFormValues,
  type MigrationRecord,
  type MigrationStatus,
} from './userMigrationData';

const { Text } = Typography;
const { TextArea } = Input;

interface LinkFormValues {
  formLink: string;
  appToken: string;
  tableId: string;
  viewId?: string;
}

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

function splitCsvLine(line: string) {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function pickValue(row: Record<string, string>, keys: string[]) {
  const matchedKey = keys.find((key) => row[key] != null && row[key].trim() !== '');
  return matchedKey ? row[matchedKey].trim() : '';
}

function parseFeishuCsv(raw: string): MigrationRecord[] {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((item) => item.replace(/^\uFEFF/, ''));
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = cells[index] || '';
      return acc;
    }, {});

    const values: MigrationFormValues = {
      name: pickValue(row, ['姓名', '用户姓名', '客户姓名', 'name']) || '未命名用户',
      phone: pickValue(row, ['手机号', '电话', '联系方式', '手机', 'phone']) || '-',
      channel: (pickValue(row, ['来源渠道', '渠道', 'channel']) as MigrationChannel) || '企微',
      sourceGroup: pickValue(row, ['来源分组', '来源客户池', '来源', 'sourceGroup']) || '飞书采集表',
      targetGroup: pickValue(row, ['目标分组', '目标客户池', '目标', 'targetGroup']) || '待分配',
      category: (pickValue(row, ['用户分类', '分类', 'category']) as MigrationCategory) || '待确认',
      status: (pickValue(row, ['迁移状态', '状态', 'status']) as MigrationStatus) || '已采集',
      score: Number(pickValue(row, ['迁移评分', '评分', 'score']) || 60),
      owner: pickValue(row, ['负责人', '跟进人', 'owner']) || '未分配',
      plannedDate: dayjs(pickValue(row, ['计划迁移日', '迁移日期', 'plannedDate']) || undefined),
      remark: pickValue(row, ['备注', '说明', 'remark']),
    };

    if (!channelOptions.includes(values.channel)) values.channel = '企微';
    if (!categoryOptions.includes(values.category)) values.category = '待确认';
    if (!statusOptions.includes(values.status)) values.status = '已采集';
    if (!values.plannedDate?.isValid()) values.plannedDate = dayjs();

    return formatMigrationRecord(values);
  });
}

export default function UserMigrationCollect() {
  const navigate = useNavigate();
  const [linkForm] = Form.useForm<LinkFormValues>();
  const [formConfig, setFormConfig] = useState(() => loadFeishuFormConfig());
  const [records, setRecords] = useState<MigrationRecord[]>(() => loadMigrationRecords());
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState('');
  const autoSyncedRef = useRef(false);

  const submittedRows = useMemo(() => records.filter((record) => record.status !== '待采集'), [records]);
  const todayCount = submittedRows.filter((record) => record.createdAt.startsWith(dayjs().format('YYYY-MM-DD'))).length;

  const syncFeishuRecords = useCallback(async (config = formConfig, silent = false) => {
    if (!config.appToken || !config.tableId) {
      if (!silent) message.info('请先配置飞书 App Token 和 Table ID');
      return;
    }

    setSyncing(true);
    try {
      const feishuRows = await getFeishuMigrationRecords({
        appToken: config.appToken,
        tableId: config.tableId,
        viewId: config.viewId || undefined,
      });
      const incomingRecords = feishuRows.map(migrationRecordFromFeishu);
      const nextRecords = mergeMigrationRecords(loadMigrationRecords(), incomingRecords);
      saveMigrationRecords(nextRecords);
      setRecords(nextRecords);
      setLastSyncedAt(dayjs().format('YYYY-MM-DD HH:mm:ss'));
      if (!silent) message.success(`已自动同步 ${incomingRecords.length} 条飞书提交信息`);
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      message.error(errorMessage || '自动获取飞书提交信息失败');
    } finally {
      setSyncing(false);
    }
  }, [formConfig]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!autoSyncedRef.current && formConfig.appToken && formConfig.tableId) {
        autoSyncedRef.current = true;
        void syncFeishuRecords(formConfig, true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [formConfig, syncFeishuRecords]);

  const handleSaveLink = async () => {
    const values = await linkForm.validateFields();
    const nextConfig = {
      formLink: values.formLink.trim(),
      appToken: values.appToken.trim(),
      tableId: values.tableId.trim(),
      viewId: values.viewId?.trim() || '',
    };
    saveFeishuFormConfig(nextConfig);
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
    const link = linkForm.getFieldValue('formLink');
    const parsed = parseFeishuConfigFromLink(link || '');
    if (parsed.appToken || parsed.tableId || parsed.viewId) {
      linkForm.setFieldsValue(parsed);
    }
  };

  const handleImport = () => {
    const imported = parseFeishuCsv(importText);
    if (imported.length === 0) {
      message.warning('未识别到可导入的数据，请确认第一行为表头，后续为提交记录');
      return;
    }
    const nextRecords = [...imported, ...records];
    saveMigrationRecords(nextRecords);
    setRecords(nextRecords);
    setImportText('');
    setImportOpen(false);
    message.success(`已导入 ${imported.length} 条飞书采集数据`);
  };

  const columns = [
    {
      title: '案例ID',
      key: 'caseId',
      width: 130,
      fixed: 'left' as const,
      render: (_: unknown, record: MigrationRecord) => <span style={{ fontWeight: 600 }}>{getMigrationField(record, ['案例ID'])}</span>,
    },
    {
      title: '提交人',
      key: 'submitter',
      width: 100,
      fixed: 'left' as const,
      render: (_: unknown, record: MigrationRecord) => getMigrationField(record, ['提交人']),
    },
    { title: '上级', key: 'leader', width: 100, render: (_: unknown, record: MigrationRecord) => getMigrationField(record, ['上级']) },
    { title: '所属SKU', key: 'sku', width: 150, ellipsis: true, render: (_: unknown, record: MigrationRecord) => getMigrationField(record, ['所属SKU']) },
    { title: '主体', key: 'entity', width: 180, ellipsis: true, render: (_: unknown, record: MigrationRecord) => getMigrationField(record, ['选择要迁移用户的主体']) },
    {
      title: '迁移账号',
      key: 'migrationAccount',
      width: 190,
      render: (_: unknown, record: MigrationRecord) => (
        <div>
          <div style={{ fontWeight: 600 }}>{getMigrationField(record, ['迁移账号对内昵称'])}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{getMigrationField(record, ['迁移账号绑定手机号'])}</Text>
        </div>
      ),
    },
    {
      title: '承接账号',
      key: 'receiverAccount',
      width: 190,
      render: (_: unknown, record: MigrationRecord) => (
        <div>
          <div style={{ fontWeight: 600 }}>{getMigrationField(record, ['承接账号对你昵称'])}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{getMigrationField(record, ['承接账号绑定手机号'])}</Text>
        </div>
      ),
    },
    { title: '迁移类型', key: 'migrationType', width: 170, ellipsis: true, render: (_: unknown, record: MigrationRecord) => getMigrationField(record, ['迁移类型']) },
    { title: '迁移客户数量', key: 'customerCount', width: 120, sorter: (a: MigrationRecord, b: MigrationRecord) => Number(getMigrationField(a, ['迁移客户数量'], '0')) - Number(getMigrationField(b, ['迁移客户数量'], '0')), render: (_: unknown, record: MigrationRecord) => getMigrationField(record, ['迁移客户数量']) },
    { title: '转量数量', key: 'transferCount', width: 100, render: (_: unknown, record: MigrationRecord) => getMigrationField(record, ['转量数量']) },
    { title: '完整标签', key: 'fullTag', width: 180, ellipsis: true, render: (_: unknown, record: MigrationRecord) => getMigrationField(record, ['迁移用户完整标签']) },
    { title: '迁移客户原因', key: 'reason', width: 220, ellipsis: true, render: (_: unknown, record: MigrationRecord) => getMigrationField(record, ['迁移客户原因']) },
    { title: '定性', key: 'qualitative', width: 90, render: (_: unknown, record: MigrationRecord) => <Tag color={getMigrationField(record, ['定性']) === '封号' ? 'red' : 'green'}>{getMigrationField(record, ['定性'])}</Tag> },
    { title: 'leader是否同意', key: 'leaderApproved', width: 120, render: (_: unknown, record: MigrationRecord) => getMigrationField(record, ['leader是否同意']) },
    { title: '处理人', key: 'handler', width: 100, render: (_: unknown, record: MigrationRecord) => getMigrationField(record, ['处理人']) },
    { title: '登记时间', key: 'registeredAt', width: 150, render: (_: unknown, record: MigrationRecord) => getMigrationField(record, ['登记时间'], record.createdAt) },
  ];

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      <PageHeader
        title="用户迁移信息采集"
        desc="配置飞书采集表链接，并展示飞书表单提交后同步到系统的用户信息"
        extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/migration')}>返回列表</Button>}
      />

      <div className="summary-grid">
        <StatCard title="已同步提交" value={submittedRows.length} suffix="条" gradient="blue" color="#1677ff" />
        <StatCard title="今日新增" value={todayCount} suffix="条" gradient="green" color="#52c41a" />
      </div>

      <Card size="small" title={<span><LinkOutlined style={{ color: '#ed6a1c', marginRight: 8 }} />飞书采集表配置</span>} style={{ marginBottom: 16 }}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="配置飞书多维表格链接后，系统会自动调用后端接口读取提交记录并展示到下方表格。后端需要配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET。"
        />
        <Form form={linkForm} layout="vertical" initialValues={formConfig}>
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
            <Button icon={<ExportOutlined />} onClick={() => setImportOpen(true)}>导入飞书导出数据</Button>
          </Space>
          {lastSyncedAt && <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>最近同步：{lastSyncedAt}</Text>}
        </Form>
      </Card>

      <Card size="small" title="采集表提交信息">
        <Table
          dataSource={submittedRows}
          columns={columns}
          rowKey="id"
          size="middle"
          scroll={{ x: 2170 }}
          pagination={{ pageSize: 12, showTotal: (total: number) => `共 ${total} 条提交信息` }}
        />
      </Card>

      <Modal
        title="导入飞书采集数据"
        open={importOpen}
        onOk={handleImport}
        onCancel={() => setImportOpen(false)}
        okText="导入"
        cancelText="取消"
        width={720}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="请从飞书采集表导出 CSV 后粘贴到这里。支持表头：姓名、手机号、来源渠道、来源分组、目标分组、用户分类、迁移状态、迁移评分、负责人、计划迁移日、备注。"
        />
        <TextArea
          rows={10}
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder={'姓名,手机号,来源渠道,来源分组,目标分组,用户分类,迁移状态,迁移评分,负责人,计划迁移日,备注\n张三,13800000000,企微,旧客户池,新客户池,高价值,已采集,80,李四,2026-06-18,重点跟进'}
        />
      </Modal>
    </div>
  );
}
