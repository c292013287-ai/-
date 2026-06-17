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
    <div className="page-header">
      <div>
        <h2 className="page-header-title">{title}</h2>
        {desc && <Text type="secondary" className="page-header-desc">{desc}</Text>}
      </div>
      {extra && <div className="page-header-extra">{extra}</div>}
    </div>
  );
}
