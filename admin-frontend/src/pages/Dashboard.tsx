import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Table, Tag, Spin } from 'antd';
import {
  TeamOutlined,
  RiseOutlined,
  PhoneOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { getDashboardStats, type DashboardStats, type EntityRanking } from '../api/dashboard';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboardStats()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  const rankingColumns = [
    { title: '排名', key: 'rank', width: 60, render: (_: any, __: any, i: number) => i + 1 },
    { title: '主体名称', dataIndex: 'name', key: 'name' },
    {
      title: '总消耗',
      dataIndex: 'totalConsumption',
      key: 'totalConsumption',
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '配额总量',
      dataIndex: 'quotaTotal',
      key: 'quotaTotal',
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '配额余额',
      dataIndex: 'quotaBalance',
      key: 'quotaBalance',
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '消耗率',
      key: 'rate',
      render: (_: any, r: EntityRanking) => {
        const rate = r.quotaTotal > 0 ? ((r.totalConsumption / r.quotaTotal) * 100).toFixed(1) : '0';
        const color = Number(rate) > 80 ? 'red' : Number(rate) > 50 ? 'orange' : 'green';
        return <Tag color={color}>{rate}%</Tag>;
      },
    },
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 24 }}>数据看板</h2>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="管理主体数"
              value={stats?.entityCount}
              prefix={<TeamOutlined />}
              suffix={`/ 活跃 ${stats?.activeEntityCount}`}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="今日消耗"
              value={stats?.todayConsumption}
              prefix={<RiseOutlined />}
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="今日调用次数"
              value={stats?.todayCalls}
              prefix={<PhoneOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="累计消耗"
              value={stats?.totalConsumption}
              prefix={<BarChartOutlined />}
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="主体消耗排名" style={{ marginTop: 24 }}>
        <Table
          dataSource={stats?.entityRanking || []}
          columns={rankingColumns}
          rowKey="id"
          pagination={false}
          size="middle"
        />
      </Card>
    </div>
  );
}
