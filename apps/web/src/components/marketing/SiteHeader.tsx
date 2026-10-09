'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Menu, X, ArrowRight } from 'lucide-react';
import shared from './shared.module.css';
import styles from './SiteHeader.module.css';

const navLinks = [
  { href: '#product', label: 'Product' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#security', label: 'Security' },
  { href: '#who-its-for', label: 'Who it’s for' },
];

/** Sticky marketing header — glass-nav surface per DESIGN_SYSTEM.md §6 */
export default function SiteHeader() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className={styles.header}>
      <a href="#main" className={styles.skipLink}>
        Skip to content
      </a>

      <div className={`${shared.container} ${styles.bar}`}>
        <Link href="/" className={styles.brand} aria-label="Ascenda — home">
          <Image
            src="/ascenda-logo.png"
            alt=""
            width={60}
            height={60}
            className={styles.logoMark}
            aria-hidden="true"
            priority
          />
          <span className={styles.brandName}>Ascenda</span>
        </Link>

        <nav className={styles.nav} aria-label="Main">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} className={styles.navLink}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className={styles.actions}>
          <Link href="/login" className={`${shared.btn} ${shared.btnQuiet}`}>
            Sign in
          </Link>
          <Link href="/signup" className={`${shared.btn} ${shared.btnPrimary} ${styles.requestCta}`}>
            Get started
            <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
          </Link>
          <button
            type="button"
            className={styles.menuButton}
            aria-label={isOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isOpen}
            aria-controls="mobile-menu"
            onClick={() => setIsOpen((open) => !open)}
          >
            {isOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div id="mobile-menu" className={styles.mobilePanel}>
          <nav aria-label="Main — mobile">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={styles.mobileLink}
                onClick={() => setIsOpen(false)}
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className={styles.mobileActions}>
            <Link href="/login" className={`${shared.btn} ${shared.btnSecondary}`}>
              Sign in
            </Link>
            <Link href="/signup" className={`${shared.btn} ${shared.btnPrimary}`}>
              Get started
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
