import Link from 'next/link';
import { ArrowRight, CircleCheckBig } from 'lucide-react';
import shared from './shared.module.css';
import styles from './Hero.module.css';
import ProductPreview from './ProductPreview';
import Typewriter from './Typewriter';

/** Marketing hero — display type scale reserved for this (TYPOGRAPHY.md §3) */
export default function Hero() {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={shared.container}>
        <div className={styles.copy}>
          <p className={`${shared.eyebrow} ${styles.eyebrow}`}>
            <span className={styles.eyebrowDot} aria-hidden="true" />
            People · Payroll · Workforce intelligence
          </p>

          <h1 id="hero-title" className={styles.title}>
            People and payroll, handled.
          </h1>

          <p className={styles.lead}>
            <Typewriter text="Ascenda brings your workers, leave, payroll runs, payments and reporting into one secure workspace — built for churches, SMEs, NGOs and schools." />
          </p>

          <div className={styles.actions}>
            <Link href="/request-access" className={`${shared.btn} ${shared.btnPrimary}`}>
              Request access
              <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
            </Link>
            <a href="#how-it-works" className={`${shared.btn} ${shared.btnSecondary}`}>
              See how it works
            </a>
          </div>

          <ul className={shared.ticks}>
            <li className={shared.tick}>
              <CircleCheckBig size={16} strokeWidth={2} className={shared.tickIcon} aria-hidden="true" />
              Approval workflows
            </li>
            <li className={shared.tick}>
              <CircleCheckBig size={16} strokeWidth={2} className={shared.tickIcon} aria-hidden="true" />
              Field-level permissions
            </li>
            <li className={shared.tick}>
              <CircleCheckBig size={16} strokeWidth={2} className={shared.tickIcon} aria-hidden="true" />
              Private payslips
            </li>
          </ul>
        </div>

        <div className={styles.previewWrap}>
          <ProductPreview />
        </div>
      </div>
    </section>
  );
}
