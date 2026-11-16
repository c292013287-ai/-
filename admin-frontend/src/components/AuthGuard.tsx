import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuthStore } from '../store/authStore';
import { getCurrentUser } from '../api/auth';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, setAuth, logout, loadFromStorage } = useAuthStore();
  const [checking, setChecking] = useState(true);
  const location = useLocation();

  useEffect(() => {
    const onStorage=(event:StorageEvent)=>{ if(event.key==='token' || event.key===null){sessionStorage.removeItem('entity_access_token');window.location.reload();} };
    window.addEventListener('storage',onStorage);
    loadFromStorage();
    const token = localStorage.getItem('token');

    if (token) {
      getCurrentUser()
        .then((user) => setAuth(token, user))
        .catch(() => {
          logout();
        })
        .finally(() => setChecking(false));
    } else {
      setChecking(false);
    }
    return ()=>window.removeEventListener('storage',onStorage);
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
