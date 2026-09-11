import { useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Modal, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EyeOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { getFeishuMigrationRecords, type FeishuRecord } from '../api/migration';
import PageHeader from '../components/PageHeader';

const { Text } = Typography;

const HANDOVER_RECORDS_KEY = 'handover-feishu-records';
const HANDOVER_SYNC_TIME_KEY = 'handover-feishu-last-synced-at';
const HANDOVER_FORM_LINK = 'https://opensplendid.feishu.cn/wiki/BMInwED56iwDFHkmXP7cdodbnF5?table=tblDWJVvByHrpdC1&view=vewPhVPbL7';
const HANDOVER_CONFIG = {
  appToken: 'BMInwED56iwDFHkmXP7cdodbnF5',
  tableId: 'tblDWJVvByHrpdC1',
  viewId: 'vewPhVPbL7',
};

const preferredFieldOrder = [
  '提交人',
  '姓名',
  '离职人员',
  '离职员工',
  '员工姓名',
  '部门',
  '岗位',
  '手机号',
  '企业微信账号',
  '交接账号',
  '接收人',
  '承接人',
  '交接内容',
  '交接事项',
  '确认状态',
  '状态',
  '备注',
  '提交时间',
];

function collectFieldNames(records: FeishuRecord[]) {
  const fieldNames = new Set<string>();
  records.forEach((record) => {
    Object.keys(record.fields || {}).forEach((fieldName) => fieldNames.add(fieldName));
  });

  return Array.from(fieldNames).sort((a, b) => {
    const aIndex = preferredFieldOrder.indexOf(a);
    const bIndex = preferredFieldOrder.indexOf(b);
    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
    }
    return a.localeCompare(b, 'zh-Hans-CN');
  });
}

function renderCell(value: string) {
  if (!value) return <Text type="secondary">-</Text>;
  if (['已确认', '已完成', '完成'].includes(value)) return <Tag color="green">{value}</Tag>;
  if (['待确认', '待交接', '进行中'].includes(value)) return <Tag color="orange">{value}</Tag>;
  if (['异常', '未完成', '驳回'].includes(value)) return <Tag color="red">{value}</Tag>;
  return <span>{value}</span>;
}

function formatFeishuTime(value?: number) {
  if (!value) return '';
  return dayjs(value < 1_000_000_000_000 ? value * 1000 : value).format('YYYY-MM-DD HH:mm');
}

function loadHandoverRecords() {
  try {
    const raw = localStorage.getItem(HANDOVER_RECORDS_KEY);
    return raw ? JSON.parse(raw) as FeishuRecord[] : [];
  } catch {
    return [];
  }
}

function saveHandoverRecords(records: FeishuRecord[]) {
  localStorage.setItem(HANDOVER_RECORDS_KEY, JSON.stringify(records));
}

function loadLastSyncedAt() {
  return localStorage.getItem(HANDOVER_SYNC_TIME_KEY) || '';
}

function saveLastSyncedAt(value: string) {
  localStorage.setItem(HANDOVER_SYNC_TIME_KEY, value);
}

export default function Handover() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<FeishuRecord[]>(() => loadHandoverRecords());
  const [loading, setLoading] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(() => loadLastSyncedAt());
  const [detailRecord, setDetailRecord] = useState<FeishuRecord | null>(null);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const rows = await getFeishuMigrationRecords(HANDOVER_CONFIG);
      const syncedAt = dayjs().format('YYYY-MM-DD HH:mm:ss');
      saveHandoverRecords(rows);
      saveLastSyncedAt(syncedAt);
      setRecords(rows);
      setLastSyncedAt(syncedAt);
      message.success(`已同步 ${rows.length} 条离职交接记录`);
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      message.error(errorMessage || '同步飞书离职交接确认单失败');
    } finally {
      setLoading(false);
    }
  };

  const columns = useMemo<ColumnsType<FeishuRecord>>(() => {
    const fieldColumns = collectFieldNames(records).map((fieldName) => ({
      title: fieldName,
      key: fieldName,
      width: 180,
      ellipsis: true,
      render: (_: unknown, record: FeishuRecord) => renderCell(record.fields[fieldName] || ''),
    }));

    return [
      {
        title: '序号',
        key: 'index',
        width: 70,
        fixed: 'left',
        align: 'center',
        render: (_: unknown, __: FeishuRecord, index: number) => index + 1,
      },
      ...fieldColumns,
      {
        title: '提交时间',
        key: 'createdTime',
        width: 170,
        render: (_: unknown, record: FeishuRecord) => (
          record.createdTime ? formatFeishuTime(record.createdTime) : <Text type="secondary">-</Text>
        ),
      },
      {
        title: '操作',
        key: 'action',
        width: 120,
        fixed: 'right',
        render: (_: unknown, record: FeishuRecord) => (
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailRecord(record)}>查看信息</Button>
        ),
      },
    ];
  }, [records]);

  const detailFieldNames = useMemo(() => (
    detailRecord ? collectFieldNames([detailRecord]) : []
  ), [detailRecord]);

  return (
    <div>
      <PageHeader
        title="离职交接"
        desc="关联飞书员工离职账号交接确认单，集中查看交接提交信息"
        extra={(
          <Space wrap>
            <Button icon={<SaveOutlined />} loading={loading} onClick={fetchRecords}>保存并同步</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/handover/collect')}>采集信息</Button>
          </Space>
        )}
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="已关联飞书员工离职账号交接确认单"
        description={(
          <Space direction="vertical" size={4}>
            <Text type="secondary">点击“保存并同步”后，系统会读取确认单当前视图提交记录并保存到本地；之后打开页面直接展示已同步数据。</Text>
            <Text type="secondary">飞书链接：{HANDOVER_FORM_LINK}</Text>
            {lastSyncedAt ? <Text type="secondary">最近同步：{lastSyncedAt}</Text> : <Text type="secondary">尚未同步，请先点击“保存并同步”。</Text>}
          </Space>
        )}
      />

      <Card
        title="离职交接确认单"
        styles={{ body: { padding: 0 } }}
      >
        <Table
          rowKey="recordId"
          columns={columns}
          dataSource={records}
          loading={loading}
          pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条交接记录` }}
          locale={{ emptyText: <Empty description="暂无离职交接数据" /> }}
          scroll={{ x: Math.max(1080, columns.length * 180) }}
        />
      </Card>

      <Modal
        title="查看信息"
        open={!!detailRecord}
        onCancel={() => setDetailRecord(null)}
        footer={<Button onClick={() => setDetailRecord(null)}>关闭</Button>}
        destroyOnClose
        width={900}
      >
        {detailRecord && (
          <Descriptions bordered size="small" column={2}>
            {detailFieldNames.map((fieldName) => (
              <Descriptions.Item key={fieldName} label={fieldName}>
                {renderCell(detailRecord.fields[fieldName] || '')}
              </Descriptions.Item>
            ))}
            <Descriptions.Item label="提交时间" span={2}>
              {detailRecord.createdTime ? formatFeishuTime(detailRecord.createdTime) : '-'}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}
