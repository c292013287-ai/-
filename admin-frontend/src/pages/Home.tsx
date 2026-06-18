import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Spin, Typography, Tag, Button, Modal, Form, Input, Select, Popconfirm, message, Empty } from 'antd';
import { DollarOutlined, ThunderboltOutlined, AlertOutlined, SoundOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { getBudgetList } from '../api/dashboard';
import { getRecharges } from '../api/recharges';
import { getAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement, type Announcement } from '../api/announcements';
import AiAssistant from './AiAssistant';

const { Title, Text } = Typography;
const { TextArea } = Input;

function currentMonthRange() { const now = new Date(); const f = (d: Date) => d.toISOString().slice(0, 10); return { startDate: f(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: f(now) }; }
function getGreeting() { const h = new Date().getHours(); return h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好'; }

export default function Home() {
  const navigate = useNavigate();
  const [monthlyRecharge, setMonthlyRecharge] = useState(0);
  const [todayConsumption, setTodayConsumption] = useState(0);
  const [warningCount, setWarningCount] = useState(0);
  const [notices, setNotices] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const fetchData = () => {
    setLoading(true);
    const { startDate, endDate } = currentMonthRange();
    Promise.all([getBudgetList(), getRecharges({ startDate, endDate, pageSize: 1 }), getAnnouncements()])
      .then(([budgetRes, rechargeRes, announcements]) => {
        const rows = Array.isArray(budgetRes?.rows) ? budgetRes.rows : [];
        setTodayConsumption(budgetRes?.summary?.todayConsumption || 0);
        setMonthlyRecharge(rechargeRes.monthlyTotal || 0);
        setWarningCount(rows.filter(r => r.countdownDays >= 0 && r.countdownDays < 5).length);
        setNotices(Array.isArray(announcements) ? announcements : []);
      }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const openCreate = () => { setEditingId(null); form.resetFields(); setModalOpen(true); };
  const openEdit = (r: Announcement) => { setEditingId(r.id); form.setFieldsValue(r); setModalOpen(true); };
  const handleSave = async () => {
    try {
      const v = await form.validateFields(); setSaving(true);
      if (editingId) { await updateAnnouncement(editingId, v); message.success('公告已更新'); }
      else { await createAnnouncement(v); message.success('公告已发布'); }
      setModalOpen(false); fetchData();
    } catch (e: any) { if (!e?.errorFields) message.error(e?.response?.data?.error || '操作失败'); } finally { setSaving(false); }
  };
  const handleDelete = async (id: number) => { try { await deleteAnnouncement(id); message.success('已删除'); fetchData(); } catch { message.error('删除失败'); } };

  if (loading) return <div style={{ textAlign: 'center', padding: 120 }}><Spin size="large" /></div>;

  const metrics = [
    { title: '本月充值总额', value: monthlyRecharge, suffix: '元', icon: <DollarOutlined />, color: '#ed6a1c', route: '/recharges' },
    { title: '今日累计获客助手进量', value: todayConsumption, suffix: '个', icon: <ThunderboltOutlined />, color: '#1677ff', route: '/consumption' },
    { title: '预警主体', value: warningCount, suffix: '个', icon: <AlertOutlined />, color: warningCount > 0 ? '#ff4d4f' : '#52c41a', route: '/warnings' },
  ];

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      <div style={{ marginBottom: 40 }}>
        <Title level={3} style={{ marginBottom: 4, fontWeight: 600 }}>{getGreeting()}</Title>
        <Text type="secondary" style={{ fontSize: 14 }}>欢迎回来，以下是系统运行概况</Text>
      </div>
      <Row gutter={[24, 24]} style={{ marginBottom: 48 }}>
        {metrics.map(m => (
          <Col xs={24} md={8} key={m.title}>
            <Card className="home-metric-card" hoverable bodyStyle={{ padding: '24px 28px' }} style={{ borderRadius: 12, cursor: 'pointer', height: '100%' }} onClick={() => navigate(m.route)}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ minWidth: 0 }}>
                  <Text type="secondary" className="home-metric-title" style={{ fontSize: 13, marginBottom: 8, display: 'block' }}>{m.title}</Text>
                  <div style={{ fontSize: 36, fontWeight: 700, color: m.color, lineHeight: 1.2 }}>{m.value.toLocaleString()}<Text style={{ fontSize: 16, fontWeight: 400, color: '#999', marginLeft: 4 }}>{m.suffix}</Text></div>
                </div>
                <div style={{ width: 48, height: 48, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: m.color.includes('255') ? 'rgba(255,77,79,0.06)' : 'rgba(237,106,28,0.06)', color: m.color, fontSize: 22, flexShrink: 0, marginLeft: 12 }}>{m.icon}</div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={5} style={{ marginBottom: 0, fontWeight: 600 }}><SoundOutlined style={{ marginRight: 8 }} />系统公告</Title>
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreate}>发布公告</Button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {notices.length === 0 ? <Card bodyStyle={{ padding: '40px 24px', textAlign: 'center' }}><Empty description="暂无公告" /></Card>
        : notices.map(n => (
          <Card key={n.id} hoverable bodyStyle={{ padding: '20px 24px' }} style={{ borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(237,106,28,0.08)', color: '#ed6a1c', fontSize: 16, flexShrink: 0 }}><SoundOutlined /></div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}><Text strong style={{ fontSize: 15 }}>{n.title}</Text><Tag style={{ margin: 0, borderRadius: 4, fontSize: 11 }}>{n.tag}</Tag></div>
                <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.8, display: 'block' }}>{n.content}</Text>
                <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>{n.date}</Text>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(n)} />
                <Popconfirm title="确定删除？" onConfirm={() => handleDelete(n.id)}><Button type="text" size="small" danger icon={<DeleteOutlined />} /></Popconfirm>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Modal title={editingId ? '编辑公告' : '发布公告'} open={modalOpen} onOk={handleSave} onCancel={() => setModalOpen(false)} confirmLoading={saving} destroyOnClose>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="title" label="标题" rules={[{ required: true }]}><Input placeholder="公告标题" /></Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true }]}><TextArea rows={4} placeholder="公告内容" /></Form.Item>
          <Form.Item name="tag" label="标签" initialValue="系统"><Select options={[{ label: '系统', value: '系统' }, { label: '更新', value: '更新' }, { label: '说明', value: '说明' }, { label: '重要', value: '重要' }]} /></Form.Item>
        </Form>
      </Modal>

      <div style={{ marginTop: 48 }}>
        <AiAssistant embedded />
      </div>
    </div>
  );
}
