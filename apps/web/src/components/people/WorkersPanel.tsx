'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  Loader2,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Upload,
  UserPlus,
} from 'lucide-react';
import {
  WorkerCategory,
  WorkerInviteStatus,
  WorkerStatus,
  type Department,
  type Location,
  type PaginationMeta,
  type WorkerInviteResult,
  type WorkerSummary,
} from '@ascenda/types';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/useCurrentUser';
import WorkerEditor from './WorkerEditor';
import ImportWorkersDrawer from './ImportWorkersDrawer';
import styles from './people.module.css';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

const PAGE_SIZE = 25;

const CATEGORY_LABEL: Record<WorkerCategory, string> = {
  [WorkerCategory.EMPLOYEE]: 'Employee',
  [WorkerCategory.MINISTER]: 'Minister',
  [WorkerCategory.VOLUNTEER]: 'Volunteer',
  [WorkerCategory.CONTRACTOR]: 'Contractor',
  [WorkerCategory.INTERN]: 'Intern',
};

const STATUS_LABEL: Record<WorkerStatus, string> = {
  [WorkerStatus.ACTIVE]: 'Active',
  [WorkerStatus.ON_LEAVE]: 'On leave',
  [WorkerStatus.SUSPENDED]: 'Suspended',
  [WorkerStatus.TERMINATED]: 'Terminated',
  [WorkerStatus.DRAFT]: 'Draft',
};

const STATUS_CLASS: Record<WorkerStatus, string | undefined> = {
  [WorkerStatus.ACTIVE]: styles.statusActive,
  [WorkerStatus.ON_LEAVE]: styles.statusOnLeave,
  [WorkerStatus.SUSPENDED]: styles.statusSuspended,
  [WorkerStatus.TERMINATED]: styles.statusTerminated,
  [WorkerStatus.DRAFT]: styles.statusDraft,
};

function initials(first: string, last: string): string {
  const a = first.trim().charAt(0);
  const b = last.trim().charAt(0);
  return `${a}${b}`.toUpperCase() || '?';
}

function displayName(worker: WorkerSummary): string {
  return worker.preferredName?.trim() || `${worker.firstName} ${worker.lastName}`;
}

export default function WorkersPanel({
  departments,
  locations,
  t,
}: {
  departments: Department[];
  locations: Location[];
  t: (term: string) => string;
}) {
  const [state, setState] = useState<LoadState>('loading');
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<WorkerSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const { user } = useCurrentUser();

  // Only organisation-level roles may create/update/terminate workers. Managers
  // (and any narrower scope) get a read-only directory of their team.
  const canManage =
    user?.role === 'OWNER' || user?.role === 'HR_ADMINISTRATOR';

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    try {
      const { data } = await api.get<{
        data: WorkerSummary[];
        meta: PaginationMeta;
      }>('/workers', {
        params: {
          page,
          pageSize: PAGE_SIZE,
          ...(debounced ? { search: debounced } : {}),
        },
      });
      setWorkers(data.data);
      setMeta(data.meta);
      setState('ready');
    } catch (err) {
      setState(
        axios.isAxiosError(err) && err.response?.status === 403
          ? 'forbidden'
          : 'error',
      );
    }
  }, [page, debounced]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSaved(saved: WorkerSummary) {
    setCreating(false);
    setEditing(null);
    setWorkers((prev) => {
      const exists = prev.some((w) => w.id === saved.id);
      const next = exists
        ? prev.map((w) => (w.id === saved.id ? saved : w))
        : [saved, ...prev];
      return next;
    });
    void load();
  }

  async function terminate(worker: WorkerSummary) {
    const ok = window.confirm(
      `Mark ${displayName(worker)} as terminated? Their history is kept and they leave the active headcount.`,
    );
    if (!ok) return;
    setBusyId(worker.id);
    setActionError('');
    try {
      const { data } = await api.delete<{ data: WorkerSummary }>(
        `/workers/${worker.id}`,
      );
      setWorkers((prev) =>
        prev.map((w) => (w.id === worker.id ? data.data : w)),
      );
    } catch (err) {
      setActionError(
        axios.isAxiosError(err)
          ? ((err.response?.data as { message?: string })?.message ??
            'Could not update the record.')
          : 'Could not update the record.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function invite(worker: WorkerSummary) {
    const isResend = worker.inviteStatus === WorkerInviteStatus.PENDING;
    const ok = window.confirm(
      isResend
        ? `Resend the workspace invitation to ${displayName(worker)}? Their previous link will stop working.`
        : `Email ${displayName(worker)} a link to set up their workspace login?`,
    );
    if (!ok) return;
    setInvitingId(worker.id);
    setActionError('');
    setNotice('');
    try {
      const { data } = await api.post<{ data: WorkerInviteResult }>(
        isResend
          ? `/workers/${worker.id}/invite/resend`
          : `/workers/${worker.id}/invite`,
      );
      setWorkers((prev) =>
        prev.map((w) =>
          w.id === worker.id
            ? { ...w, hasLogin: true, inviteStatus: WorkerInviteStatus.PENDING }
            : w,
        ),
      );
      setNotice(
        data.data.emailSent
          ? `${isResend ? 'Invitation resent' : 'Invitation sent'} to ${data.data.email}.`
          : `${isResend ? 'Invitation recreated' : 'Invitation created'} for ${data.data.email}. Email delivery is not configured here, so the link was written to the API log.`,
      );
    } catch (err) {
      setActionError(
        axios.isAxiosError(err)
          ? ((err.response?.data as { message?: string })?.message ??
            'Could not send the invitation.')
          : 'Could not send the invitation.',
      );
    } finally {
      setInvitingId(null);
    }
  }

  if (state === 'loading') {
    return (
      <div className={styles.spinnerRow}>
        <Loader2 className={styles.spin} size={16} />
        Loading {t('Employee').toLowerCase()} directory…
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className={`glass ${styles.message}`}>
        <p className={styles.messageTitle}>Directory is restricted</p>
        <p className={styles.muted}>
          Your role does not have permission to view the {t('Employee').toLowerCase()} directory.
        </p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className={`glass ${styles.message}`} role="alert">
        <p className={styles.messageTitle}>Something went wrong</p>
        <p className={styles.muted}>We could not load the directory.</p>
      </div>
    );
  }

  const total = meta?.total ?? 0;
  const totalPages = meta?.totalPages ?? 1;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search className={styles.searchIcon} size={16} strokeWidth={2} />
          <input
            className={styles.searchInput}
            type="search"
            placeholder={`Search ${t('Employee').toLowerCase() === 'employee' ? 'employees' : `${t('Employee').toLowerCase()}s`}…`}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            aria-label="Search directory"
          />
        </div>
        {canManage && (
          <div className={styles.toolbarActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => setImporting(true)}
            >
              <Upload size={16} strokeWidth={2} />
              Import CSV
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => {
                setCreating(true);
                setEditing(null);
              }}
            >
              <Plus size={16} strokeWidth={2.2} />
              Add {t('Employee')}
            </button>
          </div>
        )}
      </div>

      {actionError && (
        <p className={styles.error} role="alert">
          {actionError}
        </p>
      )}

      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      {workers.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <UserPlus size={28} strokeWidth={1.6} aria-hidden="true" />
          <p className={styles.messageTitle}>
            {debounced
              ? 'No matches'
              : `No ${t('Employee').toLowerCase()}s yet`}
          </p>
          <p className={styles.muted}>
            {debounced
              ? 'Try a different name, email or employee number.'
              : canManage
                ? 'Add your first person to bring the dashboard to life.'
                : `No ${t('Employee').toLowerCase()}s are assigned to you yet.`}
          </p>
        </div>
      ) : (
        <div className={`glass ${styles.tableWrap}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Name</th>
                <th className={styles.th}>Job title</th>
                <th className={styles.th}>Category</th>
                <th className={styles.th}>{t('Department')}</th>
                <th className={styles.th}>{t('Location')}</th>
                <th className={styles.th}>Status</th>
                {canManage && (
                  <th className={styles.th}>
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {workers.map((worker) => (
                <tr key={worker.id} className={styles.row}>
                  <td className={styles.td}>
                    <div className={styles.nameCell}>
                      <span className={styles.avatar} aria-hidden="true">
                        {initials(worker.firstName, worker.lastName)}
                      </span>
                      <span className={styles.nameText}>
                        <span className={styles.namePrimary}>
                          {displayName(worker)}
                        </span>
                        <span className={styles.nameMeta}>
                          {worker.employeeNumber} · {worker.email}
                          {worker.inviteStatus ===
                            WorkerInviteStatus.PENDING && (
                            <span className={styles.badgePending}>Invited</span>
                          )}
                          {worker.inviteStatus ===
                            WorkerInviteStatus.ACCEPTED && (
                            <span className={styles.badgeLogin}>Login</span>
                          )}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className={styles.td}>{worker.jobTitle}</td>
                  <td className={styles.td}>
                    {worker.category === WorkerCategory.EMPLOYEE
                      ? t('Employee')
                      : CATEGORY_LABEL[worker.category]}
                  </td>
                  <td className={styles.td}>{worker.departmentName ?? '—'}</td>
                  <td className={styles.td}>{worker.locationName ?? '—'}</td>
                  <td className={styles.td}>
                    <span
                      className={`${styles.status} ${STATUS_CLASS[worker.status] ?? ''}`}
                    >
                      {STATUS_LABEL[worker.status]}
                    </span>
                  </td>
                  {canManage && (
                    <td className={`${styles.td} ${styles.colActions}`}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => {
                          setEditing(worker);
                          setCreating(false);
                        }}
                        aria-label={`Edit ${displayName(worker)}`}
                        title="Edit"
                      >
                        <Pencil size={15} strokeWidth={2} />
                      </button>
                      {worker.inviteStatus !== WorkerInviteStatus.ACCEPTED &&
                        worker.status !== WorkerStatus.TERMINATED && (
                          <button
                            type="button"
                            className={styles.iconButton}
                            onClick={() => invite(worker)}
                            disabled={invitingId === worker.id}
                            aria-label={
                              worker.inviteStatus === WorkerInviteStatus.PENDING
                                ? `Resend the workspace invitation to ${displayName(worker)}`
                                : `Invite ${displayName(worker)} to the workspace`
                            }
                            title={
                              worker.inviteStatus === WorkerInviteStatus.PENDING
                                ? 'Resend invite'
                                : 'Invite to workspace login'
                            }
                          >
                            {invitingId === worker.id ? (
                              <Loader2 className={styles.spin} size={15} />
                            ) : worker.inviteStatus ===
                              WorkerInviteStatus.PENDING ? (
                              <RefreshCw size={15} strokeWidth={2} />
                            ) : (
                              <Mail size={15} strokeWidth={2} />
                            )}
                          </button>
                        )}
                      {worker.status !== WorkerStatus.TERMINATED && (
                        <button
                          type="button"
                          className={styles.iconButton}
                          onClick={() => terminate(worker)}
                          disabled={busyId === worker.id}
                          aria-label={`Terminate ${displayName(worker)}`}
                          title="Terminate"
                        >
                          {busyId === worker.id ? (
                            <Loader2 className={styles.spin} size={15} />
                          ) : (
                            <UserPlus size={15} strokeWidth={2} />
                          )}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className={styles.pager}>
          <span className={styles.pagerInfo}>
            Showing {from}–{to} of {total}
          </span>
          <div className={styles.pagerButtons}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Previous
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {(creating || editing) && (
        <WorkerEditor
          worker={editing}
          departments={departments}
          locations={locations}
          t={t}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={handleSaved}
        />
      )}

      {importing && (
        <ImportWorkersDrawer
          t={t}
          onClose={() => setImporting(false)}
          onImported={() => {
            setPage(1);
            void load();
          }}
        />
      )}
    </div>
  );
}
