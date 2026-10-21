# Payroll Module

**Bounded context:** payroll

## PRD Requirements

| ID | Status | Notes |
|---|---|---|
| PAY-01 | ✅ done | Pay structure components; gross = sum(components), legacy gross-only rows read as a `BASE` line |
| PAY-02 | ✅ done | Recurring per-worker deductions (FIXED / PERCENTAGE bps), allow-listed types |
| PAY-03 | ✅ done | Recurring employer costs (e.g. employer pension) as percentages of gross |
| PAY-04 | ✅ done | Pay calendars: frequency config, period maths for a year, cut-off day, CRUD + audit |
| LVE-06 | ✅ done | Approved unpaid leave prorates base pay (`GET /payroll/preview`) |
| ATT-03 | ✅ done | Attendance absences feed the preview as a separate deduction line |
| PAY-05 | ✅ done | Proration for unpaid leave + mid-period joiner/leaver clipping; absence deductions; per-component integer maths |
| PAY-06 | ✅ done | One-way lifecycle; approved runs immutable; reversal via a mirrored DRAFT with negated lines + `reversedAt` stamp |
| PAY-07 | ✅ done | prepare → review → override → submit → approve → process (`Payment` rows) → lock |
| PAY-08 | ✅ done | Eligibility (ACTIVE/ON_LEAVE, in-period); ineligible workers excluded + flagged; missing bank/salary block submission |
| PAY-09 | ✅ done | Item overrides require a reason and are audit-logged (`PAYROLL_ITEM_OVERRIDDEN`) |
| PAY-10 | ✅ done | Configurable thresholds (salary-change %, deduction ratio bps, bank requirement); warnings ack-gated before approval |
| PAY-11 | ✅ done | Configurable approval chain snapshotted on submit; preparer can never approve; OWNER overrides any step |
| LOC-02 | ✅ done | Statutory rule packs are organisation-configured DATA (rules-as-data), effective-dated, never invented here |
| LOC-03 | ✅ done | Packs are flagged "not validated by a professional" until an admin marks them validated; edits clear the flag |
| PAY-12 | 🟡 partial | Statutory rule-pack engine (M3a) + bank-upload payment file export (M3c) done; multi-currency/FX (PAY-15) deferred |
| PAY-13 | ✅ done | Immutable per-worker payslip generated at `process`, private PDF download, self-service scoped + audited (M3b) |
| PAY-14 | ✅ done | Reimbursements: submit → manager → finance → folded into the next run as a `REIMBURSEMENT` earning (M3d) |

Deferred beyond M3 (P1/P2): PAY-15 multi-currency + FX, PAY-16 year-end
statements / remittance schedules, PAY-17 automated bank payments / loans /
benefits.

## Interfaces
Modules communicate through explicit interfaces — never by accessing another
module's tables directly. The payroll preview reads:
- `CompensationService.getCurrentForPayroll` (People) for the effective rate.
- `LeaveRequestsService.leaveForPayroll` (Time & Leave) for period working days
  and approved unpaid-leave days (spans clipped to the period).
- `AttendanceService.absenceDaysInPeriod` (Time & Leave) for absence days.

## Layout
- `domain/payroll.ts` — pure proration + absence-deduction maths (integer minor
  units). `LVE-06`/`ATT-03`
- `domain/run-state.ts` — run lifecycle guard table (`runActionError`,
  `canPerformRunAction`, `isRunImmutable`, `isInApprovalChain`). `PAY-06`/`PAY-11`
- `domain/run-calc.ts` — per-worker prepare maths (`prepareWorker`, `runTotals`,
  `foldWorkerLines`, `reverseLines`, `componentItemType`). `PAY-05`
- `domain/run-validation.ts` — pre-approval validation report
  (`validateRun`, defaults). `PAY-08`/`PAY-10`
- `domain/statutory.ts` — pure statutory engine: effective-dated rule packs,
  FLAT / PERCENT_CAPPED (floor/cap) / PERCENT_BANDS amount resolution, employee
  lines vs employer costs, structural rule/pack validation. `LOC-02`/`LOC-03`/
  `PAY-12`
- `domain/payslip-pdf.ts` — payslip PDF renderer (pdfkit → `Buffer`). `PAY-13`
- `statutory-rule-packs.controller.ts` / `statutory-rule-packs.service.ts` —
  rule-pack CRUD + `PATCH :id/validation`; `activePackFor` resolves the
  effective pack applied at `process`/`prepare`. `LOC-02`/`LOC-03`/`PAY-12`
- `payslips.controller.ts` / `payslips.service.ts` — list/get/download
  (`GET :id/pdf`) + `generateForRun` (idempotent freeze from run item lines at
  `process`); SELF vs ORG scoping. `PAY-13`
- `expense-claims.controller.ts` / `expense-claims.service.ts` — reimbursement
  workflow (manager then finance decisions, separation of duties) +
  `consumeApprovedForRun`, which folds finance-approved claims into the next run.
  `PAY-14`
- `payroll-runs.controller.ts` / `payroll-runs.service.ts` — run lifecycle:
  prepare/review/override/submit/approve/reject/process/lock/reverse.
  `PAY-05`…`PAY-11`
- `payroll-config.controller.ts` / `payroll-config.service.ts` — per-org approval
  chain + validation thresholds. `PAY-10`/`PAY-11`
- `../payments/payments.controller.ts` / `payments.service.ts` — payment listing
  + status transitions (`PAYMENT_TRANSITIONS`) + bank-upload CSV export
  (`GET /payments/export`, `domain/payment-export.ts`). `PAY-07`/`PAY-12`
- `domain/pay-calendar.ts` — pure calendar config validation + period maths
  (`payPeriodsForYear`, cut-off state). `PAY-04`
- `domain/recurring-pay-item.ts` — pure validation + amount resolution for
  FIXED/PERCENTAGE items (bps rounding half-up). `PAY-02`/`PAY-03`
- `payroll.controller.ts` / `payroll.service.ts` — read-only preview endpoint.
- `pay-calendars.controller.ts` / `pay-calendars.service.ts` — pay calendar
  CRUD + `GET /payroll/pay-calendars/:id/periods?year=`. `PAY-04`
- `recurring-pay-items.controller.ts` / `recurring-pay-items.service.ts` —
  recurring deduction/employer-cost CRUD + list filters. `PAY-02`/`PAY-03`
- `dto/payroll-preview-query.dto.ts` — period + worker ids.
- `dto/pay-calendar.dto.ts` / `dto/recurring-pay-item.dto.ts` — write/query DTOs.
- `dto/statutory-rule-pack.dto.ts` / `dto/payslip.dto.ts` /
  `dto/expense-claim.dto.ts` — M3 write/query DTOs.

Pay-structure component maths live with People:
- `../people/domain/pay-structure.ts` — component validation, sum invariant,
  legacy `BASE` normalisation. `PAY-01`

## Notes
- The preview route is a GET specifically so it is not picked up by the audit
  interceptor; the interceptor only maps `POST /payroll/runs` to
  `PAYROLL_RUN_CREATED` — calendar and recurring-item writes are audited
  explicitly by their services (`PAY_CALENDAR_CHANGED`,
  `RECURRING_PAY_ITEM_CHANGED`).
- Pay-calendar conventions are documented product decisions, not statutory
  rules: monthly paid the following month on `dayOfMonth`, quarterly = calendar
  quarters, weekly/biweekly paid one full cycle after close. Statutory rates
  are organisation-configured data — never invented here (CLAUDE.md).
- Recurring-item amounts are stored positive; the run engine (M2) applies
  signs. `PERCENTAGE` is basis points of the period gross, rounded half-up.
- All service methods run tenant-scoped via `PrismaService.withRequestContext`.
- E2E: `node --env-file=packages\db\.env apps\api\test\e2e\phase3-m1-pay-setup.cjs`
  (46 checks over PAY-01..PAY-04 + audit + auth guard).
- E2E: `node --env-file=packages\db\.env apps\api\test\e2e\phase3-m2-payroll-runs.cjs`
  (54 checks over PAY-05..PAY-11: prepare/validate/override/submit/approve/
  process/lock/reverse, warnings ack flow, multi-step chain, guards + audits).
- E2E: `node --env-file=packages\db\.env apps\api\test\e2e\phase3-m3-statutory-payslips.cjs`
  (37 checks over M3a..M3d: rule-pack CRUD/validation/effectivity, statutory
  lines applied at `prepare`, payslip generation + PDF at `process`, payment
  CSV export, reimbursement approval flow, self-service scoping, audits + auth).

## M3 boundaries (documented product decisions)
- Statutory rule packs start **empty** — admins author them; the code never
  invents country rates (CLAUDE.md). A pack applied by a run is flagged as not
  yet "validated by a professional" until an admin marks it.
- Employee statutory lines become `payroll_item` deduction lines; employer-side
  statutory costs are **not** persisted as item lines (they would corrupt the
  `foldWorkerLines` net maths) — they are recomputed at `process` and stored on
  the payslip's `employerCostsMinorUnits`.
- The payment-export CSV contains a **masked** account number only; raw account
  numbers are envelope-encrypted at rest and are never decrypted by API code.
- Payslips are immutable once generated (idempotent `generateForRun`); a
  regenerated run's payslips are re-created from the run's frozen lines.
- PDF rendering uses `pdfkit` (added in M3).
