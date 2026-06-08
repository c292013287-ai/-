import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Dropdown, Breadcrumb, theme } from 'antd';
import {
  DashboardOutlined, TeamOutlined, BarChartOutlined,
  SafetyOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined,
  UserOutlined, LogoutOutlined, RobotOutlined,
  DollarOutlined, HomeOutlined, PieChartOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../store/authStore';

const { Sider } = Layout;

const LOGO_FILTER = 'brightness(0) saturate(100%) invert(53%) sepia(91%) saturate(2841%) hue-rotate(356deg) brightness(98%) contrast(95%)';
const SIDER_W = 220;
const SIDER_C = 80;
const HEADER_H = 64;

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { token: t } = theme.useToken();
  const sw = collapsed ? SIDER_C : SIDER_W;

  const routes = [
    { key: '/', icon: <HomeOutlined />, label: '首页' },
    { key: '/dashboard', icon: <PieChartOutlined />, label: '仪表盘' },
    { key: '/entities', icon: <TeamOutlined />, label: '主体管理' },
    { key: '/warnings', icon: <DashboardOutlined />, label: '资源预警' },
    { key: '/consumption', icon: <BarChartOutlined />, label: '消耗监控' },
    { key: '/recharges', icon: <DollarOutlined />, label: '充值记录' },
    { key: '/ai', icon: <RobotOutlined />, label: 'BI分析报告' },
    { key: '/risk', icon: <SafetyOutlined />, label: '主体风控' },
  ];
  const breadcrumbMap: Record<string, { label: string; icon: React.ReactNode }> = {};
  routes.forEach(r => { breadcrumbMap[r.key] = { label: r.label, icon: r.icon }; });
  const pageInfo = breadcrumbMap[location.pathname] || { label: '页面', icon: null };

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <Sider trigger={null} collapsible collapsed={collapsed} theme="dark" width={SIDER_W} collapsedWidth={SIDER_C}
        style={{ overflow: 'auto', height: '100vh', position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 100 }}>
        <div style={{ height: HEADER_H, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}>
          {collapsed ? (
            <img src="/logo-icon.png" alt="Logo" style={{ width: 42, height: 42, objectFit: 'contain', filter: LOGO_FILTER }} />
          ) : (
            <img src="/logo-full.png" alt="开开华彩" style={{ width: 180, height: 44, objectFit: 'contain', filter: LOGO_FILTER }} />
          )}
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[location.pathname]}
          items={routes.map(r => ({ key: r.key, icon: r.icon, label: r.label }))}
          onClick={({ key }) => navigate(key)} style={{ borderInlineEnd: 'none' }} />
      </Sider>
      <header style={{
        position: 'fixed', top: 0, left: sw, right: 0, height: HEADER_H, zIndex: 99,
        background: t.colorBgContainer, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '0 24px', transition: 'left 0.2s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} />
          <Breadcrumb items={[{ title: '首页' }, { title: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{pageInfo.icon}{pageInfo.label}</span> }]} />
        </div>
        <Dropdown menu={{ items: [{ key: 'user', icon: <UserOutlined />, label: user?.name || '用户' }, { type: 'divider' }, { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true }], onClick: ({ key }) => { if (key === 'logout') { logout(); navigate('/login'); } } }} placement="bottomRight">
          <Button type="text" icon={<UserOutlined />}>{user?.name}</Button>
        </Dropdown>
      </header>
      <main style={{ marginLeft: sw, padding: `${HEADER_H + 24}px 24px 24px`, minHeight: '100vh', transition: 'margin-left 0.2s', boxSizing: 'border-box' }}>
        <div style={{ background: t.colorBgContainer, borderRadius: t.borderRadiusLG, padding: 24, minHeight: `calc(100vh - ${HEADER_H}px - 72px)` }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
