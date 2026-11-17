# Ascenda Admin Console and plan price notices

## Console boundary

Platform administrators use `/admin`, with dedicated navigation/layout for Plans,
Signups and catalogue Change history. Customer Settings no longer advertises platform
controls. Old `/settings/plans` and `/settings/signups` URLs redirect to their `/admin`
equivalents. Unauthenticated users go to normal login with an Admin-specific heading;
platform staff default to `/admin` after login. Customer organisation ownership is
**not** platform administration. Accounts are not promoted by this implementation.

`GET /api/v1/admin/session` checks current database `isPlatformAdmin` and `isActive`,
not only the JWT flag. Existing plan-admin and signup endpoints use the same freshly
checked guard. Customer APIs, memberships and payroll grants are unchanged. Catalogue
create/update/archive also require the existing five-minute password/MFA step-up token.
Public `GET /plans` remains available for signup. The Admin shell never mounts its
data panels until its server access check succeeds; API guards remain authoritative.

## Pricing policy (approved)

- Changes apply to **future checkouts only**. No proration, automatic charge,
  payment-provider plan edit or historical transaction change is introduced. Manual
  renewal reminders and a manual renewal checkout are available, but nothing is
  debited without the Owner explicitly starting and completing a hosted payment.
  A subscription's displayed catalogue plan may reflect the new price; that is not
  a change to its already-paid period.
- A real change to price, currency or billing period creates a price notice. Identical
  saves and description/feature/limit-only edits do not send price notices. Creating
  or archiving a plan is audited but does not send a price-change email.
- The affected-organisation audience is snapshotted inside the price-edit transaction:
  active organisations on that plan with ACTIVE or PAST_DUE subscriptions. Pending,
  cancelled and expired subscriptions are excluded. There is no platform-wide blast.
- Active Owners of those organisations are selected during fan-out and checked
  again before sending. Current email addresses are used. Inactive organisations,
  removed/demoted owners or inactive users are skipped. Ownerless/inactive fan-out
  organisations are counted in Admin history for operator follow-up; new Owners
  are not retroactively added after that organisation's fan-out finishes.
- Every email contains the snapshotted plan name, old/new exact price, currency,
  billing period, change date and the future-checkout/no-automatic-charge policy.
  User-provided strings are escaped by the existing mail template.

## Atomic audit/outbox and delivery

Plan mutation and `platform_plan_events` audit/outbox insertion share a transaction.
Infrequent catalogue mutations take a transaction advisory lock so two changes cannot
compare against the same stale price or both remove the last free tier. If the outbox
cannot be written, the edit rolls back. Missing migration returns a specific 503,
not a saved price with lost notifications. Platform audit payloads/audiences are
immutable. `GET /admin/plan-events` is platform-only and paginated (maximum 100).

The narrow SECURITY DEFINER `plan_price_notice_audience(plan_id)` verifies the current
database actor is an active platform admin and returns **only affected organisation
IDs** across RLS. It uses fixed SQL/search_path and fails if its owner cannot perform
the intended RLS-independent audience lookup. No tenant payroll/bank/worker data is
read through this function. Its permission and source are in migration 04.

`SCHEDULER_ENABLED=true` runs fan-out/delivery each minute using existing in-process
jobs, not a new dependency. Each pass fans out at most five events and fifty
organisations/event; each tenant pass claims at most ten messages. The existing
privileged scheduler client only orchestrates global event metadata/organisation IDs.
Tenant recipient reads and email intents always use transaction-local RLS context.
Unique (event, organisation, recipient) keys make repeated fan-out safe. The queue's
composite membership FK and immutable matching event/audience/payload prevent cross-
tenant recipient links and forged event content.

Claims use `FOR UPDATE SKIP LOCKED`, a fresh token and a fifteen-minute recoverable
lease. Network I/O happens after the claiming transaction. Only an SMTP-accepted
message becomes SENT; absent SMTP/errors remain PENDING with exponential backoff
(capped at six hours). Revoked recipients become SKIPPED. Completion requires the
matching claim token; stale workers cannot overwrite a newer attempt. Intents are
ordered per plan/recipient: an unfinished earlier audience is prepared before later
changes on that plan, and a pending/retrying older notice blocks a newer one for
that recipient. Inbox arrival order still depends on the mail provider. Intents are
not deleted or overwritten with new prices. A stable per-intent Message-ID helps
identify duplicates. Delivery is **at-least-once**, not exactly-once: a crash after
SMTP acceptance but before acknowledgement can resend, and SMTP handoff does not
prove inbox delivery. No recipient/message/SMTP secrets are included in new error logs.

Run one active scheduler for this initial release. Monitoring, provider delivery
receipts, automatic bounces, large-scale throughput and operator retry tooling are
follow-up work. Admin history shows fan-out preparation/skips, **not** inbox delivery.

## Free tier, organisation access and manual renewals

`SUBSCRIPTION_ACCESS_ENABLED=false` preserves legacy behaviour. After migration 05 is
reviewed and policies are checked in `/admin/plans` and `/admin/subscriptions`, set
`SUBSCRIPTION_ACCESS_ENABLED=true` to enforce them in the API. Platform-admin changes
require the same step-up token; reasons and prior/next values are audited.

Migration 05 adds per-plan feature policies and per-organisation controls. Free
plans default to People, Time and leave and Documents, with Payroll, Payments and
Analytics off. A new free signup may receive a finite automatic trial of selected
premium features; existing organisations are never silently given a trial. Admin can
grant one organisation selected features for a fixed number of days, activate its
current plan temporarily, suspend new activity, resume normal plan rules, or extend a
paid expiry. Finite grants revert at their exact stored timestamp; suspension is
never cleared automatically by time.

`SubscriptionFeatureGuard` enforces the resolved entitlement server-side on People,
Time and leave, Documents, Payroll, Payments and Analytics routes. Role/RBAC checks
still apply and cannot be widened by a demo grant. Historical personal payslips,
year-end statements and existing report exports remain readable under their normal
permissions so payroll data is not destroyed when access expires. The dashboard
redacts organisation-wide payroll KPIs when the payroll entitlement is absent.

With both scheduler and access flags enabled, hourly jobs send 14/7/1-day renewal
notices to active Owners, mark elapsed periods `PAST_DUE`, apply a fixed seven-day
grace window, then mark them `EXPIRED` and read-only. A unique ledger keyed by
organisation, period end and notice kind makes notices/transitions idempotent.
`POST /api/v1/billing/renew` is Owner-only and creates a fresh hosted checkout;
only provider verification or a verified webhook may call the restoration path,
which extends the paid period from the later of now or the stored expiry and clears
an administrative suspension. Client-reported success never restores access. No
card is stored and no recurring charge is created.

Removal of feature access never deletes employee, payroll or historical records.
Restore requires a real verified payment or an audited Admin action.

## Deployment — do not skip

This implementation does not apply a migration or send real emails during testing.
Before enabling catalogue writes or expecting mail delivery:

1. Review/back up the target database. Apply migrations 04 and 05 through the
   existing privileged migration helper (not a reset):
   ```powershell
   # From packages/db, using a reviewed migration/admin connection:
   node --env-file=.env scripts/apply-sql.cjs migrations/04_platform_admin_price_notices.sql
   node --env-file=.env scripts/apply-sql.cjs migrations/05_subscription_access.sql
   ```
2. Keep the app role non-superuser/non-BYPASSRLS. The scheduler uses the existing
   DIRECT_URL orchestration connection; do not substitute it for tenant queries.
3. Configure existing `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL`
   and `WEB_APP_URL`; set `SCHEDULER_ENABLED=true`. Local/unconfigured SMTP never
   pretends an email was sent. Do not test against real customer recipient lists.
   Keep `SUBSCRIPTION_ACCESS_ENABLED=false` until feature policies and organisation
   controls have been reviewed, then enable it deliberately.
4. Restart API processes and use an existing explicitly provisioned platform admin.
   No customer Owner is automatically elevated. No dependency or engine generation
   is needed: the repository uses parameterised SQL for the additive outbox. The
   Prisma schema also documents the new tables; regenerate the client only after
   stopping API processes if Windows holds the engine DLL.

`04_platform_admin_price_notices.down.sql` and
`05_subscription_access.down.sql` refuse to drop non-empty audit/history tables.
Preserve recorded changes with forward fixes.

## Verification

```powershell
pnpm --filter @ascenda/api exec jest --runInBand
pnpm --filter @ascenda/api type-check
pnpm --filter @ascenda/web type-check
pnpm --filter @ascenda/db exec prisma validate
# Migrated, reviewed staging only; each rolls back all synthetic fixtures:
node --env-file=packages/db/.env apps/api/test/e2e/platform-admin-rls.cjs
node --env-file=packages/db/.env apps/api/test/e2e/subscription-access-rls.cjs
```

Unit/HTTP tests use database/SMTP doubles: platform-vs-Owner denial, fresh revocation,
step-up, input validation, real-change detection, free-plan preservation, atomic
write failure, recipient scoping, skips, retries, lease query/claim-token safeguards
and HTML escaping. The PostgreSQL script verifies actual audience policy, platform
history isolation, tenant queue isolation, immutable payloads, membership constraints
and duplicate-intent prevention. It connects directly using the restricted
`DATABASE_URL` app role (and asserts non-superuser/non-BYPASSRLS), avoiding managed
database restrictions on `SET ROLE`. For an explicitly approved development
database with the migration helper's self-signed certificate setup, the test-only
`DB_TEST_ALLOW_SELF_SIGNED=true` opt-in is available; certificate verification
remains enabled by default. This does not change API or production TLS settings.
Real multi-connection concurrency/crash recovery, controlled SMTP delivery and
responsive/accessibility browser checks remain staging release gates.
