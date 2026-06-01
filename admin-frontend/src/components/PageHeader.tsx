import { Typography } from 'antd';
import type { ReactNode } from 'react';

const { Text } = Typography;

interface Props {
  title: string;
  desc?: string;
  extra?: ReactNode;
}

/** 页面标题 + 描述 + 操作区 */
export default function PageHeader({ title, desc, extra }: Props) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
      <div>
        <h2 style={{ margin: '0 0 4px 0', fontSize: 20, fontWeight: 600 }}>{title}</h2>
        {desc && <Text type="secondary">{desc}</Text>}
      </div>
      {extra && <div>{extra}</div>}
    </div>
  );
}
