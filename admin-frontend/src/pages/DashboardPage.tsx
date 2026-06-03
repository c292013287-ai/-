import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Spin, Typography, Empty, Table, Tag } from 'antd';
import { TeamOutlined, NumberOutlined, ThunderboltOutlined, RiseOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getDashboardStats, type DashboardStats } from '../api/dashboard';
import { getRecharges, type RechargeRecord } from '../api/recharges';

const { Title, Text } = Typography;

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recharges, setRecharges] = useState<RechargeRecord[]>([]);
  const [rechargeTotal, setRechargeTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const now = new Date();
    const start = dayjs(new Date(now.getFullYear(), now.getMonth(), 1)).format('YYYY-MM-DD');
    const end = dayjs(now).format('YYYY-MM-DD');
    Promise.all([getDashboardStats(), getRecharges({ startDate: start, endDate: end, pageSize: 10 })])
      .then(([s, r]) => { setStats(s); setRecharges(r.data); setRechargeTotal(r.monthlyTotal || 0); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: 120 }}><Spin size="large" /></div>;

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24, fontWeight: 600 }}>仪表盘</Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {[
          { title: '主体总数', value: stats?.entityCount || 0, icon: <TeamOutlined />, color: '#ed6a1c' },
          { title: '活跃主体', value: stats?.activeEntityCount || 0, icon: <RiseOutlined />, color: '#52c41a' },
          { title: '今日消耗', value: stats?.todayConsumption || 0, icon: <ThunderboltOutlined />, color: '#1677ff' },
          { title: '累计消耗', value: stats?.totalConsumption || 0, icon: <NumberOutlined />, color: '#722ed1' },
        ].map(s => (
          <Col xs={12} sm={6} key={s.title}>
            <Card hoverable bodyStyle={{ padding: '20px 24px' }} style={{ borderRadius: 12 }}>
              <Statistic title={<Text type="secondary" style={{ fontSize: 13 }}>{s.title}</Text>} value={s.value} prefix={s.icon} valueStyle={{ color: s.color, fontSize: 28, fontWeight: 600 }} />
            </Card>
          </Col>
        ))}
      </Row>
      <Row>
        <Col span={24}>
          <Card title={<span>本月充值记录 <Text type="secondary" style={{ marginLeft: 12, fontSize: 13 }}>本月累计 ¥{rechargeTotal.toLocaleString()}</Text></span>} style={{ borderRadius: 12 }}>
            {recharges.length > 0 ? (
              <Table dataSource={recharges} rowKey="id" size="small" pagination={false}
                columns={[
                  { title: '主体', key: 'entity', width: 130, render: (_: any, r: RechargeRecord) => r.entity?.name || '-' },
                  { title: '充值数量', dataIndex: 'amount', width: 100, render: (v: number) => v.toLocaleString() },
                  { title: '下单日期', dataIndex: 'rechargeDate', width: 150, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
                  { title: '支付方式', dataIndex: 'method', width: 90, render: (v: string) => <Tag>{v}</Tag> },
                  { title: '费用金额', dataIndex: 'feeAmount', width: 100, render: (v: number | null) => v != null ? `¥${v.toLocaleString()}` : '-' },
                ]}
              />
            ) : <Empty description="本月暂无充值记录" />}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
