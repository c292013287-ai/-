import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import AuthGuard from './components/AuthGuard';
import AppLayout from './layouts/AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import EntityManage from './pages/EntityManage';
import ConsumptionMonitor from './pages/ConsumptionMonitor';
import RechargeRecord from './pages/RechargeRecord';

export default function App() {
  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#1677ff' } }}>
      <AntApp>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <AuthGuard>
                  <AppLayout />
                </AuthGuard>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/entities" element={<EntityManage />} />
              <Route path="/consumption" element={<ConsumptionMonitor />} />
              <Route path="/recharges" element={<RechargeRecord />} />
              <Route path="/settings" element={<div><h2>系统设置</h2><p>系统配置项（预留扩展）</p></div>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
}
