import { useEffect, useState } from 'react';
import { Table, Select, DatePicker, Space, Button, Modal, Form, Input, InputNumber, Popconfirm, message, Tag, Upload, Alert } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, DollarOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import { getEntities, type WecomEntity } from '../api/entities';
import { getRecharges, createRecharge, updateRecharge, deleteRecharge, type RechargeRecord } from '../api/recharges';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';

const methodColors: Record<string, string> = { '微信支付': 'green', '线下打款': 'blue', '余额支付': 'orange' };
const PAYMENT_OPTIONS = [{ label: '微信支付', value: '微信支付' }, { label: '线下打款', value: '线下打款' }, { label: '余额支付', value: '余额支付' }];

export default function RechargePage() {
  const [data, setData] = useState<RechargeRecord[]>([]);
  const [entities, setEntities] = useState<WecomEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState<number | undefined>();
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<any[]>([]);
  const [uploadFileName, setUploadFileName] = useState('');
  const [importing, setImporting] = useState(false);

  const fetchData = () => {
    setLoading(true);
    const params: any = { page: pagination.current, pageSize: pagination.pageSize };
    if (entityFilter) params.entityId = entityFilter;
    if (dateRange) {
      if (dateRange[0]) params.startDate = dateRange[0].format('YYYY-MM-DD');
      if (dateRange[1]) params.endDate = dateRange[1].format('YYYY-MM-DD');
    }
    getRecharges(params).then(res => { setData(res.data); setPagination(p => ({ ...p, total: res.total })); setMonthlyTotal(res.monthlyTotal); }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [entityFilter, dateRange, pagination.current, pagination.pageSize]);
  useEffect(() => { getEntities().then(setEntities); }, []);

  const openCreate = () => { setEditingId(null); form.resetFields(); form.setFieldsValue({ rechargeDate: dayjs(), method: '微信支付' }); setModalOpen(true); };
  const openEdit = (r: RechargeRecord) => {
    setEditingId(r.id);
    form.setFieldsValue({ entityId: r.entityId, amount: r.amount, rechargeDate: dayjs(r.rechargeDate), method: r.method, orderNumber: r.orderNumber || '', feeAmount: r.feeAmount, remark: r.remark || '' });
    setModalOpen(true);
  };
  const handleDelete = async (id: number) => { try { await deleteRecharge(id); message.success('删除成功'); fetchData(); } catch { message.error('删除失败'); } };
  const handleSubmit = async () => {
    try {
      const v = await form.validateFields();
      setSubmitting(true);
      const b = { entityId: v.entityId, amount: v.amount, rechargeDate: v.rechargeDate.format('YYYY-MM-DD HH:mm'), method: v.method, orderNumber: v.orderNumber || undefined, feeAmount: v.feeAmount, remark: v.remark || undefined };
      if (editingId) { await updateRecharge(editingId, b); message.success('更新成功'); } else { await createRecharge(b); message.success('新增成功'); }
      setModalOpen(false); fetchData();
    } catch (e: any) { if (!e?.errorFields) message.error('操作失败'); } finally { setSubmitting(false); }
  };

  const handleDownload = async () => {
    try {
      const res = await getRecharges({ pageSize: 99999 });
      const sheetData = [['企业微信ID', '主体', 'SKU', '充值数量', '下单日期', '支付方式', '订单编号', '费用金额', '备注']];
      for (const r of res.data) sheetData.push([r.entity?.corpid || '', r.entity?.name || '', r.entity?.sku || '', String(r.amount), dayjs(r.rechargeDate).format('YYYY-MM-DD HH:mm'), r.method, r.orderNumber || '', r.feeAmount != null ? String(r.feeAmount) : '', r.remark || '']);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetData), '充值记录');
      XLSX.writeFile(wb, '充值记录.xlsx');
      message.success(`已导出 ${res.data.length} 条记录`);
    } catch { message.error('导出失败'); }
  };

  const handleDownloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['企业微信ID', '主体', 'SKU', '充值数量', '下单日期', '支付方式', '订单编号', '费用金额', '备注'], ['', '开合万象', '声乐', '1000', '2026-06-01 14:30', '微信支付', 'ORD123456', '980', '']]), '模板');
    XLSX.writeFile(wb, '充值记录导入模板.xlsx');
  };

  const handleUpload = (file: File) => {
    setUploadFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(new Uint8Array(e.target?.result as ArrayBuffer), { type: 'array' });
      const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      if (rows.length < 2) { message.error('文件为空'); return; }
      const entityMap = new Map(entities.map(e => [e.name, e]));
      const preview: any[] = [];
      const dataRows = String(rows[0]?.[0] || '').includes('企业微信') ? rows.slice(1) : rows;
      dataRows.forEach((cols, i) => {
        if (!cols || cols.every(c => c == null || c === '')) return;
        const name = String(cols[1] || '').trim(); if (!name) return;
        const entity = entityMap.get(name); if (!entity) return;
        preview.push({ entityId: entity.id, entityName: name, sku: String(cols[2] || '').trim(), amount: Number(cols[3]) || 0, rechargeDate: String(cols[4] || '').trim(), method: String(cols[5] || '').trim() || '微信支付', orderNumber: String(cols[6] || '').trim(), feeAmount: cols[7] != null ? Number(cols[7]) : null, remark: String(cols[8] || '').trim(), _line: i + 2 });
      });
      setUploadPreview(preview); setUploadModalOpen(true);
    };
    reader.readAsArrayBuffer(file);
    return false;
  };

  const handleImport = async () => {
    setImporting(true); let done = 0;
    try {
      for (const row of uploadPreview) {
        await createRecharge({ entityId: row.entityId, amount: row.amount, rechargeDate: row.rechargeDate, method: row.method, orderNumber: row.orderNumber || undefined, feeAmount: row.feeAmount || undefined, remark: row.remark || undefined });
        done++;
      }
      message.success(`成功导入 ${done} 条`); setUploadModalOpen(false); fetchData();
    } catch { message.error(`已导入 ${done} 条，部分失败`); } finally { setImporting(false); }
  };

  const columns = [
    { title: '企业微信ID', key: 'corpid', width: 160, ellipsis: true, render: (_: any, r: RechargeRecord) => <code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: 3, fontSize: 12 }}>{r.entity?.corpid || '-'}</code> },
    { title: '主体', key: 'entity', width: 130, render: (_: any, r: RechargeRecord) => <span style={{ fontWeight: 500 }}>{r.entity?.name || '-'}</span> },
    { title: 'SKU', key: 'sku', width: 80, render: (_: any, r: RechargeRecord) => r.entity?.sku || '-' },
    { title: '充值数量', dataIndex: 'amount', width: 110, render: (v: number) => <span style={{ color: '#52c41a', fontWeight: 600 }}>{v.toLocaleString()}</span> },
    { title: '下单日期', dataIndex: 'rechargeDate', width: 120, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: '支付方式', dataIndex: 'method', width: 90, render: (v: string) => <Tag color={methodColors[v] || 'default'}>{v}</Tag> },
    { title: '订单编号', dataIndex: 'orderNumber', width: 140, ellipsis: true, render: (v: string | null) => v || '-' },
    { title: '费用金额', dataIndex: 'feeAmount', width: 100, render: (v: number | null) => v != null ? <span style={{ color: '#fa8c16' }}>¥{v.toLocaleString()}</span> : '-' },
    { title: '操作', key: 'action', width: 140, render: (_: any, r: RechargeRecord) => (<Space><Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button><Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm></Space>) },
  ];

  return (
    <div>
      <PageHeader title="充值记录" desc="各主体充值明细与本月汇总" />
      <div className="summary-grid">
        <StatCard title="本月充值总额" value={monthlyTotal} suffix="元" gradient="green" color="#52c41a" prefix={<DollarOutlined style={{ color: '#52c41a' }} />} />
        <StatCard title="充值笔数" value={pagination.total} suffix="笔" gradient="blue" color="#1890ff" />
      </div>
      <div className="filter-bar">
        <Select placeholder="全部主体" allowClear style={{ width: 200 }} value={entityFilter} onChange={v => { setEntityFilter(v); setPagination(p => ({ ...p, current: 1 })); }} options={entities.map(e => ({ label: e.name, value: e.id }))} />
        <DatePicker.RangePicker value={dateRange} allowClear onChange={d => { setDateRange(d as any); setPagination(p => ({ ...p, current: 1 })); }} />
        <div className="filter-bar-spacer" />
        <Button icon={<DownloadOutlined />} onClick={handleDownload}>下载</Button>
        <Upload accept=".xlsx,.xls,.csv" showUploadList={false} beforeUpload={handleUpload}><Button icon={<UploadOutlined />}>上传</Button></Upload>
        <Button type="link" size="small" onClick={handleDownloadTemplate} style={{ padding: 0 }}>下载模板</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增充值</Button>
      </div>
      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="middle" scroll={{ x: 1300 }} pagination={{ ...pagination, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条`, onChange: (page, pageSize) => setPagination({ ...pagination, current: page, pageSize }) }} />
      <Modal title={editingId ? '编辑充值' : '新增充值'} open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)} confirmLoading={submitting} destroyOnClose width={500}>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="entityId" label="主体" rules={[{ required: true }]}><Select options={entities.map(e => ({ label: e.name, value: e.id }))} /></Form.Item>
          <Form.Item name="amount" label="充值数量" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={1} /></Form.Item>
          <Form.Item name="rechargeDate" label="下单日期" rules={[{ required: true }]}><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="method" label="支付方式"><Select options={PAYMENT_OPTIONS} /></Form.Item>
          <Form.Item name="orderNumber" label="订单编号"><Input /></Form.Item>
          <Form.Item name="feeAmount" label="费用金额"><InputNumber style={{ width: '100%' }} min={0} placeholder="如手续费等" /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
      <Modal title={`导入预览 — ${uploadFileName}`} open={uploadModalOpen} onOk={handleImport} onCancel={() => setUploadModalOpen(false)} confirmLoading={importing} okText="确认导入" width={900}>
        <Alert message={`共解析 ${uploadPreview.length} 条记录，请确认后导入`} type="info" showIcon style={{ marginBottom: 16 }} />
        <Table dataSource={uploadPreview} rowKey="_line" size="small" pagination={false} scroll={{ y: 300 }}
          columns={[
            { title: '行', dataIndex: '_line', width: 50 }, { title: '主体', dataIndex: 'entityName', width: 120 }, { title: 'SKU', dataIndex: 'sku', width: 80 },
            { title: '充值数量', dataIndex: 'amount', width: 100 }, { title: '下单日期', dataIndex: 'rechargeDate', width: 110 }, { title: '支付方式', dataIndex: 'method', width: 90 },
            { title: '订单编号', dataIndex: 'orderNumber', width: 130 }, { title: '费用金额', dataIndex: 'feeAmount', width: 100, render: (v: number | null) => v != null ? v : '-' }, { title: '备注', dataIndex: 'remark', ellipsis: true },
          ]}
        />
      </Modal>
    </div>
  );
}
