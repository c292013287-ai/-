import { useEffect, useState } from 'react';
import { Table, Tag, Button, message, Modal, Form, Input, InputNumber,
         Space, Select, DatePicker, Statistic, Alert, Typography } from 'antd';
import { SyncOutlined, EditOutlined, DollarOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getBudgetList, type BudgetRow, type BudgetSummary } from '../api/dashboard';
import { getEntities, syncEntity, updateEntity } from '../api/entities';

const { Text } = Typography;

const statusMap: Record<string, { color: string; text: string }> = {
  active: { color: 'green', text: '正常' },
  paused: { color: 'orange', text: '暂停' },
};

export default function Dashboard() {
  const [data, setData] = useState<BudgetRow[]>([]);
  const [summary, setSummary] = useState<BudgetSummary>({ todayConsumption: 0 });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [entities, setEntities] = useState<any[]>([]);
  const [entityFilter, setEntityFilter] = useState<number | undefined>();
  const [yearMonth, setYearMonth] = useState<string>(dayjs().format('YYYY-MM'));
  const [form] = Form.useForm();

  const fetchData = () => {
    setLoading(true);
    const params: any = {};
    if (entityFilter) params.entityId = entityFilter;
    if (yearMonth) params.yearMonth = yearMonth;
    Promise.all([getBudgetList(params), getEntities()])
      .then(([res, ents]) => { setData(res.rows); setSummary(res.summary); setEntities(ents); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [entityFilter, yearMonth]);

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      let done = 0;
      for (const e of entities) {
        if (e.status === 'active') { try { await syncEntity(e.id); done++; } catch {} }
      }
      message.success(`同步完成: ${done} 个主体`);
      fetchData();
    } catch { message.error('同步失败'); }
    finally { setSyncing(false); }
  };

  const handleEdit = (row: BudgetRow) => {
    setEditingId(row.id);
    form.setFieldsValue({
      name: row.name, month: yearMonth, sku: row.sku,
      monthlyBudget: row.monthlyBudget, rechargeAmount: row.actualRecharge, status: row.status,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await updateEntity(editingId!, {
        name: values.name, sku: values.sku,
        monthlyBudget: values.monthlyBudget,
        rechargeAmount: values.rechargeAmount, status: values.status,
      });
      message.success('更新成功');
      setModalOpen(false);
      fetchData();
    } catch (e: any) {
      if (!e?.errorFields) message.error('操作失败');
    } finally { setSubmitting(false); }
  };

  const warningCount = data.filter((r) => r.countdownDays >= 0 && r.countdownDays < 5).length;

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 50, align: 'center' as const },
    { title: '主体', dataIndex: 'name', key: 'name', width: 130,
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span> },
    { title: '月份', key: 'month', width: 85, align: 'center' as const,
      render: () => <Tag>{yearMonth}</Tag> },
    { title: 'SKU', dataIndex: 'sku', key: 'sku', width: 90,
      render: (v: string | null) => v || '-' },
    { title: '当月预算', dataIndex: 'monthlyBudget', key: 'monthlyBudget', width: 110,
      render: (v: number) => <span style={{ color: '#1890ff' }}>{v.toLocaleString()}</span> },
    { title: '实际充值', dataIndex: 'actualRecharge', key: 'actualRecharge', width: 100,
      render: (v: number) => (v > 0 ? v.toLocaleString() : '-') },
    { title: '预算余额', key: 'budgetBalance', width: 100,
      render: (_: any, r: BudgetRow) => {
        const balance = r.monthlyBudget - r.actualRecharge;
        return <span style={{ color: balance < 0 ? '#ff4d4f' : '#52c41a' }}>{balance.toLocaleString()}</span>;
      }},
    { title: '配额余额', dataIndex: 'quotaBalance', key: 'quotaBalance', width: 100,
      render: (v: number) => {
        const warn = v < 5000;
        return <span style={{ color: warn ? '#ff4d4f' : undefined, fontWeight: warn ? 500 : undefined }}>{v.toLocaleString()}</span>;
      }},
    { title: '实际消耗', dataIndex: 'actualConsumption', key: 'actualConsumption', width: 100,
      render: (v: number) => <span style={{ color: '#cf1322' }}>{v.toLocaleString()}</span> },
    { title: '近7天平均', dataIndex: 'avg7dConsumption', key: 'avg7dConsumption', width: 100,
      render: (v: number) => v.toLocaleString() },
    { title: '倒计时', dataIndex: 'countdownDays', key: 'countdownDays', width: 90,
      render: (v: number) => {
        if (v < 0) return <span style={{ color: '#999' }}>--</span>;
        const urgent = v < 5;
        return <span style={{
          color: urgent ? '#ff4d4f' : '#52c41a',
          fontWeight: urgent ? 'bold' : undefined,
        }}>{v.toFixed(2)} 天</span>;
      }},
    { title: '状态', dataIndex: 'status', key: 'status', width: 70, align: 'center' as const,
      render: (v: string) => {
        const s = statusMap[v] || { color: 'default', text: v };
        return <Tag color={s.color}>{s.text}</Tag>;
      }},
    { title: '操作', key: 'action', width: 80, align: 'center' as const,
      render: (_: any, row: BudgetRow) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(row)}>编辑</Button>
      )},
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: '0 0 4px 0', fontSize: 20, fontWeight: 600 }}>预算情况</h2>
          <Text type="secondary">各主体预算执行与配额消耗追踪</Text>
        </div>
        <Space>
          <Button icon={<SyncOutlined spin={syncing} />} loading={syncing} onClick={handleSyncAll}>
            同步数据
          </Button>
        </Space>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <div style={{
          flex: 1, padding: '20px 24px',
          background: 'linear-gradient(135deg, #e6f7ff 0%, #f0f5ff 100%)',
          borderRadius: 8, border: '1px solid #d6e4ff',
        }}>
          <Statistic
            title={<span style={{ fontSize: 13, color: '#595959' }}>今日累计消耗</span>}
            value={summary.todayConsumption}
            prefix={<DollarOutlined style={{ color: '#1890ff' }} />}
            valueStyle={{ color: '#cf1322', fontSize: 28, fontWeight: 600 }}
          />
        </div>
        <div style={{
          flex: 1, padding: '20px 24px',
          background: warningCount > 0
            ? 'linear-gradient(135deg, #fff2f0 0%, #fff7e6 100%)'
            : 'linear-gradient(135deg, #f6ffed 0%, #f0fff0 100%)',
          borderRadius: 8,
          border: warningCount > 0 ? '1px solid #ffccc7' : '1px solid #b7eb8f',
        }}>
          <Statistic
            title={<span style={{ fontSize: 13, color: '#595959' }}>预警主体</span>}
            value={warningCount}
            suffix={warningCount > 0 ? '个倒计时不足5天' : '个'}
            prefix={<WarningOutlined style={{ color: warningCount > 0 ? '#ff4d4f' : '#52c41a' }} />}
            valueStyle={{ color: warningCount > 0 ? '#ff4d4f' : '#52c41a', fontSize: 28, fontWeight: 600 }}
          />
        </div>
      </div>

      {warningCount > 0 && (
        <Alert
          message={`${warningCount} 个主体倒计时不足 5 天，请尽快充值`}
          type="warning"
          showIcon
          style={{ marginBottom: 20, borderRadius: 8 }}
        />
      )}

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16, padding: '12px 16px',
        background: '#fafafa', borderRadius: 8,
      }}>
        <Space wrap>
          <Select
            placeholder="全部主体" allowClear style={{ width: 200 }}
            value={entityFilter} onChange={(v) => setEntityFilter(v)}
            options={entities.map((e) => ({ label: e.name, value: e.id }))}
          />
          <DatePicker
            picker="month" value={dayjs(yearMonth)}
            onChange={(d) => setYearMonth(d ? d.format('YYYY-MM') : dayjs().format('YYYY-MM'))}
            allowClear={false}
          />
        </Space>
        <Text type="secondary">共 {data.length} 条记录</Text>
      </div>

      <Table
        columns={columns} dataSource={data} rowKey="id"
        loading={loading} pagination={false}
        size="middle"
        rowClassName={(record) => record.countdownDays >= 0 && record.countdownDays < 5 ? 'row-warning' : ''}
      />

      <Modal
        title={editingId ? '编辑主体' : '新增主体'}
        open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)}
        confirmLoading={submitting} destroyOnClose width={480}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="主体名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="month" label="月份"><Input /></Form.Item>
          <Form.Item name="sku" label="SKU"><Input placeholder="可选" /></Form.Item>
          <Form.Item name="monthlyBudget" label="当月预算">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item name="rechargeAmount" label="实际充值">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select options={[
              { label: '正常', value: 'active' },
              { label: '暂停', value: 'paused' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
