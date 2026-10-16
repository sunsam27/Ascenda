'use client';

import { useEffect, useState } from 'react';
import type { Location } from '@ascenda/types';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/useCurrentUser';
import LeaveRequestsPanel from './LeaveRequestsPanel';
import AttendancePanel from './AttendancePanel';
import HolidaysPanel from './HolidaysPanel';
import LeaveTypesPanel from './LeaveTypesPanel';
import styles from './time-leave.module.css';

type Tab = 'leave-requests' | 'attendance' | 'holidays' | 'leave-types';

/** Roles that may manage the holiday calendar and the leave-type catalogue. */
const MANAGERS = new Set(['OWNER', 'HR_ADMINISTRATOR']);
/** Roles that may record attendance on behalf of others. */
const RECORDERS = new Set(['OWNER', 'HR_ADMINISTRATOR', 'MANAGER']);

export default function TimeLeaveView() {
  const { user } = useCurrentUser();
  const [tab, setTab] = useState<Tab>('attendance');
  const [locations, setLocations] = useState<Location[]>([]);

  const canManage = MANAGERS.has(user?.role ?? '');
  // Deleting a leave type requires `leave:delete`, which only the owner has.
  const canDeleteLeaveType = user?.role === 'OWNER';
  const canRecordAttendance = RECORDERS.has(user?.role ?? '');
  // Deleting an attendance record requires `attendance:delete` (org scope).
  const canDeleteAttendance = MANAGERS.has(user?.role ?? '');

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
    { id: 'leave-requests', label: 'Leave requests' },
    { id: 'attendance', label: 'Attendance' },
    { id: 'holidays', label: 'Public holidays' },
    { id: 'leave-types', label: 'Leave types' },
  ];

  return (
    <div className={`${styles.page} cascade`}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>Time &amp; Leave</h1>
          <p className={styles.pageSubtitle}>
            Attendance, the public-holiday calendar and the leave a{' '}
            {user?.role === 'VOLUNTEER_SELF' ? 'volunteer' : 'person'} can request
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

      {tab === 'leave-requests' ? (
        <LeaveRequestsPanel />
      ) : tab === 'attendance' ? (
        <AttendancePanel canRecord={canRecordAttendance} canDelete={canDeleteAttendance} />
      ) : tab === 'holidays' ? (
        <HolidaysPanel locations={locations} canManage={canManage} />
      ) : (
        <LeaveTypesPanel canManage={canManage} canDelete={canDeleteLeaveType} />
      )}
    </div>
  );
}
