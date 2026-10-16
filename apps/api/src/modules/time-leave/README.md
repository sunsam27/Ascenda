# TimeLeave Module

**Bounded context:** time-leave

## PRD Requirements

| ID | Status | Notes |
|---|---|---|
| LVE-01 | ✅ done | Leave types (Annual/Sick/Maternity/Paternity/Compassionate/Study/Unpaid/custom) + balances |
| LVE-03 | ✅ done | Public-holiday calendar (org-wide + per-location), half days, working-day maths |
| LVE-02 | ⏳ next | Request → Manager → HR (optional) approval flow + notifications |
| LVE-04 | ⏳ next | Approver delegation + automatic escalation |
| LVE-05 | ⏳ next | Accrual/carry-over/expiry, team calendar, blackout periods (P1) |
| LVE-06 | ⏳ next | Unpaid leave → payroll deduction/proration |
| ATT-01 | ⏳ next | Attendance: manual entry + clock in/out |
| ATT-02 | ⏳ next | Attendance statuses, configurable workdays/hours/grace/shift/location |

## Interfaces
Modules communicate through explicit interfaces/events — never by accessing another module's tables directly.
`payroll` will read attendance and leave through this module's service interface (LVE-06/ATT-03).

## Layout
- `domain/working-days.ts` — pure working-day maths (weekends + holidays excluded, half days). `LVE-03`
- `domain/leave-balance.ts` — pure entitlement/used/remaining maths. `LVE-01`/`LVE-05`
- `leave-types.controller.ts` / `leave-types.service.ts` — leave-type catalogue API. `LVE-01`
- `holidays.controller.ts` / `holidays.service.ts` — public-holiday calendar API. `LVE-03`

## Notes
- All tenant queries run inside `PrismaService.withRequestContext` (RLS `app.current_org`).
- Read scope is narrowed via `resolveReadScope(tx, 'leave' | 'workers', ...)`.
- Every state change emits an audit event (`LEAVE_*`, `HOLIDAY_CALENDAR_CHANGED`, `ATTENDANCE_RECORDED`).
  The global AuditInterceptor only auto-records `people`/`workers`/`payroll`, so these are recorded explicitly.
- Balances change ONLY on final approval, and are restored if the leave is later cancelled (PRD 12.2).
- Tenant isolation for `holidays` + `leave_types` is asserted by `packages/db/scripts/isolation-test.cjs`.
