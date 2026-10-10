'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { SidebarContent } from './Sidebar';
import styles from './MobileNav.module.css';

type MobileNavProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * Slide-in navigation drawer for narrow screens. Renders the same
 * SidebarContent as the desktop sidebar, with a backdrop, Escape-to-close,
 * body scroll lock and focus management.
 */
export default function MobileNav({ open, onClose }: MobileNavProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  // Close when the user activates any link/button inside the drawer.
  function handleNavigateClose(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('a, button')) onClose();
  }

  return (
    <div id="mobile-nav" className={`${styles.root} ${open ? styles.open : ''}`}>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        className={`glass-nav ${styles.panel}`}
        role="dialog"
        aria-modal="true"
        aria-label="Main navigation"
        aria-hidden={!open}
      >
        <button
          ref={closeRef}
          type="button"
          className={styles.closeButton}
          aria-label="Close menu"
          onClick={onClose}
        >
          <X size={22} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <div className={styles.content} onClickCapture={handleNavigateClose}>
          <SidebarContent />
        </div>
      </div>
    </div>
  );
}