import { Database, KeyRound, ScrollText, FileLock2 } from 'lucide-react';
import shared from './shared.module.css';
import styles from './SecurityBand.module.css';

const pillars = [
  {
    icon: Database,
    title: 'Tenant isolation at the database',
    text: 'PostgreSQL row-level security on every tenant table, so one organisation can never read another’s people or payroll — enforced below the application.',
  },
  {
    icon: KeyRound,
    title: 'Permissions down to the field',
    text: 'Server-side roles with scopes, and separate permissions for compensation, bank details and identity data. Hidden UI is never the control.',
  },
  {
    icon: ScrollText,
    title: 'Every change accounted for',
    text: 'An append-only audit log records approvals, exports, role changes and access to sensitive fields — with actor, target and timestamp.',
  },
  {
    icon: FileLock2,
    title: 'Private files, short-lived access',
    text: 'Documents sit in private storage behind signed, expiring links. Payslips are visible only to the worker and authorised payroll roles.',
  },
];

const chips = ['Multi-factor authentication', 'Re-authentication for approvals', 'Encrypted at rest', 'Audited exports'];

/** Security band — dark contrast section; text on --color-text surface */
export default function SecurityBand() {
  return (
    <section id="security" className={styles.band} aria-labelledby="security-title">
      <div className={`${shared.container} ${styles.inner}`}>
        <div className={styles.head}>
          <p className={styles.eyebrow}>Security</p>
          <h2 id="security-title" className={styles.title}>
            Security isn’t a feature. It’s the foundation.
          </h2>
          <p className={styles.lead}>
            Ascenda holds salaries, bank details and identity records. The
            controls that protect them are built into the architecture, not
            bolted on before launch.
          </p>
        </div>

        <div className={styles.grid}>
          {pillars.map(({ icon: Icon, title, text }) => (
            <div key={title} className={styles.item}>
              <span className={styles.icon} aria-hidden="true">
                <Icon size={20} strokeWidth={1.75} />
              </span>
              <div>
                <h3 className={styles.itemTitle}>{title}</h3>
                <p className={styles.itemText}>{text}</p>
              </div>
            </div>
          ))}
        </div>

        <ul className={styles.chips} aria-label="Security controls">
          {chips.map((chip) => (
            <li key={chip} className={styles.chip}>{chip}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
