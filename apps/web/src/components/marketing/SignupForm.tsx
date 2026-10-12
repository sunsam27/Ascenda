'use client';

import { useEffect, useRef, useState, FormEvent, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import { api } from '@/lib/api';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CircleCheckBig,
  CreditCard,
  Loader2,
  MailCheck,
  Rocket,
  ShieldCheck,
  Smile,
  Sparkles,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  OrganisationType,
  PaymentProvider,
  type PlanSummary,
  type StartRegistrationResult,
  type CheckoutSession,
} from '@ascenda/types';
import shared from './shared.module.css';
import styles from './SignupForm.module.css';

const orgTypes: { value: OrganisationType; label: string }[] = [
  { value: OrganisationType.CHURCH, label: 'Church or ministry' },
  { value: OrganisationType.SME, label: 'SME' },
  { value: OrganisationType.NGO, label: 'NGO or non-profit' },
  { value: OrganisationType.SCHOOL, label: 'School' },
  { value: OrganisationType.OTHER, label: 'Other' },
];

const teamSizes = ['1', '1–20', '21–100', '101–500', '501+'];

const tierIcons: Record<string, LucideIcon> = {
  free: Sparkles,
  starter: Rocket,
  growth: Zap,
  scale: Building2,
  enterprise: ShieldCheck,
};

const tierTilts = [styles.tilt0, styles.tilt1, styles.tilt2];

const tierAccents: Record<string, string> = {
  free: 'var(--color-secondary)',
  starter: 'var(--color-chart-5)',
  growth: 'var(--color-primary)',
  scale: 'var(--color-success)',
  enterprise: 'var(--color-warning)',
};

const DEFAULT_ACCENT = 'var(--color-primary)';

const countries = [
  { value: 'NG', label: 'Nigeria' },
  { value: 'GH', label: 'Ghana' },
  { value: 'KE', label: 'Kenya' },
  { value: 'ZA', label: 'South Africa' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'US', label: 'United States' },
];

const NAME_PATTERN = /^[\p{L}][\p{L}' .-]*$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^\+?[\d\s().-]{7,20}$/;
const MIN_PASSWORD_LENGTH = 12;

interface PasswordRule {
  id: string;
  label: string;
  test: (candidate: string) => boolean;
}

/** Live checklist shown under the password field. */
const PASSWORD_RULES: PasswordRule[] = [
  {
    id: 'length',
    label: `At least ${MIN_PASSWORD_LENGTH} characters`,
    test: (candidate) => candidate.length >= MIN_PASSWORD_LENGTH,
  },
  {
    id: 'upper',
    label: 'An uppercase letter (A–Z)',
    test: (candidate) => /[A-Z]/.test(candidate),
  },
  {
    id: 'lower',
    label: 'A lowercase letter (a–z)',
    test: (candidate) => /[a-z]/.test(candidate),
  },
  {
    id: 'number',
    label: 'A number (0–9)',
    test: (candidate) => /[0-9]/.test(candidate),
  },
];

function getPasswordRules(candidate: string): {
  id: string;
  label: string;
  met: boolean;
}[] {
  return PASSWORD_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    met: rule.test(candidate),
  }));
}

type Step = 'details' | 'plan' | 'verify' | 'payment' | 'done';

/** Persisted so a user who leaves mid-checkout can resume paying. */
interface PendingSignup {
  registrationId: string;
  plan: PlanSummary;
}

const PENDING_KEY = 'ascenda_pending';

function loadPending(): PendingSignup | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingSignup;
  } catch {
    return null;
  }
}

interface Fields {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirm: string;
  phone: string;
  organisationName: string;
  organisationType: string;
  teamSize: string;
  country: string;
  role: string;
  message: string;
}

const EMPTY: Fields = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  confirm: '',
  phone: '',
  organisationName: '',
  organisationType: '',
  teamSize: '',
  country: 'NG',
  role: '',
  message: '',
};

function formatPrice(plan: PlanSummary): string {
  if (plan.isFree || plan.priceMinorUnits === 0) return 'Free';
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: plan.currency,
    minimumFractionDigits: 0,
  }).format(plan.priceMinorUnits / 100);
}

function pricePeriod(plan: PlanSummary): string {
  return plan.billingPeriod === 'ANNUALLY' ? '/year' : '/month';
}

export default function SignupForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('details');
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [plansError, setPlansError] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string>('');

  const [registration, setRegistration] = useState<StartRegistrationResult | null>(
    null,
  );
  const [code, setCode] = useState('');
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState('');

  const [provider, setProvider] = useState<PaymentProvider | null>(null);

  const [pending, setPending] = useState<PendingSignup | null>(null);

  const [passwordFocused, setPasswordFocused] = useState(false);
  const submitted = useRef(false);

  useEffect(() => {
    setPending(loadPending());
  }, []);

  useEffect(() => {
    let active = true;
    api
      .get<{ data: PlanSummary[] }>('/plans')
      .then(({ data }) => {
        if (!active) return;
        setPlans(data.data);
      })
      .catch(() => active && setPlansError(true));
    return () => {
      active = false;
    };
  }, []);

  function set<K extends keyof Fields>(key: K, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      if (key === 'confirm' && value.length > 0 && value !== fields.password) {
        next.confirm = 'Passwords do not match.';
      }
      return next;
    });
  }

  type ValidatableKey =
    | 'firstName'
    | 'lastName'
    | 'email'
    | 'password'
    | 'confirm'
    | 'phone'
    | 'organisationName'
    | 'organisationType'
    | 'teamSize'
    | 'role';

  /** Single source of truth for field-level validation. */
  function validateField(
    key: ValidatableKey,
    value: Fields,
  ): string | undefined {
    const raw = value[key];
    const trimmed = raw.trim();
    switch (key) {
      case 'firstName':
      case 'lastName':
        if (trimmed.length < 2)
          return `Please enter your ${key === 'firstName' ? 'first' : 'last'} name.`;
        if (!NAME_PATTERN.test(trimmed))
          return 'Names may only contain letters, spaces, hyphens and apostrophes.';
        return;
      case 'email':
        if (!EMAIL_PATTERN.test(trimmed))
          return 'Enter a valid email, e.g. you@yourorganisation.org.';
        return;
      case 'password':
        if (raw.length > 200) return 'Keep your password under 200 characters.';
        if (raw.length < MIN_PASSWORD_LENGTH)
          return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
        if (!/[A-Z]/.test(raw)) return 'Add at least one uppercase letter.';
        if (!/[a-z]/.test(raw)) return 'Add at least one lowercase letter.';
        if (!/[0-9]/.test(raw)) return 'Add at least one number.';
        return;
      case 'confirm':
        if (raw !== value.password) return 'Passwords do not match.';
        return;
      case 'phone':
        if (raw && !PHONE_PATTERN.test(trimmed))
          return 'Enter a valid phone number.';
        return;
      case 'organisationName':
        if (trimmed.length < 2) return 'Enter your organisation name.';
        return;
      case 'organisationType':
        if (!raw) return 'Select your organisation type.';
        return;
      case 'teamSize':
        if (!raw) return 'Select your team size.';
        return;
      case 'role':
        if (raw.length > 80) return 'Keep your role under 80 characters.';
        return;
      default:
        return;
    }
  }

  /** Validate on blur — skip empty fields until the form has been submitted. */
  function validateOnBlur(key: ValidatableKey) {
    if (!submitted.current && fields[key].trim() === '') return;
    const message = validateField(key, fields);
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[key] = message;
      else if (prev[key]) delete next[key];
      return next;
    });
  }

  function validateDetails(): boolean {
    const next: Record<string, string> = {};
    for (const key of [
      'firstName',
      'lastName',
      'email',
      'password',
      'confirm',
      'organisationName',
      'organisationType',
      'teamSize',
    ] satisfies ValidatableKey[]) {
      const message = validateField(key, fields);
      if (message) next[key] = message;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goToPlan(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    submitted.current = true;
    if (validateDetails()) setStep('plan');
  }

  function persistPending(reg: StartRegistrationResult) {
    const value: PendingSignup = {
      registrationId: reg.registrationId,
      plan: reg.plan,
    };
    setPending(value);
    try {
      window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(value));
    } catch {
      // sessionStorage may be unavailable; the flow still works in-memory.
    }
  }

  function clearPending() {
    setPending(null);
    try {
      window.sessionStorage.removeItem(PENDING_KEY);
    } catch {
      // ignore
    }
  }

  function startOver() {
    clearPending();
    setFields(EMPTY);
    setCode('');
    setErrors({});
    setSubmitError(null);
    setRegistration(null);
    setStep('details');
  }

  async function createWorkspace() {
    if (!selectedCode) {
      setSubmitError('Please choose a plan to continue.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data } = await api.post<StartRegistrationResult>(
        '/signups',
        {
          firstName: fields.firstName.trim(),
          lastName: fields.lastName.trim(),
          email: fields.email.trim(),
          password: fields.password,
          phone: fields.phone.trim() || undefined,
          organisationName: fields.organisationName.trim(),
          organisationType: fields.organisationType as OrganisationType,
          teamSize: fields.teamSize,
          country: fields.country,
          role: fields.role.trim() || undefined,
          message: fields.message.trim() || undefined,
          planCode: selectedCode,
        },
      );
      setRegistration(data);
      setStep('verify');
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    if (!registration || code.trim().length !== 6) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data } = await api.post<{
        completed: boolean;
        requiresPayment?: boolean;
        redirectTo?: string;
      }>('/signups/verify', {
        registrationId: registration.registrationId,
        code: code.trim(),
      });

      if (data.completed) {
        clearPending();
        setStep('done');
        router.push(data.redirectTo ?? '/dashboard');
        router.refresh();
        return;
      }
      persistPending(registration);
      setStep('payment');
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    if (!registration) return;
    setResending(true);
    setResendNotice('');
    setSubmitError(null);
    try {
      await api.post('/signups/resend', {
        registrationId: registration.registrationId,
      });
      setResendNotice('A new code is on its way.');
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setResending(false);
    }
  }

  async function startCheckout(selectedProvider: PaymentProvider) {
    if (!activeRegistrationId) return;
    setProvider(selectedProvider);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data } = await api.post<CheckoutSession>(
        '/billing/checkout',
        {
          registrationId: activeRegistrationId,
          provider: selectedProvider,
        },
      );
      try {
        window.localStorage.setItem(
          'ascenda_checkout',
          JSON.stringify({
            provider: selectedProvider,
            reference: data.reference,
          }),
        );
      } catch {
        // localStorage may be unavailable; callback can still read query params.
      }
      window.location.href = data.authorizationUrl;
    } catch (err) {
      setSubmitError(errorMessage(err));
      setSubmitting(false);
      setProvider(null);
    }
  }

  const selectedPlan = plans.find((p) => p.code === selectedCode);

  if (step === 'done') {
    return (
      <div className={styles.card} role="status" aria-live="polite">
        <span className={styles.successIcon} aria-hidden="true">
          <CircleCheckBig size={26} strokeWidth={2} />
        </span>
        <div className={styles.successBody}>
          <h2 className={styles.successTitle}>Your workspace is ready.</h2>
          <p className={styles.successText}>
            Taking you to your dashboard…
          </p>
        </div>
        <Link href="/dashboard" className={`${shared.btn} ${shared.btnPrimary}`}>
          Go to dashboard
        </Link>
      </div>
    );
  }

  const activeRegistrationId =
    registration?.registrationId ?? pending?.registrationId ?? null;
  const activePlan = registration?.plan ?? pending?.plan ?? null;
  const flowPlan =
    step === 'plan'
      ? selectedPlan
      : activePlan;
  const showPaymentStep = Boolean(flowPlan && !flowPlan.isFree && step !== 'details');

  return (
    <div
      className={`${styles.wrapper} ${step === 'plan' ? styles.wrapperWide : ''}`}
    >
      {pending && step === 'details' && (
        <div className={styles.resumeBanner} role="status">
          <span className={styles.resumeIcon} aria-hidden="true">
            <CreditCard size={20} strokeWidth={2} />
          </span>
          <div className={styles.resumeBody}>
            <p className={styles.resumeTitle}>You have a pending payment</p>
            <p className={styles.resumeText}>
              Your {pending.plan.name} plan ({formatPrice(pending.plan)}
              {pricePeriod(pending.plan)}) is verified but not yet paid.
              Continue to activate your workspace — you won’t sign up again.
            </p>
          </div>
          <div className={styles.resumeActions}>
            <button
              type="button"
              className={`${shared.btn} ${shared.btnPrimary}`}
              onClick={() => setStep('payment')}
            >
              Continue payment
            </button>
            <button
              type="button"
              className={`${shared.btn} ${shared.btnSecondary}`}
              onClick={startOver}
            >
              Start over
            </button>
          </div>
        </div>
      )}

      <ol className={styles.steps} aria-label="Signup progress">
        <StepDot label="Details" active={step === 'details'} done={step !== 'details'} />
        <StepDot label="Plan" active={step === 'plan'} done={step === 'verify' || step === 'payment'} />
        <StepDot label="Verify" active={step === 'verify'} done={step === 'payment'} />
        <StepDot label="Payment" active={step === 'payment'} done={false} hidden={!showPaymentStep} />
      </ol>

      {step === 'details' && (
        <form className={styles.card} onSubmit={goToPlan} noValidate>
          <header className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Create your workspace</h2>
            <p className={styles.cardLead}>
              Tell us about you and your organisation. It takes a minute.
            </p>
          </header>

          <div className={styles.row}>
            <Field label="First name" error={errors.firstName}>
              <input
                className={inputClass(errors.firstName)}
                value={fields.firstName}
                autoComplete="given-name"
                onChange={(e) => set('firstName', e.currentTarget.value)}
                onBlur={() => validateOnBlur('firstName')}
              />
            </Field>
            <Field label="Last name" error={errors.lastName}>
              <input
                className={inputClass(errors.lastName)}
                value={fields.lastName}
                autoComplete="family-name"
                onChange={(e) => set('lastName', e.currentTarget.value)}
                onBlur={() => validateOnBlur('lastName')}
              />
            </Field>
          </div>

          <Field label="Work email" error={errors.email}>
            <input
              className={inputClass(errors.email)}
              type="email"
              value={fields.email}
              autoComplete="email"
              placeholder="you@yourorganisation.org"
              onChange={(e) => set('email', e.currentTarget.value)}
              onBlur={() => validateOnBlur('email')}
            />
          </Field>

          <div className={styles.row}>
            <Field label="Password" error={errors.password}>
              <input
                className={inputClass(errors.password)}
                type="password"
                value={fields.password}
                autoComplete="new-password"
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                aria-describedby="signup-password-rules"
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => {
                  setPasswordFocused(false);
                  validateOnBlur('password');
                }}
                onChange={(e) => set('password', e.currentTarget.value)}
              />
              {(passwordFocused || fields.password.length > 0) && (
                <ul
                  id="signup-password-rules"
                  className={styles.passwordRules}
                  aria-label="Password requirements"
                >
                  {getPasswordRules(fields.password).map((rule) => (
                    <li
                      key={rule.id}
                      className={`${styles.passwordRule} ${
                        rule.met ? styles.passwordRuleMet : ''
                      }`}
                    >
                      {rule.met ? (
                        <Check size={13} strokeWidth={3} aria-hidden="true" />
                      ) : (
                        <X size={13} strokeWidth={3} aria-hidden="true" />
                      )}
                      {rule.label}
                    </li>
                  ))}
                </ul>
              )}
            </Field>
            <Field label="Confirm password" error={errors.confirm}>
              <input
                className={inputClass(errors.confirm)}
                type="password"
                value={fields.confirm}
                autoComplete="new-password"
                onChange={(e) => set('confirm', e.currentTarget.value)}
                onBlur={() => validateOnBlur('confirm')}
              />
            </Field>
          </div>

          <div className={styles.row}>
            <Field label="Phone" optional>
              <input
                className={styles.input}
                value={fields.phone}
                autoComplete="tel"
                onChange={(e) => set('phone', e.currentTarget.value)}
                onBlur={() => validateOnBlur('phone')}
              />
            </Field>
            <Field label="Your role" optional>
              <input
                className={styles.input}
                value={fields.role}
                placeholder="e.g. HR lead"
                onChange={(e) => set('role', e.currentTarget.value)}
                onBlur={() => validateOnBlur('role')}
              />
            </Field>
          </div>

          <Field label="Organisation name" error={errors.organisationName}>
            <input
              className={inputClass(errors.organisationName)}
              value={fields.organisationName}
              autoComplete="organization"
              placeholder="Grace Chapel / Acme Ltd"
              onChange={(e) => set('organisationName', e.currentTarget.value)}
              onBlur={() => validateOnBlur('organisationName')}
            />
          </Field>

          <div className={styles.row}>
            <Field label="Organisation type" error={errors.organisationType}>
              <select
                className={inputClass(errors.organisationType)}
                value={fields.organisationType}
                onChange={(e) => set('organisationType', e.currentTarget.value)}
                onBlur={() => validateOnBlur('organisationType')}
              >
                <option value="" disabled>
                  Select one
                </option>
                {orgTypes.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Team size" error={errors.teamSize}>
              <select
                className={inputClass(errors.teamSize)}
                value={fields.teamSize}
                onChange={(e) => set('teamSize', e.currentTarget.value)}
                onBlur={() => validateOnBlur('teamSize')}
              >
                <option value="" disabled>
                  Select one
                </option>
                {teamSizes.map((s) => (
                  <option key={s} value={s}>
                    {s} {s === '1' ? 'person' : 'people'}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className={styles.row}>
            <Field label="Country">
              <select
                className={styles.input}
                value={fields.country}
                onChange={(e) => set('country', e.currentTarget.value)}
              >
                {countries.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className={styles.field}>
              <span className={styles.label}>&nbsp;</span>
              <p className={styles.hint}>
                Sets your default currency and timezone.
              </p>
            </div>
          </div>

          <Field label="Anything we should know?" optional>
            <textarea
              className={styles.textarea}
              rows={3}
              value={fields.message}
              onChange={(e) => set('message', e.currentTarget.value)}
            />
          </Field>

          {submitError && (
            <p className={styles.errorBanner} role="alert">
              {submitError}
            </p>
          )}

          <div className={styles.actions}>
            <span />
            <button type="submit" className={`${shared.btn} ${shared.btnPrimary}`}>
              Continue
              <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>

          <p className={styles.footnote}>
            Already have a workspace? <Link href="/login">Sign in</Link>
          </p>
        </form>
      )}

      {step === 'plan' && (
        <div className={styles.cardWide}>
          <header className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Choose your plan</h2>
            <p className={styles.cardLead}>
              Annual billing in Naira. Pick the tier that fits your team — you can
              change it later.
            </p>
          </header>

          {plansError ? (
            <p className={styles.errorBanner} role="alert">
              We couldn’t load the plans. Please refresh and try again.
            </p>
          ) : (
            <>
              <div className={styles.tierGrid} role="radiogroup" aria-label="Plans">
                {plans.map((plan, i) => {
                  const selected = plan.code === selectedCode;
                  const featured = plan.code === 'growth';
                  const Icon = tierIcons[plan.code] ?? Sparkles;
                  return (
                    <div
                      key={plan.id}
                      className={styles.tier}
                      style={
                        {
                          '--tier-accent': tierAccents[plan.code] ?? DEFAULT_ACCENT,
                        } as CSSProperties
                      }
                    >
                      {featured && (
                        <span className={styles.tierBadge}>
                          <Sparkles size={12} strokeWidth={2.5} aria-hidden="true" />
                          Most loved
                        </span>
                      )}
                      {featured && (
                        <span className={styles.tierMascot} aria-hidden="true">
                          <Smile size={17} strokeWidth={2.2} />
                        </span>
                      )}

                      <span className={styles.tierTop}>
                        <span className={`${styles.tierIcon} ${tierTilts[i % tierTilts.length]}`}>
                          <Icon size={20} strokeWidth={2} aria-hidden="true" />
                        </span>
                      </span>

                      <span className={styles.tierName}>{plan.name}</span>
                      {plan.description && (
                        <span className={styles.tierDesc}>{plan.description}</span>
                      )}

                      <span className={styles.tierPrice}>
                        {formatPrice(plan)}
                        {!plan.isFree && (
                          <span className={styles.tierPeriod}>{pricePeriod(plan)}</span>
                        )}
                      </span>
                      <span className={styles.tierHead}>
                        {plan.minHeadcount != null && plan.maxHeadcount != null
                          ? `${plan.minHeadcount}–${plan.maxHeadcount} people`
                          : plan.maxHeadcount == null && plan.minHeadcount != null
                            ? `${plan.minHeadcount}+ people`
                            : plan.maxSeats
                              ? `Up to ${plan.maxSeats} people`
                              : 'Flexible team size'}
                      </span>

                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`${styles.tierCta} ${selected ? styles.tierCtaOn : ''}`}
                        onClick={() => setSelectedCode(plan.code)}
                      >
                        {selected ? (
                          <>
                            <Check size={15} strokeWidth={3} aria-hidden="true" />
                            Selected
                          </>
                        ) : (
                          `Choose ${plan.name}`
                        )}
                      </button>

                      <ul className={styles.tierFeatures}>
                        {plan.features.map((f) => (
                          <li key={f}>
                            <CircleCheckBig
                              size={16}
                              strokeWidth={2.2}
                              aria-hidden="true"
                            />
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>

              <p className={styles.tierReassure}>
                <ShieldCheck size={16} strokeWidth={2} aria-hidden="true" />
                No card to start. Cancel any time. Change plans whenever you need.
              </p>
            </>
          )}

          {submitError && (
            <p className={styles.errorBanner} role="alert">
              {submitError}
            </p>
          )}

          {selectedPlan && !selectedPlan.isFree && (
            <p className={styles.tierNote}>
              <ShieldCheck size={16} strokeWidth={2} aria-hidden="true" />
              You’ll pay {formatPrice(selectedPlan)} by card or bank transfer after
              verifying your email.
            </p>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={`${shared.btn} ${shared.btnSecondary}`}
              onClick={() => setStep('details')}
              disabled={submitting}
            >
              <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
              Back
            </button>
            <button
              type="button"
              className={`${shared.btn} ${shared.btnPrimary}`}
              onClick={createWorkspace}
              disabled={submitting || !selectedCode}
              aria-busy={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className={styles.spin} size={16} aria-hidden="true" />
                  Creating…
                </>
              ) : (
                <>
                  Create workspace
                  <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {step === 'verify' && registration && (
        <form className={styles.card} onSubmit={verifyCode} noValidate>
          <span className={styles.stepIcon} aria-hidden="true">
            <MailCheck size={22} strokeWidth={2} />
          </span>
          <header className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Verify your email</h2>
            <p className={styles.cardLead}>
              We sent a 6-digit code to{' '}
              <strong>{registration.emailMasked}</strong>. Enter it below to
              verify your workspace.
            </p>
          </header>

          <label className={styles.label} htmlFor="signup-code">
            Verification code
          </label>
          <input
            id="signup-code"
            className={`${styles.input} ${styles.codeInput}`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="••••••"
            value={code}
            onChange={(e) =>
              setCode(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))
            }
          />

          {resendNotice && (
            <p className={styles.notice} role="status">
              {resendNotice}
            </p>
          )}
          {submitError && (
            <p className={styles.errorBanner} role="alert">
              {submitError}
            </p>
          )}

          <button
            type="submit"
            className={`${shared.btn} ${shared.btnPrimary}`}
            disabled={submitting || code.length !== 6}
            aria-busy={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className={styles.spin} size={16} aria-hidden="true" />
                Verifying…
              </>
            ) : (
              'Verify & continue'
            )}
          </button>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setStep('plan')}
              disabled={submitting}
            >
              <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" /> Change plan
            </button>
            <button
              type="button"
              className={styles.linkButton}
              onClick={resend}
              disabled={resending}
            >
              {resending ? 'Sending…' : 'Resend code'}
            </button>
          </div>
        </form>
      )}

      {step === 'payment' && activePlan && activeRegistrationId && (
        <div className={styles.card}>
          <span className={styles.stepIcon} aria-hidden="true">
            <CreditCard size={22} strokeWidth={2} />
          </span>
          <header className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Activate your plan</h2>
            <p className={styles.cardLead}>
              Pay <strong>{formatPrice(activePlan)}</strong>
              {pricePeriod(activePlan)} for {activePlan.name}. Your
              workspace activates instantly after payment.
            </p>
          </header>

          {submitError && (
            <p className={styles.errorBanner} role="alert">
              {submitError}
            </p>
          )}

          <div className={styles.payOptions}>
            <PayButton
              label="Pay with Paystack"
              sub="Card, bank transfer, USSD"
              loading={submitting && provider === PaymentProvider.PAYSTACK}
              disabled={submitting}
              onClick={() => startCheckout(PaymentProvider.PAYSTACK)}
            />
            <PayButton
              label="Pay with Flutterwave"
              sub="Card, bank transfer, mobile money"
              loading={submitting && provider === PaymentProvider.FLUTTERWAVE}
              disabled={submitting}
              onClick={() => startCheckout(PaymentProvider.FLUTTERWAVE)}
            />
          </div>

          <p className={styles.secureNote}>
            <ShieldCheck size={15} strokeWidth={2} aria-hidden="true" />
            Payments are processed securely by the provider. We never store card
            details.
          </p>
        </div>
      )}
    </div>
  );
}

function StepDot({
  label,
  active,
  done,
  hidden,
}: {
  label: string;
  active: boolean;
  done: boolean;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <li className={`${styles.step} ${active ? styles.stepActive : ''}`}>
      <span className={`${styles.stepNum} ${done ? styles.stepNumDone : ''}`}>
        {done ? <Check size={13} strokeWidth={3} /> : null}
      </span>
      {label}
    </li>
  );
}

function Field({
  label,
  error,
  optional,
  children,
}: {
  label: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>
        {label} {optional && <span className={styles.optional}>(optional)</span>}
      </span>
      {children}
      {error && (
        <span className={styles.errorText} role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

function PayButton({
  label,
  sub,
  loading,
  disabled,
  onClick,
}: {
  label: string;
  sub: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
      <button
        type="button"
        className={styles.payButton}
        onClick={onClick}
        disabled={disabled}
        aria-busy={loading}
      >
        {label === "Pay with Paystack" ? (
          <img
            src="/paystack.png"
            alt="Paystack logo"
            className={styles.payLogo}
          />
        ) : label === "Pay with Flutterwave" ? (
          <img
            src="/flutterwave.png"
            alt="Flutterwave logo"
            className={styles.payLogo}
          />
        ) : (
          <Building2 size={20} strokeWidth={1.75} aria-hidden="true" />
        )}
        <span className={styles.payText}>
          <span className={styles.payLabel}>{label}</span>
          <span className={styles.paySub}>{sub}</span>
        </span>
        {loading ? (
          <Loader2 className={styles.spin} size={16} aria-hidden="true" />
        ) : (
          <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
        )}
      </button>
  );
}

function inputClass(error?: string): string {
  return `${styles.input}${error ? ` ${styles.inputError}` : ''}`;
}

function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) {
      return 'We couldn’t reach the server. Check your connection and try again.';
    }
    const message = (err.response.data as { message?: string | string[] })
      ?.message;
    if (Array.isArray(message)) return message[0] ?? 'Something went wrong.';
    if (typeof message === 'string') return message;
  }
  return 'Something went wrong. Please try again.';
}
