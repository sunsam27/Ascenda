import { CloudUpload, ListChecks, Send } from 'lucide-react';
import shared from './shared.module.css';
import styles from './Workflow.module.css';

const steps = [
  {
    step: 'Step 01',
    icon: CloudUpload,
    title: 'Bring your people in',
    text: 'Import workers by CSV with validation, duplicate detection and a full preview — five hundred records in one go, nothing saved until it checks out.',
  },
  {
    step: 'Step 02',
    icon: ListChecks,
    title: 'Run payroll with approvals',
    text: 'Pre-flight checks catch missing bank details and odd deductions, then the run moves through your approval chain. Nobody approves their own pay.',
  },
  {
    step: 'Step 03',
    icon: Send,
    title: 'Pay, publish, prove it',
    text: 'Payment files and batches go out, payslips land privately, and dashboards plus audited exports give finance and your board the full picture.',
  },
];

/** Three-step workflow — the path from import to audited payroll */
export default function Workflow() {
  return (
    <section id="how-it-works" className={shared.section} aria-labelledby="workflow-title">
      <div className={shared.container}>
        <div className={shared.sectionHead}>
          <p className={shared.eyebrow}>How it works</p>
          <h2 id="workflow-title" className={shared.sectionTitle}>
            Three steps to a payroll you can trust.
          </h2>
          <p className={shared.sectionLead}>
            Set up once, then run the same repeatable process every pay period —
            with checks and approvals built into the path.
          </p>
        </div>

        <ol className={styles.steps}>
          {steps.map(({ step, icon: Icon, title, text }) => (
            <li key={step} className={styles.step}>
              <div className={styles.stepHead}>
                <span className={styles.icon} aria-hidden="true">
                  <Icon size={22} strokeWidth={1.75} />
                </span>
                <span className={styles.stepNumber}>{step}</span>
              </div>
              <h3 className={styles.stepTitle}>{title}</h3>
              <p className={styles.stepText}>{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
