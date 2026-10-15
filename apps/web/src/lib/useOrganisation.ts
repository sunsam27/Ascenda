'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Organisation } from '@ascenda/types';

// Module-level cache: multiple people components mount this hook (page header,
// directory, editors). They share a single in-flight request, like
// useCurrentUser.
let cache: Promise<Organisation | null> | null = null;

function fetchOrganisation(): Promise<Organisation | null> {
  if (!cache) {
    cache = api
      .get<{ data: Organisation[] }>('/organisations')
      .then((res) => res.data.data[0] ?? null)
      .catch(() => {
        // Allow a later mount to retry after a transient failure.
        cache = null;
        return null;
      });
  }
  return cache;
}

export function useOrganisation(): {
  organisation: Organisation | null;
  loading: boolean;
} {
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchOrganisation().then((fetched) => {
      if (!active) return;
      setOrganisation(fetched);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { organisation, loading };
}

/**
 * Resolve organisation-specific terminology overrides, e.g. a church maps
 * "Employee" → "Pastor" and "Department" → "Ministry". Falls back to the
 * neutral default term when no override is configured.
 */
export function terminologyOf(
  organisation: Organisation | null,
): (defaultTerm: string) => string {
  const overrides = organisation?.terminology ?? {};
  return (defaultTerm: string) => {
    return (
      overrides[defaultTerm] ??
      overrides[defaultTerm.toLowerCase()] ??
      defaultTerm
    );
  };
}
