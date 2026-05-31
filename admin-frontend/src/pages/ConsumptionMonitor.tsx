import { useEffect, useState, useRef } from 'react';
import { Table, Select, DatePicker, Space, Button, message,
         Modal, Form, Popconfirm, Card, Statistic, Typography } from 'antd';
import { EditOutlined, CheckOutlined, CloseOutlined, LockOutlined,
         EditFilled, DeleteOutlined, SyncOutlined, PlusOutlined, BarChartOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getConsumptionList, getConsumptionTrend, updateConsumption,
         createConsumption, deleteConsumption, type ConsumptionRecord } from '../api/consumption';
import { getEntities, syncEntity, type WecomEntity } from '../api/entities';

const { Text } = Typography;

export default function ConsumptionMonitor() {
  const [records, setRecords] = useState<ConsumptionRecord[]>([]);
  const [entities, setEntities] = useState<WecomEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [entityFilter, setEntityFilter] = useState<number | undefined>(
    () => {
      // 默认选中开开华彩
      const cached = sessionStorage.getItem('cm_entity');
      return cached ? Number(cached) : undefined;
    }
  );
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(30, 'day'), dayjs(),
  ]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [chartData, setChartData] = useState<{ date: string; consumption: number }[]>([]);
  const todayStr = dayjs().format('YYYY-MM-DD');

  const isToday = (record: ConsumptionRecord) => dayjs(record.date).format('YYYY-MM-DD') === todayStr;

  const fetchData = () => {
    setLoading(true);
    const params: any = {
      page: pagination.current,
      pageSize: pagination.pageSize,
      startDate: dateRange[0].format('YYYY-MM-DD'),
      endDate: dateRange[1].format('YYYY-MM-DD'),
    };
    if (entityFilter) params.entityId = entityFilter;

    getConsumptionTrend({ entityId: entityFilter, startDate: params.startDate, endDate: params.endDate })
      .then(setChartData)
      .catch(() => setChartData([]));

    getConsumptionList(params)
      .then((res) => {
        setRecords(res.data);
        setPagination((p) => ({ ...p, total: res.total }));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [entityFilter, dateRange, pagination.current, pagination.pageSize]);

  useEffect(() => {
    getEntities().then((ents) => {
      setEntities(ents);
      // 默认选中开开华彩
      if (!entityFilter) {
        const kai = ents.find((e) => e.name.includes('开开'));
        if (kai) {
          setEntityFilter(kai.id);
          sessionStorage.setItem('cm_entity', String(kai.id));
        }
      }
    });
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      let done = 0;
      const targets = entityFilter
        ? entities.filter((e) => e.id === entityFilter && e.status === 'active')
        : entities.filter((e) => e.status === 'active');
      for (const e of targets) {
        try { await syncEntity(e.id); done++; } catch {}
      }
      message.success(`同步完成: ${done} 个主体`);
      fetchData();
    } finally { setSyncing(false); }
  };

  const startEdit = (record: ConsumptionRecord) => {
    setEditingId(record.id);
    setEditValue(String(record.quotaBalance));
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (record: ConsumptionRecord) => {
    try {
      const val = Number(editValue);
      if (isNaN(val) || val < 0) { message.error('请输入有效数字'); return; }
      await updateConsumption(record.id, { quotaBalance: val });
      message.success('更新成功');
      setEditingId(null);
      fetchData();
    } catch { message.error('保存失败'); }
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      await createConsumption({
        entityId: values.entityId,
        date: values.date.format('YYYY-MM-DD'),
        quotaBalance: Number(values.quotaBalance || 0),
        consumption: Number(values.consumption || 0),
      });
      message.success('新增成功');
      setCreateOpen(false);
      createForm.resetFields();
      fetchData();
    } catch (e: any) {
      if (!e?.errorFields) message.error('操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    try { await deleteConsumption(id); message.success('删除成功'); fetchData(); }
    catch { message.error('删除失败'); }
  };

  const columns = [
    { title: '日期', dataIndex: 'date', key: 'date', width: 120,
      render: (v: string) => <span style={{ fontWeight: 500 }}>{dayjs(v).format('YYYY-MM-DD')}</span> },
    { title: '主体', key: 'entity', width: 140,
      render: (_: any, r: ConsumptionRecord) => r.entity?.name || '-' },
    { title: 'SKU', key: 'sku', width: 80,
      render: (_: any, r: ConsumptionRecord) => r.entity?.sku || '-' },
    { title: '配额余额', dataIndex: 'quotaBalance', key: 'quotaBalance', width: 150,
      render: (v: number, record: ConsumptionRecord) => {
        if (editingId === record.id) {
          return (
            <input
              type="number"
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(record); if (e.key === 'Escape') cancelEdit(); }}
              style={{
                width: 100, padding: '4px 8px', border: '1px solid #1890ff',
                borderRadius: 4, outline: 'none', fontSize: 14,
              }}
            />
          );
        }
        return (
          <span style={{ fontWeight: 500, color: isToday(record) ? '#1890ff' : undefined }}>
            {v.toLocaleString()}
          </span>
        );
      }},
    { title: '今日消耗', dataIndex: 'consumption', key: 'consumption', width: 110,
      render: (v: number) => <span style={{ color: '#cf1322', fontWeight: 500 }}>{v.toLocaleString()}</span> },
    { title: '操作', key: 'action', width: 200,
      render: (_: any, record: ConsumptionRecord) => {
        if (isToday(record)) return <Button size="small" icon={<LockOutlined />} disabled>当日锁定</Button>;
        if (editingId === record.id) {
          return (
            <Space>
              <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => saveEdit(record)}>保存</Button>
              <Button size="small" icon={<CloseOutlined />} onClick={cancelEdit}>取消</Button>
            </Space>
          );
        }
        return (
          <Space>
            <Button size="small" icon={<EditFilled />} onClick={() => startEdit(record)}>编辑</Button>
            <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        );
      }},
  ];

  const totalRecords = pagination.total;
  const todayRecords = records.filter((r) => dayjs(r.date).format('YYYY-MM-DD') === todayStr).length;
  const totalTodayConsumption = records
    .filter((r) => dayjs(r.date).format('YYYY-MM-DD') === todayStr)
    .reduce((sum, r) => sum + r.consumption, 0);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 4px 0', fontSize: 20, fontWeight: 600 }}>消耗监控</h2>
        <Text type="secondary">每日消耗记录与趋势分析</Text>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <div style={{
          flex: 1, padding: '16px 20px',
          background: 'linear-gradient(135deg, #fff7e6 0%, #fffbe6 100%)',
          borderRadius: 8, border: '1px solid #ffe58f',
        }}>
          <Statistic title="查询记录" value={totalRecords} suffix="条"
            valueStyle={{ fontSize: 24, fontWeight: 600 }} />
        </div>
        <div style={{
          flex: 1, padding: '16px 20px',
          background: 'linear-gradient(135deg, #e6f7ff 0%, #f0f5ff 100%)',
          borderRadius: 8, border: '1px solid #d6e4ff',
        }}>
          <Statistic title="今日记录" value={todayRecords} suffix="条"
            valueStyle={{ fontSize: 24, fontWeight: 600, color: '#1890ff' }} />
        </div>
        <div style={{
          flex: 1, padding: '16px 20px',
          background: 'linear-gradient(135deg, #fff2f0 0%, #fff1f0 100%)',
          borderRadius: 8, border: '1px solid #ffccc7',
        }}>
          <Statistic title="今日消耗" value={totalTodayConsumption}
            valueStyle={{ fontSize: 24, fontWeight: 600, color: '#cf1322' }} />
        </div>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        marginBottom: 16, padding: '12px 16px',
        background: '#fafafa', borderRadius: 8,
      }}>
        <Select
          placeholder="选择主体" allowClear style={{ width: 200 }}
          value={entityFilter} onChange={(v) => {
            setEntityFilter(v);
            if (v) sessionStorage.setItem('cm_entity', String(v));
            else sessionStorage.removeItem('cm_entity');
            setPagination((p) => ({ ...p, current: 1 }));
          }}
          options={entities.map((e) => ({ label: e.name, value: e.id }))}
        />
        <DatePicker.RangePicker
          value={dateRange}
          onChange={(dates) => {
            if (dates?.[0] && dates[1]) {
              setDateRange([dates[0], dates[1]]);
              setPagination((p) => ({ ...p, current: 1 }));
            }
          }}
        />
        <div style={{ flex: 1 }} />
        <Button icon={<SyncOutlined spin={syncing} />} onClick={handleSync} loading={syncing}>同步</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新增记录</Button>
      </div>

      {chartData.length > 0 && (
        <Card
          size="small"
          title={<span><BarChartOutlined style={{ marginRight: 8 }} />每日消耗趋势</span>}
          style={{ marginBottom: 16, borderRadius: 8 }}
        >
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <defs>
                <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1890ff" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#1890ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{ borderRadius: 6, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                formatter={(value: any) => [Number(value).toLocaleString(), '消耗量']}
              />
              <Line type="monotone" dataKey="consumption" name="每日消耗"
                stroke="#1890ff" strokeWidth={2.5}
                dot={{ r: 3, fill: '#1890ff', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#1890ff', stroke: '#fff', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Table
        dataSource={records} columns={columns} rowKey="id" loading={loading}
        size="middle"
        pagination={{
          ...pagination, showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, pageSize) => setPagination({ ...pagination, current: page, pageSize }),
        }}
      />

      <Modal title="新增消耗记录" open={createOpen} onOk={handleCreate}
        onCancel={() => setCreateOpen(false)} destroyOnClose width={420}>
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="entityId" label="主体" rules={[{ required: true }]}>
            <Select placeholder="选择主体"
              options={entities.filter((e) => e.status === 'active').map((e) => ({ label: e.name, value: e.id }))} />
          </Form.Item>
          <Form.Item name="date" label="日期" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="quotaBalance" label="配额余额">
            <input type="number" placeholder="0"
              style={{ width: '100%', padding: '4px 11px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 14, lineHeight: '22px' }}
              onChange={(e) => createForm.setFieldValue('quotaBalance', e.target.value)} />
          </Form.Item>
          <Form.Item name="consumption" label="消耗量">
            <input type="number" placeholder="0"
              style={{ width: '100%', padding: '4px 11px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 14, lineHeight: '22px' }}
              onChange={(e) => createForm.setFieldValue('consumption', e.target.value)} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
