'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck } from 'lucide-react';
import type { Notification } from '@ascenda/types';
import { useNotifications } from '@/lib/notifications';
import styles from './NotificationsBell.module.css';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Bell with unread badge and a dropdown inbox. */
export default function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { items, unread, loading, markRead, markAllRead } = useNotifications();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const openItem = async (notification: Notification) => {
    if (!notification.readAt) await markRead(notification.id);
    setOpen(false);
    if (notification.link) router.push(notification.link);
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={
          unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={20} strokeWidth={1.75} aria-hidden="true" />
        {unread > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label="Notifications">
          <div className={styles.header}>
            <span className={styles.title}>Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                className={styles.markAll}
                onClick={() => void markAllRead()}
              >
                <CheckCheck size={14} aria-hidden="true" /> Mark all read
              </button>
            )}
          </div>
          <div className={styles.list}>
            {loading && items.length === 0 ? (
              <p className={styles.empty}>Loading…</p>
            ) : items.length === 0 ? (
              <p className={styles.empty}>No notifications yet.</p>
            ) : (
              items.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  className={`${styles.item} ${
                    notification.readAt ? '' : styles.unread
                  }`}
                  onClick={() => void openItem(notification)}
                >
                  <span className={styles.itemTitle}>{notification.title}</span>
                  <span className={styles.itemBody}>{notification.body}</span>
                  <span className={styles.itemTime}>
                    {timeAgo(notification.createdAt)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
