'use client';

import { useEffect, useState } from 'react';
import type { Location } from '@ascenda/types';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/useCurrentUser';
import LeaveRequestsPanel from './LeaveRequestsPanel';
import LeaveBalancesPanel from './LeaveBalancesPanel';
import TeamCalendarPanel from './TeamCalendarPanel';
import AttendancePanel from './AttendancePanel';
import BlackoutPeriodsPanel from './BlackoutPeriodsPanel';
import WorkSchedulePanel from './WorkSchedulePanel';
import HolidaysPanel from './HolidaysPanel';
import LeaveTypesPanel from './LeaveTypesPanel';
import styles from './time-leave.module.css';

type Tab =
  | 'leave-requests'
  | 'calendar'
  | 'balances'
  | 'attendance'
  | 'schedule'
  | 'blackouts'
  | 'holidays'
  | 'leave-types';

/** Roles that may manage the holiday calendar and the leave-type catalogue. */
const MANAGERS = new Set(['OWNER', 'HR_ADMINISTRATOR']);
/** Roles that may record attendance on behalf of others. */
const RECORDERS = new Set(['OWNER', 'HR_ADMINISTRATOR', 'MANAGER']);
/** Roles that may clock in/out for themselves (attendance:create @ SELF+). */
const CLOCKERS = new Set([
  'OWNER',
  'HR_ADMINISTRATOR',
  'MANAGER',
  'EMPLOYEE_SELF',
  'VOLUNTEER_SELF',
]);
/** Roles whose leave read is limited to their own records. */
const SELF_ONLY = new Set(['EMPLOYEE_SELF', 'VOLUNTEER_SELF']);
/** Roles without `blackout_periods:read` — everything else may view them. */
const NO_BLACKOUT_READ = new Set(['PAYROLL_ADMINISTRATOR', 'FINANCE_APPROVER']);

export default function TimeLeaveView() {
  const { user } = useCurrentUser();
  const [tab, setTab] = useState<Tab>('leave-requests');
  const [locations, setLocations] = useState<Location[]>([]);

  const canManage = MANAGERS.has(user?.role ?? '');
  // Deleting a leave type requires `leave:delete`, which only the owner has.
  const canDeleteLeaveType = user?.role === 'OWNER';
  const canRecordAttendance = RECORDERS.has(user?.role ?? '');
  // Deleting an attendance record requires `attendance:delete` (org scope).
  const canDeleteAttendance = MANAGERS.has(user?.role ?? '');
  const canClock = CLOCKERS.has(user?.role ?? '');
  // Only owner/HR hold `leave:update` (org scope) to adjust balances.
  const canAdjustBalances = MANAGERS.has(user?.role ?? '');
  const canSeeOthersLeave = !SELF_ONLY.has(user?.role ?? '');
  const canSeeBlackouts = !NO_BLACKOUT_READ.has(user?.role ?? '');
  // Only the organisation owner can change the org-wide work-schedule default.
  const canManageOrgSchedule = user?.role === 'OWNER';

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
    { id: 'calendar', label: 'Team calendar' },
    { id: 'balances', label: 'Leave balances' },
    { id: 'attendance', label: 'Attendance' },
    ...(canManage
      ? [{ id: 'schedule' as Tab, label: 'Work schedule' }]
      : []),
    ...(canSeeBlackouts
      ? [{ id: 'blackouts' as Tab, label: 'Blackout periods' }]
      : []),
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
      ) : tab === 'calendar' ? (
        <TeamCalendarPanel canSeeOthers={canSeeOthersLeave} />
      ) : tab === 'balances' ? (
        <LeaveBalancesPanel
          canAdjust={canAdjustBalances}
          canSeeOthers={canSeeOthersLeave}
        />
      ) : tab === 'attendance' ? (
        <AttendancePanel
          canRecord={canRecordAttendance}
          canDelete={canDeleteAttendance}
          canClock={canClock}
        />
      ) : tab === 'schedule' ? (
        <WorkSchedulePanel canManage={canManage} canManageOrg={canManageOrgSchedule} />
      ) : tab === 'blackouts' ? (
        <BlackoutPeriodsPanel locations={locations} canManage={canManage} />
      ) : tab === 'holidays' ? (
        <HolidaysPanel locations={locations} canManage={canManage} />
      ) : (
        <LeaveTypesPanel canManage={canManage} canDelete={canDeleteLeaveType} />
      )}
    </div>
  );
}
