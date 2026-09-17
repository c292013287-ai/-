import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Spin, Typography, message } from 'antd';
import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons';
import {
  checkEntityManagementAccess,
  unlockEntityManagement,
} from '../api/entities';

const { Title, Text } = Typography;

export default function EntityAccessGuard({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    checkEntityManagementAccess()
      .then(setAuthorized)
      .finally(() => setChecking(false));

    const handleExpired = () => setAuthorized(false);
    window.addEventListener('entity-access-expired', handleExpired);
    return () => window.removeEventListener('entity-access-expired', handleExpired);
  }, []);

  const handleUnlock = async (values: { username: string; password: string }) => {
    setSubmitting(true);
    try {
      await unlockEntityManagement(values);
      setAuthorized(true);
      message.success('主体管理权限验证成功');
    } catch (error: any) {
      message.error(error.response?.data?.error || '权限验证失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="entity-access-loading">
        <Spin size="large" tip="正在验证访问权限..." />
      </div>
    );
  }

  if (authorized) return <>{children}</>;

  return (
    <div className="entity-access-page">
      <Card className="entity-access-card">
        <div className="entity-access-heading">
          <span className="entity-access-icon"><SafetyCertificateOutlined /></span>
          <Title level={3}>主体管理访问验证</Title>
          <Text type="secondary">请输入主体管理专用账号和密码后继续</Text>
        </div>
        <Form layout="vertical" onFinish={handleUnlock} requiredMark={false}>
          <Form.Item name="username" label="访问账号" rules={[{ required: true, message: '请输入访问账号' }]}>
            <Input prefix={<UserOutlined />} placeholder="请输入账号" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="访问密码" rules={[{ required: true, message: '请输入访问密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting} block icon={<LockOutlined />}>
            验证并进入
          </Button>
        </Form>
        <Text className="entity-access-note" type="secondary">
          验证结果仅在当前浏览器标签页有效，2 小时后自动失效
        </Text>
      </Card>
    </div>
  );
}
