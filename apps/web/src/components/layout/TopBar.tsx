'use client';

import { Bell, Menu, X } from 'lucide-react';
import styles from './TopBar.module.css';

type TopBarProps = {
  menuOpen: boolean;
  onMenuClick: () => void;
};

export default function TopBar({ menuOpen, onMenuClick }: TopBarProps) {
  return (
    <header className={`glass-nav ${styles.topbar}`} role="banner">
      <div className={styles.left}>
        <button
          type="button"
          className={styles.menuButton}
          onClick={onMenuClick}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        >
          {menuOpen ? (
            <X size={22} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Menu size={22} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
        <h1 className={styles.pageTitle} id="page-title">Dashboard</h1>
      </div>
      <div className={styles.right}>
        {/* Notifications */}
        <button
          className={styles.iconButton}
          aria-label="Notifications (3 unread)"
        >
          <Bell size={20} strokeWidth={1.75} aria-hidden="true" />
          <span className={styles.badge} aria-hidden="true">3</span>
        </button>

        {/* User avatar */}
        <button className={styles.avatarButton} aria-label="Open user menu">
          <div className={styles.avatar} aria-hidden="true">JD</div>
        </button>
      </div>
    </header>
  );
}
