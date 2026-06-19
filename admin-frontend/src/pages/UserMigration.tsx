import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, DatePicker, Descriptions, InputNumber, Modal, Select, Space, Table, Tag, message } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EyeOutlined,
  ExportOutlined,
  FilterOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { getFeishuMigrationRecords, updateFeishuMigrationRecord } from '../api/migration';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import {
  formatMigrationDate,
  getMigrationField,
  loadFeishuFormConfig,
  loadMigrationRecords,
  markMigrationRecordDeleted,
  mergeMigrationRecords,
  migrationRecordFromFeishu,
  saveMigrationRecords,
  type MigrationRecord,
} from './userMigrationData';

const PUSH_BUTTON_TEXT = '点击推送';
const PUSH_STATUS_VALUE = '推送';
const HANDLER_OPTIONS = ['张磊', '刘奕彤'];

interface DetailDraft {
  transferCount: string;
  handler?: string;
  processedAt: string;
}

function canPushDraft(draft: DetailDraft) {
  return /^\d+$/.test(draft.transferCount) && !!draft.handler && dayjs(draft.processedAt).isValid();
}

function getRegisteredTimestamp(record: MigrationRecord) {
  const value = getMigrationField(record, ['登记时间'], record.createdAt);
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue;
  }

  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.valueOf() : 0;
}

export default function UserMigration() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<MigrationRecord[]>(() => loadMigrationRecords());
  const [detailRecordId, setDetailRecordId] = useState<number | null>(null);
  const [detailDraft, setDetailDraft] = useState<DetailDraft>({ transferCount: '', handler: undefined, processedAt: '' });
  const [filters, setFilters] = useState({
    entity: '全部',
    sku: '全部',
    migrationType: '全部',
    fullTag: '全部',
    qualitative: '全部',
    leaderApproved: '全部',
    handler: '全部',
    registeredDate: '',
    operationStatus: '全部',
  });
  const [pushingId, setPushingId] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const autoSyncingRef = useRef(false);

  const filteredRecords = useMemo(() => records
    .filter((record) => {
      const registeredDate = formatMigrationDate(getMigrationField(record, ['登记时间'], record.createdAt));
      return (
        (filters.entity === '全部' || getMigrationField(record, ['选择要迁移用户的主体']) === filters.entity)
        && (filters.sku === '全部' || getMigrationField(record, ['所属SKU']) === filters.sku)
        && (filters.migrationType === '全部' || getMigrationField(record, ['迁移类型']) === filters.migrationType)
        && (filters.fullTag === '全部' || getMigrationField(record, ['迁移用户完整标签']) === filters.fullTag)
        && (filters.qualitative === '全部' || getMigrationField(record, ['定性']) === filters.qualitative)
        && (filters.leaderApproved === '全部' || getMigrationField(record, ['leader是否同意']) === filters.leaderApproved)
        && (filters.handler === '全部' || getMigrationField(record, ['处理人']) === filters.handler)
        && (!filters.registeredDate || registeredDate === filters.registeredDate)
        && (filters.operationStatus === '全部' || getMigrationField(record, ['操作状态'], PUSH_BUTTON_TEXT) === filters.operationStatus)
      );
    })
    .sort((a, b) => getRegisteredTimestamp(b) - getRegisteredTimestamp(a)), [records, filters]);

  const filterOptions = useMemo(() => {
    const buildOptions = (keys: string[]) => {
      const values = Array.from(new Set(records.map((record) => getMigrationField(record, keys, '')).filter(Boolean))).sort();
      return [{ label: '全部', value: '全部' }, ...values.map((value) => ({ label: value, value }))];
    };

    return {
      entity: buildOptions(['选择要迁移用户的主体']),
      sku: buildOptions(['所属SKU']),
      migrationType: buildOptions(['迁移类型']),
      fullTag: buildOptions(['迁移用户完整标签']),
      qualitative: buildOptions(['定性']),
      leaderApproved: buildOptions(['leader是否同意']),
      handler: [{ label: '全部', value: '全部' }, ...HANDLER_OPTIONS.map((value) => ({ label: value, value }))],
      operationStatus: [{ label: '全部', value: '全部' }, { label: PUSH_BUTTON_TEXT, value: PUSH_BUTTON_TEXT }, { label: PUSH_STATUS_VALUE, value: PUSH_STATUS_VALUE }],
    };
  }, [records]);

  const completedCount = records.filter((record) => record.status === '已完成').length;
  const migratingCount = records.filter((record) => record.status === '迁移中').length;
  const completionRate = records.length ? Math.round((completedCount / records.length) * 100) : 0;

  const detailRecord = useMemo(
    () => records.find((record) => record.id === detailRecordId) || null,
    [records, detailRecordId],
  );

  const openDetail = (record: MigrationRecord) => {
    setDetailDraft({ transferCount: '', handler: undefined, processedAt: '' });
    setDetailRecordId(record.id);
  };

  const persist = (nextRecords: MigrationRecord[]) => {
    setRecords(nextRecords);
    saveMigrationRecords(nextRecords);
  };

  const syncFeishuRecords = useCallback(async (manual = false) => {
    if (autoSyncingRef.current) return;

    const config = loadFeishuFormConfig();
    if (!config.appToken || !config.tableId) {
      if (manual) {
        message.warning('请先在信息采集页配置飞书 App Token 和 Table ID');
        navigate('/migration/collect');
      }
      return;
    }

    autoSyncingRef.current = true;
    if (manual) setSyncing(true);

    try {
      const feishuRows = await getFeishuMigrationRecords({
        appToken: config.appToken,
        tableId: config.tableId,
        viewId: config.viewId || undefined,
      });
      const incomingRecords = feishuRows.map(migrationRecordFromFeishu);
      const currentRecords = loadMigrationRecords();
      const currentSourceIds = new Set(currentRecords.map((record) => record.sourceRecordId).filter(Boolean));
      const addedCount = incomingRecords.filter((record) => record.sourceRecordId && !currentSourceIds.has(record.sourceRecordId)).length;
      const nextRecords = mergeMigrationRecords(currentRecords, incomingRecords);
      saveMigrationRecords(nextRecords);
      setRecords(nextRecords);

      if (manual) {
        message.success(`已保存并同步 ${incomingRecords.length} 条飞书提交信息`);
      } else if (addedCount > 0) {
        message.success(`已自动同步 ${addedCount} 条新增迁移信息`);
      }
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      if (manual) message.error(errorMessage || '保存并同步飞书提交信息失败');
    } finally {
      autoSyncingRef.current = false;
      if (manual) setSyncing(false);
    }
  }, [navigate]);

  useEffect(() => {
    void syncFeishuRecords(false);
    const timer = window.setInterval(() => {
      void syncFeishuRecords(false);
    }, 10_000);

    return () => window.clearInterval(timer);
  }, [syncFeishuRecords]);

  const handleManualFieldChange = (fieldName: keyof DetailDraft, value: string | undefined) => {
    setDetailDraft((current) => ({ ...current, [fieldName]: value }));
  };

  const handleCopyMigrationScript = async (value: string) => {
    if (!value || value === '-') return;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!copied) throw new Error('copy failed');
      }
      message.success('迁移话术已复制');
    } catch {
      message.error('复制失败，请手动复制');
    }
  };

  const handleDeleteRecord = (record: MigrationRecord) => {
    Modal.confirm({
      title: '确认删除当前信息？',
      content: '删除后，该记录不会再次同步到用户迁移列表。',
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        markMigrationRecordDeleted(record);
        persist(records.filter((item) => item.id !== record.id));
        setDetailRecordId(null);
        setDetailDraft({ transferCount: '', handler: undefined, processedAt: '' });
        message.success('当前信息已删除');
      },
    });
  };

  const handleResetFilters = () => {
    setFilters({
      entity: '全部',
      sku: '全部',
      migrationType: '全部',
      fullTag: '全部',
      qualitative: '全部',
      leaderApproved: '全部',
      handler: '全部',
      registeredDate: '',
      operationStatus: '全部',
    });
  };

  const handlePushStatus = async (record: MigrationRecord) => {
    if (!canPushDraft(detailDraft)) {
      message.warning('请先填写转量数量、处理人和处理时间');
      return;
    }

    if (!record.sourceRecordId) {
      message.warning('这条记录不是飞书同步记录，无法回写飞书');
      return;
    }

    const config = loadFeishuFormConfig();
    if (!config.appToken || !config.tableId) {
      message.warning('请先在信息采集页配置飞书 App Token 和 Table ID');
      return;
    }

    setPushingId(record.id);
    try {
      const transferCountValue = Number(detailDraft.transferCount);
      const transferCount = String(transferCountValue);
      const handler = detailDraft.handler || '';
      const processedAt = dayjs(detailDraft.processedAt).format('YYYY-MM-DD HH:mm:ss');
      const processedAtTimestamp = dayjs(processedAt).valueOf();

      await updateFeishuMigrationRecord(
        record.sourceRecordId,
        { appToken: config.appToken, tableId: config.tableId },
        {
          转量数量: transferCountValue || 0,
          处理人: handler,
          处理时间: processedAtTimestamp,
        },
      );

      const localSyncedRecords = records.map((item) => (
        item.id === record.id
          ? {
            ...item,
            owner: handler,
            rawFields: {
              ...(item.rawFields || {}),
              转量数量: transferCount,
              处理人: handler,
              处理时间: processedAt,
            },
          }
          : item
      ));
      persist(localSyncedRecords);

      await updateFeishuMigrationRecord(
        record.sourceRecordId,
        { appToken: config.appToken, tableId: config.tableId },
        { 操作状态: PUSH_STATUS_VALUE },
      );

      const nextRecords = localSyncedRecords.map((item) => (
        item.id === record.id
          ? { ...item, rawFields: { ...(item.rawFields || {}), 操作状态: PUSH_STATUS_VALUE, 处理时间: processedAt } }
          : item
      ));
      persist(nextRecords);
      message.success('已回写处理信息，并在飞书操作状态单元格写入“推送”');
      setDetailRecordId(null);
      setDetailDraft({ transferCount: '', handler: undefined, processedAt: '' });
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      message.error(errorMessage || '回写飞书操作状态失败');
    } finally {
      setPushingId(null);
    }
  };

  const handleSaveAndSync = async () => {
    await syncFeishuRecords(true);
  };

  const handleExport = () => {
    if (filteredRecords.length === 0) {
      message.info('当前筛选条件下暂无可导出的记录');
      return;
    }

    const header = ['案例ID', '提交人', '上级', '所属SKU', '主体', '迁移账号', '迁移账号手机号', '承接账号', '承接账号手机号', '迁移类型', '迁移客户数量', '转量数量', '迁移用户完整标签', '迁移话术', '定性', 'leader是否同意', '处理人', '登记时间', '操作状态'];
    const rows = filteredRecords.map((record) => [
      getMigrationField(record, ['案例ID']),
      getMigrationField(record, ['提交人']),
      getMigrationField(record, ['上级']),
      getMigrationField(record, ['所属SKU']),
      getMigrationField(record, ['选择要迁移用户的主体']),
      getMigrationField(record, ['迁移账号对内昵称']),
      getMigrationField(record, ['迁移账号绑定手机号']),
      getMigrationField(record, ['承接账号对你昵称']),
      getMigrationField(record, ['承接账号绑定手机号']),
      getMigrationField(record, ['迁移类型']),
      getMigrationField(record, ['迁移客户数量']),
      getMigrationField(record, ['转量数量']),
      getMigrationField(record, ['迁移用户完整标签']),
      getMigrationField(record, ['迁移话术', '迁移客户原因']),
      getMigrationField(record, ['定性']),
      getMigrationField(record, ['leader是否同意']),
      getMigrationField(record, ['处理人']),
      formatMigrationDate(getMigrationField(record, ['登记时间'], record.createdAt)),
      getMigrationField(record, ['操作状态'], PUSH_BUTTON_TEXT),
    ]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `用户迁移-${dayjs().format('YYYYMMDD-HHmm')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
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
          <span style={{ color: '#646a73', fontSize: 12 }}>{getMigrationField(record, ['迁移账号绑定手机号'])}</span>
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
          <span style={{ color: '#646a73', fontSize: 12 }}>{getMigrationField(record, ['承接账号绑定手机号'])}</span>
        </div>
      ),
    },
    { title: '迁移类型', key: 'migrationType', width: 170, ellipsis: true, render: (_: unknown, record: MigrationRecord) => getMigrationField(record, ['迁移类型']) },
    { title: '转量数量', key: 'transferCount', width: 100, render: (_: unknown, record: MigrationRecord) => getMigrationField(record, ['转量数量']) },
    { title: '完整标签', key: 'fullTag', width: 180, ellipsis: true, render: (_: unknown, record: MigrationRecord) => getMigrationField(record, ['迁移用户完整标签']) },
    { title: '定性', key: 'qualitative', width: 90, render: (_: unknown, record: MigrationRecord) => <Tag color={getMigrationField(record, ['定性']) === '封号' ? 'red' : 'green'}>{getMigrationField(record, ['定性'])}</Tag> },
    { title: '登记时间', key: 'registeredAt', width: 120, render: (_: unknown, record: MigrationRecord) => formatMigrationDate(getMigrationField(record, ['登记时间'], record.createdAt)) },
    {
      title: '操作',
      key: 'action',
      width: 100,
      fixed: 'right' as const,
      render: (_: unknown, record: MigrationRecord) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(record)}>查看信息</Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="用户迁移"
        desc="采集迁移用户信息，按价值与迁移阶段分类，并统计当前迁移进度"
        extra={(
          <Space wrap>
            <Button icon={<SaveOutlined />} loading={syncing} onClick={handleSaveAndSync}>保存并同步</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/migration/collect')}>采集信息</Button>
          </Space>
        )}
      />

      <div className="summary-grid migration-summary-grid">
        <StatCard title="采集用户" value={records.length} suffix="人" gradient="blue" color="#1677ff" prefix={<UserSwitchOutlined style={{ color: '#1677ff' }} />} />
        <StatCard title="迁移中" value={migratingCount} suffix="人" gradient="red" color="#cf1322" prefix={<ClockCircleOutlined style={{ color: '#cf1322' }} />} />
        <StatCard title="完成率" value={completionRate} suffix="%" gradient="green" color="#52c41a" prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />} />
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <div className="migration-filter-panel">
          <div className="migration-filter-title">
            <FilterOutlined style={{ color: '#ed6a1c' }} />
            <span>筛选条件</span>
          </div>
          <div className="migration-filter-grid">
            <label className="migration-filter-item">
              <span>主体</span>
              <Select
                value={filters.entity}
                placeholder="全部"
                onChange={(value) => setFilters((current) => ({ ...current, entity: value }))}
                options={filterOptions.entity}
              />
            </label>
            <label className="migration-filter-item">
              <span>所属SKU</span>
              <Select
                value={filters.sku}
                placeholder="全部"
                onChange={(value) => setFilters((current) => ({ ...current, sku: value }))}
                options={filterOptions.sku}
              />
            </label>
            <label className="migration-filter-item">
              <span>迁移类型</span>
              <Select
                value={filters.migrationType}
                placeholder="全部"
                onChange={(value) => setFilters((current) => ({ ...current, migrationType: value }))}
                options={filterOptions.migrationType}
              />
            </label>
            <label className="migration-filter-item">
              <span>完整标签</span>
              <Select
                value={filters.fullTag}
                placeholder="全部"
                onChange={(value) => setFilters((current) => ({ ...current, fullTag: value }))}
                options={filterOptions.fullTag}
              />
            </label>
            <label className="migration-filter-item">
              <span>定性</span>
              <Select
                value={filters.qualitative}
                placeholder="全部"
                onChange={(value) => setFilters((current) => ({ ...current, qualitative: value }))}
                options={filterOptions.qualitative}
              />
            </label>
            <label className="migration-filter-item">
              <span>leader是否同意</span>
              <Select
                value={filters.leaderApproved}
                placeholder="全部"
                onChange={(value) => setFilters((current) => ({ ...current, leaderApproved: value }))}
                options={filterOptions.leaderApproved}
              />
            </label>
            <label className="migration-filter-item">
              <span>处理人</span>
              <Select
                value={filters.handler}
                placeholder="全部"
                onChange={(value) => setFilters((current) => ({ ...current, handler: value }))}
                options={filterOptions.handler}
              />
            </label>
            <label className="migration-filter-item">
              <span>登记时间</span>
              <DatePicker
                value={filters.registeredDate ? dayjs(filters.registeredDate) : null}
                placeholder="选择日期"
                onChange={(value) => setFilters((current) => ({ ...current, registeredDate: value ? value.format('YYYY-MM-DD') : '' }))}
              />
            </label>
            <label className="migration-filter-item">
              <span>操作状态</span>
              <Select
                value={filters.operationStatus}
                placeholder="全部"
                onChange={(value) => setFilters((current) => ({ ...current, operationStatus: value }))}
                options={filterOptions.operationStatus}
              />
            </label>
          </div>
          <div className="migration-filter-actions">
            <Button icon={<ReloadOutlined />} onClick={handleResetFilters}>重置</Button>
            <Button icon={<ExportOutlined />} onClick={handleExport}>导出</Button>
          </div>
        </div>
      </Card>

      <Table
        dataSource={filteredRecords}
        columns={columns}
        rowKey="id"
        size="middle"
        scroll={{ x: 1770 }}
        pagination={{ pageSize: 12, showTotal: (total: number) => `共 ${total} 条迁移记录` }}
      />

      <Modal
        title="查看信息"
        open={!!detailRecord}
        onCancel={() => {
          setDetailRecordId(null);
          setDetailDraft({ transferCount: '', handler: undefined, processedAt: '' });
        }}
        destroyOnClose
        width={900}
        footer={[
          detailRecord ? (
            <Button
              key="delete"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDeleteRecord(detailRecord)}
            >
              删除
            </Button>
          ) : null,
          detailRecord ? (
            <Button
              key="push"
              type="primary"
              disabled={!canPushDraft(detailDraft)}
              loading={pushingId === detailRecord.id}
              onClick={() => handlePushStatus(detailRecord)}
            >
              {PUSH_BUTTON_TEXT}
            </Button>
          ) : null,
        ]}
      >
        {detailRecord && (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="案例ID">{getMigrationField(detailRecord, ['案例ID'])}</Descriptions.Item>
            <Descriptions.Item label="提交人">{getMigrationField(detailRecord, ['提交人'])}</Descriptions.Item>
            <Descriptions.Item label="上级">{getMigrationField(detailRecord, ['上级'])}</Descriptions.Item>
            <Descriptions.Item label="所属SKU">{getMigrationField(detailRecord, ['所属SKU'])}</Descriptions.Item>
            <Descriptions.Item label="主体" span={2}>{getMigrationField(detailRecord, ['选择要迁移用户的主体'])}</Descriptions.Item>
            <Descriptions.Item label="迁移账号">{getMigrationField(detailRecord, ['迁移账号对内昵称'])}</Descriptions.Item>
            <Descriptions.Item label="迁移账号手机号">{getMigrationField(detailRecord, ['迁移账号绑定手机号'])}</Descriptions.Item>
            <Descriptions.Item label="承接账号">{getMigrationField(detailRecord, ['承接账号对你昵称'])}</Descriptions.Item>
            <Descriptions.Item label="承接账号手机号">{getMigrationField(detailRecord, ['承接账号绑定手机号'])}</Descriptions.Item>
            <Descriptions.Item label="迁移类型">
              <span className="migration-detail-key">{getMigrationField(detailRecord, ['迁移类型'])}</span>
            </Descriptions.Item>
            <Descriptions.Item label="迁移客户数量">
              <span className="migration-detail-key">{getMigrationField(detailRecord, ['迁移客户数量'])}</span>
            </Descriptions.Item>
            <Descriptions.Item label="leader是否同意">
              <span className="migration-detail-key">{getMigrationField(detailRecord, ['leader是否同意'])}</span>
            </Descriptions.Item>
            <Descriptions.Item label="定性">{getMigrationField(detailRecord, ['定性'])}</Descriptions.Item>
            <Descriptions.Item label="转量数量">
              <InputNumber
                size="small"
                min={0}
                precision={0}
                controls={false}
                style={{ width: '100%' }}
                value={detailDraft.transferCount ? Number(detailDraft.transferCount) : null}
                placeholder="请输入转量数量"
                onChange={(value) => handleManualFieldChange('transferCount', value == null ? '' : String(Math.trunc(Number(value))))}
              />
            </Descriptions.Item>
            <Descriptions.Item label="处理人">
              <Select
                size="small"
                style={{ width: '100%' }}
                value={detailDraft.handler}
                placeholder="请选择处理人"
                options={HANDLER_OPTIONS.map((value) => ({ label: value, value }))}
                onChange={(value) => handleManualFieldChange('handler', value)}
              />
            </Descriptions.Item>
            <Descriptions.Item label="登记时间">{formatMigrationDate(getMigrationField(detailRecord, ['登记时间'], detailRecord.createdAt))}</Descriptions.Item>
            <Descriptions.Item label="处理时间" span={2}>
              <DatePicker
                showTime
                size="small"
                style={{ width: '100%' }}
                value={detailDraft.processedAt ? dayjs(detailDraft.processedAt) : null}
                placeholder="请选择处理时间"
                onChange={(value) => handleManualFieldChange('processedAt', value ? value.format('YYYY-MM-DD HH:mm:ss') : '')}
              />
            </Descriptions.Item>
            <Descriptions.Item label="完整标签" span={2}>
              <span className="migration-detail-key">{getMigrationField(detailRecord, ['迁移用户完整标签'])}</span>
            </Descriptions.Item>
            <Descriptions.Item label="迁移话术" span={2}>
              {(() => {
                const migrationScript = getMigrationField(detailRecord, ['迁移话术', '迁移客户原因']);
                return (
                  <div className="migration-script-cell">
                    <div className="migration-script-content">{migrationScript}</div>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      disabled={!migrationScript || migrationScript === '-'}
                      onClick={() => handleCopyMigrationScript(migrationScript)}
                    >
                      复制
                    </Button>
                  </div>
                );
              })()}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}
