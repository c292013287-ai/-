import { useEffect, useMemo, useState } from 'react';
import { Card, DatePicker, Empty, Progress, Row, Col, Spin, Table, Tag, Typography } from 'antd';
import { BarChartOutlined, CalendarOutlined, DollarOutlined, RiseOutlined, TeamOutlined } from '@ant-design/icons';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import dayjs from 'dayjs';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { getEntities, type WecomEntity } from '../api/entities';
import { getRecharges, type RechargeRecord } from '../api/recharges';

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

function monthRange(month: dayjs.Dayjs) {
  return {
    startDate: month.startOf('month').format('YYYY-MM-DD'),
    endDate: month.endOf('month').format('YYYY-MM-DD'),
  };
}

function money(value: number) {
  return `¥${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

interface AiAssistantProps {
  embedded?: boolean;
}

export default function AiAssistant({ embedded = false }: AiAssistantProps) {
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(dayjs());
  const [entities, setEntities] = useState<WecomEntity[]>([]);
  const [recharges, setRecharges] = useState<RechargeRecord[]>([]);

  const fetchData = () => {
    setLoading(true);
    const range = monthRange(selectedMonth);
    Promise.all([
      getEntities(),
      getRecharges({ ...range, pageSize: 99999 }),
    ])
      .then(([entityRes, rechargeRes]) => {
        setEntities(Array.isArray(entityRes) ? entityRes : []);
        setRecharges(Array.isArray(rechargeRes?.data) ? rechargeRes.data : []);
      })
      .catch(() => {
        setEntities([]);
        setRecharges([]);
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
  const chartData = reportRows.slice(0, 10).map((row) => ({
    name: row.name.length > 8 ? `${row.name.slice(0, 8)}...` : row.name,
    充值费用: Number(row.rechargeFee.toFixed(2)),
  }));

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

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', paddingTop: embedded ? 8 : 0 }}>
      <PageHeader
        title="BI分析报告"
        desc="按月份统计每一个主体的充值费用、充值数量与费用占比"
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

      <div className="summary-grid">
        <StatCard title={`${selectedMonth.format('YYYY年MM月')}充值费用`} value={money(totalFee)} gradient="orange" color="#ed6a1c" prefix={<DollarOutlined style={{ color: '#ed6a1c' }} />} />
        <StatCard title="有充值主体" value={activeRows.length} suffix="个" gradient="blue" color="#1677ff" prefix={<TeamOutlined style={{ color: '#1677ff' }} />} />
        <StatCard title="充值数量" value={totalAmount} suffix="个" gradient="green" color="#52c41a" prefix={<RiseOutlined style={{ color: '#52c41a' }} />} />
        <StatCard title="充值笔数" value={totalRecords} suffix="笔" gradient="red" color="#cf1322" />
      </div>

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
