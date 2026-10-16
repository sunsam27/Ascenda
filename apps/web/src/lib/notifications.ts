'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Notification, NotificationListResponse } from '@ascenda/types';
import { api } from './api';

type UnreadCountResponse = { data: { unread: number } };

/**
 * The signed-in user's in-app notifications (the app-shell bell): the newest
 * page plus the unread count, refreshed on an interval. Marking read is
 * optimistic with a refetch on failure.
 */
export function useNotifications(pollMs = 60_000, pageSize = 12) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const activeRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [listRes, countRes] = await Promise.all([
        api.get<NotificationListResponse>('/notifications', {
          params: { pageSize },
        }),
        api.get<UnreadCountResponse>('/notifications/unread-count'),
      ]);
      if (!activeRef.current) return;
      setItems(listRes.data.data ?? []);
      setUnread(countRes.data.data?.unread ?? 0);
    } catch {
      // Transient failure (API restarting, offline): keep the last known state.
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }, [pageSize]);

  useEffect(() => {
    activeRef.current = true;
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, pollMs);
    return () => {
      activeRef.current = false;
      window.clearInterval(timer);
    };
  }, [refresh, pollMs]);

  const markRead = useCallback(
    async (id: string) => {
      if (!items.find((n) => n.id === id)?.readAt) {
        setUnread((u) => Math.max(0, u - 1));
      }
      setItems((prev) =>
        prev.map((n) =>
          n.id === id && !n.readAt
            ? { ...n, readAt: new Date().toISOString() }
            : n,
        ),
      );
      try {
        await api.post(`/notifications/${id}/read`);
      } catch {
        void refresh();
      }
    },
    [items, refresh],
  );

  const markAllRead = useCallback(async () => {
    setItems((prev) =>
      prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
    );
    setUnread(0);
    try {
      await api.post('/notifications/read-all');
    } catch {
      void refresh();
    }
  }, [refresh]);

  return { items, unread, loading, refresh, markRead, markAllRead };
}
