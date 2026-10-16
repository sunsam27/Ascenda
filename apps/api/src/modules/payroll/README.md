# Payroll Module

**Bounded context:** payroll

## PRD Requirements

| ID | Status | Notes |
|---|---|---|
| LVE-06 | ✅ done | Approved unpaid leave prorates base pay (`GET /payroll/preview`) |
| ATT-03 | ✅ done | Attendance absences feed the preview as a separate deduction line |
| PAY-05 | 🚧 partial | Proration for unpaid leave implemented; mid-period joiner/leaver not yet |
| PAY-09 | 🚧 partial | Leave + attendance are pulled into the calculation automatically |
| PAY-01/02/06/10 | ⏳ next | Pay structures, deductions, run state machine, approval + validations |

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
- `payroll.controller.ts` / `payroll.service.ts` — read-only preview endpoint.
- `dto/payroll-preview-query.dto.ts` — period + worker ids.

## Notes
- This pass is a **preview only**: nothing is persisted yet (no `PayrollRun`).
- Money is integer minor units; unpaid leave prorates base, absences are a
  capped-at-gross deduction. Statutory tax/pension and overtime are out of scope.
- The preview route is a GET specifically so it is not picked up by the audit
  interceptor (which treats `POST /payroll` as `PAYROLL_RUN_CREATED`).
- All service methods run tenant-scoped via `PrismaService.withRequestContext`.
