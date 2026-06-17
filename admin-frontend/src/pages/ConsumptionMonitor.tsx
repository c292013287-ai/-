import { useEffect, useState } from 'react';
import { Table, Select, DatePicker, Space, Button, message, Modal, Form, Input, Popconfirm, Card } from 'antd';
import { CheckOutlined, CloseOutlined, LockOutlined,
         EditFilled, DeleteOutlined, SyncOutlined, PlusOutlined, BarChartOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getConsumptionList, getConsumptionTrend, updateConsumption,
         createConsumption, deleteConsumption, type ConsumptionRecord } from '../api/consumption';
import { getEntities, syncEntity, type WecomEntity } from '../api/entities';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';

export default function ConsumptionMonitor() {
  const [records, setRecords] = useState<ConsumptionRecord[]>([]);
  const [entities, setEntities] = useState<WecomEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [entityFilter, setEntityFilter] = useState<number | undefined>();
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().subtract(30, 'day'), dayjs()]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [chartData, setChartData] = useState<{ date: string; consumption: number }[]>([]);

  const fetchData = () => {
    setLoading(true);
    const params: any = { page: pagination.current, pageSize: pagination.pageSize, startDate: dateRange[0].format('YYYY-MM-DD'), endDate: dateRange[1].format('YYYY-MM-DD') };
    if (entityFilter) params.entityId = entityFilter;
    getConsumptionTrend({ entityId: entityFilter || undefined, days: 30 }).then(setChartData).catch(() => setChartData([]));
    getConsumptionList(params).then(res => { setRecords(res.data); setPagination(p => ({ ...p, total: res.total })); }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [entityFilter, dateRange, pagination.current, pagination.pageSize]);

  useEffect(() => { getEntities().then(setEntities); }, []);

  const handleSync = async () => {
    setSyncing(true);
    let done = 0;
    const targets = entityFilter ? entities.filter(e => e.id === entityFilter && e.status === 'active') : entities.filter(e => e.status === 'active');
    for (const e of targets) { try { await syncEntity(e.id); done++; } catch {} }
    message.success(`同步完成: ${done} 个主体`);
    setSyncing(false); fetchData();
  };

  const isToday = (r: ConsumptionRecord) => dayjs(r.date).format('YYYY-MM-DD') === dayjs().format('YYYY-MM-DD');
  const startEdit = (r: ConsumptionRecord) => { setEditingId(r.id); setEditValue(String(r.quotaBalance)); };
  const cancelEdit = () => setEditingId(null);
  const saveEdit = async (r: ConsumptionRecord) => {
    const v = Number(editValue);
    if (isNaN(v) || v < 0) return message.error('请输入有效数字');
    try { await updateConsumption(r.id, { quotaBalance: v }); message.success('更新成功'); setEditingId(null); fetchData(); }
    catch { message.error('保存失败'); }
  };
  const handleCreate = async () => {
    try {
      const v = await createForm.validateFields();
      await createConsumption({ entityId: v.entityId, date: v.date.format('YYYY-MM-DD'), quotaBalance: Number(v.quotaBalance || 0), consumption: Number(v.consumption || 0) });
      message.success('新增成功'); setCreateOpen(false); createForm.resetFields(); fetchData();
    } catch (e: any) { if (!e?.errorFields) message.error('操作失败'); }
  };
  const handleDelete = async (id: number) => { try { await deleteConsumption(id); message.success('删除成功'); fetchData(); } catch { message.error('删除失败'); } };

  const columns = [
    { title: '日期', dataIndex: 'date', key: 'date', width: 120, render: (v: string) => <span style={{ fontWeight: 500 }}>{dayjs(v).format('YYYY-MM-DD')}</span> },
    { title: '主体', key: 'entity', width: 140, render: (_: any, r: ConsumptionRecord) => r.entity?.name || '-' },
    { title: 'SKU', key: 'sku', width: 80, render: (_: any, r: ConsumptionRecord) => r.entity?.sku || '-' },
    { title: '配额余额', dataIndex: 'quotaBalance', key: 'quotaBalance', width: 150,
      render: (v: number, r: ConsumptionRecord) => editingId === r.id ? (
        <input type="number" autoFocus value={editValue} onChange={e => setEditValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') saveEdit(r); if (e.key === 'Escape') cancelEdit(); }}
          style={{ width: 100, padding: '4px 8px', border: '1px solid #1890ff', borderRadius: 4, outline: 'none', fontSize: 14 }} />
      ) : <span style={{ fontWeight: 500, color: isToday(r) ? '#1890ff' : undefined }}>{v.toLocaleString()}</span> },
    { title: '今日消耗', dataIndex: 'consumption', key: 'consumption', width: 110, render: (v: number) => <span style={{ color: '#cf1322', fontWeight: 500 }}>{v.toLocaleString()}</span> },
    { title: '操作', key: 'action', width: 200,
      render: (_: any, r: ConsumptionRecord) => isToday(r) ? <Button size="small" icon={<LockOutlined />} disabled>当日锁定</Button>
        : editingId === r.id ? (
          <Space><Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => saveEdit(r)}>保存</Button><Button size="small" icon={<CloseOutlined />} onClick={cancelEdit}>取消</Button></Space>
        ) : (
          <Space><Button size="small" icon={<EditFilled />} onClick={() => startEdit(r)}>编辑</Button>
            <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm></Space>
        )},
  ];

  const todayRecs = records.filter(r => dayjs(r.date).format('YYYY-MM-DD') === dayjs().format('YYYY-MM-DD'));
  const todayCons = todayRecs.reduce((s, r) => s + r.consumption, 0);

  return (
    <div>
      <PageHeader title="消耗监控" desc="每日消耗记录与趋势分析" />

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <StatCard title="查询记录" value={pagination.total} suffix="条" gradient="orange" />
        <StatCard title="今日记录" value={todayRecs.length} suffix="条" gradient="blue" color="#1890ff" />
        <StatCard title="今日消耗" value={todayCons} gradient="red" color="#cf1322" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16, padding: '12px 16px', background: '#fafafa', borderRadius: 8 }}>
        <Select placeholder="选择主体" allowClear style={{ width: 200 }} value={entityFilter}
          onChange={(v) => { setEntityFilter(v); setPagination(p => ({ ...p, current: 1 })); }}
          options={entities.map(e => ({ label: e.name, value: e.id }))} />
        <DatePicker.RangePicker value={dateRange} onChange={d => { if (d?.[0] && d[1]) { setDateRange([d[0], d[1]]); setPagination(p => ({ ...p, current: 1 })); } }} />
        <div style={{ flex: 1 }} />
        <Button icon={<SyncOutlined spin={syncing} />} onClick={handleSync} loading={syncing}>同步</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新增记录</Button>
      </div>

      {chartData.length > 0 && (
        <Card size="small" title={<span><BarChartOutlined style={{ marginRight: 8 }} />每日消耗趋势</span>} style={{ marginBottom: 16, borderRadius: 8 }}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1890ff" stopOpacity={0.3} /><stop offset="100%" stopColor="#1890ff" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={{ borderRadius: 6, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }} formatter={(v: any) => [Number(v).toLocaleString(), '消耗量']} />
              <Line type="monotone" dataKey="consumption" stroke="#1890ff" strokeWidth={2.5} dot={{ r: 3, fill: '#1890ff', strokeWidth: 0 }} activeDot={{ r: 5, fill: '#1890ff', stroke: '#fff', strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Table dataSource={records} columns={columns} rowKey="id" loading={loading} size="middle"
        pagination={{ ...pagination, showSizeChanger: true, showTotal: t => `共 ${t} 条`, onChange: (page, pageSize) => setPagination({ ...pagination, current: page, pageSize }) }} />

      <Modal title="新增消耗记录" open={createOpen} onOk={handleCreate} onCancel={() => setCreateOpen(false)} destroyOnClose width={420}>
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="entityId" label="主体" rules={[{ required: true }]}><Select options={entities.filter(e => e.status === 'active').map(e => ({ label: e.name, value: e.id }))} /></Form.Item>
          <Form.Item name="date" label="日期" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="quotaBalance" label="配额余额"><Input /></Form.Item>
          <Form.Item name="consumption" label="消耗量"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
