import { useEffect, useState } from 'react';
import { Table, Tag, Button, message, Modal, Form, Input, Select, Popconfirm, Space, Typography } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, KeyOutlined, UserOutlined } from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';

const { Text } = Typography;

interface User {
  id: number;
  username: string;
  name: string;
  role: string;
  status: string;
  createdAt: string;
}

const roleMap: Record<string, { color: string; text: string }> = {
  admin: { color: 'red', text: '管理员' },
  editor: { color: 'blue', text: '编辑者' },
  viewer: { color: 'green', text: '观察者' },
};

const statusMap: Record<string, { color: string; text: string }> = {
  active: { color: 'green', text: '正常' },
  disabled: { color: 'red', text: '已禁用' },
};

// 模拟数据 — 后续对接后端 API
const mockUsers: User[] = [
  { id: 1, username: 'admin', name: '系统管理员', role: 'admin', status: 'active', createdAt: '2026-05-01' },
  { id: 2, username: 'editor', name: '运营编辑', role: 'editor', status: 'active', createdAt: '2026-05-10' },
  { id: 3, username: 'viewer', name: '只读用户', role: 'viewer', status: 'disabled', createdAt: '2026-05-15' },
];

export default function AccountManage() {
  const [data, setData] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [pwdForm] = Form.useForm();

  const fetchData = () => {
    setLoading(true);
    // TODO: 替换为真实 API
    setTimeout(() => { setData(mockUsers); setLoading(false); }, 300);
  };

  useEffect(() => { fetchData(); }, []);

  const openCreate = () => { setEditingId(null); form.resetFields(); form.setFieldsValue({ role: 'viewer', status: 'active' }); setModalOpen(true); };
  const openEdit = (r: User) => { setEditingId(r.id); form.setFieldsValue(r); setModalOpen(true); };
  const openResetPwd = (r: User) => { pwdForm.resetFields(); pwdForm.setFieldsValue({ userId: r.id, username: r.username }); setPwdModalOpen(true); };

  const handleDelete = async (_id: number) => {
    message.success('删除成功（模拟）');
    fetchData();
  };

  const handleSubmit = async () => {
    try {
      await form.validateFields();
      setSubmitting(true);
      message.success(editingId ? '更新成功' : '新增成功');
      setModalOpen(false);
      fetchData();
    } catch {
      // 表单验证未通过
    } finally { setSubmitting(false); }
  };

  const handleResetPwd = async () => {
    try {
      await pwdForm.validateFields();
      setSubmitting(true);
      message.success('密码重置成功（模拟）');
      setPwdModalOpen(false);
    } catch {
      // 验证未通过
    } finally { setSubmitting(false); }
  };

  const total = data.length;
  const activeCount = data.filter((u) => u.status === 'active').length;

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60, align: 'center' as const },
    { title: '用户名', dataIndex: 'username', key: 'username', width: 120, render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span> },
    { title: '姓名', dataIndex: 'name', key: 'name', width: 120 },
    { title: '角色', dataIndex: 'role', key: 'role', width: 90, render: (v: string) => { const m = roleMap[v] || { color: 'default', text: v }; return <Tag color={m.color}>{m.text}</Tag>; }},
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: (v: string) => { const m = statusMap[v] || { color: 'default', text: v }; return <Tag color={m.color}>{m.text}</Tag>; }},
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 120 },
    { title: '操作', key: 'action', width: 200,
      render: (_: any, r: User) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Button size="small" icon={<KeyOutlined />} onClick={() => openResetPwd(r)}>重置密码</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )},
  ];

  return (
    <div>
      <PageHeader title="账号管理" desc="管理系统账号与权限" />

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <StatCard title="账号总数" value={total} suffix="个" gradient="blue" color="#1890ff" prefix={<UserOutlined style={{ color: '#1890ff' }} />} />
        <StatCard title="正常账号" value={activeCount} suffix="个" gradient="green" color="#52c41a" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '12px 16px', background: '#fafafa', borderRadius: 8 }}>
        <Text type="secondary">共 {total} 个账号，{activeCount} 个正常使用中</Text>
        <div style={{ flex: 1 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增账号</Button>
      </div>

      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="middle" pagination={false} />

      <Modal title={editingId ? '编辑账号' : '新增账号'} open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)} confirmLoading={submitting} destroyOnClose width={480}>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input disabled={!!editingId} />
          </Form.Item>
          {!editingId && (
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }, { min: 6, message: '密码至少6位' }]}>
              <Input.Password />
            </Form.Item>
          )}
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select options={[{ label: '管理员', value: 'admin' }, { label: '编辑者', value: 'editor' }, { label: '观察者', value: 'viewer' }]} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select options={[{ label: '正常', value: 'active' }, { label: '已禁用', value: 'disabled' }]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="重置密码" open={pwdModalOpen} onOk={handleResetPwd} onCancel={() => setPwdModalOpen(false)} confirmLoading={submitting} destroyOnClose width={420}>
        <Form form={pwdForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="username" label="账号"><Input disabled /></Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '密码至少6位' }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
