'use client';

import Sidebar from './Sidebar';
import TopBar from './TopBar';
import styles from './AppShell.module.css';

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={`app-bg ${styles.shell}`}>
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
