'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { Check, Loader2, X } from 'lucide-react';
import {
  EmploymentType,
  WorkerCategory,
  WorkerStatus,
  type Department,
  type Location,
  type WorkerSummary,
} from '@ascenda/types';
import { api } from '@/lib/api';
import { useOrganisation } from '@/lib/useOrganisation';
import CompensationPanel from './CompensationPanel';
import BankAccountsPanel from './BankAccountsPanel';
import styles from './people.module.css';

interface Draft {
  employeeNumber: string;
  firstName: string;
  lastName: string;
  preferredName: string;
  email: string;
  phone: string;
  category: WorkerCategory;
  employmentType: EmploymentType;
  status: WorkerStatus;
  jobTitle: string;
  departmentId: string;
  locationId: string;
  startDate: string;
  endDate: string;
  dateOfBirth: string;
  gender: string;
}

const CATEGORY_LABEL: Record<WorkerCategory, string> = {
  [WorkerCategory.EMPLOYEE]: 'Employee',
  [WorkerCategory.MINISTER]: 'Minister',
  [WorkerCategory.VOLUNTEER]: 'Volunteer',
  [WorkerCategory.CONTRACTOR]: 'Contractor',
  [WorkerCategory.INTERN]: 'Intern',
};

const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  [EmploymentType.FULL_TIME]: 'Full time',
  [EmploymentType.PART_TIME]: 'Part time',
  [EmploymentType.CASUAL]: 'Casual',
  [EmploymentType.FIXED_TERM]: 'Fixed term',
};

const STATUS_LABEL: Record<WorkerStatus, string> = {
  [WorkerStatus.ACTIVE]: 'Active',
  [WorkerStatus.ON_LEAVE]: 'On leave',
  [WorkerStatus.PROBATION]: 'Probation',
  [WorkerStatus.SUSPENDED]: 'Suspended',
  [WorkerStatus.TERMINATED]: 'Terminated',
  [WorkerStatus.RESIGNED]: 'Resigned',
  [WorkerStatus.INACTIVE]: 'Inactive',
  [WorkerStatus.DRAFT]: 'Draft',
};

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function toDateInput(iso?: string): string {
  return iso ? iso.slice(0, 10) : '';
}

function emptyDraft(): Draft {
  return {
    employeeNumber: '',
    firstName: '',
    lastName: '',
    preferredName: '',
    email: '',
    phone: '',
    category: WorkerCategory.EMPLOYEE,
    employmentType: EmploymentType.FULL_TIME,
    status: WorkerStatus.ACTIVE,
    jobTitle: '',
    departmentId: '',
    locationId: '',
    startDate: todayInput(),
    endDate: '',
    dateOfBirth: '',
    gender: '',
  };
}

function toDraft(worker: WorkerSummary): Draft {
  return {
    employeeNumber: worker.employeeNumber,
    firstName: worker.firstName,
    lastName: worker.lastName,
    preferredName: worker.preferredName ?? '',
    email: worker.email,
    phone: worker.phone ?? '',
    category: worker.category,
    employmentType: worker.employmentType,
    status: worker.status,
    jobTitle: worker.jobTitle,
    departmentId: worker.departmentId ?? '',
    locationId: worker.locationId ?? '',
    startDate: toDateInput(worker.startDate),
    endDate: toDateInput(worker.endDate),
    dateOfBirth: toDateInput(worker.dateOfBirth),
    gender: worker.gender ?? '',
  };
}

function messageFrom(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { message?: string | string[] })
      ?.message;
    if (Array.isArray(message)) return message[0] ?? fallback;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

export default function WorkerEditor({
  worker,
  departments,
  locations,
  onClose,
  onSaved,
  t,
}: {
  worker: WorkerSummary | null;
  departments: Department[];
  locations: Location[];
  onClose: () => void;
  onSaved: (worker: WorkerSummary) => void;
  t: (term: string) => string;
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    worker ? toDraft(worker) : emptyDraft(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { organisation } = useOrganisation();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (
      !draft.firstName.trim() ||
      !draft.lastName.trim() ||
      !draft.email.trim() ||
      !draft.jobTitle.trim() ||
      !draft.startDate
    ) {
      setError('Name, email, job title and start date are required.');
      return;
    }
    if (!worker && !draft.employeeNumber.trim()) {
      setError('Employee number is required.');
      return;
    }

    const payload = {
      employeeNumber: draft.employeeNumber.trim() || undefined,
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      preferredName: draft.preferredName.trim() || undefined,
      email: draft.email.trim(),
      phone: draft.phone.trim() || undefined,
      category: draft.category,
      employmentType: draft.employmentType,
      status: draft.status,
      jobTitle: draft.jobTitle.trim(),
      departmentId: draft.departmentId || null,
      locationId: draft.locationId || null,
      startDate: draft.startDate,
      endDate: draft.endDate || null,
      dateOfBirth: draft.dateOfBirth || null,
      gender: draft.gender.trim() || null,
    };

    setBusy(true);
    setError('');
    try {
      const res = worker
        ? await api.patch<{ data: WorkerSummary }>(
            `/workers/${worker.id}`,
            payload,
          )
        : await api.post<{ data: WorkerSummary }>('/workers', payload);
      onSaved(res.data.data);
    } catch (err) {
      setError(messageFrom(err, 'Could not save the record. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={worker ? `Edit ${worker.firstName}` : `Add ${t('Employee')}`}
      >
        <div className={styles.drawerHeader}>
          <p className={styles.drawerTitle}>
            {worker
              ? `Edit ${worker.firstName} ${worker.lastName}`
              : `Add ${t('Employee')}`}
          </p>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className={styles.drawerBody}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <div className={styles.grid}>
            <p className={styles.sectionLabel}>Identity</p>

            <label className={styles.field}>
              <span className={styles.label}>Employee number</span>
              <input
                className={styles.input}
                value={draft.employeeNumber}
                placeholder="EMP-001"
                onChange={(e) => set('employeeNumber', e.currentTarget.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Job title</span>
              <input
                className={styles.input}
                value={draft.jobTitle}
                onChange={(e) => set('jobTitle', e.currentTarget.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>First name</span>
              <input
                className={styles.input}
                value={draft.firstName}
                onChange={(e) => set('firstName', e.currentTarget.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Last name</span>
              <input
                className={styles.input}
                value={draft.lastName}
                onChange={(e) => set('lastName', e.currentTarget.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Preferred name</span>
              <input
                className={styles.input}
                value={draft.preferredName}
                onChange={(e) => set('preferredName', e.currentTarget.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Date of birth</span>
              <input
                type="date"
                className={styles.input}
                value={draft.dateOfBirth}
                onChange={(e) => set('dateOfBirth', e.currentTarget.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Email</span>
              <input
                type="email"
                className={styles.input}
                value={draft.email}
                onChange={(e) => set('email', e.currentTarget.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Phone</span>
              <input
                className={styles.input}
                value={draft.phone}
                onChange={(e) => set('phone', e.currentTarget.value)}
              />
            </label>

            <p className={styles.sectionLabel}>Engagement</p>

            <label className={styles.field}>
              <span className={styles.label}>Category</span>
              <select
                className={styles.input}
                value={draft.category}
                onChange={(e) =>
                  set('category', e.currentTarget.value as WorkerCategory)
                }
              >
                {Object.values(WorkerCategory).map((value) => (
                  <option key={value} value={value}>
                    {value === WorkerCategory.EMPLOYEE
                      ? t('Employee')
                      : CATEGORY_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Employment type</span>
              <select
                className={styles.input}
                value={draft.employmentType}
                onChange={(e) =>
                  set('employmentType', e.currentTarget.value as EmploymentType)
                }
              >
                {Object.values(EmploymentType).map((value) => (
                  <option key={value} value={value}>
                    {EMPLOYMENT_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Status</span>
              <select
                className={styles.input}
                value={draft.status}
                onChange={(e) =>
                  set('status', e.currentTarget.value as WorkerStatus)
                }
              >
                {Object.values(WorkerStatus).map((value) => (
                  <option key={value} value={value}>
                    {STATUS_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>{t('Department')}</span>
              <select
                className={styles.input}
                value={draft.departmentId}
                onChange={(e) => set('departmentId', e.currentTarget.value)}
              >
                <option value="">Unassigned</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>{t('Location')}</span>
              <select
                className={styles.input}
                value={draft.locationId}
                onChange={(e) => set('locationId', e.currentTarget.value)}
              >
                <option value="">Unassigned</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Start date</span>
              <input
                type="date"
                className={styles.input}
                value={draft.startDate}
                onChange={(e) => set('startDate', e.currentTarget.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>End date</span>
              <input
                type="date"
                className={styles.input}
                value={draft.endDate}
                onChange={(e) => set('endDate', e.currentTarget.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Gender</span>
              <input
                className={styles.input}
                value={draft.gender}
                placeholder="Optional"
                onChange={(e) => set('gender', e.currentTarget.value)}
              />
            </label>

            {worker && (
              <>
                <p className={styles.sectionLabel}>Compensation</p>
                <div className={styles.fieldFull}>
                  <CompensationPanel
                    worker={worker}
                    currency={organisation?.currency ?? 'NGN'}
                  />
                </div>

                <p className={styles.sectionLabel}>Bank details</p>
                <div className={styles.fieldFull}>
                  <BankAccountsPanel workerId={worker.id} canManage />
                </div>
              </>
            )}
          </div>
        </div>

        <div className={styles.drawerActions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={save}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className={styles.spin} size={15} />
            ) : (
              <Check size={15} strokeWidth={2.5} />
            )}
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
