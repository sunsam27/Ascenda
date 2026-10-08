import type { Metadata } from 'next';
import RequestAccessForm from '@/components/marketing/RequestAccessForm';
import styles from './request-access.module.css';

export const metadata: Metadata = {
  title: 'Request access',
  description:
    'Request access to Ascenda — people, payroll and workforce intelligence for churches, SMEs, NGOs and schools.',
};

export default function RequestAccessPage() {
  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>Request access</p>
        <h1 className={styles.title}>See Ascenda in your workspace.</h1>
        <p className={styles.lead}>
          Tell us a little about your organisation and we’ll be in touch with
          next steps — usually within one working day.
        </p>
      </div>

      <RequestAccessForm />
    </div>
  );
}
