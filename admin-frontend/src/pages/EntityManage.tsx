import { useEffect, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, Space, Tag,
  Popconfirm, message, Typography, Statistic,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, SyncOutlined, TeamOutlined } from '@ant-design/icons';
import {
  getEntities, createEntity, updateEntity, deleteEntity, syncEntity,
  type WecomEntity, type EntityFormData,
} from '../api/entities';

const { Text } = Typography;

export default function EntityManage() {
  const [entities, setEntities] = useState<WecomEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<WecomEntity | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const fetchEntities = () => {
    setLoading(true);
    getEntities().then(setEntities).finally(() => setLoading(false));
  };

  useEffect(() => { fetchEntities(); }, []);

  const handleCreate = () => { setEditingEntity(null); form.resetFields(); setModalOpen(true); };
  const handleEdit = (entity: WecomEntity) => { setEditingEntity(entity); form.setFieldsValue(entity); setModalOpen(true); };

  const handleDelete = async (id: number) => {
    try { await deleteEntity(id); message.success('删除成功'); fetchEntities(); }
    catch { message.error('删除失败'); }
  };

  const handleSync = async (id: number, name: string) => {
    try {
      message.loading({ content: `正在同步「${name}」...`, key: 'sync' });
      const result = await syncEntity(id);
      message.success({ content: `「${name}」同步完成: 配额${result.quotaTotal} 余额${result.quotaBalance}`, key: 'sync' });
      fetchEntities();
    } catch { message.error({ content: '同步失败', key: 'sync' }); }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const formData: EntityFormData = {
        name: values.name, sku: values.sku, corpid: values.corpid,
        secret: values.secret, quotaTotal: values.quotaTotal,
      };
      if (editingEntity) { await updateEntity(editingEntity.id, formData); message.success('更新成功'); }
      else { await createEntity(formData); message.success('创建成功'); }
      setModalOpen(false);
      fetchEntities();
    } catch (error: any) {
      if (error.errorFields) return;
      message.error('操作失败');
    } finally { setSubmitting(false); }
  };

  const activeCount = entities.filter((e) => e.status === 'active').length;

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60, align: 'center' as const },
    { title: 'SKU', dataIndex: 'sku', key: 'sku', width: 90,
      render: (v: string | null) => v ? <Tag color="blue">{v}</Tag> : '-' },
    { title: '主体名称', dataIndex: 'name', key: 'name',
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span> },
    { title: '企业ID', dataIndex: 'corpid', key: 'corpid', width: 180, ellipsis: true,
      render: (v: string) => <Text code>{v}</Text> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, align: 'center' as const,
      render: (status: string) => (
        <Tag color={status === 'active' ? 'green' : 'orange'}>
          {status === 'active' ? '启用' : '停用'}
        </Tag>
      )},
    { title: '配额总量', dataIndex: 'quotaTotal', key: 'quotaTotal', width: 110,
      render: (v: number) => <span style={{ color: '#1890ff' }}>{v.toLocaleString()}</span> },
    { title: '配额余额', dataIndex: 'quotaBalance', key: 'quotaBalance', width: 110,
      render: (v: number) => (
        <span style={{
          color: v < 5000 ? '#ff4d4f' : '#52c41a',
          fontWeight: v < 5000 ? 600 : 400,
        }}>
          {v.toLocaleString()}
        </span>
      )},
    { title: '最后同步', dataIndex: 'lastSyncAt', key: 'lastSyncAt', width: 170,
      render: (v: string | null) => v ? new Date(v).toLocaleString() : <Text type="secondary">未同步</Text> },
    { title: '操作', key: 'action', width: 230,
      render: (_: any, record: WecomEntity) => (
        <Space>
          <Button size="small" icon={<SyncOutlined />}
            onClick={() => handleSync(record.id, record.name)}>同步</Button>
          <Button size="small" icon={<EditOutlined />}
            onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除该主体？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )},
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: '0 0 4px 0', fontSize: 20, fontWeight: 600 }}>主体管理</h2>
          <Text type="secondary">管理企微获客主体配置与同步状态</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchEntities}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>添加主体</Button>
        </Space>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <div style={{
          flex: 1, padding: '16px 20px',
          background: 'linear-gradient(135deg, #f6ffed 0%, #f0fff0 100%)',
          borderRadius: 8, border: '1px solid #b7eb8f',
        }}>
          <Statistic title="主体总数" value={entities.length} suffix="个"
            prefix={<TeamOutlined style={{ color: '#52c41a' }} />}
            valueStyle={{ fontSize: 24, fontWeight: 600 }} />
        </div>
        <div style={{
          flex: 1, padding: '16px 20px',
          background: 'linear-gradient(135deg, #e6f7ff 0%, #f0f5ff 100%)',
          borderRadius: 8, border: '1px solid #d6e4ff',
        }}>
          <Statistic title="启用中" value={activeCount} suffix="个"
            valueStyle={{ fontSize: 24, fontWeight: 600, color: '#1890ff' }} />
        </div>
      </div>

      <Table
        dataSource={entities} columns={columns} rowKey="id"
        loading={loading} size="middle"
        pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 个主体` }}
      />

      <Modal title={editingEntity ? '编辑主体' : '添加主体'} open={modalOpen}
        onOk={handleSubmit} onCancel={() => setModalOpen(false)}
        confirmLoading={submitting} destroyOnClose width={480}>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="主体名称" rules={[{ required: true, message: '请输入主体名称' }]}>
            <Input placeholder="例如：开开华彩文艺" />
          </Form.Item>
          <Form.Item name="sku" label="SKU 编码">
            <Input placeholder="可选，如 声乐" />
          </Form.Item>
          <Form.Item name="corpid" label="企业ID (corpid)" rules={[{ required: true, message: '请输入企业ID' }]}>
            <Input placeholder="wwxxxxxxxxxxxxxx" />
          </Form.Item>
          <Form.Item name="secret" label="应用 Secret" rules={[{ required: true, message: '请输入应用Secret' }]}>
            <Input.Password placeholder="获客助手应用的 Secret" />
          </Form.Item>
          <Form.Item name="quotaTotal" label="配额总量">
            <InputNumber style={{ width: '100%' }} min={0} placeholder="10000" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
