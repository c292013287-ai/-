import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import AuthGuard from './components/AuthGuard';
import EntityAccessGuard from './components/EntityAccessGuard';
import AppLayout from './layouts/AppLayout';
import Login from './pages/Login';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import EntityManage from './pages/EntityManage';
import ConsumptionMonitor from './pages/ConsumptionMonitor';
import RechargeRecord from './pages/RechargeRecord';
import UserMigration from './pages/UserMigration';
import UserMigrationCollect from './pages/UserMigrationCollect';
import Handover from './pages/Handover';
import HandoverCollect from './pages/HandoverCollect';

export default function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#ed6a1c',
          colorInfo: '#1677ff',
          colorSuccess: '#16a34a',
          colorWarning: '#f59e0b',
          colorError: '#e11d48',
          colorText: '#1f2937',
          colorTextSecondary: '#667085',
          colorBorder: '#e5e7eb',
          colorBgLayout: '#f4f6fa',
          colorBgContainer: '#ffffff',
          borderRadius: 8,
          controlHeight: 36,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        },
        components: {
          Button: {
            borderRadius: 8,
            controlHeight: 36,
            fontWeight: 500,
          },
          Card: {
            borderRadiusLG: 10,
            headerFontSize: 15,
          },
          Table: {
            headerBg: '#f8fafc',
            headerColor: '#475467',
            rowHoverBg: '#fff7ed',
          },
        },
      }}
    >
      <AntApp>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<AuthGuard><AppLayout /></AuthGuard>}>
              <Route path="/" element={<Home />} />
              <Route path="/warnings" element={<Dashboard />} />
              <Route path="/entities" element={<EntityAccessGuard><EntityManage /></EntityAccessGuard>} />
              <Route path="/consumption" element={<ConsumptionMonitor />} />
              <Route path="/recharges" element={<RechargeRecord />} />
              <Route path="/migration" element={<UserMigration />} />
              <Route path="/migration/collect" element={<UserMigrationCollect />} />
              <Route path="/handover" element={<Handover />} />
              <Route path="/handover/collect" element={<HandoverCollect />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
}
