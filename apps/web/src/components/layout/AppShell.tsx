'use client';

import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import TopBar from './TopBar';
import SessionRefresher from '@/components/auth/SessionRefresher';
import styles from './AppShell.module.css';

export type ShellTheme = 'soft' | 'glass' | 'dark';

const THEME_KEY = 'ascenda-dashboard-theme';
const THEME_ORDER: ShellTheme[] = ['soft', 'glass', 'dark'];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<ShellTheme>('soft');

  // Restore the saved theme after mount (keeps SSR output deterministic).
  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === 'soft' || stored === 'glass' || stored === 'dark') {
      setTheme(stored);
    }
  }, []);

  function toggleTheme() {
    setTheme((current) => {
      const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length] ?? 'soft';
      window.localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }

  return (
    <div className={`app-bg ${styles.shell}`} data-theme={theme}>
      <SessionRefresher />
      <Sidebar />
      <MobileNav open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className={styles.main}>
        <TopBar
          menuOpen={menuOpen}
          onMenuClick={() => setMenuOpen((open) => !open)}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <main className={styles.content} id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}