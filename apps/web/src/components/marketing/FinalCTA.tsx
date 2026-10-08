import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import shared from './shared.module.css';
import styles from './FinalCTA.module.css';

/** Closing CTA — Primary band (white on Primary passes 6.7:1 — COLORS.md §2) */
export default function FinalCTA() {
  return (
    <section className={shared.section} aria-labelledby="cta-title">
      <div className={shared.container}>
        <div className={styles.band}>
          <h2 id="cta-title" className={styles.title}>
            See Ascenda run your next payroll.
          </h2>
          <p className={styles.lead}>
            Tell us about your organisation and we’ll set up a workspace for
            your team — no spreadsheets required.
          </p>

          <div className={styles.actions}>
            <Link href="/request-access" className={`${shared.btn} ${shared.btnLight}`}>
              Request access
              <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
            </Link>
            <Link href="/login" className={`${shared.btn} ${shared.btnOutlineLight}`}>
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
