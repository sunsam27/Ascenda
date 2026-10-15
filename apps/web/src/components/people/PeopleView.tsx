'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import type { Department, Location } from '@ascenda/types';
import { api } from '@/lib/api';
import { useOrganisation, terminologyOf } from '@/lib/useOrganisation';
import WorkersPanel from './WorkersPanel';
import DepartmentsPanel from './DepartmentsPanel';
import LocationsPanel from './LocationsPanel';
import styles from './people.module.css';

type Tab = 'directory' | 'departments' | 'locations';

export default function PeopleView() {
  const { organisation } = useOrganisation();
  const t = useMemo(() => terminologyOf(organisation), [organisation]);

  const [tab, setTab] = useState<Tab>('directory');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [refsError, setRefsError] = useState('');

  const loadRefs = useCallback(async () => {
    const term = terminologyOf(organisation);
    try {
      const [departmentsRes, locationsRes] = await Promise.all([
        api.get<{ data: Department[] }>('/departments'),
        api.get<{ data: Location[] }>('/locations'),
      ]);
      setDepartments(departmentsRes.data.data);
      setLocations(locationsRes.data.data);
      setRefsError('');
    } catch (error) {
      // A 403 simply means this role can't manage org structure; the tabs will
      // surface their own empty/permission states. Anything else is a real error.
      if (axios.isAxiosError(error) && error.response?.status === 403) return;
      setRefsError(
        `Could not load ${term('Department').toLowerCase()}s and ${term('Location').toLowerCase()}s.`,
      );
    }
  }, [organisation]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'directory', label: 'Directory' },
    { id: 'departments', label: `${t('Department')}s` },
    { id: 'locations', label: `${t('Location')}s` },
  ];

  return (
    <div className={`${styles.page} cascade`}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>People</h1>
          <p className={styles.pageSubtitle}>
            {t('Employee')} directory, {t('Department').toLowerCase()}s and{' '}
            {t('Location').toLowerCase()}s
          </p>
        </div>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="People sections">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`${styles.tab} ${tab === item.id ? styles.tabActive : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {refsError && (
        <p className={styles.error} role="alert">
          {refsError}
        </p>
      )}

      {tab === 'directory' && (
        <WorkersPanel departments={departments} locations={locations} t={t} />
      )}
      {tab === 'departments' && (
        <DepartmentsPanel
          departments={departments}
          onChanged={loadRefs}
          t={t}
        />
      )}
      {tab === 'locations' && (
        <LocationsPanel locations={locations} onChanged={loadRefs} t={t} />
      )}
    </div>
  );
}
