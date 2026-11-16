'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, Copy, RefreshCw, ShieldCheck } from 'lucide-react';
import type { EmployerWalletSummary, EmployerWalletLedgerEntry, EmployerWalletQuote, EmployerWalletPayment, PaymentBatch } from '@ascenda/types';
import { api } from '@/lib/api';
import { useOrganisation } from '@/lib/useOrganisation';
import { formatMinorUnits } from '@/lib/money';
import { messageFrom, PAYMENT_BATCH_STATUS_LABEL } from './payroll-ui';
import StepUpDialog from './StepUpDialog';
import base from './payroll.module.css';
import styles from './employer-wallet.module.css';

const ROOT = '/payments/employer-wallet';
const labels: Record<string, string> = {
  NOT_STARTED: 'Not started', PENDING_VERIFICATION: 'Verification pending', ACTIVE: 'Funding account active', REJECTED: 'Setup not approved',
  PENDING: 'Awaiting confirmation', CONFIRMED: 'Confirmed', RESERVED: 'Reserved for payroll',
  QUEUED: 'Pending submission', PROCESSING: 'Processing', PAID: 'Successful', FAILED: 'Confirmed failure', REVERSED: 'Funds returned', REFUNDED: 'Refunded',
  DEPOSIT: 'Bank transfer received', FEE: 'Partner fee', PAYROLL_RESERVATION: 'Payroll funds reserved',
  SALARY_PAYOUT: 'Salary payment', REVERSAL: 'Salary payment returned', REFUND: 'Deposit returned', SETUP_SUBMITTED: 'Company setup submitted', SETUP_STATUS: 'Company setup status',
};
type Page<T> = { data: T[]; meta: { totalPages: number } };

export default function EmployerWalletPanel({ canSetup, canApprove }: { canSetup: boolean; canApprove: boolean }) {
  const { organisation } = useOrganisation();
  const funding = useRef<HTMLElement>(null);
  const [wallet, setWallet] = useState<EmployerWalletSummary | null>(null);
  const [ledger, setLedger] = useState<EmployerWalletLedgerEntry[]>([]);
  const [history, setHistory] = useState<EmployerWalletPayment[]>([]);
  const [batches, setBatches] = useState<PaymentBatch[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPages, setHistoryPages] = useState(1);
  const [batchPage, setBatchPage] = useState(1);
  const [batchPages, setBatchPages] = useState(1);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [quote, setQuote] = useState<EmployerWalletQuote | null>(null);
  const [selected, setSelected] = useState<{ id: string; retry: boolean; requestKey: string } | null>(null);
  const [action, setAction] = useState<{ title: string; run: (token: string) => Promise<void> } | null>(null);
  const [form, setForm] = useState({ legalName: '', registrationNumber: '', companyAddress: '', representativeName: '', representativeEmail: '', representativePhone: '', representativeRole: '', authorised: false });

  useEffect(() => { if (organisation) setForm((value) => ({ ...value, legalName: value.legalName || organisation.name })); }, [organisation]);

  const load = useCallback(async () => {
    try {
      const [summary, activity, payments, batchList] = await Promise.all([
        api.get<EmployerWalletSummary>(ROOT),
        api.get<Page<EmployerWalletLedgerEntry>>(`${ROOT}/ledger`, { params: { page, pageSize: 10 } }),
        api.get<Page<EmployerWalletPayment>>(`${ROOT}/history`, { params: { page: historyPage, pageSize: 10 } }),
        api.get<Page<PaymentBatch>>('/payments/batches', { params: { page: batchPage, pageSize: 10 } }),
      ]);
      setWallet(summary.data); setLedger(activity.data.data); setPages(activity.data.meta.totalPages);
      setHistory(payments.data.data); setHistoryPages(payments.data.meta.totalPages);
      setBatches(batchList.data.data); setBatchPages(batchList.data.meta.totalPages);
    } catch (err) { setError(messageFrom(err, 'Employer funding could not be loaded. Contact support if this persists.')); }
    finally { setLoading(false); }
  }, [page, historyPage, batchPage]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!batches.some((batch) => batch.status === 'PROCESSING')) return;
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [batches, load]);

  async function perform(work: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); setNotice(success); await load(); }
    catch (err) { setError(messageFrom(err, 'The action could not be confirmed. Check activity before trying again.')); await load(); }
    finally { setBusy(false); }
  }

  async function review(batch: PaymentBatch, retry = false) {
    setBusy(true); setError(''); setQuote(null);
    const request = selected?.id === batch.id && selected.retry === retry ? selected : { id: batch.id, retry, requestKey: crypto.randomUUID() };
    setSelected(request);
    try { setQuote((await api.get<EmployerWalletQuote>(`${ROOT}/batches/${batch.id}/${retry ? 'retry-quote' : 'quote'}`)).data); }
    catch (err) { setError(messageFrom(err, 'This payroll is not eligible for employer-funded payment.')); }
    finally { setBusy(false); }
  }

  function fundPayroll() {
    funding.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
    funding.current?.focus();
  }

  const amount = (value: number | null) => value === null ? 'Awaiting partner quote' : formatMinorUnits(value, 'NGN');
  const status = (value: string) => labels[value] ?? value.toLowerCase().replaceAll('_', ' ');

  return <section className={styles.wallet} aria-labelledby="employer-funding-title">
    <div className={styles.heading}>
      <div><h2 id="employer-funding-title"><Building2 aria-hidden="true" size={22} /> Company payroll funding</h2>
        <p>Fund your company’s payroll from your regular bank account. Employees receive salaries in their existing bank accounts.</p></div>
      <button className={`${base.btn} ${base.btnGhost}`} onClick={() => void load()} disabled={busy}><RefreshCw size={16} aria-hidden="true" /> Refresh</button>
    </div>
    {error && <p className={base.error} role="alert">{error}</p>}
    {notice && <p className={base.notice} role="status">{notice}</p>}
    {loading ? <p role="status">Loading company funding…</p> : !wallet ? <p>Funding information is unavailable. Refresh to try again.</p> : <>
      <section className={styles.card} ref={funding} tabIndex={-1} aria-labelledby="funding-account-title">
        <div className={styles.heading}><h3 id="funding-account-title">Your payroll funding account</h3><span className={base.badge}>{status(wallet.status)}</span></div>
        {wallet.mode === 'TEST' && <p className={styles.warning}>Test environment only. Do not transfer real money.</p>}
        <p>{wallet.message}</p>
        <p><ShieldCheck size={16} aria-hidden="true" /> You do not need to create or manage a Flutterwave or Paystack account.</p>
        {wallet.reconciliationRequired && <p className={base.error} role="alert">Payments are paused for reconciliation. Contact Ascenda support; do not pay these salaries again by another route.</p>}
        {wallet.fundingAccount ? <>
          <dl className={styles.account}>
            <div><dt>Bank</dt><dd>{wallet.fundingAccount.bankName}</dd></div>
            <div><dt>Account name</dt><dd>{wallet.fundingAccount.accountName}</dd></div>
            <div><dt>Account number</dt><dd><strong>{wallet.fundingAccount.accountNumber}</strong>{' '}
              <button className={`${base.btn} ${base.btnGhost}`} onClick={() => void perform(() => navigator.clipboard.writeText(wallet.fundingAccount!.accountNumber), 'Funding account number copied.')}><Copy size={16} aria-hidden="true" /> Copy account number</button>
            </dd></div>
          </dl>
          <ol><li>Open your company’s bank app and make a normal NGN bank transfer.</li><li>Check the bank and account name against the details above before confirming.</li><li>Return here to check funding. Transfers may take time; only partner-confirmed funds become available.</li></ol>
          <p>The payment partner holds and moves the funds. Do not send funds to an employee account to fund this balance.</p>
        </> : <p><strong>No funding account has been issued.</strong> Do not send money until verified account details appear here.</p>}
        {canSetup && (wallet.status === 'NOT_STARTED' || wallet.status === 'REJECTED') && <button className={`${base.btn} ${base.btnPrimary}`} onClick={() => setShowSetup((value) => !value)} disabled={busy}>{showSetup ? 'Close company setup' : 'Set up company funding'}</button>}
        {canSetup && wallet.status === 'PENDING_VERIFICATION' && <button className={`${base.btn} ${base.btnGhost}`} disabled={busy} onClick={() => setAction({ title: 'Check company funding setup', run: (token) => perform(() => api.post(`${ROOT}/setup/status`, undefined, { headers: { 'x-step-up-token': token } }), 'Setup status checked. A pending application is not an active funding account.') })}>Check setup status</button>}
        {!canSetup && wallet.status === 'NOT_STARTED' && <p>Ask your workspace owner to complete company funding setup.</p>}
        {canApprove && wallet.providerReady && wallet.status === 'ACTIVE' && <button className={`${base.btn} ${base.btnGhost}`} disabled={busy} onClick={() => void perform(() => api.post(`${ROOT}/reconcile`), 'Payment-partner records checked. Only confirmed transactions update your balance.')}>Check funding and payments</button>}
      </section>

      {showSetup && canSetup && (wallet.status === 'NOT_STARTED' || wallet.status === 'REJECTED') && <form className={styles.card} onSubmit={(event) => {
        event.preventDefault(); setAction({ title: 'Submit company funding setup', run: (token) => perform(async () => {
          await api.post(`${ROOT}/setup`, form, { headers: { 'x-step-up-token': token } });
          setShowSetup(false); setForm((value) => ({ ...value, registrationNumber: '', companyAddress: '', authorised: false }));
        }, 'Company details saved. Funding remains unavailable until partner verification and account issuance are complete.') });
      }}>
        <h3>Company and authorised representative</h3><p>These details begin your application. The payment partner may require additional secure verification. Do not enter bank passwords, OTPs, BVN or identity documents here.</p>
        <div className={styles.form}>
          {([
            ['legalName', 'Registered company name', 160, 'text'], ['registrationNumber', 'Company registration number', 80, 'text'],
            ['companyAddress', 'Registered company address', 500, 'text'], ['representativeName', 'Representative full name', 160, 'text'],
            ['representativeEmail', 'Representative work email', 200, 'email'], ['representativePhone', 'Representative phone', 30, 'tel'],
            ['representativeRole', 'Representative role in the company', 100, 'text'],
          ] as const).map(([key, label, maxLength, type]) => <label className={base.field} key={key}><span className={base.label}>{label}</span>
            <input className={base.input} type={type} value={form[key]} required minLength={key === 'companyAddress' ? 5 : key === 'representativePhone' ? 7 : 2} maxLength={maxLength} onChange={(event) => setForm((value) => ({ ...value, [key]: event.target.value }))} />
          </label>)}
        </div>
        <label className={styles.consent}><input type="checkbox" required checked={form.authorised} onChange={(event) => setForm((value) => ({ ...value, authorised: event.target.checked }))} /> I am authorised to arrange payroll funding for this company and submit these details for verification.</label>
        <button className={`${base.btn} ${base.btnPrimary}`} type="submit" disabled={busy}>Submit company details</button>
      </form>}

      <div className={styles.balances}>
        {([['Pending deposits', wallet.pendingMinorUnits], ['Available for payroll', wallet.availableMinorUnits], ['Reserved for payroll', wallet.reservedMinorUnits], ['Completed salary payments', wallet.paidMinorUnits]] as const).map(([label, value]) => <div className={styles.card} key={label}><span>{label}</span><strong className={styles.balance}>{amount(value)}</strong></div>)}
      </div>
      <p className={styles.caption}>Pending deposits appear only when reported by the payment partner. Completed salary payments exclude confirmed returned principal. Last checked: {wallet.lastReconciledAt ? new Date(wallet.lastReconciledAt).toLocaleString() : 'Not yet reconciled'}.</p>

      <section className={styles.card} aria-labelledby="funded-payroll-title"><h3 id="funded-payroll-title">Pay your approved payroll</h3>
        <p>Process an approved payroll run to create a payment batch. Approve the batch, then review the net pay, partner fees and funding shortfall before paying.</p>
        {!batches.length ? <p>No payroll payment batches yet.</p> : <div className={styles.tableScroll}><table className={base.table}><caption className="sr-only">Company payroll payment batches</caption><thead><tr><th>Payroll batch</th><th>Status</th><th>Net salaries</th><th>Action</th></tr></thead><tbody>{batches.map((batch) => <tr key={batch.id}>
          <td>{batch.label}<small className={styles.reference}>{batch.reference}</small></td><td>{PAYMENT_BATCH_STATUS_LABEL[batch.status]}</td><td>{formatMinorUnits(batch.totalMinorUnits, batch.currency)}</td><td>
            {canApprove && batch.status === 'DRAFT' && <button className={`${base.btn} ${base.btnGhost}`} disabled={busy} onClick={() => setAction({ title: `Approve ${batch.reference}`, run: (token) => perform(() => api.post(`/payments/batches/${batch.id}/approve`, undefined, { headers: { 'x-step-up-token': token } }), 'Payment batch approved. No money has been sent.') })}>Approve batch</button>}
            {batch.status === 'APPROVED' && <button className={`${base.btn} ${base.btnGhost}`} disabled={busy} onClick={() => void review(batch)}>Review funding</button>}
            {canApprove && (batch.status === 'FAILED' || batch.status === 'PARTIALLY_PAID') && <button className={`${base.btn} ${base.btnGhost}`} disabled={busy} onClick={() => void review(batch, true)}>Review failed payments</button>}
            {batch.status === 'PROCESSING' && <span>Awaiting payment confirmation. Do not resend.</span>}
          </td></tr>)}</tbody></table></div>}
        <Pagination page={batchPage} pages={batchPages} setPage={setBatchPage} />
        {quote && selected && <div className={styles.quote} role="region" aria-label="Payroll funding review"><h4>{selected.retry ? 'Retry confirmed failures only' : 'Payroll funding review'}</h4>
          <dl className={styles.account}><div><dt>Available funds</dt><dd>{amount(quote.availableMinorUnits)}</dd></div><div><dt>Net salaries ({quote.paymentCount})</dt><dd>{amount(quote.netMinorUnits)}</dd></div><div><dt>Partner fees</dt><dd>{amount(quote.feeMinorUnits)}</dd></div><div><dt>Total required</dt><dd>{amount(quote.requiredMinorUnits)}</dd></div><div><dt>Shortfall</dt><dd>{amount(quote.shortfallMinorUnits)}</dd></div></dl>
          <p>{quote.message}</p><button className={`${base.btn} ${base.btnGhost}`} onClick={fundPayroll}>Fund payroll</button>{' '}
          {canApprove && <button className={`${base.btn} ${base.btnPrimary}`} disabled={busy || !quote.canSubmit} onClick={() => setAction({ title: selected.retry ? 'Retry confirmed failed salary payments' : 'Reserve funds and pay payroll', run: (token) => perform(async () => {
            await api.post(`${ROOT}/batches/${selected.id}/${selected.retry ? 'retry' : 'pay'}`, { requestKey: selected.requestKey, expectedRequiredMinorUnits: quote.requiredMinorUnits }, { headers: { 'x-step-up-token': token } });
            setQuote(null); setSelected(null);
          }, 'Payroll payment submission recorded. Funds remain reserved until each payment outcome is confirmed.') })}>{selected.retry ? 'Retry failed salaries' : 'Reserve funds and pay'}</button>}
        </div>}
      </section>

      <section className={styles.card}><h3>Funding and payroll ledger</h3><p>Confirmed money movements and reservations, with references for support. Company setup activity is also recorded.</p>
        {!ledger.length ? <p>No funding activity yet. A balance is never credited from a transfer receipt alone.</p> : <div className={styles.tableScroll}><table className={base.table}><caption className="sr-only">Employer funding ledger</caption><thead><tr><th>Activity</th><th>Status</th><th>Amount</th><th>Reference / payroll run</th><th>Date</th></tr></thead><tbody>{ledger.map((entry) => <tr key={entry.id}><td>{status(entry.type)}</td><td>{status(entry.status)}</td><td>{entry.amountMinorUnits ? amount(entry.amountMinorUnits) : '—'}</td><td className={styles.reference}>{entry.providerReference}{entry.payrollRunId && <small className={styles.reference}>Run: {entry.payrollRunId}</small>}</td><td>{new Date(entry.occurredAt).toLocaleString()}</td></tr>)}</tbody></table></div>}
        <Pagination page={page} pages={pages} setPage={setPage} />
      </section>
      <section className={styles.card}><h3>Salary payment history</h3><p>Each employee payment is tracked independently. Retries keep their own attempt reference; successful and returned transfers are never automatically resent.</p>
        {!history.length ? <p>No employer-funded salary payments yet.</p> : <div className={styles.tableScroll}><table className={base.table}><caption className="sr-only">Employer-funded salary payment attempts</caption><thead><tr><th>Employee</th><th>Amount</th><th>Status</th><th>Attempt / reference</th></tr></thead><tbody>{history.map((payment) => <tr key={payment.reference}><td>{payment.workerName}<small className={styles.reference}>{payment.employeeNumber}</small></td><td>{amount(payment.amountMinorUnits)}</td><td>{status(payment.status)}</td><td className={styles.reference}>Attempt {payment.attemptNumber}<small className={styles.reference}>{payment.reference}</small></td></tr>)}</tbody></table></div>}
        <Pagination page={historyPage} pages={historyPages} setPage={setHistoryPage} />
      </section>
    </>}
    <StepUpDialog open={action !== null} title={action?.title} description="Confirm this company payroll action with your password. The action is audited. Live salary payouts move real money; test mode must never be funded with real money." onCancel={() => setAction(null)} onVerified={async (token) => { const current = action; setAction(null); if (current) await current.run(token); }} />
  </section>;
}

function Pagination({ page, pages, setPage }: { page: number; pages: number; setPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return <div className={styles.pagination}><button className={`${base.btn} ${base.btnGhost}`} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button className={`${base.btn} ${base.btnGhost}`} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>;
}
