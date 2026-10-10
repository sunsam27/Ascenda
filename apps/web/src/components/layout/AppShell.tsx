'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import TopBar from './TopBar';
import SessionRefresher from '@/components/auth/SessionRefresher';
import styles from './AppShell.module.css';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={`app-bg ${styles.shell}`}>
      <SessionRefresher />
      <Sidebar />
      <MobileNav open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className={styles.main}>
        <TopBar menuOpen={menuOpen} onMenuClick={() => setMenuOpen((open) => !open)} />
        <main className={styles.content} id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}