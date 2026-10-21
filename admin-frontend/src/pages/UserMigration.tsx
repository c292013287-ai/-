import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, DatePicker, Descriptions, Input, InputNumber, Modal, Select, Space, Table, Tag, message } from 'antd';
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
import { getMigrationSnapshot, getMigrationSyncError, updateFeishuMigrationRecord } from '../api/migration';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import {
  formatMigrationDate,
  getMigrationDetailDraft,
  getMigrationField,
  getMigrationStats,
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
const HANDLER_OPTIONS = ['张磊', '刘奕彤', '李娜'];
const { RangePicker } = DatePicker;

interface DetailDraft {
  transferCount: string;
  handler?: string;
  processedAt: string;
}

function canPushDraft(draft: DetailDraft) {
  return /^\d+$/.test(draft.transferCount) && !!draft.handler && dayjs(draft.processedAt).isValid();
}

function hasLocalOperationStatus(record: MigrationRecord) {
  const operationStatus = record.rawFields?.操作状态?.trim();
  return !!operationStatus && operationStatus !== '-';
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

function copyTextFallback(value: string) {
  const textarea = document.createElement('textarea');
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  Object.assign(textarea.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    padding: '0',
    border: '0',
    outline: '0',
    opacity: '0.01',
  });

  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, value.length);

  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
    activeElement?.focus({ preventScroll: true });
  }
}

export default function UserMigration() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<MigrationRecord[]>(() => loadMigrationRecords());
  const [detailRecordId, setDetailRecordId] = useState<number | null>(null);
  const [detailEdits, setDetailDraft] = useState<Partial<DetailDraft>>({});
  const [filters, setFilters] = useState({
    entity: '全部',
    sku: '全部',
    migrationType: '全部',
    qualitative: '全部',
    handler: '全部',
    registeredDateRange: [] as string[],
  });
  const [pagination, setPagination] = useState({ current: 1, pageSize: 12 });
  const [pushingId, setPushingId] = useState<number | null>(null);
  const [editingRemarkId, setEditingRemarkId] = useState<number | null>(null);
  const [remarkDraft, setRemarkDraft] = useState('');
  const [savingRemarkId, setSavingRemarkId] = useState<number | null>(null);
  const [liveMigrationStats, setLiveMigrationStats] = useState<ReturnType<typeof getMigrationStats> | null>(null);
  const [syncError, setSyncError] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [sourceRefreshing, setSourceRefreshing] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const activeRef = useRef(false);
  const revisionRef = useRef('');
  const sourceRef = useRef('');
  const recordsRef = useRef(records);
  const mutationRef = useRef({ active: 0, version: 0 });

  const filteredRecords = useMemo(() => records
    .filter((record) => {
      const registeredDate = formatMigrationDate(getMigrationField(record, ['登记时间'], record.createdAt));
      const [registeredStart, registeredEnd] = filters.registeredDateRange;
      return (
        (filters.entity === '全部' || getMigrationField(record, ['选择要迁移用户的主体']) === filters.entity)
        && (filters.sku === '全部' || getMigrationField(record, ['所属SKU']) === filters.sku)
        && (filters.migrationType === '全部' || getMigrationField(record, ['迁移类型']) === filters.migrationType)
        && (filters.qualitative === '全部' || getMigrationField(record, ['定性']) === filters.qualitative)
        && (filters.handler === '全部' || getMigrationField(record, ['处理人']) === filters.handler)
        && (!registeredStart || registeredDate >= registeredStart)
        && (!registeredEnd || registeredDate <= registeredEnd)
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
      qualitative: buildOptions(['定性']),
      handler: [{ label: '全部', value: '全部' }, ...HANDLER_OPTIONS.map((value) => ({ label: value, value }))],
    };
  }, [records]);

  const detailRecord = useMemo(
    () => records.find((record) => record.id === detailRecordId) || null,
    [records, detailRecordId],
  );
  const detailDraft: DetailDraft = { ...getMigrationDetailDraft(detailRecord), ...detailEdits };

  const openDetail = (record: MigrationRecord) => {
    setDetailDraft({});
    setDetailRecordId(record.id);
  };

  const persist = (nextRecords: MigrationRecord[]) => {
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    try { saveMigrationRecords(nextRecords); }
    catch { setSyncError('数据已更新，但浏览器缓存写入失败；刷新后将从服务器重新读取'); }
  };

  const syncFeishuRecords = useCallback(async (manual = false) => {
    if (!activeRef.current) return;
    if (mutationRef.current.active) return;
    if (requestRef.current) {
      if (!manual) return;
      requestRef.current.abort();
    }

    const config = loadFeishuFormConfig();
    if (!config.appToken || !config.tableId) {
      setSyncError('尚未配置飞书源表，请在信息采集页检查采集表链接');
      if (manual) {
        message.warning('请先在信息采集页配置飞书 App Token 和 Table ID');
        navigate('/migration/collect');
      }
      return;
    }

    const sourceKey = JSON.stringify([config.appToken, config.tableId, config.viewId || '']);
    if (sourceRef.current !== sourceKey) {
      sourceRef.current = sourceKey;
      revisionRef.current = '';
      setLiveMigrationStats(null);
      setLastSyncedAt('');
    }
    const controller = new AbortController();
    requestRef.current = controller;
    const mutationVersion = mutationRef.current.version;
    if (manual) setSyncing(true);

    try {
      const snapshot = await getMigrationSnapshot({
        appToken: config.appToken,
        tableId: config.tableId,
        viewId: config.viewId || undefined,
        revision: revisionRef.current || undefined,
      }, manual, controller.signal);
      const currentConfig = loadFeishuFormConfig();
      if (controller.signal.aborted || mutationVersion !== mutationRef.current.version
        || sourceKey !== JSON.stringify([currentConfig.appToken, currentConfig.tableId, currentConfig.viewId || ''])) return;
      setSourceRefreshing(snapshot.refreshing);
      setSyncError(snapshot.error ? `${snapshot.error}。当前保留上次成功数据，服务器将自动重试。` : '');
      if (snapshot.ready) {
        if (snapshot.records) {
          const incomingRecords = snapshot.records.map(migrationRecordFromFeishu);
          const nextRecords = mergeMigrationRecords(recordsRef.current, incomingRecords);
          recordsRef.current = nextRecords;
          setRecords(nextRecords);
          setLiveMigrationStats(getMigrationStats(incomingRecords));
          revisionRef.current = snapshot.revision;
          try { saveMigrationRecords(nextRecords); }
          catch { setSyncError('最新源表已读取，但浏览器缓存写入失败；刷新后将从服务器重新读取'); }
        }
        setLastSyncedAt(dayjs(snapshot.updatedAt).format('YYYY-MM-DD HH:mm:ss'));
      }
      if (manual) message.info('已请求后台同步，完成后自动更新');
    } catch (error) {
      if (controller.signal.aborted) return;
      const errorMessage = getMigrationSyncError(error);
      setSyncError(`${errorMessage}。当前保留上次数据，尚未完成本次源表同步。`);
      if (manual) message.error(errorMessage);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setSyncing(false);
      }
    }
  }, [navigate]);

  useEffect(() => {
    activeRef.current = true;
    void syncFeishuRecords(false);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void syncFeishuRecords(false);
    }, 5_000);
    const refresh = () => {
      if (document.visibilityState === 'visible') void syncFeishuRecords(false);
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      activeRef.current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [syncFeishuRecords]);

  const handleManualFieldChange = (fieldName: keyof DetailDraft, value: string | undefined) => {
    setDetailDraft((current) => ({ ...current, [fieldName]: value }));
  };

  const handleCopyMigrationScript = (value: string) => {
    if (!value || value === '-') return;

    const showSuccess = () => message.success('迁移话术已复制');
    const useFallback = () => {
      try {
        if (!copyTextFallback(value)) throw new Error('copy failed');
        showSuccess();
      } catch {
        message.error('复制失败，请长按话术内容手动复制');
      }
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(value).then(showSuccess).catch(useFallback);
      return;
    }

    useFallback();
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
        setDetailDraft({});
        message.success('当前信息已删除');
      },
    });
  };

  const handleResetFilters = () => {
    setFilters({
      entity: '全部',
      sku: '全部',
      migrationType: '全部',
      qualitative: '全部',
      handler: '全部',
      registeredDateRange: [],
    });
  };

  const handlePushStatus = async (record: MigrationRecord) => {
    if (hasLocalOperationStatus(record)) {
      message.warning('该记录已有操作状态，无法重复推送');
      return;
    }

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
    mutationRef.current.active++;
    mutationRef.current.version++;
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

      const localSyncedRecords = recordsRef.current.map((item) => (
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
      setDetailDraft({});
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      message.error(errorMessage || '回写飞书操作状态失败');
    } finally {
      mutationRef.current.active--;
      mutationRef.current.version++;
      setPushingId(null);
      void syncFeishuRecords(false);
    }
  };

  const handleSaveAndSync = async () => {
    await syncFeishuRecords(true);
  };

  const startEditRemark = (record: MigrationRecord) => {
    setEditingRemarkId(record.id);
    setRemarkDraft(record.rawFields?.备注?.trim() || '');
  };

  const cancelEditRemark = () => {
    setEditingRemarkId(null);
    setRemarkDraft('');
  };

  const saveRemark = async (record: MigrationRecord) => {
    const nextRemark = remarkDraft.trim();
    const currentRemark = record.rawFields?.备注?.trim() || '';
    if (nextRemark === currentRemark) {
      cancelEditRemark();
      return;
    }

    if (!record.sourceRecordId) {
      message.warning('这条记录不是飞书同步记录，无法回写备注');
      return;
    }

    const config = loadFeishuFormConfig();
    if (!config.appToken || !config.tableId) {
      message.warning('请先在信息采集页配置飞书 App Token 和 Table ID');
      return;
    }

    setSavingRemarkId(record.id);
    mutationRef.current.active++;
    mutationRef.current.version++;
    try {
      await updateFeishuMigrationRecord(
        record.sourceRecordId,
        { appToken: config.appToken, tableId: config.tableId },
        { 备注: nextRemark },
      );
      persist(recordsRef.current.map((item) => (
        item.id === record.id
          ? { ...item, rawFields: { ...(item.rawFields || {}), 备注: nextRemark } }
          : item
      )));
      message.success('备注已保存并回写飞书');
      cancelEditRemark();
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      message.error(errorMessage || '保存备注失败');
    } finally {
      mutationRef.current.active--;
      mutationRef.current.version++;
      setSavingRemarkId(null);
      void syncFeishuRecords(false);
    }
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
      title: '备注',
      key: 'remark',
      width: 100,
      fixed: 'left' as const,
      render: (_: unknown, record: MigrationRecord) => (
        editingRemarkId === record.id ? (
          <Input
            autoFocus
            size="small"
            value={remarkDraft}
            disabled={savingRemarkId === record.id}
            placeholder="请输入备注"
            onChange={(event) => setRemarkDraft(event.target.value)}
            onBlur={() => void saveRemark(record)}
            onPressEnter={() => void saveRemark(record)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') cancelEditRemark();
            }}
          />
        ) : (
          <Button
            type="text"
            size="small"
            block
            loading={savingRemarkId === record.id}
            onClick={() => startEditRemark(record)}
            style={{ justifyContent: 'flex-start', paddingInline: 0, textAlign: 'left' }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {record.rawFields?.备注?.trim() || '-'}
            </span>
          </Button>
        )
      ),
    },
    { title: '转量数量', key: 'transferCount', width: 100, fixed: 'left' as const, render: (_: unknown, record: MigrationRecord) => getMigrationField(record, ['转量数量']) },
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
    <div className="migration-page">
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
        <StatCard title="采集用户" value={liveMigrationStats?.totalCollected ?? '--'} suffix={liveMigrationStats ? '人' : undefined} gradient="blue" color="#1677ff" prefix={<UserSwitchOutlined style={{ color: '#1677ff' }} />} />
        <StatCard title="迁移中" value={liveMigrationStats?.migratingCount ?? '--'} suffix={liveMigrationStats ? '人' : undefined} gradient="red" color="#cf1322" prefix={<ClockCircleOutlined style={{ color: '#cf1322' }} />} />
        <StatCard title="完成率" value={liveMigrationStats?.completionRate ?? '--'} suffix={liveMigrationStats ? '%' : undefined} gradient="green" color="#52c41a" prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />} />
      </div>

      {syncError && <Alert type="warning" showIcon title={syncError} style={{ marginBottom: 12 }} action={<Button size="small" loading={syncing} onClick={() => void syncFeishuRecords(true)}>重试同步</Button>} />}
      <div role="status" style={{ marginBottom: 12, color: '#667085', fontSize: 12 }}>
        {sourceRefreshing ? '后台正在同步源表… ' : ''}
        {lastSyncedAt ? `源表最后同步成功：${lastSyncedAt}` : '源表统计尚未加载'}
      </div>

      <Card className="migration-filter-card" size="small" style={{ marginBottom: 16 }}>
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
            <label className="migration-filter-item migration-filter-item-sku">
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
              <span>定性</span>
              <Select
                value={filters.qualitative}
                placeholder="全部"
                onChange={(value) => setFilters((current) => ({ ...current, qualitative: value }))}
                options={filterOptions.qualitative}
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
            <label className="migration-filter-item migration-filter-item-date">
              <span>登记时间</span>
              <RangePicker
                value={filters.registeredDateRange.length === 2
                  ? [dayjs(filters.registeredDateRange[0]), dayjs(filters.registeredDateRange[1])]
                  : null}
                placeholder={['开始日期', '结束日期']}
                onChange={(_, dateStrings) => setFilters((current) => ({
                  ...current,
                  registeredDateRange: dateStrings[0] && dateStrings[1] ? dateStrings : [],
                }))}
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
        className="migration-table"
        dataSource={filteredRecords}
        columns={columns}
        rowKey="id"
        size="middle"
        rowClassName={(_, index) => (index % 2 === 0 ? 'migration-table-row-even' : 'migration-table-row-odd')}
        scroll={{ x: 1990 }}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          showSizeChanger: true,
          pageSizeOptions: [10, 12, 20, 50, 100],
          showTotal: (total: number) => `共 ${total} 条迁移记录`,
          onChange: (current, pageSize) => setPagination({ current, pageSize }),
          onShowSizeChange: (_, pageSize) => setPagination({ current: 1, pageSize }),
        }}
      />

      <Modal
        title="查看信息"
        open={!!detailRecord}
        onCancel={() => {
          setDetailRecordId(null);
          setDetailDraft({});
        }}
        destroyOnClose
        width={900}
        footer={
          detailRecord ? (
            <div className="migration-detail-footer">
              <div className="migration-detail-tip">如果无法转量，请在列表第一列编辑备注</div>
              <Space>
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDeleteRecord(detailRecord)}
                >
                  删除
                </Button>
                <Button
                  type="primary"
                  disabled={hasLocalOperationStatus(detailRecord) || !canPushDraft(detailDraft)}
                  title={hasLocalOperationStatus(detailRecord) ? '该记录已有操作状态，无法重复推送' : undefined}
                  loading={pushingId === detailRecord.id}
                  onClick={() => handlePushStatus(detailRecord)}
                >
                  {PUSH_BUTTON_TEXT}
                </Button>
              </Space>
            </div>
          ) : null
        }
      >
        {detailRecord && (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="案例ID">{getMigrationField(detailRecord, ['案例ID'])}</Descriptions.Item>
            <Descriptions.Item label="提交人">{getMigrationField(detailRecord, ['提交人'])}</Descriptions.Item>
            <Descriptions.Item label="上级">{getMigrationField(detailRecord, ['上级'])}</Descriptions.Item>
            <Descriptions.Item label="所属SKU">{getMigrationField(detailRecord, ['所属SKU'])}</Descriptions.Item>
            <Descriptions.Item label="主体" span={2}>
              <span className="migration-detail-key">{getMigrationField(detailRecord, ['选择要迁移用户的主体'])}</span>
            </Descriptions.Item>
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
            <Descriptions.Item label="处理时间">
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
