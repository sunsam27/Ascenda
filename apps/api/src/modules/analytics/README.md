# Analytics overview and standard reports — ANA-01–04 (initial slice)

`GET /api/v1/analytics/overview?from=YYYY-MM-DD&to=YYYY-MM-DD` powers `/analytics`.
Dates are inclusive UTC civil dates, limited to 366 days. Defaults: January 1
through today (or January 1 of the supplied end date's year). Responses use
`{ data: AnalyticsOverview }` and `Cache-Control: private, no-store`.
No new dependency, schema change, permission grant, payroll calculation or
payment operation is introduced.

## Metrics and boundaries

- **Workforce:** non-draft workers starting by the final date, whose recorded last
  working day is on/after that date. Open-ended records must currently be ACTIVE,
  ON_LEAVE or PROBATION. Includes every supported worker category. A worker is still
  included on their last working day. Joiners/exits use start/end dates in range.
  Category, department, location and status breakdowns use current assignments;
  historical transfers/status histories cannot be reconstructed from the present
  schema. Period-end tenure bands and completed-month averages use recorded start
  and last-working dates. Retention counts workers in the period-start snapshot
  who remain in the period-end snapshot; open-ended records use current status.
  Tenure and retention rates are suppressed below five workers. Approved leave days
  and explicit unapproved `ABSENT` days are grouped by the worker's **current**
  department; the same current-assignment caveat applies. Future dates reflect
  scheduled records, not forecasts.
- **Payroll:** sum frozen payslips on PROCESSED/LOCKED runs, using payslip period-end
  dates. Excludes reversed originals and reversal runs to avoid double-counting
  corrected payroll. Months and currencies remain separate; there is no FX or
  cross-currency total. Total employer cost = gross + employer costs. Amounts remain
  checked integer minor units. This is payroll cost, **not cash paid**. No records
  in a month means no reported bucket, not an estimated zero. An unreplaced reversal
  removes its original from this restated-cost view; this is not a historical
  cash-ledger report. Relative gross-pay bands are grouped by pay-period month and
  currency against that cohort's own average; the average and individual pay are
  never exposed in the distribution report and cohorts below five paid workers are
  hidden. Gross and employer costs are also grouped by current department. Overtime,
  bonus, allowance, volunteer-stipend and contractor costs come from frozen payslip
  lines and worker category. Average salary is employee gross ÷ paid employees and
  is released only for cohorts of at least five paid employees; contractor and
  volunteer-stipend buckets have their own five-contributor thresholds.
- **Attendance:** recorded worker-days, with PRESENT, REMOTE, LATE and ABSENT counts.
  All-records also includes other statuses (e.g. half-day/off-day/on-leave). Missing
  records are not assumed absent in those raw counts. The separate scheduled rate
  uses the effective org/location work schedule, public holidays, recorded
  employment dates and approved leave as its denominator. PRESENT, LATE, REMOTE and
  HALF_DAY records count as attended; unrecorded scheduled days count as not
  attended. Approved leave is removed from the denominator (half-day markers count
  as 0.5), overlapping leave never removes more than a day, and leavers/joiners are
  prorated by their recorded dates. Only an explicit `ABSENT` record on a scheduled
  day counts as unapproved absence; unrecorded days are simply not attended. The
  late-arrival rate is late clock-ins ÷ total clock-ins. Scheduled metrics are also
  grouped by current department as the team proxy (the schema has no Team/Roster
  entity) and into monthly trend buckets. Cohorts below five workers are suppressed
  per team/month.
- **Leave:** currently approved requests **starting** in range and their full,
  stored booked-day duration, even when the request ends outside the selected
  range. This is not leave consumed within the window; durations are not recomputed
  using today's holidays/schedule. Breakdowns by leave type/category are grouped
  from the frozen booked days; no reasons or medical details are selected and
  types with fewer than five contributing workers are hidden.

This no-schema slice completes the ANA-01–03 gaps identified for existing dated
facts, payslip lines and current assignments. It is still not the full acceptance
criteria: true historical status/department/location trends and hire/exit trend
series need an effective-dated worker-history ledger. Period-average-headcount
turnover and its employee/volunteer split are also outside this slice. Team analytics
use current department instead of a real Team entity. Native Excel exports from
ANA-04 and P1/P2 analytics remain deferred. CSV/PDF reports are described below;
those report types are unchanged by this slice.

## Standard reports and downloads (ANA-04)

The **Reports and exports** view on `/analytics` uses the applied date range.
No dependency, permission grant, database migration or payroll calculation was added.

| Endpoint | Purpose |
| --- | --- |
| `GET /analytics/reports/catalogue` | Report definitions visible to the current role, export capability and row limit |
| `GET /analytics/reports?type=...&from=...&to=...&page=1&pageSize=25` | Paginated preview; page size 1–100 |
| `GET /analytics/reports/export?type=...&from=...&to=...&format=csv` | Entire report as CSV or PDF; no pagination parameters accepted |

Paths use the configured `/api/v1` prefix. Types:

- `employee`: period-end workforce directory across all categories, using the
  same snapshot definition as the overview. The start filter does not exclude
  existing workers who joined earlier. Columns: worker number, name, category,
  current status/job title/department/location and employment dates. No email,
  phone, IDs, bank, pay, medical fields or worker database IDs are selected.
  Requires existing worker read access and intersects worker + analytics scopes.
- `department`: period-end workforce headcount by current department.
- `payroll`: monthly gross, deductions and net by currency, with the overview's
  processed/locked-run, reversal and distinct-worker suppression rules.
- `workforce-cost`: monthly gross, employer-side costs and total cost by currency,
  using the same frozen payroll source and restrictions. Not a cash-payment report.
- `attendance` and `leave`: aggregate summary rows with the overview's precise
  recorded-day/booked-request definitions, underlying permissions and suppression.
  Attendance also includes the scheduled-working-day rate. These are not per-person
  attendance/leave exports.
- `retention` and `tenure`: period-start/period-end retention and completed-tenure
  summaries from the overview. Rates are suppressed below five workers. Historical
  transfers and status changes are not reconstructed.
- `leave-types`: approved requests starting in the range, grouped by leave type and
  category using frozen booked days. No reasons or medical details; types with fewer
  than five contributing workers are hidden.
- `pay-distribution`: relative gross-pay band counts by pay-period month and currency
  from frozen processed/locked payslips. Cohort averages and individual pay are never
  shown; cohorts below five paid workers are hidden. Requires step-up to export.

Report catalogue, preview and export are all checked server-side. Missing context
fails closed. Managers see only themselves/direct reports; unlinked managers get
no rows. HR and payroll/finance roles only preview their underlying permitted data.
**Only Owners download**, retaining the existing analytics export grant. Other roles
(including Auditors) do not gain export access. Payroll/pay-distribution/workforce-cost
exports also require a fresh existing `x-step-up-token` (password/MFA flow), bound by the existing
step-up guard to the authenticated user and organisation. The report UI reuses that
flow. No report can bypass payroll suppression via another export format.

Every successful file preparation records `EXPORT_CREATED` with actor, organisation,
report, format, dates, scope, timestamp and exact data-row count. No pay amounts,
person names or export contents enter the audit metadata. Audit write failure
prevents the download; payroll read auditing remains unchanged. Audit records mean
the server prepared the file, not proof that the browser saved it.

Files are private/no-store attachments, never public URLs. CSV uses UTF-8 BOM,
RFC-4180 quoting/CRLF, spreadsheet formula neutralisation for untrusted text and
exact two-decimal money formatting from integer minor units. Metadata (including
report definition, dates, scope, organisation, exporter and timestamp) accompanies
each row. An empty CSV contains a `no_data` metadata row, not a fabricated workforce
record. PDF uses the existing PDFKit renderer/fonts, labelled records across pages,
and an organisation/exporter/time/page watermark on every page. Native `.xlsx` is
explicitly deferred; CSV is not disguised as an Excel workbook.

Synchronous exports are capped at **5,000 data rows**; oversized or detectably
changing results fail instead of silently truncating to a preview page. No offline
or asynchronous export API is included; larger exports require separate reviewed
work. Definitions, currency separation and hidden values are consistent across
preview, CSV and PDF. Historical assignments and revised/reversed data retain the
overview limitations above. Pagination is live, not a persisted report snapshot.

## Access and privacy

- Existing `analytics:read:team` guard admits managers and organisation analytics
  readers. Existing global JWT authentication is unchanged.
- `resolveReadScope` limits managers to themselves and direct reports. An unlinked
  manager sees no data. All source reads run through an RLS transaction and explicit
  organisation predicates. Time/leave additionally intersect the corresponding
  resource scope; if it is absent the section is `null` and never queried.
- Payroll requires organisation-wide analytics, payroll, compensation **and** payslip
  read permissions. Support is explicitly excluded; HR, Viewer and Manager receive
  `payroll: null`. The permission matrix is not changed. Access is audited with
  `RESTRICTED_FIELD_ACCESSED`, report/date metadata only—never salary values.
- Each payroll month/currency requires at least five distinct paid workers (not
  five payslips). Smaller cohorts return `null` for every monetary field and
  `suppressed: true`. Department, team, month and leave-type buckets are suppressed
  independently at the same five-distinct-worker threshold. Where a hidden child
  bucket could be recovered by subtraction, the matching overall figure is hidden
  too: monthly payroll totals disappear for a month/currency with a hidden
  department; the overall scheduled rate disappears when a team or month is hidden;
  and overall leave totals/types disappear when a department or type is hidden.
  Component amounts and average salary are released only when their own contributor
  cohorts reach five; the pay-distribution report still never exposes the cohort
  average. Attendance and leave suppress recorded counts when their non-empty
  contributor cohort is smaller than five; the scheduled rate also suppresses empty
  or sub-five scheduled cohorts. Other empty aggregates return zero, not hidden.
- Overview and aggregate reports contain counts only, with no worker identifiers,
  names, bank details or restricted personal fields. The separately authorised
  directory report intentionally includes the worker numbers/names listed above.
- People, Payroll and Time/Leave expose dedicated read-only reader interfaces
  through their owning modules. Analytics composes these without reading their
  tables directly. The response contract is `packages/types/src/analytics.ts`.

## Verification

```powershell
pnpm --filter @ascenda/types build
pnpm --filter @ascenda/api exec jest --runInBand
pnpm --filter @ascenda/api type-check
pnpm --filter @ascenda/web type-check
# Reviewed, migrated staging only; synthetic fixtures always roll back:
node --env-file=packages/db/.env apps/api/test/e2e/analytics-rls.cjs
```

Domain and HTTP tests exercise real DTO validation, guards, services and readers
with identity/database doubles. They cover role/field boundaries, team scope,
explicit tenant filters, missing context, small cohorts, integer totals, date
boundaries, retention/tenure, leave-type, pay-distribution and scheduled-attendance
suppression, and run exclusions. The expanded ANA-01–03 tests cover department
leave/absence and payroll cost, pay components and average salary, late-arrival and
absence rates, department-as-team grouping and monthly attendance trends, including
per-bucket suppression and hidden-parent totals. Scheduled-rate tests cover work
schedules, public holidays, employment bounds, approved leave (including half days)
and record statuses.
ANA-04 tests additionally cover all ten report types,
preview pagination, role-specific catalogue, Owner-only exports, step-up expiration/
user/tenant binding, CSV formula/quoting safety, exact money, full-report export,
PDF page generation, privacy suppression, row limits, changing datasets and
fail-closed export auditing. The separate PostgreSQL script tests source-table
aggregate isolation as `ascenda_app`; it needs a privileged staging connection able
to SET ROLE and at least two organisations/one user. It does not contact providers,
send email, or commit fixtures. Do not run against an unreviewed production DB.
Real PostgreSQL execution, query performance/load and responsive/browser acceptance
remain staging release gates; local HTTP tests do not prove deployed RLS or UI.
