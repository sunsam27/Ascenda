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

`WorkerSummary.hasLogin` tells the UI who has an account; `WorkerInviteResult`
reports the outcome (`emailSent` is `false` when SMTP is unconfigured and the link
is logged instead).

## Notes
- All service methods must accept and filter by \organisationId\
- Add a tenant-isolation test for every new endpoint
- Sensitive fields must be classified and encrypted/masked
