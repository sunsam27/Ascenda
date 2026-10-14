'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** Shape of the JWT payload returned by `GET /auth/me` (see jwt.strategy.ts). */
export type CurrentUser = {
  sub: string;
  email: string;
  firstName?: string;
  lastName?: string;
  platformAdmin?: boolean;
  organisationId?: string;
  role?: string;
};

// Module-level cache: the shell mounts this hook in several places (sidebar,
// mobile drawer, topbar). They all share a single in-flight request.
let cache: Promise<CurrentUser | null> | null = null;

function fetchCurrentUser(): Promise<CurrentUser | null> {
  if (!cache) {
    cache = api
      .get<{ user: CurrentUser }>('/auth/me')
      .then((res) => res.data.user)
      .catch(() => {
        // Allow a later mount to retry after a transient failure.
        cache = null;
        return null;
      });
  }
  return cache;
}

export function useCurrentUser(): { user: CurrentUser | null; loading: boolean } {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchCurrentUser().then((fetched) => {
      if (!active) return;
      setUser(fetched);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { user, loading };
}

/** Initials for an avatar: "Samuel Sunday" → "SS". Falls back to the email. */
export function initialsOf(user: CurrentUser | null): string {
  if (!user) return '';
  const first = user.firstName?.trim().charAt(0) ?? '';
  const last = user.lastName?.trim().charAt(0) ?? '';
  const initials = `${first}${last}`.toUpperCase();
  return initials || user.email.charAt(0).toUpperCase();
}

/** Full display name, falling back to the email address. */
export function displayNameOf(user: CurrentUser | null): string {
  if (!user) return '';
  const name = [user.firstName, user.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return name || user.email;
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  HR_ADMINISTRATOR: 'HR Administrator',
  PAYROLL_ADMINISTRATOR: 'Payroll Administrator',
  FINANCE_APPROVER: 'Finance Approver',
  MANAGER: 'Manager',
  EMPLOYEE_SELF: 'Employee',
  VOLUNTEER_SELF: 'Volunteer',
  AUDITOR: 'Auditor',
  VIEWER: 'Viewer',
  SUPPORT_READ_ONLY: 'Support',
};

/** Human-readable role label for the account row. */
export function roleLabelOf(user: CurrentUser | null): string {
  if (!user) return '';
  const label = user.role ? ROLE_LABELS[user.role] : undefined;
  if (label) return label;
  if (user.platformAdmin) return 'Platform Admin';
  if (user.role) {
    return user.role
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
  return '';
}
