import { useEffect, useMemo, useState } from 'react';
import { Alert, Avatar, Button, Collapse, DatePicker, Empty, Input, Select, Space, Table, Tag, Tooltip, message } from 'antd';
import { DownloadOutlined, ReloadOutlined, UserOutlined } from '@ant-design/icons';
import { writeFile } from 'xlsx';
import { buildCustomerWorkbook } from './customerExport';
import dayjs from 'dayjs';
import PageHeader from '../components/PageHeader';
import { employeeOptions } from './customerEmployees';
import { useAuthStore } from '../store/authStore';
import { readCustomerPreference, writeCustomerPreference } from './customerCache';
import { customerSource, type CustomerFilters } from './customerQuery';
import { getEntities, getEmployeeNames, getCustomerSnapshot, getCustomerLiveStatus, downloadCustomerCsv, getCustomerSyncJobs, startCustomerSync, type CustomerLiveStatus, type CustomerSyncJob, type Customer, type WecomEntity } from '../api/entities';

const errorText = (error: unknown) => (error as { response?: { data?: { error?: string } } })?.response?.data?.error || (error instanceof Error ? error.message : '加载失败，请重试');

function CustomerList({ entityId, entityName, ownerId, job, onSync }: { entityId: number; entityName: string; ownerId: number; job?: CustomerSyncJob; onSync: (id?: number) => Promise<void> }) {
  const preferenceKey = `customer-selection:${ownerId}:${entityId}`;
  const [users, setUsers] = useState<string[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});
  const [namesLoading, setNamesLoading] = useState(false);
  const [namesError, setNamesError] = useState('');
  const [namesVersion, setNamesVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setNamesLoading(true); setNamesError('');
    getEmployeeNames(entityId, controller.signal).then(setEmployeeNames)
      .catch(e => { if (!controller.signal.aborted) setNamesError(errorText(e)); })
      .finally(() => { if (!controller.signal.aborted) setNamesLoading(false); });
    return () => controller.abort();
  }, [entityId, namesVersion]);
  const employees = useMemo(() => employeeOptions(users, employeeNames), [users, employeeNames]);
  const [userId, setUserId] = useState<string | undefined>(() => readCustomerPreference(preferenceKey).userId);
  const [items, setItems] = useState<Customer[]>([]);
  const loading = job?.status === 'queued' || job?.status === 'running';
  const [error, setError] = useState('');
  const [tagWarning, setTagWarning] = useState('');
  const [scope, setScope] = useState<'employee' | 'entity'>(() => readCustomerPreference(preferenceKey).scope === 'employee' ? 'employee' : 'entity');
  const [cacheLoading, setCacheLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [updatedAt, setUpdatedAt] = useState('');
  const [fullUpdatedAt, setFullUpdatedAt] = useState('');
  const [revision, setRevision] = useState<string>();
  const [live, setLive] = useState<CustomerLiveStatus>();
  const [liveError, setLiveError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const value = await getCustomerLiveStatus(entityId, controller.signal); if (!controller.signal.aborted) { setLive(value); setLiveError(''); } }
      catch (e) { if (!controller.signal.aborted) setLiveError(errorText(e)); }
      finally { if (!controller.signal.aborted) timer = setTimeout(poll, 15000); }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [entityId]);
  const [filters, setFilters] = useState<CustomerFilters>({});
  const [completed, setCompleted] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [count, setCount] = useState(0);
  const [tags, setTags] = useState<Array<{ value: string; label: string }>>([]);
  const [sources, setSources] = useState<Array<{ value: number; label: string }>>([]);
  const [exporting, setExporting] = useState(false);
  const queryFilters = useMemo(() => ({ ...filters, userId: scope === 'employee' ? userId || '__unselected__' : undefined }), [filters, scope, userId]);
  useEffect(() => { writeCustomerPreference(preferenceKey, { scope, userId }); }, [preferenceKey, scope, userId]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setCacheLoading(true); setError('');
    const timer = setTimeout(() => {
    (async () => {
      try {
        const snapshot = await getCustomerSnapshot(entityId, { ...queryFilters, page, pageSize }, controller.signal);
        if (active && snapshot) {
          setItems(snapshot.items); setTagWarning(snapshot.warning); setUpdatedAt(snapshot.updatedAt); setCompleted(true);
          setFullUpdatedAt(snapshot.fullUpdatedAt || snapshot.updatedAt); setRevision(snapshot.revision);
          setTotal(snapshot.total); setCount(snapshot.count);
          setTags(snapshot.tags.map(tag => ({ value: tag.id, label: tag.name || tag.id })));
          setSources([...new Set([0, 1, 2, 3, 4, ...snapshot.sources])].map(value => ({ value, label: customerSource(value) })));
          setUsers(snapshot.users); setUserId(previous => previous && snapshot.users.includes(previous) ? previous : snapshot.users[0]);
        } else if (active) {
          setItems([]); setUsers([]); setCompleted(false); setUpdatedAt(''); setTagWarning(''); setTotal(0); setCount(0);
        }
      } catch (e) { if (active) setError(errorText(e)); }
      finally { if (active) setCacheLoading(false); }
    })();
    }, 250);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [entityId, job?.updatedAt, live?.ready, live?.revision, version, queryFilters, page, pageSize]);

  const download = async () => {
    if (!completed || cacheLoading || !total || exporting) return;
    setExporting(true);
    try {
      const safeName = entityName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 60);
      if (total > 10000) {
        const blob = await downloadCustomerCsv(entityId, queryFilters);
        const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
        anchor.href = url; anchor.download = `用户管理_${safeName}_${dayjs().format('YYYYMMDD_HHmmss')}.csv`;
        anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
        message.success('已下载全部筛选结果'); return;
      }
      const rows: Customer[] = [];
      for (let current = 1; rows.length < total; current++) {
        const snapshot = await getCustomerSnapshot(entityId, { ...queryFilters, page: current, pageSize: 100 });
        if (!snapshot || snapshot.updatedAt !== updatedAt || snapshot.revision !== revision || !snapshot.items.length) throw new Error('同步数据已更新，请刷新后重新下载');
        rows.push(...snapshot.items);
      }
      const workbook = buildCustomerWorkbook(rows, {
        entityName, scope: scope === 'entity' ? '整个主体' : `当前员工：${userId}`, updatedAt, filters, sourceLabel: customerSource,
      });
      writeFile(workbook, `用户管理_${safeName}_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`);
      message.success(`已导出 ${rows.length} 条客户跟进关系`);
    } catch { message.error('下载失败，请重试或缩小筛选范围'); }
    finally { setExporting(false); }
  };
  const updateFilter = <K extends keyof CustomerFilters>(key: K, value: CustomerFilters[K]) => {
    setFilters(current => ({ ...current, [key]: value })); setPage(1);
  };

  return <>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '16px 0' }}>
      <span>查询范围</span>
      <Select aria-label="查询范围" value={scope} style={{ width: 150, maxWidth: '100%' }} options={[{ value: 'employee', label: '当前员工' }, { value: 'entity', label: '整个主体' }]}
        onChange={value => { setPage(1); setScope(value); }} />
      <span>跟进员工</span>
      <Select aria-label="跟进员工" disabled={scope === 'entity'} showSearch optionFilterProp="searchText" value={userId} loading={cacheLoading || namesLoading}
        style={{ width: 280, maxWidth: '100%' }} placeholder="选择员工"
        options={employees}
        onChange={id => { setPage(1); setUserId(id); }} />
      <Button icon={<DownloadOutlined />} loading={exporting} disabled={!completed || cacheLoading || !total} onClick={() => void download()}>{total > 10000 ? '下载 CSV' : '下载 Excel'}</Button>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12, marginBottom: 16 }}>
      {([
        ['name', '客户名称'], ['remark', '客户备注'], ['phone', '备注手机号'],
        ['externalUserId', 'external_userid'], ['unionId', 'unionid'], ['state', '渠道标记'],
      ] as const).map(([key, label]) => <label key={key} style={{ minWidth: 0 }}><div style={{ marginBottom: 4 }}>{label}</div>
        <Input aria-label={label} allowClear value={filters[key]} placeholder={`搜索${label}`} onChange={e => updateFilter(key, e.target.value)} /></label>)}
      <label>性别<Select aria-label="性别" allowClear placeholder="全部" style={{ width: '100%' }} value={filters.gender} onChange={value => updateFilter('gender', value)} options={[{ value: 1, label: '男' }, { value: 2, label: '女' }, { value: 0, label: '未知' }]} /></label>
      <label>客户类型<Select aria-label="客户类型" allowClear placeholder="全部" style={{ width: '100%' }} value={filters.type} onChange={value => updateFilter('type', value)} options={[{ value: 1, label: '微信客户' }, { value: 2, label: '企业微信客户' }]} /></label>
      <label>客户标签<Select aria-label="客户标签" showSearch optionFilterProp="label" allowClear placeholder="全部" style={{ width: '100%' }} value={filters.tagId} onChange={value => updateFilter('tagId', value)} options={tags} /></label>
      <label>添加来源<Select aria-label="添加来源" allowClear placeholder="全部" style={{ width: '100%' }} value={filters.addWay} onChange={value => updateFilter('addWay', value)} options={sources} /></label>
      <label>unionid 状态<Select aria-label="unionid 状态" allowClear placeholder="全部" style={{ width: '100%' }} value={filters.unionStatus} onChange={value => updateFilter('unionStatus', value)} options={[{ value: 'present', label: '已获取' }, { value: 'missing', label: '未获取' }]} /></label>
      <label>添加时间<DatePicker.RangePicker style={{ width: '100%' }} value={filters.startDate && filters.endDate ? [dayjs(filters.startDate), dayjs(filters.endDate)] : null}
        onChange={value => { setFilters(current => ({ ...current, startDate: value?.[0]?.format('YYYY-MM-DD'), endDate: value?.[1]?.format('YYYY-MM-DD') })); setPage(1); }} /></label>
    </div>
    {loading && <Alert type="info" showIcon message={`${job?.status === 'queued' ? '等待同步' : '后台同步中'}：员工 ${job?.employees || 0}/${job?.totalEmployees || 0}，已读 ${job?.pages || 0} 页、${job?.records || 0} 条关系记录${completed ? '；当前显示上次完整数据' : ''}`} />}
    {job?.status === 'failed' && <Alert type="error" showIcon message={job.error} action={<Button onClick={() => void onSync(entityId)}>重试同步</Button>} />}
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => setVersion(v => v + 1)}>重新读取</Button>} />}
    {namesError && <Alert type="warning" showIcon message={namesError} action={<Button onClick={() => setNamesVersion(v => v + 1)}>重试读取名称</Button>} />}
    {tagWarning && <Alert type="warning" showIcon message={tagWarning} />}
    {liveError && <Alert type="warning" showIcon message={`增量状态读取失败：${liveError}`} />}
    {live?.enabled && <Alert style={{ marginTop: 8 }} type={live.failed ? 'warning' : 'info'} showIcon message={
      !live.ready ? `增量索引准备中：已导入 ${(live.importRows || 0).toLocaleString()} 条，当前仍可查询原快照` :
        `自动增量补查已开启 · 已检查员工 ${live.checked || 0}/${live.employees || 0} · 待更新 ${live.pending || 0} 条${live.failed ? ` · ${live.failed} 项等待重试` : ''}${live.eventAt ? ' · 已收到企微事件通知' : ' · 企微事件通知尚未接通'}`
    } description={live.error || undefined} />}
    {completed && <div style={{ margin: '12px 0', display: 'flex', flexWrap: 'wrap', gap: '4px 16px', color: '#657080' }}>
      <span>最近全量完成：{dayjs(fullUpdatedAt).format('YYYY-MM-DD HH:mm:ss')}</span>
      {live?.enabled && <span>最近增量更新：{live.incrementAt ? dayjs(live.incrementAt).format('MM-DD HH:mm:ss') : '尚未更新'}</span>}
      {live?.latestCheckAt && <span>最近员工补查：{dayjs(live.latestCheckAt).format('MM-DD HH:mm:ss')}</span>}
      <span>主体共 {count.toLocaleString()} 条客户跟进关系 · 符合筛选 {total.toLocaleString()} 条</span>
    </div>}
    {filters.endDate === dayjs().format('YYYY-MM-DD') && !cacheLoading && !total && <Alert type="warning" showIcon style={{ marginBottom: 8 }} message="当前已同步数据中暂无当日记录，今日数据可能尚未补查完整" />}
    <Table<Customer> rowKey={r => JSON.stringify([r.externalUserId, r.userId])} dataSource={items} loading={cacheLoading}
      pagination={{ current: page, total, pageSize, onChange: (value, size) => { setPage(size !== pageSize ? 1 : value); setPageSize(size); }, pageSizeOptions: [20, 50, 100], showSizeChanger: true, showTotal: total => `共 ${total} 条客户跟进关系` }} size="middle" scroll={{ x: 2650 }}
      locale={{ emptyText: <Empty description={error ? '客户信息加载失败' : !completed ? '暂无完整同步数据' : '无符合条件的客户'} /> }}
      columns={[
        { title: '头像', dataIndex: 'avatar', width: 70, render: value => <Avatar size={36} src={value || undefined} icon={<UserOutlined />} /> },
        { title: '客户名称', dataIndex: 'name', width: 160, render: value => value || '-' },
        { title: '性别', dataIndex: 'gender', width: 80, render: value => value === 1 ? '男' : value === 2 ? '女' : '未知' },
        { title: '客户备注', dataIndex: 'remark', width: 180, ellipsis: true, render: value => value || '-' },
        { title: '备注手机号', dataIndex: 'remarkMobiles', width: 170, render: (value: string[] | undefined) => value?.length ? value.map(phone => <div key={phone}>{phone}</div>) : '未填写' },
        { title: '客户标签', dataIndex: 'tags', width: 270, render: (value: Customer['tags']) => value?.length ? <Space size={[4, 4]} wrap>{value.map(tag => <Tooltip key={tag.id} title={tag.name ? `${tag.name} (${tag.id})` : `标签ID：${tag.id}`}><Tag style={{ maxWidth: 240, whiteSpace: 'normal', overflowWrap: 'anywhere', marginInlineEnd: 0 }}>{tag.name || tag.id}</Tag></Tooltip>)}</Space> : '-' },
        { title: '添加来源', dataIndex: 'addWay', width: 160, render: customerSource },
        { title: '渠道标记', dataIndex: 'state', width: 210, ellipsis: true, render: value => value || '-' },
        { title: '类型', dataIndex: 'type', width: 110, render: value => <Tag>{value === 1 ? '微信客户' : value === 2 ? '企业微信客户' : '未知'}</Tag> },
        { title: '企业', dataIndex: 'company', width: 200, ellipsis: true, render: value => value || '-' },
        { title: '员工ID', dataIndex: 'userId', width: 170 },
        { title: '添加时间', dataIndex: 'addedAt', width: 190, render: value => value == null ? '-' : new Date(value * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) },
        { title: '描述', dataIndex: 'description', width: 220, ellipsis: true, render: value => value || '-' },
        { title: 'external_userid', dataIndex: 'externalUserId', width: 230, ellipsis: true },
        { title: 'unionid', dataIndex: 'unionId', width: 230, ellipsis: true, render: value => value || '未获取' },
      ]} />
  </>;
}

export default function CustomerManage() {
  const ownerId = useAuthStore(state => state.user?.id);
  const preferenceKey = `customer-entity:${ownerId}`;
  const [entities, setEntities] = useState<WecomEntity[]>([]);
  const [entityId, setEntityId] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    getEntities().then(value => { if (active) { setEntities(value); const saved = readCustomerPreference(preferenceKey).entityId; setEntityId(value.find(entity => entity.id === saved)?.id ?? value[0]?.id); } })
      .catch(e => { if (active) setError(errorText(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [version, preferenceKey]);
  const [jobs, setJobs] = useState<CustomerSyncJob[]>([]);
  const [jobError, setJobError] = useState('');
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const value = await getCustomerSyncJobs(); if (active) { setJobs(value); setJobError(''); } }
      catch (e) { if (active) setJobError(errorText(e)); }
      finally { if (active) timer = setTimeout(poll, 3000); }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  const sync = async (id?: number) => {
    setStarting(true);
    try { setJobs(await startCustomerSync(id)); setJobError(''); message.success('已加入后台同步队列'); }
    catch (e) { setJobError(errorText(e)); }
    finally { setStarting(false); }
  };
  return <div>
    <PageHeader title="用户管理" />
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => setVersion(v => v + 1)}>重试</Button>} />}
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <span>主体</span>
      <Select aria-label="主体" showSearch optionFilterProp="label" loading={loading} value={entityId}
        onChange={value => { setEntityId(value); writeCustomerPreference(preferenceKey, { entityId: value }); }} placeholder="选择主体" style={{ width: 300, maxWidth: '100%' }}
        options={entities.map(entity => ({ value: entity.id, label: entity.name }))} />
      <Button icon={<ReloadOutlined />} loading={starting} disabled={loading || !entities.length} onClick={() => void sync()}>同步全部主体</Button>
    </div>
    {jobError && <Alert type="error" showIcon message={jobError} />}
    {!!jobs.length && <Collapse ghost style={{ margin: '16px 0' }} defaultActiveKey={[]} items={[{
      key: 'sync-progress',
      label: <Space size={[8, 4]} wrap><span>主体同步进度</span>
        <Tag color="success">已完成 {jobs.filter(job => job.status === 'completed').length}</Tag>
        <Tag color="processing">同步中 {jobs.filter(job => job.status === 'running').length}</Tag>
        <Tag>排队中 {jobs.filter(job => job.status === 'queued').length}</Tag>
        {jobs.some(job => job.status === 'failed') && <Tag color="error">失败 {jobs.filter(job => job.status === 'failed').length}</Tag>}
      </Space>,
      children: <div style={{ overflowX: 'auto' }}><Table<CustomerSyncJob> size="small" pagination={false} rowKey="entityId" dataSource={jobs} scroll={{ x: 700 }} columns={[
      { title: '主体', dataIndex: 'entityId', render: id => entities.find(entity => entity.id === id)?.name || id },
      { title: '同步状态', dataIndex: 'status', render: status => <Tag color={status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'processing'}>{{ queued: '排队中', running: '同步中', completed: '已完成', failed: '失败' }[status as CustomerSyncJob['status']]}</Tag> },
      { title: '员工进度', render: (_, row) => `${row.employees}/${row.totalEmployees}` },
      { title: '已读页数', dataIndex: 'pages' },
      { title: '关系记录', dataIndex: 'records' },
      { title: '结果', render: (_, row) => row.error || row.message || (row.updatedAt ? dayjs(row.updatedAt).format('MM-DD HH:mm:ss') : '-') },
      { title: '操作', render: (_, row) => row.status === 'failed' ? <Button size="small" icon={<ReloadOutlined />} disabled={starting} onClick={() => void sync(row.entityId)}>重试</Button> : null },
    ]} /></div>,
    }]} />}
    {entityId && ownerId != null ? <CustomerList key={`${ownerId}:${entityId}`} entityId={entityId} entityName={entities.find(entity => entity.id === entityId)?.name || String(entityId)} ownerId={ownerId} job={jobs.find(job => job.entityId === entityId)} onSync={sync} /> : !loading && !error && <Empty description="暂无主体" />}
  </div>;
}
