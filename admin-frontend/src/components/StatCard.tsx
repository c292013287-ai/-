import { Statistic } from 'antd';
import type { ReactNode } from 'react';

type Gradient = 'blue' | 'green' | 'red' | 'orange';

const gradients: Record<Gradient, { bg: string; border: string }> = {
  blue:   { bg: 'linear-gradient(135deg, #e6f7ff 0%, #f0f5ff 100%)', border: '#d6e4ff' },
  green:  { bg: 'linear-gradient(135deg, #f6ffed 0%, #f0fff0 100%)', border: '#b7eb8f' },
  red:    { bg: 'linear-gradient(135deg, #fff2f0 0%, #fff1f0 100%)', border: '#ffccc7' },
  orange: { bg: 'linear-gradient(135deg, #fff7e6 0%, #fffbe6 100%)', border: '#ffe58f' },
};

interface Props {
  title: string;
  value: number | string;
  suffix?: string;
  prefix?: ReactNode;
  color?: string;
  gradient?: Gradient;
  fontSize?: number;
}

/** 渐变色统计卡片 */
export default function StatCard({ title, value, suffix, prefix, color, gradient, fontSize = 24 }: Props) {
  const g = gradient ? gradients[gradient] : undefined;
  return (
    <div className="stat-card" style={{
      background: g?.bg,
      borderColor: g?.border || '#eee',
    }}>
      <Statistic
        title={title}
        value={value}
        suffix={suffix}
        prefix={prefix}
        valueStyle={{ fontSize, fontWeight: 600, color }}
      />
    </div>
  );
}
