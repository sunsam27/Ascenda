'use client';

import { useEffect } from 'react';
import { getSessionExpiry, refreshSession } from '@/lib/api';

const REFRESH_SKEW_MS = 60 * 1000; // refresh 60s before expiry
const MAX_TIMEOUT_MS = 2_147_483_000; // setTimeout ceiling

/**
 * Keeps the access cookie fresh while a refreshable session exists. Refreshes
 * proactively just before expiry (and when the tab regains focus), so the user
 * is never interrupted mid-session. Mounted inside the authenticated shell.
 */
export default function SessionRefresher() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    async function schedule() {
      if (cancelled) return;
      const expiry = getSessionExpiry();
      if (expiry === null) return; // no session marker — nothing to refresh

      const delay = expiry - Date.now() - REFRESH_SKEW_MS;
      if (delay > 0) {
        timer = setTimeout(schedule, Math.min(delay, MAX_TIMEOUT_MS));
        return;
      }

      try {
        await refreshSession();
      } catch {
        // Refresh token is gone/invalid; the API client redirects on 401.
        return;
      }
      if (!cancelled) void schedule();
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void schedule();
    }

    void schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return null;
}
