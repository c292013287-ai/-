import { Statistic } from 'antd';
import type { CSSProperties, ReactNode } from 'react';

type Gradient = 'blue' | 'green' | 'red' | 'orange';

const gradients: Record<Gradient, { bg: string; border: string; accent: string }> = {
  blue:   { bg: 'linear-gradient(135deg, #eff6ff 0%, #ffffff 72%)', border: '#bfdbfe', accent: '#1677ff' },
  green:  { bg: 'linear-gradient(135deg, #ecfdf3 0%, #ffffff 72%)', border: '#bbf7d0', accent: '#16a34a' },
  red:    { bg: 'linear-gradient(135deg, #fff1f2 0%, #ffffff 72%)', border: '#fecdd3', accent: '#e11d48' },
  orange: { bg: 'linear-gradient(135deg, #fff7ed 0%, #ffffff 72%)', border: '#fed7aa', accent: '#ed6a1c' },
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
    <div
      className="stat-card"
      style={{
        background: g?.bg,
        borderColor: g?.border || '#e5e7eb',
        '--stat-accent': g?.accent || color || '#ed6a1c',
      } as CSSProperties}
    >
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
