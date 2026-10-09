'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  LayoutDashboard,
  Users,
  CalendarClock,
  DollarSign,
  CreditCard,
  FileText,
  BarChart3,
  Settings,
  LogOut,
} from 'lucide-react';
import styles from './Sidebar.module.css';

const navItems = [
  { href: '/dashboard',   label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/people',      label: 'People',     icon: Users },
  { href: '/time-leave',  label: 'Time & Leave', icon: CalendarClock },
  { href: '/payroll',     label: 'Payroll',    icon: DollarSign },
  { href: '/payments',    label: 'Payments',   icon: CreditCard },
  { href: '/documents',   label: 'Documents',  icon: FileText },
  { href: '/analytics',   label: 'Analytics',  icon: BarChart3 },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    try {
      await api.post('/auth/logout');
    } catch {
      // Even if the request fails, clear the client-side session view.
    }
    router.replace('/login');
    router.refresh();
  }

  return (
    <aside className={`glass-nav ${styles.sidebar}`} aria-label="Main navigation">
      {/* Brand */}
      <div className={styles.brand}>
        <Image
          src="/ascenda-logo.png"
          alt=""
          width={36}
          height={36}
          className={styles.logoMark}
          aria-hidden="true"
          priority
        />
        <span className={styles.brandName}>Ascenda</span>
      </div>

      {/* Navigation */}
      <nav className={styles.nav}>
        <ul role="list" className={styles.navList}>
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom section */}
      <div className={styles.bottom}>
        <Link href="/settings" className={`${styles.navItem} ${pathname.startsWith('/settings') ? styles.active : ''}`}>
          <Settings size={20} strokeWidth={1.75} aria-hidden="true" />
          <span>Settings</span>
        </Link>

        <div className={styles.divider} role="separator" />

        <div className={styles.userRow}>
          <div className={styles.avatar} aria-hidden="true">JD</div>
          <div className={styles.userInfo}>
            <span className={styles.userName}>Jane Doe</span>
            <span className={styles.userRole}>HR Administrator</span>
          </div>
        </div>

        <button
          className={`${styles.navItem} ${styles.signOut}`}
          aria-label="Sign out"
          onClick={handleSignOut}
        >
          <LogOut size={20} strokeWidth={1.75} aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
