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
| PAY-05 | 🚧 partial | Proration for unpaid leave implemented; mid-period joiner/leaver not yet |
| PAY-09 | 🚧 partial | Leave + attendance are pulled into the calculation automatically |
| PAY-06/07/08/10/11/12 | ⏳ next | Payroll runs, calculation, approvals, payslips, payments (Phase 3 M2+) |

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
