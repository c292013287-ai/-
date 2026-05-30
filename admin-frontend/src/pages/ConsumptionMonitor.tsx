import { useEffect, useState } from 'react';
import { Table, Card, Select, DatePicker, Row, Col, Space, Statistic } from 'antd';
import { BarChartOutlined, PhoneOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getConsumptionList, getConsumptionTrend, type ConsumptionRecord, type TrendItem } from '../api/consumption';
import { getEntities, type WecomEntity } from '../api/entities';

export default function ConsumptionMonitor() {
  const [records, setRecords] = useState<ConsumptionRecord[]>([]);
  const [, setTrend] = useState<TrendItem[]>([]);
  const [entities, setEntities] = useState<WecomEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState<number | undefined>();
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(7, 'day'), dayjs(),
  ]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });

  useEffect(() => {
    getEntities().then(setEntities);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getConsumptionList({
        entityId: entityFilter,
        startDate: dateRange[0].format('YYYY-MM-DD'),
        endDate: dateRange[1].format('YYYY-MM-DD'),
        page: pagination.current,
        pageSize: pagination.pageSize,
      }),
      getConsumptionTrend({ entityId: entityFilter, days: 7 }),
    ])
      .then(([listRes, trendRes]) => {
        setRecords(listRes.data);
        setPagination((p: any) => ({ ...p, total: listRes.total }));
        setTrend(trendRes);
      })
      .finally(() => setLoading(false));
  }, [entityFilter, dateRange, pagination.current]);

  const totalConsumption = records.reduce((sum, r) => sum + r.consumption, 0);
  const totalCalls = records.reduce((sum, r) => sum + r.calls, 0);

  const columns = [
    { title: '日期', dataIndex: 'date', key: 'date', width: 110, render: (v: string) => dayjs(v).format('YYYY-MM-DD') },
    { title: '主体', key: 'entity', width: 160, render: (_: any, r: ConsumptionRecord) => r.entity.name },
    {
      title: '消耗量', dataIndex: 'consumption', key: 'consumption', width: 110,
      render: (v: number) => <span style={{ color: '#cf1322', fontWeight: 500 }}>{v.toLocaleString()}</span>,
    },
    {
      title: '调用次数', dataIndex: 'calls', key: 'calls', width: 110,
      render: (v: number) => v.toLocaleString(),
    },
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 24 }}>消耗监控</h2>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title="筛选期间总消耗" value={totalConsumption} prefix={<BarChartOutlined />} valueStyle={{ color: '#cf1322' }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title="筛选期间总调用" value={totalCalls} prefix={<PhoneOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title="记录条数" value={pagination.total} />
          </Card>
        </Col>
      </Row>

      <Card>
        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            placeholder="全部主体"
            allowClear
            style={{ width: 200 }}
            value={entityFilter}
            onChange={(v) => {
              setEntityFilter(v);
              setPagination((p: any) => ({ ...p, current: 1 }));
            }}
            options={entities.map((e) => ({ label: e.name, value: e.id }))}
          />
          <DatePicker.RangePicker
            value={dateRange}
            onChange={(dates) => {
              if (dates && dates[0] && dates[1]) {
                setDateRange([dates[0], dates[1]]);
                setPagination((p: any) => ({ ...p, current: 1 }));
              }
            }}
          />
        </Space>

        <Table
          dataSource={records}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{
            ...pagination,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page, pageSize) => setPagination({ ...pagination, current: page, pageSize }),
          }}
        />
      </Card>
    </div>
  );
}
