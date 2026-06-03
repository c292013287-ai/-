import { useEffect, useState, useMemo } from 'react';
import { Typography, Spin, Card, Row, Col, Tag, Divider, Empty, Tabs, Progress } from 'antd';
import { ThunderboltOutlined, WarningOutlined, RiseOutlined, BarChartOutlined } from '@ant-design/icons';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts';
import { getDashboardStats, getBudgetList, type DashboardStats, type BudgetRow } from '../api/dashboard';
import { getConsumptionTrend, type TrendItem } from '../api/consumption';
import { getEntities, type WecomEntity } from '../api/entities';
import { getRecharges } from '../api/recharges';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const CHART_COLORS = ['#ed6a1c', '#1890ff', '#52c41a', '#faad14', '#eb2f96', '#722ed1'];

type Period = 'day' | 'week' | 'month';

interface ReportData {
  stats: DashboardStats | null;
  budgets: BudgetRow[];
  trends: TrendItem[];
  rechargeTotal: number;
}

export default function AiAssistant() {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('day');
  const [dayData, setDayData] = useState<ReportData>({ stats: null, budgets: [], trends: [], rechargeTotal: 0 });
  const [weekData, setWeekData] = useState<ReportData>({ stats: null, budgets: [], trends: [], rechargeTotal: 0 });
  const [monthData, setMonthData] = useState<ReportData>({ stats: null, budgets: [], trends: [], rechargeTotal: 0 });
  const [entities, setEntities] = useState<WecomEntity[]>([]);

  const fetchReport = async (p: Period) => {
    const now = dayjs();
    let start: string, end: string;
    let trendDays: number;
    if (p === 'day') { start = now.format('YYYY-MM-DD'); end = start; trendDays = 1; }
    else if (p === 'week') { start = now.subtract(6, 'day').format('YYYY-MM-DD'); end = now.format('YYYY-MM-DD'); trendDays = 7; }
    else { start = dayjs(new Date(now.year(), now.month(), 1)).format('YYYY-MM-DD'); end = now.format('YYYY-MM-DD'); trendDays = (now.diff(dayjs(start), 'day')) + 1; }

    const [statsRes, budgetRes, trendRes, rechargeRes] = await Promise.all([
      getDashboardStats(), getBudgetList(), getConsumptionTrend({ days: trendDays }), getRecharges({ startDate: start, endDate: end, pageSize: 999 }),
    ]);
    return {
      stats: statsRes, budgets: budgetRes.rows,
      trends: trendRes,
      rechargeTotal: rechargeRes.monthlyTotal || 0,
    };
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchReport('day'), fetchReport('week'), fetchReport('month'), getEntities()])
      .then(([d, w, m, e]) => { setDayData(d); setWeekData(w); setMonthData(m); setEntities(e); })
      .finally(() => setLoading(false));
  }, []);

  const getCurrentData = () => {
    if (period === 'day') return dayData;
    if (period === 'week') return weekData;
    return monthData;
  };

  const data = getCurrentData();
  const { budgets, trends, rechargeTotal } = data;

  const warningEntities = budgets.filter(r => r.countdownDays >= 0 && r.countdownDays < 5);
  const periodLabel = period === 'day' ? '今日' : period === 'week' ? '近7天' : '本月';
  const avg7d = budgets.reduce((s, r) => s + r.avg7dConsumption, 0);
  const periodTotal = trends.reduce((s, t) => s + t.consumption, 0);
  const trendData = trends.map(t => ({ date: t.date?.slice(5) || t.date, consumption: t.consumption }));
  const rankingTable = budgets.sort((a, b) => b.actualConsumption - a.actualConsumption).slice(0, 10);
  const countdownDist = [
    { name: '不足3天', value: budgets.filter(r => r.countdownDays >= 0 && r.countdownDays < 3).length, color: '#ff4d4f' },
    { name: '3-5天', value: budgets.filter(r => r.countdownDays >= 3 && r.countdownDays < 5).length, color: '#fa8c16' },
    { name: '5-10天', value: budgets.filter(r => r.countdownDays >= 5 && r.countdownDays < 10).length, color: '#fadb14' },
    { name: '10天以上', value: budgets.filter(r => r.countdownDays >= 10).length, color: '#52c41a' },
  ];
  const rankingChart = rankingTable.slice(0, 8).map(r => ({
    name: r.name.length > 8 ? r.name.slice(0, 8) : r.name,
    消耗: r.actualConsumption,
  }));

  const summaryText = useMemo(() => {
    const top1 = rankingTable[0];
    const activeCount = entities.filter(e => e.status === 'active').length;
    return `${periodLabel}共 ${activeCount} 个活跃主体，累计消耗 ${periodTotal.toLocaleString()}，` +
      (top1 ? `消耗最高为 ${top1.name}（${top1.actualConsumption.toLocaleString()}），` : '') +
      `充值总额 ¥${rechargeTotal.toLocaleString()}。` +
      (warningEntities.length > 0 ? `⚠️ ${warningEntities.map(e => e.name).join('、')} 余额不足5天。` : '各主体配额充足。');
  }, [periodLabel, periodTotal, rechargeTotal, rankingTable, warningEntities, entities]);

  const tabItems = [
    { key: 'day', label: '日报' },
    { key: 'week', label: '周报' },
    { key: 'month', label: '月报' },
  ];

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <Title level={3} style={{ margin: 0 }}><BarChartOutlined style={{ marginRight: 8, color: '#ed6a1c' }} />BI分析报告</Title>
        <Tabs activeKey={period} onChange={v => setPeriod(v as Period)} items={tabItems} style={{ marginBottom: 0 }} />
      </div>
      <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 16 }}>
        {summaryText}
      </Text>
      <Divider style={{ margin: '0 0 20px' }} />

      {/* 核心指标 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {[
          { title: `${periodLabel}消耗`, value: periodTotal, color: '#ed6a1c', icon: <ThunderboltOutlined /> },
          { title: '7日均消耗', value: avg7d, color: '#1890ff', icon: <RiseOutlined /> },
          { title: `${periodLabel}充值`, value: rechargeTotal, color: '#52c41a', unit: '¥', icon: <BarChartOutlined /> },
          { title: '预警主体', value: warningEntities.length, color: '#ff4d4f', unit: '个', icon: <WarningOutlined /> },
        ].map((s, i) => (
          <Col xs={12} sm={6} key={i}>
            <Card bodyStyle={{ padding: '16px 20px' }} style={{ borderRadius: 10 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>{s.title}</Text>
              <div style={{ fontSize: 26, fontWeight: 700, color: s.color, marginTop: 4 }}>
                {s.unit === '¥' ? '¥' : ''}{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* 图表区 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={14}>
          <Card size="small" title={`${periodLabel}消耗趋势`} style={{ borderRadius: 10 }}>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={period === 'day' ? 0 : 'preserveStartEnd'} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => [Number(v).toLocaleString(), '消耗']} contentStyle={{ borderRadius: 6, border: 'none' }} />
                  <Line type="monotone" dataKey="consumption" stroke="#ed6a1c" strokeWidth={2} dot={period === 'day'} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <Empty description="暂无数据" />}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card size="small" title="配额倒计时分布" style={{ borderRadius: 10 }}>
            {countdownDist.reduce((s, c) => s + c.value, 0) > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={countdownDist} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value">
                    {countdownDist.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 6, border: 'none' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <Empty description="暂无数据" />}
          </Card>
        </Col>
      </Row>

      {/* 消耗排名 + 预算使用率 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card size="small" title={<span>消耗排名 Top8 <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>累计消耗</Text></span>} style={{ borderRadius: 10 }}>
            {rankingChart.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={rankingChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => [Number(v).toLocaleString(), '消耗']} contentStyle={{ borderRadius: 6, border: 'none' }} />
                  <Bar dataKey="消耗" radius={[4, 4, 0, 0]}>
                    {rankingChart.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty description="暂无数据" />}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card size="small" title={<span>主体详情 <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>消耗 + 预算使用率</Text></span>} style={{ borderRadius: 10 }}>
            {rankingTable.length > 0 ? (
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {rankingTable.map(r => {
                  const pct = r.monthlyBudget > 0 ? Math.min(100, Math.round((r.actualConsumption / r.monthlyBudget) * 100)) : 0;
                  return (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 10 }}>
                      <Text style={{ width: 80, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.name}
                      </Text>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <Text style={{ fontSize: 11, color: '#999' }}>{r.actualConsumption.toLocaleString()}</Text>
                          <Text style={{ fontSize: 11, color: '#999' }}>{pct}%</Text>
                        </div>
                        <Progress percent={pct} showInfo={false} size="small" strokeColor={pct > 80 ? '#ff4d4f' : pct > 50 ? '#fa8c16' : '#52c41a'} />
                      </div>
                      {r.countdownDays >= 0 && r.countdownDays < 5 && <Tag color="error" style={{ margin: 0, fontSize: 10 }}>预警</Tag>}
                    </div>
                  );
                })}
              </div>
            ) : <Empty description="暂无数据" />}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
