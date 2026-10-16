'use client';

import { Droplet, Menu, Moon, Sparkles, X, type LucideIcon } from 'lucide-react';
import { useCurrentUser, initialsOf } from '@/lib/useCurrentUser';
import type { ShellTheme } from './AppShell';
import NotificationsBell from './NotificationsBell';
import styles from './TopBar.module.css';

type TopBarProps = {
  menuOpen: boolean;
  onMenuClick: () => void;
  theme: ShellTheme;
  onToggleTheme: () => void;
};

const THEME_META: Record<ShellTheme, { label: string; Icon: LucideIcon }> = {
  soft: { label: 'Soft-UI', Icon: Sparkles },
  glass: { label: 'Glass', Icon: Droplet },
  dark: { label: 'Black', Icon: Moon },
};

export default function TopBar({ menuOpen, onMenuClick, theme, onToggleTheme }: TopBarProps) {
  const { user } = useCurrentUser();
  const { label: themeLabel, Icon: ThemeIcon } = THEME_META[theme];

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
        {/* Theme toggle — cycles Soft-UI → Glass → Black */}
        <button
          type="button"
          className={styles.themeButton}
          onClick={onToggleTheme}
          aria-label={`Theme: ${themeLabel}. Click to change.`}
          title={`Theme: ${themeLabel}`}
        >
          <ThemeIcon size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>

        {/* Notifications */}
        <NotificationsBell />

        {/* User avatar */}
        <button className={styles.avatarButton} aria-label="Open user menu">
          <div className={styles.avatar} aria-hidden="true">{initialsOf(user)}</div>
        </button>
      </div>
    </header>
  );
}
