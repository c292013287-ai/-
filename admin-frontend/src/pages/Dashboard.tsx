import { useEffect, useState } from 'react';
import { Table, Tag, Button, message, Select, Statistic, Alert } from 'antd';
import { SyncOutlined, DollarOutlined, WarningOutlined } from '@ant-design/icons';
import { getBudgetList, type BudgetRow, type BudgetSummary } from '../api/dashboard';
import { getEntities, syncEntity, type WecomEntity } from '../api/entities';
import PageHeader from '../components/PageHeader';

const statusMap: Record<string, { color: string; text: string }> = {
  active: { color: 'green', text: '正常' }, paused: { color: 'orange', text: '暂停' },
};

export default function Dashboard() {
  const [data, setData] = useState<BudgetRow[]>([]);
  const [summary, setSummary] = useState<BudgetSummary>({ todayConsumption: 0 });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [entities, setEntities] = useState<WecomEntity[]>([]);
  const [entityFilter, setEntityFilter] = useState<number | undefined>();

  const fetchData = () => {
    setLoading(true);
    const params = entityFilter ? { entityId: entityFilter } : undefined;
    Promise.all([getBudgetList(params), getEntities()])
      .then(([res, ents]) => { setData(res.rows); setSummary(res.summary); setEntities(ents); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [entityFilter]);

  const handleSyncAll = async () => {
    setSyncing(true);
    let done = 0;
    for (const e of entities) {
      if (e.status === 'active') { try { await syncEntity(e.id); done++; } catch {} }
    }
    message.success(`同步完成: ${done} 个主体`);
    setSyncing(false);
    fetchData();
  };

  const warningList = data.filter((r) => r.countdownDays >= 0 && r.countdownDays < 5);

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 50, align: 'center' as const },
    { title: '主体', dataIndex: 'name', key: 'name', width: 130,
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span> },
    { title: 'SKU', dataIndex: 'sku', key: 'sku', width: 90, render: (v: string | null) => v || '-' },
    { title: '配额余额', dataIndex: 'quotaBalance', key: 'quotaBalance', width: 100,
      render: (v: number) => <span style={{ color: v < 5000 ? '#ff4d4f' : undefined, fontWeight: v < 5000 ? 500 : undefined }}>{v.toLocaleString()}</span> },
    { title: '近7天平均', dataIndex: 'avg7dConsumption', key: 'avg7dConsumption', width: 100, render: (v: number) => v.toLocaleString() },
    { title: '倒计时', dataIndex: 'countdownDays', key: 'countdownDays', width: 90,
      render: (v: number) => {
        if (v < 0) return <span style={{ color: '#999' }}>--</span>;
        const urgent = v < 5;
        return <span style={{ color: urgent ? '#ff4d4f' : '#52c41a', fontWeight: urgent ? 'bold' : undefined }}>{v.toFixed(2)} 天</span>;
      }},
    { title: '状态', dataIndex: 'status', key: 'status', width: 70, align: 'center' as const,
      render: (v: string) => <Tag color={statusMap[v]?.color || 'default'}>{statusMap[v]?.text || v}</Tag> },
  ];

  return (
    <div>
      <PageHeader title="资源预警" desc="配额余额监控与倒计时预警"
        extra={<Button icon={<SyncOutlined spin={syncing} />} loading={syncing} onClick={handleSyncAll}>同步数据</Button>} />

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <div style={{ flex: 1, padding: '20px 24px', background: 'linear-gradient(135deg, #e6f7ff 0%, #f0f5ff 100%)', borderRadius: 8, border: '1px solid #d6e4ff' }}>
          <Statistic title={<span style={{ fontSize: 13, color: '#595959' }}>今日累计消耗</span>} value={summary.todayConsumption}
            prefix={<DollarOutlined style={{ color: '#1890ff' }} />} valueStyle={{ color: '#cf1322', fontSize: 28, fontWeight: 600 }} />
        </div>
        <div style={{ flex: 1, padding: '20px 24px', borderRadius: 8,
          background: warningList.length > 0 ? 'linear-gradient(135deg, #fff2f0 0%, #fff7e6 100%)' : 'linear-gradient(135deg, #f6ffed 0%, #f0fff0 100%)',
          border: warningList.length > 0 ? '1px solid #ffccc7' : '1px solid #b7eb8f',
        }}>
          <div style={{ fontSize: 13, color: '#595959', marginBottom: 8 }}>预警主体</div>
          {warningList.length > 0 ? (
            warningList.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ff4d4f', fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
                <WarningOutlined /><span>{r.name}</span>
                <span style={{ fontSize: 12, fontWeight: 400, color: '#999' }}>倒计时 {r.countdownDays} 天</span>
              </div>
            ))
          ) : (
            <div style={{ color: '#52c41a', fontWeight: 600, fontSize: 24 }}><WarningOutlined style={{ marginRight: 6 }} />0 个</div>
          )}
        </div>
      </div>

      {warningList.length > 0 && (
        <Alert message={`${warningList.length} 个主体倒计时不足 5 天，请尽快充值`} type="warning" showIcon style={{ marginBottom: 20, borderRadius: 8 }} />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, padding: '12px 16px', background: '#fafafa', borderRadius: 8 }}>
        <Select placeholder="全部主体" allowClear style={{ width: 200 }} value={entityFilter} onChange={(v) => setEntityFilter(v)}
          options={entities.map((e) => ({ label: e.name, value: e.id }))} />
        <span style={{ color: '#999', fontSize: 13 }}>共 {data.length} 条记录</span>
      </div>

      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} pagination={false} size="middle"
        rowClassName={(record) => record.countdownDays >= 0 && record.countdownDays < 5 ? 'row-warning' : ''} />
    </div>
  );
}
