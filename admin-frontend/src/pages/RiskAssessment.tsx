import { useState, useEffect } from 'react';
import { Typography, Card, Row, Col, Tag, Divider, Tabs, Table, Progress, Button, Modal, Input, Select } from 'antd';
import { SafetyOutlined, RiseOutlined, FallOutlined, FileTextOutlined, UserOutlined, SearchOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend } from 'recharts';
import { getEntities, type WecomEntity } from '../api/entities';

const { Title, Text, Paragraph } = Typography;

// ========== Mock Data ==========

const industryBench = { 日活跃率: 72, 客户触达率: 65, 月净增长: 380, 群活跃度: 58, 平均响应时间: 45, 内容触达转化: 28 };

const entityHealth = {
  cards: [
    { key: '日活跃率', value: 68, unit: '%', lastValue: 64, threshold: { good: 70, warn: 50 }, icon: '📈' },
    { key: '客户触达率', value: 62, unit: '%', lastValue: 59, threshold: { good: 65, warn: 45 }, icon: '🎯' },
    { key: '月净增长', value: 352, unit: '', lastValue: 310, threshold: { good: 300, warn: 100 }, icon: '📊' },
    { key: '群活跃度', value: 55, unit: '%', lastValue: 52, threshold: { good: 60, warn: 35 }, icon: '💬' },
    { key: '平均响应时间', value: 42, unit: 's', lastValue: 48, threshold: { good: 50, warn: 80 }, icon: '⏱' },
    { key: '内容触达转化', value: 25, unit: '%', lastValue: 22, threshold: { good: 30, warn: 15 }, icon: '📨' },
  ],
};

type HealthStatus = '健康' | '关注' | '预警';

function getHealth(value: number, t: { good: number; warn: number }): HealthStatus {
  if (value >= t.good) return '健康';
  if (value >= t.warn) return '关注';
  return '预警';
}

const healthTag: Record<HealthStatus, { color: string; bg: string }> = {
  '健康': { color: '#52c41a', bg: '#f6ffed' },
  '关注': { color: '#fa8c16', bg: '#fffbe6' },
  '预警': { color: '#ff4d4f', bg: '#fff2f0' },
};

// Chart mock data
const trendChart = [
  { name: '5/28', 活跃度: 62, 触达率: 58 }, { name: '5/29', 活跃度: 65, 触达率: 60 }, { name: '5/30', 活跃度: 63, 触达率: 59 },
  { name: '5/31', 活跃度: 67, 触达率: 61 }, { name: '6/1', 活跃度: 68, 触达率: 62 }, { name: '6/2', 活跃度: 64, 触达率: 59 },
  { name: '6/3', 活跃度: 68, 触达率: 62 },
];
const growthChart = [
  { name: '1月', 净增长: 340 }, { name: '2月', 净增长: 320 }, { name: '3月', 净增长: 310 }, { name: '4月', 净增长: 360 }, { name: '5月', 净增长: 352 },
];
const groupPie = [
  { name: '高活跃(≥70%)', value: 35, color: '#52c41a' }, { name: '中活跃(40-70%)', value: 42, color: '#1890ff' },
  { name: '低活跃(10-40%)', value: 18, color: '#fa8c16' }, { name: '沉寂(<10%)', value: 5, color: '#ff4d4f' },
];
const responseChart = [
  { name: '售前咨询', 响应时间: 35 }, { name: '售后服务', 响应时间: 52 }, { name: '客户投诉', 响应时间: 28 },
  { name: '产品咨询', 响应时间: 45 }, { name: '技术支撑', 响应时间: 60 }, { name: '商务合作', 响应时间: 38 },
];

const radarData = [
  { subject: '日活跃率', 当前值: 68, 行业基准: 72, fullMark: 100 },
  { subject: '客户触达率', 当前值: 62, 行业基准: 65, fullMark: 100 },
  { subject: '月净增长', 当前值: 70, 行业基准: 76, fullMark: 100 },
  { subject: '群活跃度', 当前值: 55, 行业基准: 58, fullMark: 100 },
  { subject: '响应时间', 当前值: 84, 行业基准: 76, fullMark: 100 },
  { subject: '触达转化', 当前值: 25, 行业基准: 28, fullMark: 100 },
];

// Member Data
const memberStats = { total: 48, avgScore: 73, excellent: 12, attention: 28, risk: 8, trend: '+3%' };

const memberGradeDist = [
  { name: 'A级(≥85)', value: 12, color: '#52c41a' }, { name: 'B级(70-84)', value: 20, color: '#1890ff' },
  { name: 'C级(60-69)', value: 10, color: '#fa8c16' }, { name: 'D级(<60)', value: 6, color: '#ff4d4f' },
];

interface Member {
  key: number; name: string; score: number; grade: string;
  activity: number; reach: number; response: number; quality: number;
  trend: number; risk: string[];
}
const memberList: Member[] = [
  { key: 1, name: '张明', score: 92, grade: 'A', activity: 88, reach: 95, response: 90, quality: 93, trend: +5, risk: [] },
  { key: 2, name: '李华', score: 88, grade: 'A', activity: 85, reach: 90, response: 88, quality: 87, trend: +3, risk: [] },
  { key: 3, name: '王芳', score: 78, grade: 'B', activity: 75, reach: 80, response: 76, quality: 81, trend: +2, risk: [] },
  { key: 4, name: '赵磊', score: 75, grade: 'B', activity: 72, reach: 78, response: 70, quality: 80, trend: -1, risk: ['响应速度下滑'] },
  { key: 5, name: '陈静', score: 65, grade: 'C', activity: 60, reach: 68, response: 55, quality: 72, trend: -3, risk: ['活跃度偏低'] },
  { key: 6, name: '刘洋', score: 62, grade: 'C', activity: 58, reach: 65, response: 52, quality: 68, trend: -5, risk: ['活跃度偏低', '响应慢'] },
  { key: 7, name: '孙鹏', score: 45, grade: 'D', activity: 35, reach: 48, response: 40, quality: 55, trend: -8, risk: ['全面下滑', '需专项干预'] },
  { key: 8, name: '周婷', score: 42, grade: 'D', activity: 30, reach: 45, response: 35, quality: 52, trend: -12, risk: ['客户投诉增多', '需专项干预'] },
];

export default function RiskAssessment() {
  const [entities, setEntities] = useState<WecomEntity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<number | undefined>(undefined);
  const [loadingEntities, setLoadingEntities] = useState(true);
  const [activeTab, setActiveTab] = useState('entity');
  const [reportOpen, setReportOpen] = useState(false);
  const [gradeFilter, setGradeFilter] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const [memberDetail, setMemberDetail] = useState<Member | null>(null);

  useEffect(() => {
    getEntities().then(ents => { setEntities(ents.filter(e => e.status === 'active')); setLoadingEntities(false); });
  }, []);

  const selectedName = selectedEntity ? entities.find(e => e.id === selectedEntity)?.name || '' : '全部主体';

  const filteredMembers = memberList.filter(m => {
    if (gradeFilter.length && !gradeFilter.includes(m.grade)) return false;
    if (searchText && !m.name.includes(searchText)) return false;
    return true;
  });

  const memberRadar = memberDetail ? [
    { subject: '活跃度', 个人: memberDetail.activity, 团队均值: 68, fullMark: 100 },
    { subject: '触达率', 个人: memberDetail.reach, 团队均值: 73, fullMark: 100 },
    { subject: '响应速度', 个人: memberDetail.response, 团队均值: 65, fullMark: 100 },
    { subject: '服务质量', 个人: memberDetail.quality, 团队均值: 70, fullMark: 100 },
  ] : [];

  const tabItems = [
    { key: 'entity', label: '主体维度' },
    { key: 'member', label: '成员维度' },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Title level={3} style={{ margin: 0, fontWeight: 600 }}>
            <SafetyOutlined style={{ marginRight: 8, color: '#ed6a1c' }} />🏢 健康运营监控测算
          </Title>
          <Text type="secondary">主体与成员两大维度健康监控 · 当前：{selectedName}</Text>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Select
            placeholder="选择主体"
            style={{ width: 200 }}
            value={selectedEntity}
            onChange={setSelectedEntity}
            allowClear
            onClear={() => setSelectedEntity(undefined)}
            loading={loadingEntities}
            options={entities.map(e => ({ label: e.name, value: e.id }))}
            notFoundContent="加载中..."
          />
          <Button type="primary" icon={<FileTextOutlined />} size="large" onClick={() => setReportOpen(true)}>
            智能报告
          </Button>
        </div>
      </div>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} size="large" style={{ marginBottom: 20 }} />

      {/* ==================== Panel: 主体维度 ==================== */}
      {activeTab === 'entity' && (
        <>
          {/* 6 Health Cards */}
          <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
            {entityHealth.cards.map(c => {
              const status = getHealth(c.value, c.threshold);
              const change = c.lastValue ? Math.round(((c.value - c.lastValue) / c.lastValue) * 100) : 0;
              const tag = healthTag[status];
              return (
                <Col xs={12} sm={8} lg={4} key={c.key}>
                  <Card bodyStyle={{ padding: '12px 14px' }} style={{ borderRadius: 10, borderLeft: `3px solid ${tag.color}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>{c.key}</Text>
                      <Tag color={status === '健康' ? 'success' : status === '关注' ? 'warning' : 'error'} style={{ margin: 0, fontSize: 10, padding: '0 6px', lineHeight: '18px' }}>{status}</Tag>
                    </div>
                    <div style={{ fontSize: 26, fontWeight: 700, color: tag.color }}>
                      {c.value}{c.unit ? <Text style={{ fontSize: 14 }}>{c.unit}</Text> : null}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 11 }}>
                      {change >= 0 ? <RiseOutlined style={{ color: '#52c41a' }} /> : <FallOutlined style={{ color: '#ff4d4f' }} />}
                      <Text style={{ color: change >= 0 ? '#52c41a' : '#ff4d4f', marginLeft: 2 }}>
                        {change >= 0 ? '+' : ''}{change}%
                      </Text>
                      <Text type="secondary" style={{ marginLeft: 4 }}>环比</Text>
                    </div>
                  </Card>
                </Col>
              );
            })}
          </Row>

          {/* 4 Charts */}
          <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
            <Col xs={24} lg={12}>
              <Card size="small" title="📈 活跃度 & 触达率趋势" style={{ borderRadius: 10 }}>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={trendChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={[40, 80]} />
                    <ReTooltip contentStyle={{ borderRadius: 6, border: 'none' }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="活跃度" stroke="#ed6a1c" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="触达率" stroke="#1890ff" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card size="small" title="📊 客户月净增长" style={{ borderRadius: 10 }}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={growthChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <ReTooltip contentStyle={{ borderRadius: 6, border: 'none' }} />
                    <Bar dataKey="净增长" fill="#52c41a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card size="small" title="💬 群活跃度分布" style={{ borderRadius: 10 }}>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={groupPie} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" strokeWidth={2}>
                      {groupPie.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <ReTooltip contentStyle={{ borderRadius: 6, border: 'none' }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card size="small" title="⏱ 平均响应时间(秒)" style={{ borderRadius: 10 }}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={responseChart} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={60} />
                    <ReTooltip contentStyle={{ borderRadius: 6, border: 'none' }} />
                    <Bar dataKey="响应时间" fill="#1890ff" radius={[0, 4, 4, 0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </Col>
          </Row>

          {/* Radar Chart */}
          <Card size="small" title="🎯 综合健康雷达图 vs 行业基准" style={{ borderRadius: 10 }}>
            <ResponsiveContainer width="100%" height={350}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#f0f0f0" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Radar name="当前值" dataKey="当前值" stroke="#ed6a1c" fill="#ed6a1c" fillOpacity={0.2} />
                <Radar name="行业基准" dataKey="行业基准" stroke="#1890ff" fill="#1890ff" fillOpacity={0.1} />
                <Legend />
                <ReTooltip />
              </RadarChart>
            </ResponsiveContainer>
          </Card>
        </>
      )}

      {/* ==================== Panel: 成员维度 ==================== */}
      {activeTab === 'member' && (
        <>
          {/* 6 Summary Stats */}
          <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
            {[
              { title: '总人数', value: memberStats.total, color: '#ed6a1c' },
              { title: '平均分', value: memberStats.avgScore, color: '#1890ff' },
              { title: '优秀(A)', value: memberStats.excellent, color: '#52c41a' },
              { title: '关注(B/C)', value: memberStats.attention, color: '#fa8c16' },
              { title: '风险(D)', value: memberStats.risk, color: '#ff4d4f' },
              { title: '趋势', value: memberStats.trend, color: '#722ed1' },
            ].map(s => (
              <Col xs={12} sm={8} md={4} key={s.title}>
                <Card bodyStyle={{ padding: '12px 16px', textAlign: 'center' }} style={{ borderRadius: 10 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{s.title}</Text>
                  <div style={{ fontSize: 24, fontWeight: 700, color: s.color, marginTop: 4 }}>{s.value}</div>
                </Card>
              </Col>
            ))}
          </Row>

          {/* Grade Distribution Pie */}
          <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
            <Col xs={24} md={8}>
              <Card size="small" title="健康等级分布" style={{ borderRadius: 10, height: '100%' }}>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={memberGradeDist} cx="50%" cy="50%" innerRadius={55} outerRadius={90} dataKey="value" strokeWidth={2}>
                      {memberGradeDist.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <ReTooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </Card>
            </Col>
            <Col xs={24} md={16}>
              {/* Member Table */}
              <Card size="small" title={<span>成员评分明细 <Text type="secondary" style={{ fontSize: 12 }}>(点击行查看详情)</Text></span>}
                extra={
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Select mode="multiple" placeholder="等级筛选" style={{ width: 130 }} size="small"
                      value={gradeFilter} onChange={v => setGradeFilter(v)}
                      options={[{ label: 'A级', value: 'A' }, { label: 'B级', value: 'B' }, { label: 'C级', value: 'C' }, { label: 'D级', value: 'D' }]}
                      allowClear />
                    <Input prefix={<SearchOutlined />} placeholder="搜索姓名" size="small" style={{ width: 120 }}
                      value={searchText} onChange={e => setSearchText(e.target.value)} allowClear />
                  </div>
                }
                style={{ borderRadius: 10 }}
              >
                <Table dataSource={filteredMembers} rowKey="key" size="small" pagination={false}
                  onRow={r => ({ onClick: () => setMemberDetail(r), style: { cursor: 'pointer' } })}
                  scroll={{ y: 350 }}
                  columns={[
                    { title: '姓名', dataIndex: 'name', width: 80, render: (v: string) => <Text strong>{v}</Text> },
                    { title: '评分', dataIndex: 'score', width: 60, sorter: (a: Member, b: Member) => b.score - a.score, render: (v: number) => <Text strong style={{ color: v >= 85 ? '#52c41a' : v >= 70 ? '#1890ff' : v >= 60 ? '#fa8c16' : '#ff4d4f' }}>{v}</Text> },
                    { title: '等级', dataIndex: 'grade', width: 60, render: (v: string) => <Tag color={v === 'A' ? 'success' : v === 'B' ? 'processing' : v === 'C' ? 'warning' : 'error'}>{v}</Tag> },
                    { title: '活跃度', dataIndex: 'activity', width: 100, render: (v: number) => <Progress percent={v} size="small" strokeColor={v >= 70 ? '#52c41a' : v >= 50 ? '#1890ff' : '#ff4d4f'} /> },
                    { title: '触达率', dataIndex: 'reach', width: 100, render: (v: number) => <Progress percent={v} size="small" strokeColor={v >= 70 ? '#52c41a' : v >= 50 ? '#1890ff' : '#ff4d4f'} /> },
                    { title: '响应', dataIndex: 'response', width: 100, render: (v: number) => <Progress percent={v} size="small" strokeColor={v >= 70 ? '#52c41a' : v >= 50 ? '#fa8c16' : '#ff4d4f'} /> },
                    { title: '质量', dataIndex: 'quality', width: 100, render: (v: number) => <Progress percent={v} size="small" strokeColor={v >= 70 ? '#52c41a' : v >= 50 ? '#1890ff' : '#ff4d4f'} /> },
                    { title: '趋势', dataIndex: 'trend', width: 60, render: (v: number) => <Text style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f' }}>{v >= 0 ? '↑' : '↓'} {Math.abs(v)}%</Text> },
                    { title: '风险', dataIndex: 'risk', width: 120, render: (v: string[]) => v.length === 0 ? <Tag color="success">无</Tag> : v.map(r => <Tag key={r} color="error" style={{ fontSize: 10, marginBottom: 2 }}>{r}</Tag>) },
                  ]}
                />
              </Card>
            </Col>
          </Row>
        </>
      )}

      {/* ==================== Member Detail Modal ==================== */}
      <Modal open={!!memberDetail} onCancel={() => setMemberDetail(null)} footer={null} width={700} title={null} destroyOnClose>
        {memberDetail && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <Title level={4} style={{ margin: 0 }}><UserOutlined style={{ marginRight: 6, color: '#ed6a1c' }} />{memberDetail.name}</Title>
                <Text type="secondary">总评分 {memberDetail.score} · 等级 <Tag color={memberDetail.grade === 'A' ? 'success' : memberDetail.grade === 'B' ? 'processing' : memberDetail.grade === 'C' ? 'warning' : 'error'}>{memberDetail.grade}级</Tag></Text>
              </div>
              <Text style={{ color: memberDetail.trend >= 0 ? '#52c41a' : '#ff4d4f', fontSize: 16, fontWeight: 600 }}>
                {memberDetail.trend >= 0 ? '↑' : '↓'} {Math.abs(memberDetail.trend)}% vs 上月
              </Text>
            </div>

            {/* Radar Chart */}
            <Card size="small" title="🎯 个人能力雷达 vs 团队均值" style={{ borderRadius: 10, marginBottom: 16 }}>
              <ResponsiveContainer width="100%" height={260}>
                <RadarChart data={memberRadar}>
                  <PolarGrid stroke="#f0f0f0" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Radar name="个人" dataKey="个人" stroke="#ed6a1c" fill="#ed6a1c" fillOpacity={0.2} />
                  <Radar name="团队均值" dataKey="团队均值" stroke="#1890ff" fill="#1890ff" fillOpacity={0.1} />
                  <Legend />
                  <ReTooltip />
                </RadarChart>
              </ResponsiveContainer>
            </Card>

            {/* Risk Warnings */}
            {memberDetail.risk.length > 0 && (
              <Card size="small" style={{ marginBottom: 16, borderRadius: 10, background: '#fff2f0', border: '1px solid #ffccc7' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <InfoCircleOutlined style={{ color: '#ff4d4f', fontSize: 16, marginTop: 2 }} />
                  <div>
                    <Text strong style={{ color: '#ff4d4f' }}>风险提示</Text>
                    {memberDetail.risk.map(r => <Tag key={r} color="error" style={{ marginLeft: 8 }}>{r}</Tag>)}
                  </div>
                </div>
              </Card>
            )}

            {/* Suggestions */}
            <Card size="small" title="💡 个性化改善建议" style={{ borderRadius: 10 }}>
              <Paragraph style={{ marginBottom: 8 }}>
                {memberDetail.grade === 'D' && <>1. 需参加为期 2 周的专项提升训练营，重点提升活跃度和响应速度。<br /></>}
                {memberDetail.grade === 'C' && <>1. 建议与 A 级成员结对学习，每周 2 次经验分享会。<br /></>}
                {memberDetail.activity < 50 && <>2. 活跃度偏低，建议增加每日客户触达频次至 15 次以上。<br /></>}
                {memberDetail.response < 50 && <>3. 响应时间过长，启用模板化回复提升效率，目标从 {memberDetail.response} 降至 60 以内。<br /></>}
                {memberDetail.quality < 60 && <>4. 服务质量待提升，建议回顾近 30 天差评案例，制定改进清单。<br /></>}
                {memberDetail.grade === 'A' && <>1. 保持优秀表现，推荐担任新成员导师，参与培训体系搭建。<br /></>}
                执行周期：{memberDetail.grade === 'D' ? '2周' : memberDetail.grade === 'C' ? '3周' : '1个月'} · 复查日期：7 个工作日后
              </Paragraph>
            </Card>
          </div>
        )}
      </Modal>

      {/* ==================== 智能报告 Modal ==================== */}
      <Modal open={reportOpen} onCancel={() => setReportOpen(false)} footer={null} width={800} title={
        <span><FileTextOutlined style={{ color: '#ed6a1c', marginRight: 6 }} />健康运营智能报告 · 2026年6月</span>
      }>
        <Divider style={{ margin: '12px 0 16px' }} />

        {/* Section 1: Overview */}
        <Title level={5}>📋 一、现状概览</Title>
        <Table dataSource={entityHealth.cards.map((c, i) => ({
          key: i, 指标: c.key, 当前值: `${c.value}${c.unit}`,
          行业基准: `${industryBench[c.key as keyof typeof industryBench]}${c.unit}`,
          差距: `${(c.value - (industryBench[c.key as keyof typeof industryBench] || 0)).toFixed(1)}${c.unit}`,
          状态: getHealth(c.value, c.threshold),
        }))} pagination={false} size="small" style={{ marginBottom: 20 }}
          columns={[
            { title: '指标', dataIndex: '指标', width: 120 },
            { title: '当前值', dataIndex: '当前值', width: 80 },
            { title: '行业基准', dataIndex: '行业基准', width: 80 },
            { title: '差距', dataIndex: '差距', width: 80, render: (v: string) => <Text style={{ color: v.startsWith('-') ? '#ff4d4f' : '#52c41a' }}>{v}</Text> },
            { title: '状态', dataIndex: '状态', width: 70, render: (v: HealthStatus) => <Tag color={v === '健康' ? 'success' : v === '关注' ? 'warning' : 'error'}>{v}</Tag> },
          ]}
        />

        {/* Section 2: Member Analysis */}
        <Title level={5}>👤 二、成员健康分析</Title>
        <Paragraph>
          总人数 <Text strong>48</Text> 人中：A 级 <Text strong style={{ color: '#52c41a' }}>12 人(25%)</Text>、B 级 <Text strong style={{ color: '#1890ff' }}>20 人(42%)</Text>、
          C 级 <Text strong style={{ color: '#fa8c16' }}>10 人(21%)</Text>、D 级 <Text strong style={{ color: '#ff4d4f' }}>6 人(12%)</Text>。
        </Paragraph>
        <Table dataSource={memberList.filter(m => m.grade === 'D' || m.grade === 'C').map(m => ({
          key: m.key, name: m.name, grade: m.grade, score: m.score,
          issues: m.risk.join('、'),
          action: m.grade === 'D' ? '专项训练营' : '结对提升',
        }))} pagination={false} size="small" style={{ marginBottom: 20 }}
          title={() => <Text strong>风险成员明细</Text>}
          columns={[
            { title: '姓名', dataIndex: 'name' }, { title: '等级', dataIndex: 'grade' }, { title: '评分', dataIndex: 'score' },
            { title: '问题', dataIndex: 'issues' }, { title: '措施', dataIndex: 'action' },
          ]}
        />

        {/* Section 3: Improvements */}
        <Title level={5}>🔧 三、改善方案建议</Title>
        <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
          {[
            { title: '低活跃度提升', desc: '针对 10 名活跃度<50 的成员，每日增加触达目标至 15 次，预计 2 周内活跃度提升 20%。', time: '2周' },
            { title: '内容触达优化', desc: '内容触达转化低于行业基准 3 个百分点，建议优化话术库，添加个性化推荐模板。', time: '1个月' },
            { title: 'D 级成员专项干预', desc: '6 名 D 级成员需参加为期 2 周的集中训练营，由 A 级成员一对一辅导。', time: '2周' },
            { title: '响应速度标准化', desc: '启用智能回复模板 + 自动分配机制，目标将平均响应时间从 42s 降至 30s。', time: '1个月' },
          ].map((s, i) => (
            <Col xs={24} sm={12} key={i}>
              <Card size="small" style={{ borderRadius: 8, height: '100%' }}>
                <Text strong>{s.title}</Text>
                <Paragraph style={{ margin: '8px 0 0', fontSize: 12, color: '#666' }}>{s.desc}</Paragraph>
                <Tag color="blue" style={{ marginTop: 6 }}>⏱ {s.time}</Tag>
              </Card>
            </Col>
          ))}
        </Row>

        {/* Section 4: Targets */}
        <Title level={5}>🎯 四、下期目标</Title>
        <Table dataSource={[
          { key: 1, 指标: '日活跃率', 当前: '68%', t30: '72%', t60: '75%' },
          { key: 2, 指标: '客户触达率', 当前: '62%', t30: '65%', t60: '68%' },
          { key: 3, 指标: '响应时间', 当前: '42s', t30: '35s', t60: '30s' },
          { key: 4, 指标: 'D级成员数', 当前: '6', t30: '3', t60: '0' },
          { key: 5, 指标: '平均评分', 当前: '73', t30: '78', t60: '82' },
          { key: 6, 指标: '内容转化率', 当前: '25%', t30: '28%', t60: '32%' },
        ]} pagination={false} size="small"
          columns={[
            { title: '指标', dataIndex: '指标' },
            { title: '当前', dataIndex: '当前' },
            { title: '30天目标', dataIndex: 't30', render: (v: string) => <Text strong style={{ color: '#1890ff' }}>{v}</Text> },
            { title: '60天目标', dataIndex: 't60', render: (v: string) => <Text strong style={{ color: '#722ed1' }}>{v}</Text> },
          ]}
        />
      </Modal>
    </div>
  );
}
