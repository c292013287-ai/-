import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuthStore } from '../store/authStore';
import { getCurrentUser } from '../api/auth';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, setAuth, loadFromStorage } = useAuthStore();
  const [checking, setChecking] = useState(true);
  const location = useLocation();

  useEffect(() => {
    loadFromStorage();
    const token = localStorage.getItem('token');

    if (token) {
      getCurrentUser()
        .then((user) => setAuth(token, user))
        .catch(() => {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        })
        .finally(() => setChecking(false));
    } else {
      setChecking(false);
    }
  }, []);

  if (checking) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="验证登录状态..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
