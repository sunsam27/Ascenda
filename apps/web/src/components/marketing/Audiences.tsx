import type { LucideIcon } from 'lucide-react';
import { Church, Building2, HeartHandshake, GraduationCap } from 'lucide-react';
import shared from './shared.module.css';
import styles from './Audiences.module.css';

const audiences: { icon: LucideIcon; title: string; text: string; tags: string[] }[] = [
  {
    icon: Church,
    title: 'Churches and ministries',
    text: 'Keep staff, volunteers and everyone who serves in one register — with departments, stipends and payroll that respect your structure.',
    tags: ['Departments and ministries', 'Volunteers and stipends'],
  },
  {
    icon: Building2,
    title: 'SMEs',
    text: 'Move off spreadsheets without enterprise complexity: pay structures, approvals, payslips and a pay calendar your team can verify.',
    tags: ['Pay calendar', 'Private payslips'],
  },
  {
    icon: HeartHandshake,
    title: 'NGOs and non-profits',
    text: 'Project teams, consultants and stipends across locations, with every payment, approval and export accounted for end to end.',
    tags: ['Audited exports', 'Scope-based access'],
  },
  {
    icon: GraduationCap,
    title: 'Schools',
    text: 'Teaching, support and casual staff in one place — term-time leave, substitute pay and payroll that closes the month on time.',
    tags: ['Leave and attendance', 'Approval workflows'],
  },
];

/** Audience cards — who Ascenda is built for */
export default function Audiences() {
  return (
    <section id="who-its-for" className={shared.section} aria-labelledby="audiences-title">
      <div className={shared.container}>
        <div className={shared.sectionHead}>
          <p className={shared.eyebrow}>Who it’s for</p>
          <h2 id="audiences-title" className={shared.sectionTitle}>
            Built for organisations like yours.
          </h2>
          <p className={shared.sectionLead}>
            Ascenda speaks your language — departments and ministries, staff and
            volunteers, stipends and salaries — without forcing you into a
            generic HR template.
          </p>
        </div>

        <div className={styles.grid}>
          {audiences.map(({ icon: Icon, title, text, tags }) => (
            <article key={title} className={styles.card}>
              <span className={styles.icon} aria-hidden="true">
                <Icon size={22} strokeWidth={1.75} />
              </span>
              <h3 className={styles.cardTitle}>{title}</h3>
              <p className={styles.cardText}>{text}</p>
              <ul className={styles.tags}>
                {tags.map((tag) => (
                  <li key={tag} className={styles.tag}>{tag}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
