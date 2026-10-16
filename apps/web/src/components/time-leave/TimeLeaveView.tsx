'use client';

import { useEffect, useState } from 'react';
import type { Location } from '@ascenda/types';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/useCurrentUser';
import HolidaysPanel from './HolidaysPanel';
import LeaveTypesPanel from './LeaveTypesPanel';
import styles from './time-leave.module.css';

type Tab = 'holidays' | 'leave-types';

/** Roles that may manage the holiday calendar and the leave-type catalogue. */
const MANAGERS = new Set(['OWNER', 'HR_ADMINISTRATOR']);

export default function TimeLeaveView() {
  const { user } = useCurrentUser();
  const [tab, setTab] = useState<Tab>('holidays');
  const [locations, setLocations] = useState<Location[]>([]);

  const canManage = MANAGERS.has(user?.role ?? '');
  // Deleting a leave type requires `leave:delete`, which only the owner has.
  const canDeleteLeaveType = user?.role === 'OWNER';

  useEffect(() => {
    let active = true;
    api
      .get<{ data: Location[] }>('/locations')
      .then((res) => {
        if (active) setLocations(res.data.data);
      })
      .catch(() => {
        // Roles without org-structure access simply see organisation-wide items.
      });
    return () => {
      active = false;
    };
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'holidays', label: 'Public holidays' },
    { id: 'leave-types', label: 'Leave types' },
  ];

  return (
    <div className={`${styles.page} cascade`}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>Time &amp; Leave</h1>
          <p className={styles.pageSubtitle}>
            Public-holiday calendar and the leave a {user?.role === 'VOLUNTEER_SELF' ? 'volunteer' : 'person'} can request
          </p>
        </div>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Time and leave sections">
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

      {tab === 'holidays' ? (
        <HolidaysPanel locations={locations} canManage={canManage} />
      ) : (
        <LeaveTypesPanel canManage={canManage} canDelete={canDeleteLeaveType} />
      )}
    </div>
  );
}
