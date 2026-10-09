import type { Metadata } from 'next';
import SignupForm from '@/components/marketing/SignupForm';
import styles from './signup.module.css';

export const metadata: Metadata = {
  title: 'Create your workspace',
  description:
    'Start with Ascenda — people, payroll and workforce intelligence for churches, SMEs, NGOs and schools. Pick a plan and launch your workspace in minutes.',
};

export default function SignupPage() {
  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>Get started</p>
        <h1 className={styles.title}>Create your workspace today.</h1>
        <p className={styles.lead}>
          Set up your organisation, choose a plan and start managing your people
          right away. No approval queue, no waiting.
        </p>
      </div>

      <SignupForm />
    </div>
  );
}
