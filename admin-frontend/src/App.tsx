import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import AuthGuard from './components/AuthGuard';
import AppLayout from './layouts/AppLayout';
import Login from './pages/Login';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import EntityManage from './pages/EntityManage';
import ConsumptionMonitor from './pages/ConsumptionMonitor';
import RechargeRecord from './pages/RechargeRecord';
import RiskAssessment from './pages/RiskAssessment';
import UserMigration from './pages/UserMigration';
import UserMigrationCollect from './pages/UserMigrationCollect';

export default function App() {
  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#ed6a1c', borderRadius: 6 } }}>
      <AntApp>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<AuthGuard><AppLayout /></AuthGuard>}>
              <Route path="/" element={<Home />} />
              <Route path="/warnings" element={<Dashboard />} />
              <Route path="/entities" element={<EntityManage />} />
              <Route path="/consumption" element={<ConsumptionMonitor />} />
              <Route path="/recharges" element={<RechargeRecord />} />
              <Route path="/migration" element={<UserMigration />} />
              <Route path="/migration/collect" element={<UserMigrationCollect />} />
              <Route path="/risk" element={<RiskAssessment />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
}
