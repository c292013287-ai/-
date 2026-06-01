import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Dropdown, Breadcrumb, theme } from 'antd';
import {
  DashboardOutlined, TeamOutlined, BarChartOutlined,
  SettingOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  UserOutlined, LogoutOutlined, DollarOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../store/authStore';

const { Header, Sider, Content } = Layout;

const breadcrumbMap: Record<string, { label: string; icon: React.ReactNode }> = {
  '/': { label: '资源预警', icon: <DashboardOutlined /> },
  '/consumption': { label: '消耗监控', icon: <BarChartOutlined /> },
  '/recharges': { label: '充值记录', icon: <DollarOutlined /> },
  '/entities': { label: '主体管理', icon: <TeamOutlined /> },
  '/settings': { label: '系统设置', icon: <SettingOutlined /> },
};

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { token: themeToken } = theme.useToken();

  const pageInfo = breadcrumbMap[location.pathname] || { label: '页面', icon: null };

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '资源预警' },
    { key: '/consumption', icon: <BarChartOutlined />, label: '消耗监控' },
    { key: '/recharges', icon: <DollarOutlined />, label: '充值记录' },
    { key: '/entities', icon: <TeamOutlined />, label: '主体管理' },
    { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
  ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const userMenuItems = [
    { key: 'user', icon: <UserOutlined />, label: user?.name || '用户' },
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
  ];

  const handleUserMenuClick = ({ key }: { key: string }) => {
    if (key === 'logout') handleLogout();
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        theme="dark"
        width={220}
        style={{
          boxShadow: '2px 0 8px rgba(0,0,0,0.06)',
          zIndex: 10,
        }}
      >
        <div style={{
          height: 64,
          display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start',
          paddingLeft: collapsed ? 0 : 24,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: 'linear-gradient(135deg, rgba(24,144,255,0.15) 0%, rgba(24,144,255,0) 100%)',
        }}>
          {!collapsed && (
            <span style={{
              color: '#fff', fontSize: 16, fontWeight: 600,
              whiteSpace: 'nowrap', letterSpacing: 1,
            }}>
              开开华彩
            </span>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none', marginTop: 8 }}
        />
      </Sider>
      <Layout>
        <Header style={{
          padding: '0 24px',
          background: themeToken.colorBgContainer,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: `1px solid ${themeToken.colorBorderSecondary}`,
          boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
          height: 64,
          lineHeight: '64px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
            />
            <Breadcrumb
              items={[
                { title: '首页' },
                { title: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {pageInfo.icon}
                    {pageInfo.label}
                  </span>
                )},
              ]}
            />
          </div>
          <Dropdown menu={{ items: userMenuItems, onClick: handleUserMenuClick }} placement="bottomRight">
            <Button type="text" icon={<UserOutlined />}>
              {user?.name}
            </Button>
          </Dropdown>
        </Header>
        <Content style={{ margin: 24, minHeight: 280 }}>
          <div style={{
            padding: 24,
            background: themeToken.colorBgContainer,
            borderRadius: themeToken.borderRadiusLG,
            minHeight: 'calc(100vh - 136px)',
          }}>
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
