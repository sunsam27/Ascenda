import Link from 'next/link';
import Image from 'next/image';
import shared from './shared.module.css';
import styles from './SiteFooter.module.css';

const productLinks = [
  { href: '#product', label: 'Product' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#security', label: 'Security' },
  { href: '#who-its-for', label: 'Who it’s for' },
];

const startLinks = [
  { href: '/request-access', label: 'Request access' },
  { href: '/login', label: 'Sign in' },
];

export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <div className={shared.container}>
        <div className={styles.top}>
          <div className={styles.brandCol}>
            <Link href="/" className={styles.brand} aria-label="Ascenda — home">
              <Image
                src="/ascenda-logo.png"
                alt=""
                width={60}
                height={60}
                className={styles.logoMark}
                aria-hidden="true"
              />
              <span className={styles.brandName}>Ascenda</span>
            </Link>
            <p className={styles.tagline}>
              People, payroll and workforce intelligence for churches, SMEs,
              NGOs and schools.
            </p>
          </div>

          <nav className={styles.nav} aria-label="Footer">
            <div className={styles.col}>
              <p className={styles.colTitle}>Product</p>
              {productLinks.map((link) => (
                <a key={link.href} href={link.href} className={styles.link}>
                  {link.label}
                </a>
              ))}
            </div>
            <div className={styles.col}>
              <p className={styles.colTitle}>Get started</p>
              {startLinks.map((link) => (
                <Link key={link.href} href={link.href} className={styles.link}>
                  {link.label}
                </Link>
              ))}
            </div>
          </nav>
        </div>

        <div className={styles.bottom}>
          <p className={styles.copyright}>
            © {year} Ascenda. All rights reserved.
          </p>
          <p className={styles.meta}>Built mobile-first for low-bandwidth teams.</p>
        </div>
      </div>
    </footer>
  );
}
