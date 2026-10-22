# People Module

**Bounded context:** people

## PRD Requirements
TODO: Link to PRD sections for this module (e.g. ORG-01, PPL-01 )

## Interfaces
Modules must communicate through explicit interfaces/events  never by accessing another module's tables directly.

## Workspace invitations

`POST /workers/:id/invite` (permission `workers:update @ ORGANISATION`) turns a
directory record into a self-service user. It:

- resolves the login role from the worker category (`VOLUNTEER` → `VOLUNTEER_SELF`,
  otherwise `EMPLOYEE_SELF`);
- creates (or reuses) the platform user and workspace membership;
- supersedes any outstanding invitation for the address and issues a single-use
  7-day token (`POST /auth/set-password` consumes it);
- emails the set-password link (`WEB_APP_URL`) and links `worker.userId` so leave,
  attendance and documents resolve to the same profile.

`WorkerSummary.inviteStatus` tells the UI where a worker is in onboarding:
`NONE` (never invited), `PENDING` (invited, has not set a password yet) or
`ACCEPTED` (active login). `hasLogin` is a convenience derived from it
(`inviteStatus !== NONE`). The directory shows **Invite** for `NONE` workers and
**Resend invite** for `PENDING` ones.

`POST /workers/:id/invite/resend` (same `workers:update @ ORGANISATION`
permission) re-sends an invitation, superseding the previous link. It shares the
`invite()` implementation with the first invite, so a resend invalidates the old
token and issues a fresh 7-day one. `WorkerInviteResult` reports the outcome
(`emailSent` is `false` when SMTP is unconfigured and the link is logged
instead).

## Bank details & employee self-service

Bank accounts are entered by the employee (self-service) and corrected by the org
payroll admin before a pay run. The `BankAccount` table stores the number
encrypted at rest (AES-256-GCM, `BankAccount.accountNumberEncrypted`) and only
ever exposes the masked form (`****1234`) on reads, exports and the audit trail.

Endpoints (`apps/api/src/modules/people/bank-accounts.controller.ts`):

- `GET  /workers/:workerId/bank-accounts` — list (masked)
- `GET  /workers/:workerId/bank-accounts/primary` — primary account (masked)
- `POST /workers/:workerId/bank-accounts` — add (encrypt + audit)
- `PATCH /workers/:workerId/bank-accounts/:id` — update (re-encrypt + audit)
- `DELETE /workers/:workerId/bank-accounts/:id` — remove
- `GET  /bank-accounts/banks` — static NG bank list for the picker
- `POST /bank-accounts/detect` — best-effort bank detection from a 10-digit NUBAN

All worker-scoped routes require `bank_accounts:<action> @ SELF`, which the RBAC
scope rank lets a broader ORGANISATION grant satisfy. The service then narrows to
the caller's own worker when their effective scope is SELF, so an employee can
only read/write their own account. Grants: OWNER and PAYROLL_ADMINISTRATOR get
`read/create/update @ ORGANISATION`; EMPLOYEE_SELF and VOLUNTEER_SELF get
`read/create/update @ SELF`.

**Bank detection** (`domain/bank-detect.ts`) uses a conservative NUBAN prefix
table. When the bank cannot be inferred the API returns `400` and the UI must
present the dropdown; an explicit `bankName`/`bankCode` always wins. Verification
(`isVerified`) is org-only — a self caller's attempt to set it is ignored.

**Employee workspace.** `GET /workers/me` (`workers:read @ SELF`) returns the
signed-in employee's own `WorkerSummary` (the record the organisation entered)
so the self-service dashboard can display it read-only. Sign-in and
set-password now route self roles to the `/me` workspace
(`homePathForRole()` in `identity-access.service.ts`) rather than `/dashboard`.

Coverage: `apps/api/test/e2e/phase3-bank-self-service.cjs` (33 checks) plus unit
specs for `domain/bank-crypto.ts` and `domain/bank-detect.ts`.

## Notes
- All service methods must accept and filter by \organisationId\
- Add a tenant-isolation test for every new endpoint
- Sensitive fields must be classified and encrypted/masked
