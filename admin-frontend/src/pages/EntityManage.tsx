import { useEffect, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, Space, Tag,
  Popconfirm, message, Card,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  getEntities, createEntity, updateEntity, deleteEntity,
  type WecomEntity, type EntityFormData,
} from '../api/entities';

export default function EntityManage() {
  const [entities, setEntities] = useState<WecomEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<WecomEntity | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const fetchEntities = () => {
    setLoading(true);
    getEntities()
      .then(setEntities)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchEntities(); }, []);

  const handleCreate = () => {
    setEditingEntity(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleEdit = (entity: WecomEntity) => {
    setEditingEntity(entity);
    form.setFieldsValue(entity);
    setModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteEntity(id);
      message.success('删除成功');
      fetchEntities();
    } catch {
      message.error('删除失败');
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      const formData: EntityFormData = {
        name: values.name,
        corpid: values.corpid,
        secret: values.secret,
        quotaTotal: values.quotaTotal,
      };

      if (editingEntity) {
        await updateEntity(editingEntity.id, formData);
        message.success('更新成功');
      } else {
        await createEntity(formData);
        message.success('创建成功');
      }

      setModalOpen(false);
      fetchEntities();
    } catch (error: any) {
      if (error.errorFields) return; // 表单验证错误
      message.error('操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '主体名称', dataIndex: 'name', key: 'name' },
    { title: '企业ID', dataIndex: 'corpid', key: 'corpid', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (status: string) => (
        <Tag color={status === 'active' ? 'green' : 'red'}>
          {status === 'active' ? '启用' : '停用'}
        </Tag>
      ),
    },
    {
      title: '配额总量',
      dataIndex: 'quotaTotal',
      key: 'quotaTotal',
      width: 100,
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '配额余额',
      dataIndex: 'quotaBalance',
      key: 'quotaBalance',
      width: 100,
      render: (v: number) => (
        <span style={{ color: v < 1000 ? '#ff4d4f' : '#52c41a' }}>{v.toLocaleString()}</span>
      ),
    },
    {
      title: '最后同步',
      dataIndex: 'lastSyncAt',
      key: 'lastSyncAt',
      width: 170,
      render: (v: string | null) => v ? new Date(v).toLocaleString() : '未同步',
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_: any, record: WecomEntity) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定删除该主体？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="主体管理"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchEntities}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              添加主体
            </Button>
          </Space>
        }
      >
        <Table
          dataSource={entities}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20 }}
        />
      </Card>

      <Modal
        title={editingEntity ? '编辑主体' : '添加主体'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="主体名称"
            rules={[{ required: true, message: '请输入主体名称' }]}
          >
            <Input placeholder="例如：主体A-科技公司" />
          </Form.Item>
          <Form.Item
            name="corpid"
            label="企业ID (corpid)"
            rules={[{ required: true, message: '请输入企业ID' }]}
          >
            <Input placeholder="wwxxxxxxxxxxxxxx" />
          </Form.Item>
          <Form.Item
            name="secret"
            label="应用 Secret"
            rules={[{ required: true, message: '请输入应用Secret' }]}
          >
            <Input.Password placeholder="获客助手应用的 Secret" />
          </Form.Item>
          <Form.Item
            name="quotaTotal"
            label="配额总量"
          >
            <InputNumber style={{ width: '100%' }} min={0} placeholder="10000" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
