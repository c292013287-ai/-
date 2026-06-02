import { useEffect, useState } from 'react';
import { Typography, Spin, Card, Row, Col, Tag, Divider, Empty } from 'antd';
import { RobotOutlined, WarningOutlined,
         RiseOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
         PieChart, Pie, Cell, Legend, LineChart, Line } from 'recharts';
import { getDashboardStats, getBudgetList, type DashboardStats, type BudgetRow } from '../api/dashboard';
import { getConsumptionTrend, type TrendItem } from '../api/consumption';
import { getEntities, type WecomEntity } from '../api/entities';

const { Title, Text, Paragraph } = Typography;

const CHART_COLORS = ['#ed6a1c', '#1890ff', '#52c41a', '#faad14', '#eb2f96', '#722ed1'];

export default function AiAssistant() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [entities, setEntities] = useState<WecomEntity[]>([]);
  const [trends, setTrends] = useState<TrendItem[]>([]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getDashboardStats(),
      getBudgetList(),
      getEntities(),
      getConsumptionTrend({ days: 30 }),
    ])
      .then(([s, b, e, t]) => {
        setStats(s);
        setBudgets(b.rows);
        setEntities(e);
        setTrends(t);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" tip="AI 正在分析数据..." /></div>;
  }

  if (!stats) {
    return <Empty description="暂无数据" />;
  }

  // ---- 数据分析 ----
  const activeEntities = entities.filter((e) => e.status === 'active');
  const warningEntities = budgets.filter((r) => r.countdownDays >= 0 && r.countdownDays < 5);
  const todayTotalConsumption = budgets.reduce((sum, r) => sum + r.actualConsumption, 0);

  // 消耗榜单
  const rankingData = stats.entityRanking?.slice(0, 10).map((e) => ({
    name: e.name.length > 6 ? e.name.slice(0, 6) + '...' : e.name,
    消耗: e.totalConsumption,
    余额: e.quotaBalance,
  })) || [];

  // 预算使用率
  const budgetUsage = budgets
    .filter((b) => b.monthlyBudget > 0)
    .map((b) => ({
      name: b.name.length > 6 ? b.name.slice(0, 6) + '...' : b.name,
      使用率: Math.min(100, Math.round((b.actualConsumption / b.monthlyBudget) * 100)),
      fullName: b.name,
    }))
    .sort((a, b) => b.使用率 - a.使用率);

  // 倒计时分布（饼图）
  const countdownDist = [
    { name: '不足3天', value: budgets.filter((r) => r.countdownDays >= 0 && r.countdownDays < 3).length, color: '#ff4d4f' },
    { name: '3-5天', value: budgets.filter((r) => r.countdownDays >= 3 && r.countdownDays < 5).length, color: '#fa8c16' },
    { name: '5-10天', value: budgets.filter((r) => r.countdownDays >= 5 && r.countdownDays < 10).length, color: '#fadb14' },
    { name: '10天以上', value: budgets.filter((r) => r.countdownDays >= 10).length, color: '#52c41a' },
  ];

  // 趋势数据
  const trendData = trends.map((t) => ({ date: t.date?.slice(5) || t.date, consumption: t.consumption }));

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* 标题 */}
      <div style={{ marginBottom: 8 }}>
        <Title level={2} style={{ margin: '0 0 4px 0' }}>
          <RobotOutlined style={{ fontSize: 24, marginRight: 10, color: '#ed6a1c' }} />
          AI 智能分析报告
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          基于 {entities.length} 个主体的实时数据，AI 自动生成分析报告
        </Text>
      </div>

      <Divider style={{ margin: '16px 0 20px' }} />

      {/* 核心指标 */}
      <div style={{
        display: 'flex', gap: 12, marginBottom: 24,
      }}>
        {[
          { icon: <ThunderboltOutlined />, label: '活跃主体', value: activeEntities.length, unit: '个', color: '#ed6a1c' },
          { icon: <RiseOutlined />, label: '今日消耗', value: todayTotalConsumption.toLocaleString(), unit: '', color: '#cf1322' },
          { icon: <WarningOutlined />, label: '预警主体', value: warningEntities.length, unit: '个', color: '#ff4d4f' },
          { icon: <RiseOutlined />, label: '总消耗', value: (stats.totalConsumption || 0).toLocaleString(), unit: '', color: '#1890ff' },
        ].map((s, i) => (
          <div key={i} style={{
            flex: 1, padding: '16px 18px', borderRadius: 8,
            background: '#fafafa', border: '1px solid #f0f0f0',
          }}>
            <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>
              {s.icon} {s.label}
            </div>
            <span style={{ fontSize: 24, fontWeight: 700, color: s.color }}>
              {s.value}<span style={{ fontSize: 14, fontWeight: 400, color: '#8c8c8c' }}>{s.unit}</span>
            </span>
          </div>
        ))}
      </div>

      {/* AI 文字分析 */}
      <Card
        size="small"
        style={{ marginBottom: 24, borderRadius: 8, background: 'linear-gradient(135deg, #fff7e6 0%, #fffbe6 100%)' }}
      >
        <div style={{ display: 'flex', gap: 10 }}>
          <RobotOutlined style={{ fontSize: 20, color: '#ed6a1c', marginTop: 2 }} />
          <div>
            <Text strong style={{ fontSize: 14 }}>AI 分析摘要</Text>
            <Paragraph style={{ margin: '8px 0 0' }}>
              {warningEntities.length > 0 ? (
                <>
                  ⚠️ <Text strong style={{ color: '#ff4d4f' }}>{warningEntities.map((e) => e.name).join('、')}</Text> 配额倒计时不足5天，需尽快充值。
                </>
              ) : '✅ 当前所有主体配额充足，运行状态正常。'}
              近30天累计消耗 <Text strong>{stats.totalConsumption?.toLocaleString() || '--'}</Text>，
              {budgetUsage.length > 0 && (
                <>
                  预算使用率最高的主体为 <Text strong style={{ color: '#ed6a1c' }}>{budgetUsage[0]?.fullName}</Text>（{budgetUsage[0]?.使用率}%）。
                </>
              )}
            </Paragraph>
          </div>
        </div>
      </Card>

      {/* 图表区 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {/* 消耗榜单 */}
        <Col span={12}>
          <Card size="small" title="主体消耗 Top10" style={{ borderRadius: 8, height: '100%' }}>
            {rankingData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={rankingData} layout="vertical" margin={{ left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={60} />
                  <Tooltip
                    contentStyle={{ borderRadius: 6, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                  />
                  <Bar dataKey="消耗" fill="#ed6a1c" radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty description="暂无数据" />}
          </Card>
        </Col>

        {/* 预算使用率 */}
        <Col span={12}>
          <Card size="small" title="预算使用率" style={{ borderRadius: 8, height: '100%' }}>
            {budgetUsage.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={budgetUsage}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip
                    formatter={(val: any) => [`${val}%`, '使用率']}
                    contentStyle={{ borderRadius: 6, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                  />
                  <Bar dataKey="使用率" radius={[4, 4, 0, 0]} barSize={28}>
                    {budgetUsage.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty description="暂无数据" />}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {/* 消耗趋势 */}
        <Col span={14}>
          <Card size="small" title="近30天消耗趋势" style={{ borderRadius: 8 }}>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={4} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ borderRadius: 6, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                    formatter={(v: any) => [Number(v).toLocaleString(), '消耗']}
                  />
                  <Line type="monotone" dataKey="consumption" stroke="#ed6a1c" strokeWidth={2}
                    dot={false} activeDot={{ r: 4, fill: '#ed6a1c' }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <Empty description="暂无数据" />}
          </Card>
        </Col>

        {/* 倒计时分布 */}
        <Col span={10}>
          <Card size="small" title="配额倒计时分布" style={{ borderRadius: 8 }}>
            {countdownDist.reduce((s, c) => s + c.value, 0) > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={countdownDist} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                    dataKey="value" strokeWidth={3}>
                    {countdownDist.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 6, border: 'none' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <Empty description="暂无数据" />}
          </Card>
        </Col>
      </Row>

      {/* AI 建议 */}
      <Card
        size="small"
        title={<span><RobotOutlined style={{ color: '#ed6a1c', marginRight: 8 }} />AI 参考建议</span>}
        style={{ borderRadius: 8 }}
      >
        <div style={{ padding: '0 4px' }}>
          {warningEntities.length > 0 && (
            <Paragraph>
              <Text strong>1. 紧急充值：</Text>
              {warningEntities.map((e, i) => (
                <Tag key={e.id} color="error" style={{ marginLeft: i === 0 ? 8 : 4 }}>{e.name}</Tag>
              ))}
              配额即将耗尽，建议立即补充，避免影响获客链路。
            </Paragraph>
          )}

          {budgetUsage.length > 0 && budgetUsage[0].使用率 > 80 && (
            <Paragraph>
              <Text strong>2. 预算调整：</Text>
              <Tag color="orange">{budgetUsage[0].fullName}</Tag>
              预算使用率已达 {budgetUsage[0].使用率}%，建议适当追加当月预算。
            </Paragraph>
          )}

          <Paragraph>
            <Text strong>{warningEntities.length > 0 ? '3' : '1'}. 优化建议：</Text>
            根据近30天消耗趋势，建议重点关注消耗波动较大的主体，合理分配配额资源，建立定期充值机制避免倒计时告警。
          </Paragraph>
        </div>
      </Card>
    </div>
  );
}
