import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, DatePicker, Empty, Progress, Row, Col, Spin, Table, Tag, Typography } from 'antd';
import { AlertOutlined, BarChartOutlined, CalendarOutlined, DollarOutlined, RiseOutlined, TeamOutlined, ThunderboltOutlined, UserSwitchOutlined } from '@ant-design/icons';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import dayjs from 'dayjs';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { getEntities, type WecomEntity } from '../api/entities';
import { getRecharges, type RechargeRecord } from '../api/recharges';
import { getBudgetList } from '../api/dashboard';
import { getMigrationField, loadMigrationRecords, type MigrationRecord } from './userMigrationData';

const { Text } = Typography;

const CHART_COLORS = ['#ed6a1c', '#1890ff', '#52c41a', '#faad14', '#722ed1', '#eb2f96'];

interface EntityMonthRecharge {
  id: number;
  name: string;
  sku?: string | null;
  rechargeFee: number;
  rechargeAmount: number;
  recordCount: number;
  latestRechargeDate: string | null;
}

interface AnalysisRow {
  key: string;
  dimension: string;
  finding: string;
  reason: string;
  suggestion: string;
  plan: string;
  priority: '高' | '中' | '低';
}

function monthRange(month: dayjs.Dayjs) {
  return {
    startDate: month.startOf('month').format('YYYY-MM-DD'),
    endDate: month.endOf('month').format('YYYY-MM-DD'),
  };
}

function money(value: number) {
  return `¥${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function parseMigrationTimestamp(value: string) {
  if (!value || value === '-') return 0;

  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue;
  }

  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.valueOf() : 0;
}

function getMigrationRegisteredTimestamp(record: MigrationRecord) {
  return parseMigrationTimestamp(getMigrationField(record, ['登记时间'], record.createdAt));
}

function getMigrationProcessedTimestamp(record: MigrationRecord) {
  return parseMigrationTimestamp(getMigrationField(record, ['处理时间'], ''));
}

function getTransferCount(record: MigrationRecord) {
  const value = getMigrationField(record, ['转量数量'], '0').replace(/,/g, '');
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

interface MigrationRollingStat {
  label: string;
  color: string;
  count: number;
}

function MigrationStatSection({
  title,
  stats,
  unit,
  tone,
}: {
  title: string;
  stats: MigrationRollingStat[];
  unit: string;
  tone: 'danger' | 'warning' | 'primary';
}) {
  return (
    <section className="migration-stat-section" data-tone={tone}>
      <div className="migration-stat-section-header">
        <div className="migration-stat-section-title">{title}</div>
      </div>
      <div className="migration-category-grid">
        {stats.map((item) => (
          <div key={item.label} className="migration-category-item" data-tone={item.color}>
            <span className="migration-category-label">{item.label}</span>
            <div className="migration-category-value">
              <strong>{item.count.toLocaleString()}</strong>
              <span>{unit}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

interface AiAssistantProps {
  embedded?: boolean;
  title?: string;
  desc?: string;
}

export default function AiAssistant({
  embedded = false,
  title = 'BI分析报告',
  desc = '按月份统计主体充值表现，并补充用户迁移与转量数据',
}: AiAssistantProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(dayjs());
  const [entities, setEntities] = useState<WecomEntity[]>([]);
  const [recharges, setRecharges] = useState<RechargeRecord[]>([]);
  const [migrationRecords, setMigrationRecords] = useState<MigrationRecord[]>(() => loadMigrationRecords());
  const [monthlyRecharge, setMonthlyRecharge] = useState(0);
  const [todayConsumption, setTodayConsumption] = useState(0);
  const [warningCount, setWarningCount] = useState(0);

  const fetchData = () => {
    setLoading(true);
    setMigrationRecords(loadMigrationRecords());
    const range = monthRange(selectedMonth);
    Promise.all([
      getEntities(),
      getRecharges({ ...range, pageSize: 99999 }),
      getBudgetList(),
    ])
      .then(([entityRes, rechargeRes, budgetRes]) => {
        const budgetRows = Array.isArray(budgetRes?.rows) ? budgetRes.rows : [];
        setEntities(Array.isArray(entityRes) ? entityRes : []);
        setRecharges(Array.isArray(rechargeRes?.data) ? rechargeRes.data : []);
        setMonthlyRecharge(Number(rechargeRes?.monthlyTotal || 0));
        setTodayConsumption(Number(budgetRes?.summary?.todayConsumption || 0));
        setWarningCount(budgetRows.filter((row) => row.countdownDays >= 0 && row.countdownDays < 5).length);
      })
      .catch(() => {
        setEntities([]);
        setRecharges([]);
        setMonthlyRecharge(0);
        setTodayConsumption(0);
        setWarningCount(0);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [selectedMonth]);

  const reportRows = useMemo<EntityMonthRecharge[]>(() => {
    const rowMap = new Map<number, EntityMonthRecharge>();
    entities.forEach((entity) => {
      rowMap.set(entity.id, {
        id: entity.id,
        name: entity.name,
        sku: entity.sku,
        rechargeFee: 0,
        rechargeAmount: 0,
        recordCount: 0,
        latestRechargeDate: null,
      });
    });

    recharges.forEach((record) => {
      const fallbackEntity = record.entity;
      const current = rowMap.get(record.entityId) || {
        id: record.entityId,
        name: fallbackEntity?.name || `主体 ${record.entityId}`,
        sku: fallbackEntity?.sku,
        rechargeFee: 0,
        rechargeAmount: 0,
        recordCount: 0,
        latestRechargeDate: null,
      };

      current.rechargeFee += Number(record.feeAmount || 0);
      current.rechargeAmount += Number(record.amount || 0);
      current.recordCount += 1;
      if (!current.latestRechargeDate || dayjs(record.rechargeDate).isAfter(dayjs(current.latestRechargeDate))) {
        current.latestRechargeDate = record.rechargeDate;
      }
      rowMap.set(record.entityId, current);
    });

    return Array.from(rowMap.values()).sort((a, b) => b.rechargeFee - a.rechargeFee);
  }, [entities, recharges]);

  const activeRows = reportRows.filter((row) => row.rechargeFee > 0 || row.recordCount > 0);
  const totalFee = reportRows.reduce((sum, row) => sum + row.rechargeFee, 0);
  const totalAmount = reportRows.reduce((sum, row) => sum + row.rechargeAmount, 0);
  const totalRecords = reportRows.reduce((sum, row) => sum + row.recordCount, 0);
  const avgFee = activeRows.length ? totalFee / activeRows.length : 0;
  const topRow = activeRows[0];
  const inactiveCount = Math.max(reportRows.length - activeRows.length, 0);
  const topShare = totalFee > 0 && topRow ? topRow.rechargeFee / totalFee : 0;
  const migrationSummary = useMemo(() => {
    const monthStart = selectedMonth.startOf('month').valueOf();
    const monthEnd = selectedMonth.endOf('month').valueOf();
    const recordsInMonth = migrationRecords.filter((record) => {
      const registeredAt = getMigrationRegisteredTimestamp(record);
      return registeredAt >= monthStart && registeredAt <= monthEnd;
    });
    const blockedRecordsInMonth = recordsInMonth.filter((record) => getMigrationField(record, ['定性']).trim() === '封号');
    const transferredRecordsInMonth = migrationRecords.filter((record) => {
      const processedAt = getMigrationProcessedTimestamp(record);
      return processedAt >= monthStart && processedAt <= monthEnd && getTransferCount(record) > 0;
    });
    const transferPeople = transferredRecordsInMonth.reduce((sum, record) => sum + getTransferCount(record), 0);

    return {
      submitted: recordsInMonth.length,
      blocked: blockedRecordsInMonth.length,
      transferPeople,
      transferTimes: transferredRecordsInMonth.length,
    };
  }, [migrationRecords, selectedMonth]);
  const migrationRollingStats = useMemo(() => {
    const now = dayjs();
    const yesterdayStart = now.subtract(1, 'day').startOf('day').valueOf();
    const yesterdayEnd = now.subtract(1, 'day').endOf('day').valueOf();
    const weekStart = now.subtract(7, 'day').startOf('day').valueOf();
    const monthStart = now.subtract(30, 'day').startOf('day').valueOf();
    const blockedRecords = migrationRecords.filter(
      (record) => getMigrationField(record, ['定性']).trim() === '封号',
    );
    const transferredRecords = migrationRecords.filter((record) => getTransferCount(record) > 0);

    const blockedCount = (start: number, end: number) => blockedRecords.filter((record) => {
      const registeredAt = getMigrationRegisteredTimestamp(record);
      return registeredAt >= start && registeredAt <= end;
    }).length;
    const transferCount = (start: number, end: number) => migrationRecords.reduce((total, record) => {
      const processedAt = getMigrationProcessedTimestamp(record);
      return processedAt >= start && processedAt <= end ? total + getTransferCount(record) : total;
    }, 0);
    const transferTimes = (start: number, end: number) => transferredRecords.filter((record) => {
      const processedAt = getMigrationProcessedTimestamp(record);
      return processedAt >= start && processedAt <= end;
    }).length;

    return {
      blocked: [
        { label: '上一日封号数据', color: 'red', count: blockedCount(yesterdayStart, yesterdayEnd) },
        { label: '近一周封号数据', color: 'orange', count: blockedCount(weekStart, yesterdayEnd) },
        { label: '近一月封号数据', color: 'gold', count: blockedCount(monthStart, yesterdayEnd) },
        { label: '累计封号数据', color: 'blue', count: blockedRecords.length },
      ],
      transfers: [
        { label: '上一日迁移用户数量', color: 'red', count: transferCount(yesterdayStart, yesterdayEnd) },
        { label: '近一周迁移用户数量', color: 'orange', count: transferCount(weekStart, yesterdayEnd) },
        { label: '近一月迁移用户数量', color: 'gold', count: transferCount(monthStart, yesterdayEnd) },
        { label: '累计迁移用户数量', color: 'blue', count: migrationRecords.reduce((total, record) => total + getTransferCount(record), 0) },
      ],
      times: [
        { label: '上一日迁移人次', color: 'red', count: transferTimes(yesterdayStart, yesterdayEnd) },
        { label: '近一周迁移人次', color: 'orange', count: transferTimes(weekStart, yesterdayEnd) },
        { label: '近一月迁移人次', color: 'gold', count: transferTimes(monthStart, yesterdayEnd) },
        { label: '累计迁移人次', color: 'blue', count: transferredRecords.length },
      ],
    };
  }, [migrationRecords]);
  const chartData = reportRows.slice(0, 10).map((row) => ({
    name: row.name.length > 8 ? `${row.name.slice(0, 8)}...` : row.name,
    充值费用: Number(row.rechargeFee.toFixed(2)),
  }));
  const operationalMetrics = [
    { title: '本月充值总额', value: monthlyRecharge, suffix: '元', icon: <DollarOutlined />, color: '#ed6a1c', route: '/recharges' },
    { title: '今日累计获客助手进量', value: todayConsumption, suffix: '个', icon: <ThunderboltOutlined />, color: '#1677ff', route: '/consumption' },
    { title: '预警主体', value: warningCount, suffix: '个', icon: <AlertOutlined />, color: warningCount > 0 ? '#ff4d4f' : '#52c41a', route: '/warnings' },
  ];
  const analysisRows = useMemo<AnalysisRow[]>(() => {
    const blockedRate = migrationSummary.submitted > 0
      ? migrationSummary.blocked / migrationSummary.submitted
      : 0;
    const inactiveRate = reportRows.length > 0 ? inactiveCount / reportRows.length : 0;
    const avgTransfer = migrationSummary.transferTimes > 0
      ? migrationSummary.transferPeople / migrationSummary.transferTimes
      : 0;
    const missingFeeCount = recharges.filter(
      (record) => Number(record.amount || 0) > 0 && Number(record.feeAmount || 0) <= 0,
    ).length;

    return [
      {
        key: 'concentration',
        dimension: '充值集中度',
        finding: totalFee > 0
          ? `头部主体贡献 ${(topShare * 100).toFixed(1)}%，最高为${topRow?.name || '-'}。`
          : '本月暂无有效充值费用记录。',
        reason: totalFee > 0
          ? (topShare >= 0.5 ? '充值可能集中在少数成熟主体，其他主体尚未形成稳定投入。' : '主体间投入相对分散，暂未出现明显单点依赖。')
          : '可能尚未发生充值，或费用金额字段未及时登记。',
        suggestion: topShare >= 0.5 ? '核查头部主体依赖风险，并提升第二梯队主体投入。' : '保持当前结构，持续跟踪前三主体占比。',
        plan: '每月输出 Top3 占比与环比变化；对连续两月无充值主体建立专项跟进清单。',
        priority: topShare >= 0.5 || totalFee === 0 ? '高' : '低',
      },
      {
        key: 'activity',
        dimension: '主体活跃度',
        finding: `${activeRows.length} 个主体有充值，${inactiveCount} 个主体无充值，未活跃占比 ${(inactiveRate * 100).toFixed(1)}%。`,
        reason: inactiveRate >= 0.3 ? '可能存在主体停用、资源未分配或充值节奏不稳定。' : '大部分主体已有充值记录，整体活跃度较稳定。',
        suggestion: inactiveRate >= 0.3 ? '按 SKU 和负责人拆分未活跃主体，确认真实经营状态。' : '对低频主体设置月度最低活跃监测。',
        plan: '将无充值主体分为停用、待启动、异常三类，并为异常主体设置 3 个工作日处理时限。',
        priority: inactiveRate >= 0.3 ? '中' : '低',
      },
      {
        key: 'risk',
        dimension: '迁移风险',
        finding: `${selectedMonth.format('MM月')}迁移提交 ${migrationSummary.submitted} 条，封号 ${migrationSummary.blocked} 条，封号率 ${(blockedRate * 100).toFixed(1)}%。`,
        reason: blockedRate >= 0.1 ? '可能与账号质量、迁移节奏或话术合规性有关，需结合具体标签复核。' : '当前封号占比较低，但仍需保持迁移前检查。',
        suggestion: blockedRate >= 0.1 ? '优先复盘封号案例，按主体、SKU、迁移类型定位集中风险。' : '维持现有审核流程，持续观察近一周变化。',
        plan: '建立封号案例周复盘；将高风险标签加入迁移前置校验，并沉淀可复用话术。',
        priority: blockedRate >= 0.1 ? '高' : '低',
      },
      {
        key: 'efficiency',
        dimension: '迁移效率',
        finding: migrationSummary.transferTimes > 0
          ? `本月完成 ${migrationSummary.transferTimes} 人次，迁移 ${migrationSummary.transferPeople.toLocaleString()} 人，单次平均 ${avgTransfer.toFixed(1)} 人。`
          : '本月暂无已登记的迁移执行数据。',
        reason: migrationSummary.transferTimes > 0 ? '批次效率受转量规模、处理人产能和迁移类型共同影响。' : '可能尚未执行，或转量数量、处理时间未完成回填。',
        suggestion: migrationSummary.transferTimes > 0 ? '比较不同处理人和迁移类型的单次产出，识别高效做法。' : '检查待处理记录并补齐处理人、转量数量和处理时间。',
        plan: '按处理人建立周度人次和转量看板；低于团队均值的批次进入复盘清单。',
        priority: migrationSummary.transferTimes > 0 ? '中' : '高',
      },
      {
        key: 'quality',
        dimension: '数据完整性',
        finding: `本月 ${totalRecords} 笔充值中，${missingFeeCount} 笔未登记有效费用金额。`,
        reason: missingFeeCount > 0 ? '费用字段可能非必填，或导入记录未完成补录。' : '当前充值费用字段完整，可支持金额分析。',
        suggestion: missingFeeCount > 0 ? '补齐缺失费用，并在新增和导入环节增加完整性校验。' : '继续保持录入校验，并定期抽查异常值。',
        plan: '将费用金额设为业务必填项；导入后自动输出缺失字段清单并指派负责人。',
        priority: missingFeeCount > 0 ? '中' : '低',
      },
    ];
  }, [activeRows.length, inactiveCount, migrationSummary, recharges, reportRows.length, selectedMonth, topRow, topShare, totalFee, totalRecords]);

  const columns = [
    {
      title: '排名',
      key: 'rank',
      width: 70,
      align: 'center' as const,
      render: (_: unknown, row: EntityMonthRecharge, index: number) => (
        row.rechargeFee > 0 ? <Tag color={index < 3 ? 'orange' : 'default'}>{index + 1}</Tag> : <span style={{ color: '#999' }}>-</span>
      ),
    },
    {
      title: '主体',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      render: (value: string, row: EntityMonthRecharge) => (
        <div>
          <div style={{ fontWeight: 600 }}>{value}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.sku || '未配置 SKU'}</Text>
        </div>
      ),
    },
    {
      title: '单月充值费用',
      dataIndex: 'rechargeFee',
      key: 'rechargeFee',
      width: 150,
      sorter: (a: EntityMonthRecharge, b: EntityMonthRecharge) => a.rechargeFee - b.rechargeFee,
      render: (value: number) => <span style={{ color: '#ed6a1c', fontWeight: 700 }}>{money(value)}</span>,
    },
    {
      title: '充值数量',
      dataIndex: 'rechargeAmount',
      key: 'rechargeAmount',
      width: 130,
      sorter: (a: EntityMonthRecharge, b: EntityMonthRecharge) => a.rechargeAmount - b.rechargeAmount,
      render: (value: number) => <span style={{ color: '#1677ff', fontWeight: 600 }}>{value.toLocaleString()} 个</span>,
    },
    {
      title: '充值笔数',
      dataIndex: 'recordCount',
      key: 'recordCount',
      width: 110,
      sorter: (a: EntityMonthRecharge, b: EntityMonthRecharge) => a.recordCount - b.recordCount,
      render: (value: number) => `${value} 笔`,
    },
    {
      title: '费用占比',
      key: 'ratio',
      width: 190,
      render: (_: unknown, row: EntityMonthRecharge) => {
        const ratio = totalFee > 0 ? Math.round((row.rechargeFee / totalFee) * 100) : 0;
        return <Progress percent={ratio} size="small" strokeColor="#ed6a1c" />;
      },
    },
    {
      title: '最近下单日期',
      dataIndex: 'latestRechargeDate',
      key: 'latestRechargeDate',
      width: 150,
      render: (value: string | null) => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-',
    },
  ];
  const analysisColumns = [
    { title: '分析维度', dataIndex: 'dimension', key: 'dimension', width: 110, fixed: 'left' as const, render: (value: string) => <strong>{value}</strong> },
    { title: '数据发现', dataIndex: 'finding', key: 'finding', width: 250 },
    { title: '原因判断', dataIndex: 'reason', key: 'reason', width: 280 },
    { title: '建议', dataIndex: 'suggestion', key: 'suggestion', width: 260 },
    { title: '优化方案', dataIndex: 'plan', key: 'plan', width: 320 },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      width: 90,
      fixed: 'right' as const,
      render: (value: AnalysisRow['priority']) => <Tag color={value === '高' ? 'red' : value === '中' ? 'orange' : 'blue'}>{value}</Tag>,
    },
  ];

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  return (
    <div className="data-report-page" style={{ paddingTop: embedded ? 8 : 0 }}>
      <PageHeader
        title={title}
        desc={desc}
        extra={
          <DatePicker
            picker="month"
            allowClear={false}
            value={selectedMonth}
            onChange={(value) => value && setSelectedMonth(value)}
            suffixIcon={<CalendarOutlined />}
          />
        }
      />

      <section className="report-section">
        <div className="report-section-heading">
          <div>
            <strong>实时经营概览</strong>
            <span>点击指标可查看对应业务明细</span>
          </div>
        </div>
        <Row gutter={[16, 16]}>
          {operationalMetrics.map((metric) => (
            <Col xs={24} md={8} key={metric.title}>
              <Card
                className="home-metric-card report-operational-card"
                hoverable
                styles={{ body: { padding: '20px 22px' } }}
                onClick={() => navigate(metric.route)}
              >
                <div className="report-operational-content">
                  <div>
                    <Text type="secondary" className="home-metric-title">{metric.title}</Text>
                    <div className="report-operational-value" style={{ color: metric.color }}>
                      {metric.value.toLocaleString()}
                      <Text>{metric.suffix}</Text>
                    </div>
                  </div>
                  <div className="report-operational-icon" style={{ color: metric.color }}>{metric.icon}</div>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      </section>

      <div className="data-report-meta">
        <div><span>报告周期</span><strong>{selectedMonth.format('YYYY年MM月')}</strong></div>
        <div><span>数据主体</span><strong>{reportRows.length} 个</strong></div>
        <div><span>迁移样本</span><strong>{migrationSummary.submitted} 条</strong></div>
        <div><span>生成时间</span><strong>{dayjs().format('YYYY-MM-DD HH:mm')}</strong></div>
      </div>

      <div className="summary-grid">
        <StatCard title={`${selectedMonth.format('YYYY年MM月')}充值费用`} value={money(totalFee)} gradient="orange" color="#ed6a1c" prefix={<DollarOutlined style={{ color: '#ed6a1c' }} />} />
        <StatCard title="有充值主体" value={activeRows.length} suffix="个" gradient="blue" color="#1677ff" prefix={<TeamOutlined style={{ color: '#1677ff' }} />} />
        <StatCard title="充值数量" value={totalAmount} suffix="个" gradient="green" color="#52c41a" prefix={<RiseOutlined style={{ color: '#52c41a' }} />} />
        <StatCard title="充值笔数" value={totalRecords} suffix="笔" gradient="red" color="#cf1322" />
      </div>

      <Card size="small" title="用户迁移概况" style={{ marginBottom: 24 }}>
        <div className="summary-grid bi-migration-summary-grid" style={{ marginBottom: 0 }}>
          <StatCard title={`${selectedMonth.format('MM月')}迁移提交`} value={migrationSummary.submitted} suffix="条" gradient="blue" color="#1677ff" prefix={<UserSwitchOutlined style={{ color: '#1677ff' }} />} />
          <StatCard title="封号数据" value={migrationSummary.blocked} suffix="条" gradient="red" color="#cf1322" prefix={<AlertOutlined style={{ color: '#cf1322' }} />} />
          <StatCard title="转量用户数量" value={migrationSummary.transferPeople} suffix="人" gradient="green" color="#52c41a" prefix={<RiseOutlined style={{ color: '#52c41a' }} />} />
          <StatCard title="迁移人次" value={migrationSummary.transferTimes} suffix="人次" gradient="orange" color="#ed6a1c" />
        </div>
      </Card>

      <Card size="small" title="迁移统计" style={{ marginBottom: 24 }}>
        <div className="migration-stat-sections">
          <MigrationStatSection title="封号数据" stats={migrationRollingStats.blocked} unit="条" tone="danger" />
          <MigrationStatSection title="转量数据" stats={migrationRollingStats.transfers} unit="人" tone="warning" />
          <MigrationStatSection title="人次" stats={migrationRollingStats.times} unit="人次" tone="primary" />
        </div>
      </Card>

      <Card
        className="report-analysis-card"
        size="small"
        title="经营分析与优化建议"
        extra={<Text type="secondary">原因判断为基于当前数据的分析推断</Text>}
        style={{ marginBottom: 24 }}
      >
        <div className="report-executive-summary">
          <div>
            <span>经营概览</span>
            <strong>{activeRows.length} 个主体产生充值，费用合计 {money(totalFee)}</strong>
          </div>
          <div>
            <span>核心风险</span>
            <strong>{analysisRows.filter((item) => item.priority === '高').length} 项高优先级问题</strong>
          </div>
          <div>
            <span>执行重点</span>
            <strong>主体活跃、迁移风控、数据完整性</strong>
          </div>
        </div>
        <Table
          dataSource={analysisRows}
          columns={analysisColumns}
          rowKey="key"
          size="small"
          pagination={false}
          scroll={{ x: 1310 }}
        />
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={15}>
          <Card
            className="chart-card"
            size="small"
            title={<span><BarChartOutlined style={{ color: '#ed6a1c', marginRight: 8 }} />主体单月充值费用 Top10</span>}
            style={{ height: '100%' }}
          >
            {activeRows.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 28 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={58} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => Number(value).toLocaleString()} />
                  <ChartTooltip formatter={(value: any) => [money(Number(value || 0)), '充值费用']} contentStyle={{ borderRadius: 6, border: 'none' }} />
                  <Bar dataKey="充值费用" radius={[4, 4, 0, 0]}>
                    {chartData.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty description="本月暂无充值费用" />}
          </Card>
        </Col>

        <Col xs={24} lg={9}>
          <Card size="small" title="月度摘要" style={{ height: '100%' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <Text type="secondary">统计月份</Text>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{selectedMonth.format('YYYY年MM月')}</div>
              </div>
              <div>
                <Text type="secondary">充值费用最高主体</Text>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{topRow?.name || '-'}</div>
                <Text type="secondary" style={{ fontSize: 12 }}>{topRow ? money(topRow.rechargeFee) : '暂无数据'}</Text>
              </div>
              <div>
                <Text type="secondary">单主体平均充值费用</Text>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#ed6a1c', marginTop: 4 }}>{money(avgFee)}</div>
              </div>
              <div>
                <Text type="secondary">未产生充值费用主体</Text>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{Math.max(reportRows.length - activeRows.length, 0)} 个</div>
              </div>
              <div>
                <Text type="secondary">用户迁移转量</Text>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#1677ff', marginTop: 4 }}>{migrationSummary.transferPeople.toLocaleString()} 人</div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {migrationSummary.transferTimes.toLocaleString()} 人次 · 封号 {migrationSummary.blocked.toLocaleString()} 条
                </Text>
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      <Card size="small" title="主体单月充值费用明细">
        <Table
          dataSource={reportRows}
          columns={columns}
          rowKey="id"
          size="middle"
          scroll={{ x: 1040 }}
          pagination={{
            pageSize: 20,
            showTotal: (total: number) => `共 ${total} 个主体`,
          }}
        />
      </Card>
    </div>
  );
}
