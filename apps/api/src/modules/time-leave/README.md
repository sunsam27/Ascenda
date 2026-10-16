# TimeLeave Module

**Bounded context:** time-leave

## PRD Requirements

| ID | Status | Notes |
|---|---|---|
| LVE-01 | ✅ done | Leave types (Annual/Sick/Maternity/Paternity/Compassionate/Study/Unpaid/custom) + balances |
| LVE-03 | ✅ done | Public-holiday calendar (org-wide + per-location), half days, working-day maths |
| LVE-02 | ✅ done | Request → Manager → HR (optional) approval flow. HTTP acceptance verified: balance moves only on final approval, restored on cancel. |
| LVE-04 | ✅ done | Approver delegation + automatic escalation (default 48h; scheduled/manual `POST /leave-requests/escalations/run`) |
| LVE-05 | ✅ done | Team calendar (`GET /leave-requests/calendar`); accrual/carry-over/expiry (`POST /leave-balances/accrual/run`); blackout periods (`/blackout-periods`, enforced on request create with org-wide override). |
| LVE-06 | ✅ done | Approved unpaid leave → payroll proration via `LeaveRequestsService.leaveForPayroll` (consumed by `GET /payroll/preview`) |
| ATT-01 | ✅ done | Attendance: manual entry (manager/HR) + employee clock in/out; single clock pair per day |
| ATT-02 | ✅ done | Statuses (Present/Absent/Late/Remote/On Leave/Half Day/Off Day) + configurable workdays/start/end/grace with per-location overrides. `shift` deferred (no schema). |

## Interfaces
Modules communicate through explicit interfaces/events — never by accessing another module's tables directly.
`payroll` reads attendance and leave through this module's service interface (LVE-06/ATT-03): `leaveForPayroll` and `absenceDaysInPeriod`.

## Layout
- `domain/working-days.ts` — pure working-day maths (weekends + holidays excluded, half days). `LVE-03`
- `domain/leave-balance.ts` — pure entitlement/used/remaining maths. `LVE-01`/`LVE-05`
- `domain/approval.ts` — pure approval-plan + escalation maths. `LVE-02`/`LVE-04`
- `domain/attendance.ts` — pure schedule/status/hours maths (late, grace, hours worked). `ATT-01`/`ATT-02`
- `domain/leave-calendar.ts` — pure span→day-bucket expansion for the team calendar. `LVE-05`
- `domain/leave-accrual.ts` — pure accrual (upfront/monthly/pro-rata) + carry-over/expiry maths. `LVE-05`
- `domain/blackout.ts` — pure blackout-window overlap matching (recurring + one-off). `LVE-05`
- `leave-types.controller.ts` / `leave-types.service.ts` — leave-type catalogue API. `LVE-01`
- `holidays.controller.ts` / `holidays.service.ts` — public-holiday calendar API. `LVE-03`
- `blackout-periods.controller.ts` / `blackout-periods.service.ts` — blackout-window CRUD. `LVE-05`
- `leave-balances.controller.ts` / `leave-balances.service.ts` — balance list/adjust; auto-provisions default entitlements when a specific worker is requested. `LVE-01`
- `leave-requests.controller.ts` / `leave-requests.service.ts` — request + approval workflow (create/submit/decide/delegate/cancel/escalate). `LVE-02`/`LVE-04`
- `leave-balance-ops.ts` — shared balance-mutation helpers used by both services (`ensureBalance`/`applyApprovedLeave`/`reverseApprovedLeave`).
- `attendance.controller.ts` / `attendance.service.ts` — clock in/out, manual entry, list/get/update/delete, and the effective work schedule (`GET /attendance/schedule`). `ATT-01`/`ATT-02`

## Notes
- All tenant queries run inside `PrismaService.withRequestContext` (RLS `app.current_org`).
- Read scope is narrowed via `resolveReadScope(tx, 'leave' | 'workers', ...)`.
- Every state change emits an audit event (`LEAVE_*`, `HOLIDAY_CALENDAR_CHANGED`, `ATTENDANCE_RECORDED`).
  The global AuditInterceptor only auto-records `people`/`workers`/`payroll`, so these are recorded explicitly.
- Balances change ONLY on final approval, and are restored if the leave is later cancelled (PRD 12.2).
- Tenant isolation for `holidays` + `leave_types` is asserted by `packages/db/scripts/isolation-test.cjs`.
