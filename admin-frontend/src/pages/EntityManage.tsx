import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Space, Tag, message } from 'antd';
import { PlusOutlined, EditOutlined, ReloadOutlined, SyncOutlined, TeamOutlined } from '@ant-design/icons';
import { getEntities, createEntity, updateEntity, syncEntity, type WecomEntity, type EntityFormData } from '../api/entities';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';

export default function EntityManage() {
  const [entities, setEntities] = useState<WecomEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const fetchData = () => { setLoading(true); getEntities().then(setEntities).finally(() => setLoading(false)); };
  useEffect(() => { fetchData(); }, []);

  const handleCreate = () => { setEditingId(null); form.resetFields(); setModalOpen(true); };
  const handleEdit = (e: WecomEntity) => { setEditingId(e.id); form.setFieldsValue(e); setModalOpen(true); };

  const handleSync = async (id: number, name: string) => {
    message.loading({ content: `正在同步「${name}」...`, key: 'sync' });
    try { await syncEntity(id); message.success({ content: `「${name}」同步完成`, key: 'sync' }); fetchData(); }
    catch { message.error({ content: '同步失败', key: 'sync' }); }
  };

  const handleSubmit = async () => {
    try {
      const v = await form.validateFields();
      setSubmitting(true);
      const d: EntityFormData = { name: v.name, sku: v.sku, corpid: v.corpid, secret: v.secret, quotaTotal: v.quotaTotal };
      if (editingId) { await updateEntity(editingId, d); message.success('更新成功'); }
      else { await createEntity(d); message.success('创建成功'); }
      setModalOpen(false); fetchData();
    } catch (e: any) { if (!e?.errorFields) message.error('操作失败'); }
    finally { setSubmitting(false); }
  };

  const activeCount = entities.filter(e => e.status === 'active').length;

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60, align: 'center' as const },
    { title: 'SKU', dataIndex: 'sku', key: 'sku', width: 90, render: (v: string | null) => v ? <Tag color="blue">{v}</Tag> : '-' },
    { title: '主体名称', dataIndex: 'name', key: 'name', render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span> },
    { title: '企业ID', dataIndex: 'corpid', key: 'corpid', width: 180, ellipsis: true,
      render: (v: string) => <code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: 3, fontSize: 12 }}>{v}</code> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, align: 'center' as const,
      render: (s: string) => <Tag color={s === 'active' ? 'green' : 'orange'}>{s === 'active' ? '启用' : '停用'}</Tag> },
    { title: '配额总量', dataIndex: 'quotaTotal', key: 'quotaTotal', width: 110, render: (v: number) => <span style={{ color: '#1890ff' }}>{v.toLocaleString()}</span> },
    { title: '配额余额', dataIndex: 'quotaBalance', key: 'quotaBalance', width: 110,
      render: (v: number) => <span style={{ color: v < 5000 ? '#ff4d4f' : '#52c41a', fontWeight: v < 5000 ? 600 : 400 }}>{v.toLocaleString()}</span> },
    { title: '最后同步', dataIndex: 'lastSyncAt', key: 'lastSyncAt', width: 170, render: (v: string | null) => v ? new Date(v).toLocaleString() : '-' },
    { title: '操作', key: 'action', width: 230,
      render: (_: any, r: WecomEntity) => (
        <Space>
          <Button size="small" icon={<SyncOutlined />} onClick={() => handleSync(r.id, r.name)}>同步</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
        </Space>
      )},
  ];

  return (
    <div>
      <PageHeader title="主体管理" desc="管理企微获客主体配置与同步状态"
        extra={<Space><Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>添加主体</Button></Space>} />

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <StatCard title="主体总数" value={entities.length} suffix="个" gradient="green" prefix={<TeamOutlined style={{ color: '#52c41a' }} />} />
        <StatCard title="启用中" value={activeCount} suffix="个" gradient="blue" color="#1890ff" />
      </div>

      <Table dataSource={entities} columns={columns} rowKey="id" loading={loading} size="middle"
        pagination={{ pageSize: 20, showTotal: (t: number) => `共 ${t} 个主体` }} />

      <Modal title={editingId ? '编辑主体' : '添加主体'} open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)} confirmLoading={submitting} destroyOnClose width={480}>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="主体名称" rules={[{ required: true }]}><Input placeholder="例如：开开华彩文艺" /></Form.Item>
          <Form.Item name="sku" label="SKU"><Input placeholder="可选，如 声乐" /></Form.Item>
          <Form.Item name="corpid" label="企业ID" rules={[{ required: true }]}><Input placeholder="wwxxxxxxxxxxxxxx" /></Form.Item>
          <Form.Item name="secret" label="应用Secret" rules={[{ required: true }]}><Input.Password placeholder="获客助手应用的Secret" /></Form.Item>
          <Form.Item name="quotaTotal" label="配额总量"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
