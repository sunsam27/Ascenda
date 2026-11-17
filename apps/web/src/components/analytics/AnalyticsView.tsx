'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { isAxiosError } from 'axios';
import { BarChart3, ShieldCheck, Users, UserPlus, UserMinus } from 'lucide-react';
import type { AnalyticsBreakdown, AnalyticsOverview } from '@ascenda/types';
import { api } from '@/lib/api';
import { formatMinorUnits } from '@/lib/money';
import { terminologyOf, useOrganisation } from '@/lib/useOrganisation';
import styles from './analytics.module.css';
import ReportsPanel from './ReportsPanel';

function today() {
  return new Date().toISOString().slice(0, 10);
}
const number = (value: number | null) => (value === null ? 'Hidden' : value.toLocaleString());
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

function Breakdown({
  title,
  rows,
  label = (value) => value,
}: {
  title: string;
  rows: AnalyticsBreakdown[];
  label?: (value: string) => string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <section className={styles.card}>
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className={styles.note}>No workforce in this snapshot.</p>
      ) : (
        <ul className={styles.breakdown}>
          {rows.map((row, i) => (
            <li key={`${row.label}-${i}`}>
              <div className={styles.row}>
                <span>{label(row.label)}</span>
                <strong>{number(row.count)}</strong>
              </div>
              <div className={styles.track} aria-hidden="true">
                <div className={styles.bar} style={{ width: `${(row.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AnalyticsView() {
  const { organisation } = useOrganisation();
  const term = terminologyOf(organisation);
  const [from, setFrom] = useState(() => `${today().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [range, setRange] = useState({ from, to });
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<'overview' | 'reports'>('overview');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(null);
    api
      .get<{ data: AnalyticsOverview }>('/analytics/overview', {
        params: range,
        signal: controller.signal,
      })
      .then((response) => {
        if (!controller.signal.aborted) setData(response.data.data);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          isAxiosError(cause) && cause.response?.status === 403
            ? 'Your role does not have access to analytics.'
            : isAxiosError(cause) && cause.response?.status === 400
              ? 'Choose valid dates spanning no more than 366 days.'
              : 'Analytics could not be loaded. Please try again.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [range, attempt]);

  function apply(event: FormEvent) {
    event.preventDefault();
    setRange({ from, to });
  }

  const categoryLabel = (value: string) => term(value.charAt(0) + value.slice(1).toLowerCase());
  const statusLabel = (value: string) =>
    value
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            <BarChart3 size={16} aria-hidden="true" /> Workforce intelligence
          </p>
          <h1>Analytics</h1>
          <p className={styles.subtitle}>
            A clearer picture of your people, payroll and working patterns.
          </p>
        </div>
      </header>

      <form className={styles.filters} onSubmit={apply}>
        <label>
          From
          <input
            type="date"
            value={from}
            max={to}
            required
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            min={from}
            required
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button type="submit" disabled={loading}>
          Apply dates
        </button>
        <span className={styles.note}>Up to 366 days · inclusive dates</span>
      </form>

      <div className={styles.viewSwitch} role="group" aria-label="Analytics view">
        <button
          type="button"
          aria-pressed={view === 'overview'}
          onClick={() => setView('overview')}
        >
          Overview
        </button>
        <button type="button" aria-pressed={view === 'reports'} onClick={() => setView('reports')}>
          Reports and exports
        </button>
      </div>

      {view === 'reports' ? (
        <ReportsPanel key={`${range.from}-${range.to}`} from={range.from} to={range.to} />
      ) : loading ? (
        <div className={styles.card} role="status">
          Loading analytics…
        </div>
      ) : error ? (
        <div className={styles.card} role="alert">
          <p>{error}</p>
          <button
            className={styles.retry}
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : (
        data && (
          <>
            <div className={styles.context}>
              <span>
                {data.scope === 'team' ? 'Your team, including you' : 'Your organisation'} ·{' '}
                {data.from} – {data.to}
              </span>
              <span>
                <ShieldCheck size={16} aria-hidden="true" /> Sensitive figures hidden below{' '}
                {data.minimumCohort} people
              </span>
            </div>

            <div className={styles.kpis}>
              {[
                { label: 'Workforce at period end', value: data.workforce.headcount, icon: Users },
                { label: 'Joined in period', value: data.workforce.joiners, icon: UserPlus },
                { label: 'Exits in period', value: data.workforce.exits, icon: UserMinus },
              ].map(({ label, value, icon: Icon }) => (
                <section className={`glass ${styles.kpi}`} key={label}>
                  <Icon size={20} aria-hidden="true" />
                  <h2>{label}</h2>
                  <p>{number(value)}</p>
                </section>
              ))}
            </div>

            <div className={styles.grid}>
              <Breakdown
                title="Worker categories"
                rows={data.workforce.categories}
                label={categoryLabel}
              />
              <Breakdown
                title={`By ${term('Department').toLowerCase()}`}
                rows={data.workforce.departments}
              />
              <Breakdown
                title={`By ${term('Location').toLowerCase()}`}
                rows={data.workforce.locations}
              />
              <Breakdown
                title="By current status"
                rows={data.workforce.statuses}
                label={statusLabel}
              />
            </div>

            <div className={styles.twoColumns}>
              <section className={styles.card}>
                <h2>Retention</h2>
                <p className={styles.note}>
                  Workers present at the start of the range who are still present at period end.
                  Open-ended records use current status; historical status changes are not
                  reconstructed.
                </p>
                {data.workforce.retention.suppressed ? (
                  <p className={styles.empty}>
                    Hidden: fewer than {data.minimumCohort} workers were eligible at period start.
                  </p>
                ) : (
                  <dl className={styles.metrics}>
                    <div>
                      <dt>Eligible at start</dt>
                      <dd>{number(data.workforce.retention.eligible)}</dd>
                    </div>
                    <div>
                      <dt>Retained at end</dt>
                      <dd>{number(data.workforce.retention.retained)}</dd>
                    </div>
                    <div>
                      <dt>Retention rate</dt>
                      <dd>{data.workforce.retention.ratePercent}%</dd>
                    </div>
                  </dl>
                )}
              </section>
              <section className={styles.card}>
                <h2>Tenure</h2>
                <p className={styles.note}>
                  Completed months at period end from recorded start and last-working dates.
                </p>
                {data.workforce.tenure.suppressed ? (
                  <p className={styles.empty}>
                    Hidden: fewer than {data.minimumCohort} workers in this snapshot.
                  </p>
                ) : (
                  <>
                    <dl className={styles.metrics}>
                      <div>
                        <dt>Average tenure</dt>
                        <dd>{data.workforce.tenure.averageMonths} months</dd>
                      </div>
                    </dl>
                    <ul className={styles.breakdown}>
                      {data.workforce.tenure.bands.map((row) => {
                        const max = Math.max(1, ...data.workforce.tenure.bands.map((r) => r.count));
                        return (
                          <li key={row.label}>
                            <div className={styles.row}>
                              <span>{row.label}</span>
                              <strong>{number(row.count)}</strong>
                            </div>
                            <div className={styles.track} aria-hidden="true">
                              <div
                                className={styles.bar}
                                style={{ width: `${(row.count / max) * 100}%` }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </section>
            </div>

            <section className={styles.card}>
              <h2>Payroll cost trend</h2>
              <p className={styles.note}>
                Frozen payslips from processed or locked runs, grouped by pay-period end month.
                Reversed originals and reversal runs are excluded. Employer cost is gross pay plus
                employer-side costs—not confirmation of payment.
              </p>
              {!data.payroll ? (
                <p className={styles.empty}>Payroll figures are not available to your role.</p>
              ) : data.payroll.months.length === 0 ? (
                <p className={styles.empty}>No processed payroll in this date range.</p>
              ) : (
                <>
                  <div className={styles.trends}>
                    {[...new Set(data.payroll.months.map((row) => row.currency))].map(
                      (currency) => {
                        const rows = data.payroll!.months.filter(
                          (row) => row.currency === currency,
                        );
                        const max = Math.max(1, ...rows.map((row) => row.totalCostMinorUnits ?? 0));
                        return (
                          <div key={currency}>
                            <h3>{currency} · total employer cost</h3>
                            <ul className={styles.breakdown}>
                              {rows.map((row) => (
                                <li key={row.month}>
                                  <div className={styles.row}>
                                    <span>{monthLabel(row.month)}</span>
                                    <strong>
                                      {row.totalCostMinorUnits === null
                                        ? 'Hidden · small cohort'
                                        : formatMinorUnits(row.totalCostMinorUnits, currency)}
                                    </strong>
                                  </div>
                                  <div className={styles.track} aria-hidden="true">
                                    <div
                                      className={styles.bar}
                                      style={{
                                        width: `${((row.totalCostMinorUnits ?? 0) / max) * 100}%`,
                                      }}
                                    />
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      },
                    )}
                  </div>
                  <div
                    className={styles.tableWrap}
                    tabIndex={0}
                    role="region"
                    aria-label="Scrollable monthly payroll breakdown"
                  >
                    <table>
                      <caption className={styles.note}>
                        Monthly payroll breakdown · amounts shown separately by currency
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Month</th>
                          <th scope="col">Currency</th>
                          <th scope="col">Gross</th>
                          <th scope="col">Deductions</th>
                          <th scope="col">Net</th>
                          <th scope="col">Employer costs</th>
                          <th scope="col">Total cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.payroll.months.map((row) => (
                          <tr key={`${row.month}-${row.currency}`}>
                            <th scope="row">{monthLabel(row.month)}</th>
                            <td>{row.currency}</td>
                            {(
                              [
                                'grossMinorUnits',
                                'deductionsMinorUnits',
                                'netMinorUnits',
                                'employerCostsMinorUnits',
                                'totalCostMinorUnits',
                              ] as const
                            ).map((field) => (
                              <td key={field}>
                                {row[field] === null
                                  ? 'Hidden'
                                  : formatMinorUnits(row[field], row.currency)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>

            <section className={styles.card}>
              <h2>Pay distribution</h2>
              <p className={styles.note}>
                Relative gross-pay bands by pay-period month and currency. Each band compares
                workers with their own cohort average—the average and individual pay are never
                shown. Cohorts below {data.minimumCohort} paid workers are hidden.
              </p>
              {!data.payroll ? (
                <p className={styles.empty}>Payroll figures are not available to your role.</p>
              ) : data.payroll.distribution.length === 0 ? (
                <p className={styles.empty}>No processed payroll in this date range.</p>
              ) : (
                <div className={styles.trends}>
                  {data.payroll.distribution.map((month) => {
                    const max = Math.max(1, ...month.bands.map((band) => band.count));
                    return (
                      <div key={`${month.month}-${month.currency}`}>
                        <h3>
                          {monthLabel(month.month)} · {month.currency}
                        </h3>
                        {month.suppressed ? (
                          <p className={styles.empty}>
                            Hidden: fewer than {data.minimumCohort} paid workers.
                          </p>
                        ) : (
                          <ul className={styles.breakdown}>
                            {month.bands.map((band) => (
                              <li key={band.label}>
                                <div className={styles.row}>
                                  <span>{band.label}</span>
                                  <strong>{number(band.count)}</strong>
                                </div>
                                <div className={styles.track} aria-hidden="true">
                                  <div
                                    className={styles.bar}
                                    style={{ width: `${(band.count / max) * 100}%` }}
                                  />
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <div className={styles.twoColumns}>
              <section className={styles.card}>
                <h2>Recorded attendance</h2>
                <p className={styles.note}>
                  Recorded worker-days only; missing records are not assumed absent. This is not a
                  scheduled-working-day attendance rate.
                </p>
                {!data.attendance ? (
                  <p className={styles.empty}>Attendance figures are not available to your role.</p>
                ) : data.attendance.suppressed ? (
                  <p className={styles.empty}>
                    Hidden: fewer than {data.minimumCohort} people have attendance records.
                  </p>
                ) : (
                  <dl className={styles.metrics}>
                    {[
                      ['All recorded days', data.attendance.records],
                      ['Present', data.attendance.present],
                      ['Remote', data.attendance.remote],
                      ['Late', data.attendance.late],
                      ['Absent', data.attendance.absent],
                    ].map(([label, value]) => (
                      <div key={String(label)}>
                        <dt>{label}</dt>
                        <dd>{number(value as number | null)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
              <section className={styles.card}>
                <h2>Approved leave</h2>
                <p className={styles.note}>
                  Approved requests starting in this date range, including their full booked
                  duration—even when they end outside the range. No leave reasons are included.
                </p>
                {!data.leave ? (
                  <p className={styles.empty}>Leave figures are not available to your role.</p>
                ) : data.leave.suppressed ? (
                  <p className={styles.empty}>
                    Hidden: fewer than {data.minimumCohort} people have approved requests.
                  </p>
                ) : (
                  <>
                    <dl className={styles.metrics}>
                      <div>
                        <dt>Booked leave days</dt>
                        <dd>{number(data.leave.approvedDays)}</dd>
                      </div>
                      <div>
                        <dt>Approved requests</dt>
                        <dd>{number(data.leave.requests)}</dd>
                      </div>
                    </dl>
                    {data.leave.byType.length > 0 && (
                      <>
                        <h3>By leave type</h3>
                        <ul className={styles.breakdown}>
                          {data.leave.byType.map((row) => {
                            const max = Math.max(
                              1,
                              ...data.leave!.byType.map((other) => other.approvedDays ?? 0),
                            );
                            return (
                              <li key={row.label}>
                                <div className={styles.row}>
                                  <span>
                                    {row.label} · {statusLabel(row.category)}
                                  </span>
                                  <strong>
                                    {row.suppressed
                                      ? 'Hidden'
                                      : `${number(row.approvedDays)} days · ${number(row.requests)} requests`}
                                  </strong>
                                </div>
                                <div className={styles.track} aria-hidden="true">
                                  <div
                                    className={styles.bar}
                                    style={{
                                      width: `${((row.approvedDays ?? 0) / max) * 100}%`,
                                    }}
                                  />
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                  </>
                )}
              </section>
            </div>
            <section className={styles.card}>
              <h2>About these numbers</h2>
              <p className={styles.note}>
                Workforce includes non-draft workers who started by the final date and have not yet
                left. Open-ended records must currently be active, on leave or on probation.
                Breakdowns use current category, {term('Department').toLowerCase()} and{' '}
                {term('Location').toLowerCase()} assignments; historical transfers and status
                changes are not reconstructed. Joiners use start dates; exits use recorded end
                dates. Retention and tenure use those recorded dates at the range boundaries;
                open-ended records use current status. Leave types group approved requests by
                their configured type and category without reasons. Pay distribution shows only
                relative bands against each cohort's own average—never individual pay. Future
                dates reflect scheduled records, not forecasts. Blank periods are not estimated.
              </p>
            </section>
          </>
        )
      )}
    </div>
  );
}
