import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Alert, Button, Spin, Tabs } from 'antd';
import {
  ArrowRightOutlined, BarChartOutlined, DashboardOutlined, DollarOutlined,
  SolutionOutlined, TeamOutlined, UserOutlined, UserSwitchOutlined, ReloadOutlined,
  FileTextOutlined, CheckSquareOutlined, AppstoreOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import { getWorkbenchNotes, getWorkbenchTodos, workbenchError, type WorkbenchNote, type WorkbenchTodo } from '../api/workbench';
import WorkbenchNotes from './WorkbenchNotes';
import WorkbenchTodos from './WorkbenchTodos';
import './Workbench.css';

const shortcuts = [
  { path: '/entities', label: '主体管理', icon: <TeamOutlined /> },
  { path: '/customers', label: '用户管理', icon: <UserOutlined /> },
  { path: '/migration', label: '用户迁移', icon: <UserSwitchOutlined /> },
  { path: '/handover', label: '离职交接', icon: <SolutionOutlined /> },
  { path: '/warnings', label: '资源预警', icon: <DashboardOutlined /> },
  { path: '/consumption', label: '消耗监控', icon: <BarChartOutlined /> },
  { path: '/recharges', label: '充值记录', icon: <DollarOutlined /> },
];

export default function Workbench() {
  const [notes, setNotes] = useState<WorkbenchNote[]>([]);
  const [todos, setTodos] = useState<WorkbenchTodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = () => {
    setLoading(true); setError('');
    setRevision(value => value + 1);
  };
  useEffect(() => {
    let cancelled = false;
    Promise.all([getWorkbenchNotes(), getWorkbenchTodos()])
      .then(([savedNotes, savedTodos]) => { if (!cancelled) { setNotes(savedNotes); setTodos(savedTodos); } })
      .catch(err => { if (!cancelled) setError(workbenchError(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revision]);

  return (
    <section className="workbench-page" aria-label="我的工作台">
      <PageHeader title="我的工作台" extra={<Button icon={<ReloadOutlined />} loading={loading} onClick={refresh}>刷新</Button>} />
      {error && <Alert className="workbench-load-error" type="error" showIcon title={error} action={<Button size="small" onClick={refresh}>重试</Button>} />}
      <Spin spinning={loading}>
      <Tabs className="workbench-tabs" items={[
        { key: 'notes', label: '记事本', icon: <FileTextOutlined />, children: !loading && !error ? <WorkbenchNotes notes={notes} onChange={setNotes} /> : null },
        { key: 'todos', label: '待办清单', icon: <CheckSquareOutlined />, children: !loading && !error ? <WorkbenchTodos todos={todos} onChange={setTodos} /> : null },
        { key: 'shortcuts', label: '常用功能', icon: <AppstoreOutlined />, children: <nav aria-labelledby="workbench-shortcuts-title">
        <h3 id="workbench-shortcuts-title" className="workbench-section-title">常用功能</h3>
        <ul className="workbench-shortcuts">
          {shortcuts.map(shortcut => (
            <li key={shortcut.path}>
              <Link className="workbench-shortcut" to={shortcut.path}>
                <span className="workbench-shortcut-icon" aria-hidden="true">{shortcut.icon}</span>
                <span className="workbench-shortcut-label">{shortcut.label}</span>
                <ArrowRightOutlined className="workbench-shortcut-arrow" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </nav> },
      ]} />
      </Spin>
    </section>
  );
}
