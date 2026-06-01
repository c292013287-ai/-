import { useEffect, useState } from 'react';
import { Table, Select, DatePicker, Space, Button, Modal, Form, Input, InputNumber, Popconfirm, message, Tag } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, DollarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getEntities, type WecomEntity } from '../api/entities';
import { getRecharges, createRecharge, updateRecharge, deleteRecharge, type RechargeRecord } from '../api/recharges';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';

const methodColors: Record<string, string> = { '银行转账': 'blue', '微信支付': 'green', '支付宝': 'cyan', '现金': 'orange', '其他': 'default' };

export default function RechargePage() {
  const [data, setData] = useState<RechargeRecord[]>([]);
  const [entities, setEntities] = useState<WecomEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState<number | undefined>();
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const fetchData = () => {
    setLoading(true);
    const params: any = { page: pagination.current, pageSize: pagination.pageSize };
    if (entityFilter) params.entityId = entityFilter;
    if (dateRange[0]) params.startDate = dateRange[0].format('YYYY-MM-DD');
    if (dateRange[1]) params.endDate = dateRange[1].format('YYYY-MM-DD');
    getRecharges(params).then(res => { setData(res.data); setPagination(p => ({ ...p, total: res.total })); setMonthlyTotal(res.monthlyTotal); }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [entityFilter, dateRange, pagination.current, pagination.pageSize]);
  useEffect(() => { getEntities().then(setEntities); }, []);

  const openCreate = () => { setEditingId(null); form.resetFields(); form.setFieldsValue({ rechargeDate: dayjs(), method: '银行转账' }); setModalOpen(true); };
  const openEdit = (r: RechargeRecord) => { setEditingId(r.id); form.setFieldsValue({ entityId: r.entityId, amount: r.amount, rechargeDate: dayjs(r.rechargeDate), method: r.method, remark: r.remark || '' }); setModalOpen(true); };
  const handleDelete = async (id: number) => { try { await deleteRecharge(id); message.success('删除成功'); fetchData(); } catch { message.error('删除失败'); } };

  const handleSubmit = async () => {
    try {
      const v = await form.validateFields();
      setSubmitting(true);
      const b = { entityId: v.entityId, amount: v.amount, rechargeDate: v.rechargeDate.format('YYYY-MM-DD'), method: v.method, remark: v.remark || undefined };
      if (editingId) { await updateRecharge(editingId, b); message.success('更新成功'); }
      else { await createRecharge(b); message.success('新增成功'); }
      setModalOpen(false); fetchData();
    } catch (e: any) { if (!e?.errorFields) message.error('操作失败'); }
    finally { setSubmitting(false); }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60, align: 'center' as const },
    { title: '主体', key: 'entity', width: 130, render: (_: any, r: RechargeRecord) => <span style={{ fontWeight: 500 }}>{r.entity?.name || '-'}</span> },
    { title: 'SKU', key: 'sku', width: 80, render: (_: any, r: RechargeRecord) => r.entity?.sku || '-' },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 120, render: (v: number) => <span style={{ color: '#52c41a', fontWeight: 600, fontSize: 15 }}>¥{v.toLocaleString()}</span> },
    { title: '日期', dataIndex: 'rechargeDate', key: 'rechargeDate', width: 120, render: (v: string) => dayjs(v).format('YYYY-MM-DD') },
    { title: '方式', dataIndex: 'method', key: 'method', width: 90, render: (v: string) => <Tag color={methodColors[v] || 'default'}>{v}</Tag> },
    { title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true, render: (v: string | null) => v || '-' },
    { title: '操作', key: 'action', width: 140,
      render: (_: any, r: RechargeRecord) => (<Space><Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button><Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm></Space>) },
  ];

  return (
    <div>
      <PageHeader title="充值记录" desc="各主体充值明细与本月汇总" />

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <StatCard title="本月充值总额" value={monthlyTotal} suffix="元" gradient="green" color="#52c41a" prefix={<DollarOutlined style={{ color: '#52c41a' }} />} />
        <StatCard title="充值笔数" value={pagination.total} suffix="笔" gradient="blue" color="#1890ff" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '12px 16px', background: '#fafafa', borderRadius: 8 }}>
        <Select placeholder="全部主体" allowClear style={{ width: 200 }} value={entityFilter} onChange={v => { setEntityFilter(v); setPagination(p => ({ ...p, current: 1 })); }} options={entities.map(e => ({ label: e.name, value: e.id }))} />
        <DatePicker.RangePicker value={dateRange} onChange={d => { if (d?.[0] && d[1]) { setDateRange([d[0], d[1]]); setPagination(p => ({ ...p, current: 1 })); } }} />
        <div style={{ flex: 1 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增充值</Button>
      </div>

      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="middle"
        pagination={{ ...pagination, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条`, onChange: (page, pageSize) => setPagination({ ...pagination, current: page, pageSize }) }} />

      <Modal title={editingId ? '编辑充值' : '新增充值'} open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)} confirmLoading={submitting} destroyOnClose width={480}>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="entityId" label="主体" rules={[{ required: true }]}><Select options={entities.map(e => ({ label: e.name, value: e.id }))} /></Form.Item>
          <Form.Item name="amount" label="充值金额" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={1} /></Form.Item>
          <Form.Item name="rechargeDate" label="充值日期" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="method" label="充值方式"><Select options={[{ label: '银行转账', value: '银行转账' }, { label: '微信支付', value: '微信支付' }, { label: '支付宝', value: '支付宝' }, { label: '现金', value: '现金' }, { label: '其他', value: '其他' }]} /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
