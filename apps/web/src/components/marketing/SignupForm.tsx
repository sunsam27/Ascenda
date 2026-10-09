'use client';

import { useEffect, useState, FormEvent } from 'react';
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
  ShieldCheck,
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

const countries = [
  { value: 'NG', label: 'Nigeria' },
  { value: 'GH', label: 'Ghana' },
  { value: 'KE', label: 'Kenya' },
  { value: 'ZA', label: 'South Africa' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'US', label: 'United States' },
];

const NAME_PATTERN = /^[A-Za-z][A-Za-z' -]*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD_LENGTH = 12;

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
        const firstPaid = data.data.find((p) => !p.isFree) ?? data.data[0];
        if (firstPaid) setSelectedCode(firstPaid.code);
      })
      .catch(() => active && setPlansError(true));
    return () => {
      active = false;
    };
  }, []);

  function set<K extends keyof Fields>(key: K, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function validateDetails(): boolean {
    const next: Record<string, string> = {};
    if (fields.firstName.trim().length < 2 || !NAME_PATTERN.test(fields.firstName.trim()))
      next.firstName = 'Please enter your first name.';
    if (fields.lastName.trim().length < 2 || !NAME_PATTERN.test(fields.lastName.trim()))
      next.lastName = 'Please enter your last name.';
    if (!EMAIL_PATTERN.test(fields.email.trim()))
      next.email = 'Please enter a valid work email address.';
    if (fields.password.length < MIN_PASSWORD_LENGTH)
      next.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (fields.confirm !== fields.password)
      next.confirm = 'Passwords do not match.';
    if (fields.organisationName.trim().length < 2)
      next.organisationName = 'Please enter your organisation name.';
    if (!fields.organisationType)
      next.organisationType = 'Please select your organisation type.';
    if (!fields.teamSize) next.teamSize = 'Please select your team size.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goToPlan(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
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
    <div className={styles.wrapper}>
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
              />
            </Field>
            <Field label="Last name" error={errors.lastName}>
              <input
                className={inputClass(errors.lastName)}
                value={fields.lastName}
                autoComplete="family-name"
                onChange={(e) => set('lastName', e.currentTarget.value)}
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
                onChange={(e) => set('password', e.currentTarget.value)}
              />
            </Field>
            <Field label="Confirm password" error={errors.confirm}>
              <input
                className={inputClass(errors.confirm)}
                type="password"
                value={fields.confirm}
                autoComplete="new-password"
                onChange={(e) => set('confirm', e.currentTarget.value)}
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
              />
            </Field>
            <Field label="Your role" optional>
              <input
                className={styles.input}
                value={fields.role}
                placeholder="e.g. HR lead"
                onChange={(e) => set('role', e.currentTarget.value)}
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
            />
          </Field>

          <div className={styles.row}>
            <Field label="Organisation type" error={errors.organisationType}>
              <select
                className={inputClass(errors.organisationType)}
                value={fields.organisationType}
                onChange={(e) => set('organisationType', e.currentTarget.value)}
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
            <div className={styles.tierGrid} role="radiogroup" aria-label="Plans">
              {plans.map((plan) => {
                const selected = plan.code === selectedCode;
                const featured = plan.code === 'growth';
                return (
                  <button
                    type="button"
                    key={plan.id}
                    role="radio"
                    aria-checked={selected}
                    className={`${styles.tier} ${selected ? styles.tierSelected : ''} ${featured ? styles.tierFeatured : ''}`}
                    onClick={() => setSelectedCode(plan.code)}
                  >
                    {featured && <span className={styles.tierBadge}>Most popular</span>}
                    <span className={styles.tierName}>{plan.name}</span>
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
                    <ul className={styles.tierFeatures}>
                      {plan.features.map((f) => (
                        <li key={f}>
                          <Check size={15} strokeWidth={2.5} aria-hidden="true" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <span
                      className={`${styles.tierCheck} ${selected ? styles.tierCheckOn : ''}`}
                      aria-hidden="true"
                    >
                      {selected && <Check size={14} strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>
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
      <Building2 size={20} strokeWidth={1.75} aria-hidden="true" />
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
