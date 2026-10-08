import type { LucideIcon } from 'lucide-react';
import styles from './KpiCard.module.css';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface KpiCardProps {
  id: string;
  label: string;
  value: string;
  change: string;
  changePositive: boolean;
  icon: LucideIcon;
  color: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'accent';
}

const colorMap = {
  primary:   { bg: 'var(--color-primary-light)',  icon: 'var(--color-primary)' },
  secondary: { bg: 'rgba(15,118,110,.12)',         icon: 'var(--color-secondary)' },
  success:   { bg: 'var(--color-success-tint)',    icon: 'var(--color-success)' },
  warning:   { bg: 'var(--color-warning-tint)',    icon: 'var(--color-warning)' },
  error:     { bg: 'var(--color-error-tint)',      icon: 'var(--color-error)' },
  accent:    { bg: 'var(--color-accent-tint)',     icon: 'var(--color-accent)' },
};

/** KPI Card — glass surface per DESIGN_SYSTEM.md §6 */
export default function KpiCard({
  id, label, value, change, changePositive, icon: Icon, color,
}: KpiCardProps) {
  const { bg, icon: iconColor } = colorMap[color];

  return (
    <article className={`glass ${styles.card}`} aria-labelledby={`${id}-label`}>
      {/* Icon — 38px rounded square tinted (DESIGN_SYSTEM.md §6 KPI card spec) */}
      <div
        className={styles.iconWrap}
        aria-hidden="true"
        style={{ background: bg }}
      >
        <Icon size={20} strokeWidth={1.75} style={{ color: iconColor }} />
      </div>

      <div className={styles.body}>
        <p id={`${id}-label`} className={styles.label}>{label}</p>
        <p className={`text-kpi ${styles.value}`}>{value}</p>
        <p className={styles.change} aria-label={`Change: ${change}`}>
          {changePositive
            ? <TrendingUp size={12} aria-hidden="true" />
            : <TrendingDown size={12} aria-hidden="true" />}
          <span style={{ color: changePositive ? 'var(--color-success)' : 'var(--color-warning)' }}>
            {change}
          </span>
        </p>
      </div>
    </article>
  );
}
