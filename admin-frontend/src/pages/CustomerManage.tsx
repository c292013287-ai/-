import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Avatar, Button, DatePicker, Empty, Input, Select, Space, Table, Tag, Tooltip, message } from 'antd';
import { DownloadOutlined, ReloadOutlined, SearchOutlined, StopOutlined, UserOutlined } from '@ant-design/icons';
import { writeFile } from 'xlsx';
import { buildCustomerWorkbook } from './customerExport';
import dayjs from 'dayjs';
import PageHeader from '../components/PageHeader';
import { useAuthStore } from '../store/authStore';
import { customerCacheKey, readCustomerCache, writeCustomerCache, readCustomerPreference, writeCustomerPreference } from './customerCache';
import { collectCustomers, customerSource, matchesCustomer, type CustomerFilters, type CustomerQueryProgress } from './customerQuery';
import { getEntities, getCustomerFollowers, getCustomers, type Customer, type WecomEntity } from '../api/entities';

const errorText = (error: unknown) => (error as { response?: { data?: { error?: string } } })?.response?.data?.error || (error instanceof Error ? error.message : '加载失败，请重试');

function CustomerList({ entityId, entityName, ownerId }: { entityId: number; entityName: string; ownerId: number }) {
  const preferenceKey = `customer-selection:${ownerId}:${entityId}`;
  const [users, setUsers] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | undefined>(() => readCustomerPreference(preferenceKey).userId);
  const [membersLoading, setMembersLoading] = useState(true);
  const [memberError, setMemberError] = useState('');
  const [memberVersion, setMemberVersion] = useState(0);
  const [items, setItems] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tagWarning, setTagWarning] = useState('');
  const [scope, setScope] = useState<'employee' | 'entity'>(() => readCustomerPreference(preferenceKey).scope === 'entity' ? 'entity' : 'employee');
  const [cacheLoading, setCacheLoading] = useState(true);
  const [cacheWarning, setCacheWarning] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [filters, setFilters] = useState<CustomerFilters>({});
  const [completed, setCompleted] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [progress, setProgress] = useState<CustomerQueryProgress>();
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { writeCustomerPreference(preferenceKey, { scope, userId }); }, [preferenceKey, scope, userId]);
  useEffect(() => {
    let active = true;
    setCacheLoading(true); setCacheWarning(''); setItems([]); setCompleted(false); setUpdatedAt('');
    if (scope === 'employee' && !userId) { setCacheLoading(false); return; }
    (async () => {
      try {
        let snapshot = await readCustomerCache(customerCacheKey(ownerId, entityId, scope === 'entity' ? undefined : userId));
        if (scope === 'employee') {
          const whole = await readCustomerCache(customerCacheKey(ownerId, entityId));
          if (whole && (!snapshot || whole.updatedAt > snapshot.updatedAt)) snapshot = { ...whole, items: whole.items.filter(item => item.userId === userId) };
        }
        if (active && snapshot) {
          setItems(snapshot.items); setTagWarning(snapshot.warning); setUpdatedAt(snapshot.updatedAt); setCompleted(true);
        }
      } catch { if (active) setCacheWarning('浏览器缓存不可用，本次查询结果仅在当前页面保留'); }
      finally { if (active) setCacheLoading(false); }
    })();
    return () => { active = false; };
  }, [ownerId, entityId, scope, userId]);

  const clearResults = () => {
    controller.current?.abort(); controller.current = null;
    setLoading(false); setItems([]); setCompleted(false); setCancelled(false);
    setProgress(undefined); setError(''); setTagWarning(''); setUpdatedAt(''); setPage(1);
  };
  const query = async () => {
    if (cacheLoading || membersLoading || memberError || !users.length || (scope === 'employee' && !userId)) return;
    controller.current?.abort();
    setCancelled(false); setError(''); setProgress(undefined); setPage(1);
    const current = new AbortController(); controller.current = current;
    setLoading(true);
    try {
      const result = await collectCustomers(scope === 'entity' ? users : [userId!],
        (employee, cursor) => getCustomers(entityId, employee, cursor, current.signal), current.signal, setProgress);
      if (controller.current !== current) return;
      const timestamp = new Date().toISOString();
      setItems(result.items); setTagWarning(result.warning); setCompleted(true); setUpdatedAt(timestamp);
      try {
        await writeCustomerCache(customerCacheKey(ownerId, entityId, scope === 'entity' ? undefined : userId), { ...result, updatedAt: timestamp });
        if (controller.current === current) setCacheWarning('');
      } catch { if (controller.current === current) setCacheWarning('缓存保存失败，本次结果仅在当前页面保留'); }
    } catch (e) {
      if (controller.current === current) {
        if (current.signal.aborted) setCancelled(true); else setError(errorText(e));
      }
    } finally { if (controller.current === current) setLoading(false); }
  };
  const filteredItems = useMemo(() => items.filter(item => matchesCustomer(item, filters)), [items, filters]);
  const download = () => {
    if (!completed || loading || cacheLoading || !filteredItems.length || exporting) return;
    setExporting(true);
    try {
      const workbook = buildCustomerWorkbook(filteredItems, {
        entityName, scope: scope === 'entity' ? '整个主体' : `当前员工：${userId}`, updatedAt, filters, sourceLabel: customerSource,
      });
      const safeName = entityName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 60);
      writeFile(workbook, `用户管理_${safeName}_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`);
      message.success(`已导出 ${filteredItems.length} 条客户跟进关系`);
    } catch { message.error('下载失败，请重试或缩小筛选范围'); }
    finally { setExporting(false); }
  };
  const tags = useMemo(() => {
    const result = new Map<string, string>();
    items.forEach(item => item.tags?.forEach(tag => result.set(tag.id, tag.name || tag.id)));
    return [...result].map(([value, label]) => ({ value, label }));
  }, [items]);
  const sources = useMemo(() => [...new Set([0, 1, 2, 3, 4, ...items.flatMap(item => item.addWay == null ? [] : [item.addWay])])]
    .map(value => ({ value, label: customerSource(value) })), [items]);
  const updateFilter = <K extends keyof CustomerFilters>(key: K, value: CustomerFilters[K]) => {
    setFilters(current => ({ ...current, [key]: value })); setPage(1);
  };

  useEffect(() => {
    let active = true;
    setMembersLoading(true);
    setMemberError('');
    getCustomerFollowers(entityId).then(value => {
      if (active) { setUsers(value); setUserId(previous => previous && value.includes(previous) ? previous : value[0]); }
    }).catch(e => { if (active) setMemberError(errorText(e)); })
      .finally(() => { if (active) setMembersLoading(false); });
    return () => { active = false; };
  }, [entityId, memberVersion]);

  return <>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '16px 0' }}>
      <span>查询范围</span>
      <Select aria-label="查询范围" value={scope} style={{ width: 150, maxWidth: '100%' }} options={[{ value: 'employee', label: '当前员工' }, { value: 'entity', label: '整个主体' }]}
        onChange={value => { clearResults(); setScope(value); }} />
      <span>跟进员工</span>
      <Select aria-label="跟进员工" disabled={scope === 'entity'} showSearch optionFilterProp="label" value={userId} loading={membersLoading}
        style={{ width: 280, maxWidth: '100%' }} placeholder="选择员工账号"
        options={users.map(id => ({ value: id, label: id }))}
        onChange={id => { clearResults(); setUserId(id); }} />
      <Button type="primary" icon={completed ? <ReloadOutlined /> : <SearchOutlined />} disabled={cacheLoading || membersLoading || !!memberError || !users.length || loading} onClick={query}>{completed ? '刷新数据' : '查询客户'}</Button>
      {loading && <Button icon={<StopOutlined />} onClick={() => controller.current?.abort()}>取消查询</Button>}
      <Button icon={<ReloadOutlined />} onClick={() => { setFilters({}); setPage(1); }}>重置筛选</Button>
      <Button icon={<DownloadOutlined />} loading={exporting} disabled={!completed || loading || cacheLoading || !filteredItems.length} onClick={download}>下载 Excel</Button>
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
    {loading && <Alert type="info" showIcon message={`正在读取全部分页：员工 ${progress?.employees || 0}/${scope === 'entity' ? users.length : 1}，已读 ${progress?.pages || 0} 页、${progress?.records || 0} 条关系记录`} />}
    {cancelled && <Alert type="warning" showIcon message="查询已取消，未展示不完整结果" />}
    {memberError && <Alert type="error" showIcon message={memberError} action={<Button onClick={() => setMemberVersion(v => v + 1)}>重试</Button>} />}
    {error && <Alert type="error" showIcon message={`查询未完成：${error}`} action={<Button onClick={query}>重试</Button>} />}
    {tagWarning && <Alert type="warning" showIcon message={tagWarning} />}
    {cacheWarning && <Alert type="warning" showIcon message={cacheWarning} />}
    {completed && <div style={{ margin: '12px 0' }}>数据更新时间：{dayjs(updatedAt).format('YYYY-MM-DD HH:mm:ss')} · 共 {items.length} 条客户跟进关系 · 符合筛选 {filteredItems.length} 条</div>}
    <Table<Customer> rowKey={r => JSON.stringify([r.externalUserId, r.userId])} dataSource={filteredItems} loading={cacheLoading || (!completed && (loading || membersLoading))}
      pagination={{ current: page, onChange: setPage, defaultPageSize: 20, showSizeChanger: true, showTotal: total => `共 ${total} 条客户跟进关系` }} size="middle" scroll={{ x: 2650 }}
      locale={{ emptyText: <Empty description={error || memberError ? '客户信息加载失败' : cancelled ? '查询已取消' : !completed ? '待查询' : '无符合条件的客户'} /> }}
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
  return <div>
    <PageHeader title="用户管理" />
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => setVersion(v => v + 1)}>重试</Button>} />}
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <span>主体</span>
      <Select aria-label="主体" showSearch optionFilterProp="label" loading={loading} value={entityId}
        onChange={value => { setEntityId(value); writeCustomerPreference(preferenceKey, { entityId: value }); }} placeholder="选择主体" style={{ width: 300, maxWidth: '100%' }}
        options={entities.map(entity => ({ value: entity.id, label: entity.name }))} />
    </div>
    {entityId && ownerId != null ? <CustomerList key={`${ownerId}:${entityId}`} entityId={entityId} entityName={entities.find(entity => entity.id === entityId)?.name || String(entityId)} ownerId={ownerId} /> : !loading && !error && <Empty description="暂无主体" />}
  </div>;
}
