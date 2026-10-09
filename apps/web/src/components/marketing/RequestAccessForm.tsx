'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { ArrowRight, CircleCheckBig } from 'lucide-react';
import shared from './shared.module.css';
import styles from './RequestAccessForm.module.css';

const orgTypes = [
  'Church or ministry',
  'SME',
  'NGO or non-profit',
  'School',
  'Other',
];

const teamSizes = ['1–20', '21–100', '101–500', '501+'];

const NAME_PATTERN = /^[A-Za-z][A-Za-z' -]*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ORGANISATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 &.'-]*$/;

type Status = 'idle' | 'sending' | 'done';
type FieldErrors = Partial<
  Record<'name' | 'email' | 'organisation' | 'orgType' | 'teamSize', string>
>;

export default function RequestAccessForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [values, setValues] = useState({
    name: '',
    email: '',
    organisation: '',
    orgType: '',
    teamSize: '',
  });

  function nameError(value: string): string | undefined {
    const v = value.trim();
    return v.length < 2 || !NAME_PATTERN.test(v)
      ? 'Please enter your full name.'
      : undefined;
  }

  function emailError(value: string): string | undefined {
    return EMAIL_PATTERN.test(value.trim())
      ? undefined
      : 'Please enter a valid work email address.';
  }

  function organisationError(value: string): string | undefined {
    const v = value.trim();
    return v.length < 2 || !ORGANISATION_PATTERN.test(v)
      ? 'Please enter your organization name.'
      : undefined;
  }

  function validate(data: FormData): FieldErrors {
    const next: FieldErrors = {};
    const name = nameError(String(data.get('name') ?? ''));
    const email = emailError(String(data.get('email') ?? ''));
    const organisation = organisationError(String(data.get('organisation') ?? ''));
    if (name) next.name = name;
    if (email) next.email = email;
    if (organisation) next.organisation = organisation;
    if (!String(data.get('orgType') ?? '')) {
      next.orgType = 'Please select your organisation type.';
    }
    if (!String(data.get('teamSize') ?? '')) {
      next.teamSize = 'Please select your team size.';
    }
    return next;
  }

  function handleBlur(
    field: 'name' | 'email' | 'organisation',
    value: string,
  ) {
    const message =
      field === 'name'
        ? nameError(value)
        : field === 'email'
          ? emailError(value)
          : organisationError(value);

    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  }

  function clearError(field: keyof FieldErrors) {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function handleChange(field: keyof typeof values, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    clearError(field);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const validation = validate(data);
    setErrors(validation);

    if (Object.keys(validation).length > 0) {
      const firstInvalid = (
        ['name', 'email', 'organisation', 'orgType', 'teamSize'] as const
      ).find((field) => validation[field]);
      if (firstInvalid) {
        const el = form.elements.namedItem(firstInvalid);
        if (el instanceof HTMLElement) el.focus();
      }
      return;
    }

    const email = String(data.get('email') ?? '').trim();
    setStatus('sending');
    // TODO: POST to the API once the request-access endpoint exists (apps/api)
    await new Promise((resolve) => setTimeout(resolve, 900));
    setSubmittedEmail(email);
    setStatus('done');
  }

  const isComplete =
    !nameError(values.name) &&
    !emailError(values.email) &&
    !organisationError(values.organisation) &&
    values.orgType !== '' &&
    values.teamSize !== '';

  if (status === 'done') {
    return (
      <div className={styles.card} role="status" aria-live="polite">
        <span className={styles.successIcon} aria-hidden="true">
          <CircleCheckBig size={26} strokeWidth={2} />
        </span>
        <div className={styles.successBody}>
          <h2 className={styles.successTitle}>Request received.</h2>
          <p className={styles.successText}>
            Thanks — we’ll email <strong>{submittedEmail}</strong> with next
            steps for setting up your workspace.
          </p>
        </div>
        <div className={styles.successActions}>
          <Link href="/" className={`${shared.btn} ${shared.btnPrimary}`}>
            Back to home
          </Link>
          <Link href="/login" className={`${shared.btn} ${shared.btnSecondary}`}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.card} onSubmit={handleSubmit} noValidate>
      <div className={styles.field}>
        <label htmlFor="ra-name" className={styles.label}>Full name</label>
        <input
          id="ra-name"
          name="name"
          type="text"
          className={`${styles.input}${errors.name ? ` ${styles.inputError}` : ''}`}
          placeholder="Jane Adeyemi"
          autoComplete="name"
          required
          value={values.name}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? 'ra-name-error' : undefined}
          onChange={(e) => handleChange('name', e.currentTarget.value)}
          onBlur={(e) => handleBlur('name', e.currentTarget.value)}
        />
        {errors.name && (
          <p id="ra-name-error" className={styles.errorText} role="alert">
            {errors.name}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="ra-email" className={styles.label}>Work email</label>
        <input
          id="ra-email"
          name="email"
          type="email"
          className={`${styles.input}${errors.email ? ` ${styles.inputError}` : ''}`}
          placeholder="you@yourorganisation.org"
          autoComplete="email"
          required
          value={values.email}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'ra-email-error' : undefined}
          onChange={(e) => handleChange('email', e.currentTarget.value)}
          onBlur={(e) => handleBlur('email', e.currentTarget.value)}
        />
        {errors.email && (
          <p id="ra-email-error" className={styles.errorText} role="alert">
            {errors.email}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="ra-org" className={styles.label}>Organisation name</label>
        <input
          id="ra-org"
          name="organisation"
          type="text"
          className={`${styles.input}${errors.organisation ? ` ${styles.inputError}` : ''}`}
          placeholder="Grace Chapel / Acme Ltd"
          autoComplete="organization"
          required
          value={values.organisation}
          aria-invalid={errors.organisation ? true : undefined}
          aria-describedby={errors.organisation ? 'ra-org-error' : undefined}
          onChange={(e) => handleChange('organisation', e.currentTarget.value)}
          onBlur={(e) => handleBlur('organisation', e.currentTarget.value)}
        />
        {errors.organisation && (
          <p id="ra-org-error" className={styles.errorText} role="alert">
            {errors.organisation}
          </p>
        )}
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="ra-type" className={styles.label}>Organisation type</label>
          <select
            id="ra-type"
            name="orgType"
            className={`${styles.input}${errors.orgType ? ` ${styles.inputError}` : ''}`}
            required
            value={values.orgType}
            aria-invalid={errors.orgType ? true : undefined}
            aria-describedby={errors.orgType ? 'ra-type-error' : undefined}
            onChange={(e) => handleChange('orgType', e.currentTarget.value)}
          >
            <option value="" disabled>Select one</option>
            {orgTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          {errors.orgType && (
            <p id="ra-type-error" className={styles.errorText} role="alert">
              {errors.orgType}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="ra-size" className={styles.label}>Team size</label>
          <select
            id="ra-size"
            name="teamSize"
            className={`${styles.input}${errors.teamSize ? ` ${styles.inputError}` : ''}`}
            required
            value={values.teamSize}
            aria-invalid={errors.teamSize ? true : undefined}
            aria-describedby={errors.teamSize ? 'ra-size-error' : undefined}
            onChange={(e) => handleChange('teamSize', e.currentTarget.value)}
          >
            <option value="" disabled>Select one</option>
            {teamSizes.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
          {errors.teamSize && (
            <p id="ra-size-error" className={styles.errorText} role="alert">
              {errors.teamSize}
            </p>
          )}
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="ra-message" className={styles.label}>
          Anything we should know? <span className={styles.optional}>(optional)</span>
        </label>
        <textarea
          id="ra-message"
          name="message"
          className={styles.textarea}
          rows={4}
          placeholder="How do you run payroll today?"
        />
      </div>

      <button
        type="submit"
        className={`${shared.btn} ${shared.btnPrimary} ${styles.submit}`}
        disabled={status === 'sending' || !isComplete}
        aria-busy={status === 'sending'}
      >
        {status === 'sending' ? (
          <>
            <span className={styles.spinner} aria-hidden="true" />
            Sending…
          </>
        ) : (
          <>
            Request access
            <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
          </>
        )}
      </button>

      <p className={styles.footnote}>
        Already have a workspace?{' '}
        <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}
