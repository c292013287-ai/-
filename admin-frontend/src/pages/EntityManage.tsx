import { useEffect, useState } from 'react';
import { Alert, DatePicker, Table, Button, Modal, Form, Input, Space, Tag, Popconfirm, message } from 'antd';
import dayjs from 'dayjs';
import { certificationStatus } from './entityCertification';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SyncOutlined, TeamOutlined } from '@ant-design/icons';
import { getManagedEntities, createEntity, updateEntity, deleteEntity, syncEntity, syncServedUsers, getServedUserJobs, type ServedUserJob, type WecomEntity, type EntityFormData } from '../api/entities';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';

export default function EntityManage() {
  const [entities, setEntities] = useState<WecomEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [submittingCounts, setSubmittingCounts] = useState<number[]>([]);
  const [jobs, setJobs] = useState<ServedUserJob[]>([]);
  const [progressError, setProgressError] = useState('');
  const [countErrors, setCountErrors] = useState<Record<number, string>>({});
  const [form] = Form.useForm();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const fetchData = () => {
    setLoading(true);
    setLoadError('');
    getManagedEntities().then(setEntities).catch(() => setLoadError('主体列表加载失败，请重试或检查本地数据库。')).finally(() => setLoading(false));
  };
  useEffect(() => { fetchData(); }, []);
  useEffect(() => {
    let stopped = false;
    let timer: number;
    const poll = async () => {
      try {
        const next = await getServedUserJobs();
        if (stopped) return;
        setJobs(previous => [...next, ...previous.filter(job =>
          ['running', 'queued', 'failed'].includes(job.status) && !next.some(item => item.entityId === job.entityId),
        ).map(job => Date.now() - Date.parse(job.startedAt) <= 10000 ? job
          : { ...job, status: 'failed' as const, error: '后台任务已中断，请重新统计' })]);
        setProgressError('');
        setEntities(current => current.map(entity => {
          const result = next.find(job => job.entityId === entity.id && job.status === 'completed')?.result;
          return result && (!entity.servedUserCountUpdatedAt || result.servedUserCountUpdatedAt >= entity.servedUserCountUpdatedAt)
            ? { ...entity, ...result } : entity;
        }));
      } catch {
        if (!stopped) setProgressError('统计进度连接中断，正在重试');
      } finally {
        if (!stopped) timer = window.setTimeout(poll, 3000);
      }
    };
    void poll();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, []);

  const handleCreate = () => { setEditingId(null); form.resetFields(); setModalOpen(true); };

  const handleEdit = (entity: WecomEntity) => {
    setEditingId(entity.id);
    form.setFieldsValue({
      name: entity.name,
      sku: entity.sku,
      corpid: entity.corpid,
      secret: entity.secret,
      wecomApiBaseUrl: entity.wecomApiBaseUrl,
      certificationExpiresAt: entity.certificationExpiresAt ? dayjs(entity.certificationExpiresAt.slice(0, 10)) : null,
    });
    setModalOpen(true);
  };

  const handleDelete = async (entity: WecomEntity) => {
    setDeletingId(entity.id);
    try {
      await deleteEntity(entity.id);
      message.success(`「${entity.name}」已删除`);
      fetchData();
    } catch (error: any) {
      message.error(error.response?.data?.error || '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSync = async (id: number, name: string) => {
    message.loading({ content: `正在同步「${name}」...`, key: 'sync' });
    try { await syncEntity(id); message.success({ content: `「${name}」同步完成`, key: 'sync' }); fetchData(); }
    catch { message.error({ content: '同步失败', key: 'sync' }); }
  };

  const handleSubmit = async () => {
    try {
      const v = await form.validateFields();
      setSubmitting(true);
      const d: EntityFormData = {
        name: v.name,
        sku: v.sku,
        corpid: v.corpid,
        secret: v.secret,
        wecomApiBaseUrl: v.wecomApiBaseUrl,
        certificationExpiresAt: v.certificationExpiresAt?.format('YYYY-MM-DD') || null,
      };
      if (editingId) { await updateEntity(editingId, d); message.success('更新成功'); }
      else { await createEntity(d); message.success('创建成功'); }
      setModalOpen(false); fetchData();
    } catch (e: any) { if (!e?.errorFields) message.error('操作失败'); }
    finally { setSubmitting(false); }
  };

  const handleCount = async (entity: WecomEntity) => {
    setSubmittingCounts(current => [...current, entity.id]);
    setCountErrors(current => ({ ...current, [entity.id]: '' }));
    try {
      const job = await syncServedUsers(entity.id);
      setJobs(current => [...current.filter(item => item.entityId !== entity.id), job]);
      message.success(`「${entity.name}」已提交后台统计`);
    } catch (error: any) {
      const reason = error.response?.data?.error || '统计超时或连接失败，请稍后刷新重试';
      setCountErrors(current => ({ ...current, [entity.id]: reason }));
      message.error(reason);
    } finally { setSubmittingCounts(current => current.filter(id => id !== entity.id)); }
  };

  const activeCount = entities.filter(e => e.status === 'active').length;
  const expiryAlerts = entities.map(entity => ({ entity, ...certificationStatus(entity.certificationExpiresAt, now) }))
    .filter(item => item.days !== null && item.days <= 30)
    .sort((a, b) => a.days! - b.days!);

  const columns = [
    { title: 'ID', key: 'displayId', width: 60, align: 'center' as const, render: (_: unknown, __: WecomEntity, index: number) => index + 1 },
    { title: 'SKU', dataIndex: 'sku', key: 'sku', width: 90, render: (v: string | null) => v ? <Tag color="blue">{v}</Tag> : '-' },
    { title: '主体名称', dataIndex: 'name', key: 'name', width: 150, render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span> },
    { title: '企业ID', dataIndex: 'corpid', key: 'corpid', width: 180, ellipsis: true,
      render: (v: string) => <code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: 3, fontSize: 12 }}>{v}</code> },
    { title: '同步出口', dataIndex: 'wecomApiBaseUrl', key: 'wecomApiBaseUrl', width: 190, ellipsis: true, render: (v: string | null) => v || '默认出口' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, align: 'center' as const,
      render: (s: string) => <Tag color={s === 'active' ? 'green' : 'orange'}>{s === 'active' ? '启用' : '停用'}</Tag> },
    { title: '获客助手余额', dataIndex: 'quotaBalance', key: 'quotaBalance', width: 120,
      render: (v: number) => <span style={{ color: v < 5000 ? '#ff4d4f' : '#52c41a', fontWeight: v < 5000 ? 600 : 400 }}>{v.toLocaleString()}</span> },
    { title: '最后同步', dataIndex: 'lastSyncAt', key: 'lastSyncAt', width: 170, render: (v: string | null) => v ? new Date(v).toLocaleString() : '-' },
    { title: '认证到期日', dataIndex: 'certificationExpiresAt', key: 'certificationExpiresAt', width: 220,
      sorter: (a: WecomEntity, b: WecomEntity) => (a.certificationExpiresAt || '9999').localeCompare(b.certificationExpiresAt || '9999'),
      render: (value: string | null) => {
        const status = certificationStatus(value, now);
        return <Space direction="vertical" size={4}><span>{value?.slice(0, 10) || '-'}</span><Tag color={status.color}>{status.label}</Tag></Space>;
      } },
    { title: '已服务人数', key: 'servedUserCount', width: 250,
      sorter: (a: WecomEntity, b: WecomEntity) => (a.servedUserCount ?? -1) - (b.servedUserCount ?? -1),
      render: (_: unknown, r: WecomEntity) => <Space direction="vertical" size={4}>
        <span>{r.servedUserCount == null ? '未统计' : `${r.servedUserCount.toLocaleString()} 人`}</span>
        {(() => {
          const job = jobs.find(item => item.entityId === r.id);
          if (!job) return null;
          if (job.status === 'queued') return <Tag color="blue">排队中</Tag>;
          if (job.status === 'running') return <div style={{ color: '#1677ff', fontSize: 12 }}>
            <div><SyncOutlined spin /> 统计中 · 已读取 {job.pages} 页</div>
            <div>关系记录 {job.rows.toLocaleString()} 条</div>
            <div>暂计去重 {job.uniqueUsers.toLocaleString()} 人</div>
          </div>;
          if (job.status === 'failed') return <span style={{ color: '#cf1322', fontSize: 12 }}>{job.error}</span>;
          return <Tag color="green">统计完成</Tag>;
        })()}
        {countErrors[r.id] && <span style={{ color: '#cf1322', fontSize: 12 }}>{countErrors[r.id]}</span>}
      </Space> },
    { title: '统计更新时间', dataIndex: 'servedUserCountUpdatedAt', key: 'servedUserCountUpdatedAt', width: 180,
      render: (v: string | null) => v ? new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '-' },
    { title: '操作', key: 'action', width: 350, fixed: 'right' as const,
      render: (_: any, r: WecomEntity) => (
        <Space size={6}>
          <Button size="small" icon={<SyncOutlined />} onClick={() => handleSync(r.id, r.name)}>同步</Button>
          <Button size="small" icon={<TeamOutlined />} loading={submittingCounts.includes(r.id)}
            disabled={jobs.some(job => job.entityId === r.id && ['queued', 'running'].includes(job.status))}
            onClick={() => handleCount(r)}>统计人数</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
          <Popconfirm
            title="确认删除主体？"
            description={`删除「${r.name}」后无法恢复，关联记录也会一并删除。`}
            okText="确认删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(r)}
          >
            <Button danger size="small" icon={<DeleteOutlined />} loading={deletingId === r.id}>删除</Button>
          </Popconfirm>
        </Space>
      )},
  ];

  return (
    <div>
      <PageHeader title="主体管理" desc="管理企微获客主体配置与同步状态"
        extra={<Space><Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>添加主体</Button></Space>} />

      {loadError && <Alert type="error" showIcon message={loadError} style={{ marginBottom: 16 }} action={<Button onClick={fetchData}>重试</Button>} />}
      {progressError && <Alert type="warning" showIcon message={progressError} style={{ marginBottom: 16 }} />}
      {!loadError && <div className="summary-grid">
        <StatCard title="主体总数" value={entities.length} suffix="个" gradient="green" prefix={<TeamOutlined style={{ color: '#52c41a' }} />} />
        <StatCard title="启用中" value={activeCount} suffix="个" gradient="blue" color="#1890ff" />
      </div>}

      {expiryAlerts.length > 0 && <Alert showIcon type={expiryAlerts.some(item => item.days! <= 7) ? 'error' : 'warning'}
        style={{ marginBottom: 16 }} message={`认证到期预警：${expiryAlerts.length} 个主体需关注`}
        description={<Space wrap>{expiryAlerts.map(({ entity, label, color }) => <Tag key={entity.id} color={color}>{entity.name}：{label}</Tag>)}</Space>} />}

      <Table dataSource={entities} columns={columns} rowKey="id" loading={loading} size="middle" scroll={{ x: 2120 }}
        pagination={{ pageSize: 20, showTotal: (t: number) => `共 ${t} 个主体` }} />

      <Modal title={editingId ? '编辑主体' : '添加主体'} open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)} confirmLoading={submitting} destroyOnClose width={480}>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="主体名称" rules={[{ required: true }]}><Input placeholder="例如：开开华彩文艺" /></Form.Item>
          <Form.Item name="sku" label="SKU"><Input placeholder="可选，如 声乐" /></Form.Item>
          <Form.Item name="certificationExpiresAt" label="认证到期日"><DatePicker format="YYYY-MM-DD" style={{ width: '100%' }} placeholder="选择认证到期日期" /></Form.Item>
          <Form.Item name="corpid" label="企业ID" rules={[{ required: true }]}><Input placeholder="wwxxxxxxxxxxxxxx" /></Form.Item>
          <Form.Item name="secret" label="应用Secret" rules={[{ required: true }]}><Input.Password placeholder="获客助手应用的Secret" /></Form.Item>
          <Form.Item name="wecomApiBaseUrl" label="同步出口地址">
            <Input placeholder="可选，例如 http://47.95.226.204:8088" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
