import type { LucideIcon } from 'lucide-react';
import {
  Users,
  CalendarCheck2,
  Wallet,
  Banknote,
  ChartColumn,
  ShieldCheck,
} from 'lucide-react';
import shared from './shared.module.css';
import styles from './FeatureGrid.module.css';

type Tint = 'primary' | 'secondary';

const features: { icon: LucideIcon; title: string; text: string; tint: Tint }[] = [
  {
    icon: Users,
    title: 'People directory',
    text: 'Profiles, departments, locations and documents — with CSV import that validates, finds duplicates and previews before anything is saved.',
    tint: 'primary',
  },
  {
    icon: CalendarCheck2,
    title: 'Time and leave',
    text: 'Attendance, holiday calendars and leave balances, moving through an approval workflow with delegation and escalation.',
    tint: 'secondary',
  },
  {
    icon: Wallet,
    title: 'Payroll runs',
    text: 'Pay structures, deductions, proration and one-way run states — draft, review, approval, locked — with private PDF payslips.',
    tint: 'primary',
  },
  {
    icon: Banknote,
    title: 'Payments',
    text: 'Batches for contractors, stipends and reimbursements, plus payment file exports that are permissioned, re-authenticated and audited.',
    tint: 'secondary',
  },
  {
    icon: ChartColumn,
    title: 'Analytics and reports',
    text: 'Workforce, payroll and attendance dashboards with standard reports and exports finance and boards can actually sign off.',
    tint: 'primary',
  },
  {
    icon: ShieldCheck,
    title: 'Roles and audit',
    text: 'Server-side permissions with scopes and field-level controls, and an append-only audit log of every sensitive action.',
    tint: 'secondary',
  },
];

/** Product feature grid — solid surfaces (readable body copy per DESIGN_SYSTEM.md §1) */
export default function FeatureGrid() {
  return (
    <section id="product" className={shared.section} aria-labelledby="features-title">
      <div className={shared.container}>
        <div className={shared.sectionHead}>
          <p className={shared.eyebrow}>Everything in one place</p>
          <h2 id="features-title" className={shared.sectionTitle}>
            From first day to final payslip.
          </h2>
          <p className={shared.sectionLead}>
            One workspace for the whole employment lifecycle, so nobody has to
            reconcile three spreadsheets before payday.
          </p>
        </div>

        <div className={styles.grid}>
          {features.map(({ icon: Icon, title, text, tint }) => (
            <article key={title} className={styles.card}>
              <span className={styles.icon} data-tint={tint} aria-hidden="true">
                <Icon size={22} strokeWidth={1.75} />
              </span>
              <h3 className={styles.cardTitle}>{title}</h3>
              <p className={styles.cardText}>{text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
