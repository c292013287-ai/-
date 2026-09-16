import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Dropdown, Breadcrumb } from 'antd';
import {
  DashboardOutlined, TeamOutlined, BarChartOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined,
  UserOutlined, LogoutOutlined, UserSwitchOutlined,
  DollarOutlined, HomeOutlined, SolutionOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../store/authStore';

const { Sider } = Layout;

const LOGO_FILTER = 'brightness(0) saturate(100%) invert(53%) sepia(91%) saturate(2841%) hue-rotate(356deg) brightness(98%) contrast(95%)';
const SIDER_W = 220;
const SIDER_C = 80;

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 768);
  const [isCompact, setIsCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 768);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const collapsedWidth = isCompact ? 64 : SIDER_C;
  const sw = collapsed ? collapsedWidth : SIDER_W;

  const routes = [
    { key: '/', icon: <HomeOutlined />, label: '首页' },
    { key: '/entities', icon: <TeamOutlined />, label: '主体管理' },
    { key: '/warnings', icon: <DashboardOutlined />, label: '资源预警' },
    { key: '/consumption', icon: <BarChartOutlined />, label: '消耗监控' },
    { key: '/recharges', icon: <DollarOutlined />, label: '充值记录' },
    { key: '/migration', icon: <UserSwitchOutlined />, label: '用户迁移' },
    { key: '/handover', icon: <SolutionOutlined />, label: '离职交接' },
  ];
  const breadcrumbMap: Record<string, { label: string; icon: React.ReactNode }> = {};
  routes.forEach(r => { breadcrumbMap[r.key] = { label: r.label, icon: r.icon }; });
  breadcrumbMap['/migration/collect'] = { label: '信息采集', icon: <UserSwitchOutlined /> };
  breadcrumbMap['/handover/collect'] = { label: '信息采集', icon: <SolutionOutlined /> };
  const pageInfo = breadcrumbMap[location.pathname] || { label: '页面', icon: null };
  const selectedMenuKey = location.pathname.startsWith('/migration') ? '/migration' : location.pathname.startsWith('/handover') ? '/handover' : location.pathname;

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsCompact(event.matches);
      if (event.matches) setCollapsed(true);
    };
    handleChange(media);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  return (
    <div className="app-shell">
      <Sider
        className="app-sider"
        trigger={null}
        collapsible
        collapsed={collapsed}
        theme="dark"
        width={SIDER_W}
        collapsedWidth={collapsedWidth}
      >
        <div className="app-logo">
          {collapsed ? (
            <img src="/logo-icon.png" alt="Logo" style={{ width: isCompact ? 34 : 42, height: isCompact ? 34 : 42, objectFit: 'contain', filter: LOGO_FILTER }} />
          ) : (
            <img src="/logo-full.png" alt="开开华彩" style={{ width: 180, height: 44, objectFit: 'contain', filter: LOGO_FILTER }} />
          )}
        </div>
        <Menu className="app-menu" theme="dark" mode="inline" selectedKeys={[selectedMenuKey]}
          items={routes.map(r => ({ key: r.key, icon: r.icon, label: r.label }))}
          onClick={({ key }) => navigate(key)} style={{ borderInlineEnd: 'none' }} />
      </Sider>
      <header className="app-header" style={{ left: sw }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Button className="app-collapse-button" type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} />
          <Breadcrumb items={[{ title: '首页' }, { title: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{pageInfo.icon}{pageInfo.label}</span> }]} />
        </div>
        <Dropdown menu={{ items: [{ key: 'user', icon: <UserOutlined />, label: user?.name || '用户' }, { type: 'divider' }, { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true }], onClick: ({ key }) => { if (key === 'logout') { logout(); navigate('/login'); } } }} placement="bottomRight">
          <Button className="app-user-button" type="text" icon={<UserOutlined />}>{user?.name}</Button>
        </Dropdown>
      </header>
      <main className="app-main" style={{ marginLeft: sw, width: `calc(100% - ${sw}px)` }}>
        <div className="app-content-card">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
