'use client';

import Sidebar from './Sidebar';
import TopBar from './TopBar';
import SessionRefresher from '@/components/auth/SessionRefresher';
import styles from './AppShell.module.css';

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={`app-bg ${styles.shell}`}>
      <SessionRefresher />
      <Sidebar />
      <div className={styles.main}>
        <TopBar />
        <main className={styles.content} id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
