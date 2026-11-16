# Employer payroll funding (PAY-17)

## Release status — no active payment-partner adapter

The **Company payroll funding** panel is the primary experience in Payments and
Payroll → Payments. An owner can submit company/authorised-representative details;
the application is persisted encrypted and remains **Verification pending**.
It does not issue a fictional account or credit a fictional balance. Employers
do not enter provider keys or need a Flutterwave/Paystack login in this journey.
There are no employee wallets.

`EmployerFundingRegistry.configured()` deliberately returns `null`. No environment
flag, existing subscription credential, frontend toggle or provider PSA `ACTIVE`
flag enables this release. Account issuance, funding credits and salary transfers
remain unavailable until a reviewed adapter and partner authorisation are supplied.
Direct-bank connection scaffolding and merchant-owned provider setup have been
removed from the employer journey. Payments and Payroll → Payments render this
panel directly, without provider-key forms, dashboard-funding links, bank-connection
catalogs or the old manual-payment/export controls. Existing payment records,
legacy backend reconciliation and subscription checkout are preserved. The retired
provider account setup/replacement/disconnection endpoints no longer accept keys.

## Provider research (checked 2026-11-09)

Official Flutterwave documentation:

- https://developer.flutterwave.com/docs/payout-subaccount
- https://developer.flutterwave.com/docs/virtual-account
- https://developer.flutterwave.com/docs/webhooks

Flutterwave documents v3 NGN payout subaccounts, dedicated static funding accounts,
wallet transactions/balances, and withdrawals via `/v3/transfers` with
`debit_subaccount`. Its wallet-funding webhook may be `transfer.completed` with
`debit_currency: PSA`, **not** an ordinary checkout `charge.completed`.
The v3 webhook guide currently specifies `verif-hash`, constant-time comparison,
and re-querying critical transaction data before giving value. API versions and
account-specific webhook configuration must be confirmed with Flutterwave before
implementing a real adapter; do not mix a different version's signature scheme.

These documents do **not** establish Ascenda's permission to offer employer payroll
funding, corporate KYB requirements, reliable idempotent wallet creation, exact
funding-to-employer attribution/verification, full fee semantics, or production
approval. A generic collection VA is not automatically a funded payout wallet.
The existing `FlutterwavePayoutProvider` debits a merchant balance and is **not**
registered here. Test-mode `fund-account` is a simulation endpoint and is not used.

### Adapter activation gates

1. Partner agreement for employer payroll receipt/holding/payouts; legal/compliance
   review, employer KYB, beneficial-owner/representative requirements and mandates.
2. Documented server-owned credentials, environment-specific signature validation,
   rotation and secret-manager configuration. No employer-supplied provider keys.
3. Idempotent `createOrRetrieve` using the persisted setup reference, recovering
   uncertain creation without issuing another account. Corporate verification must
   be independently confirmed; a wallet's technical ACTIVE status is insufficient.
4. Dedicated employer subaccount, static NGN account, per-wallet balance/transaction
   queries and exact funding verification tied to that account. Never attribute a
   deposit by sender narration, client organisation header or amount alone.
5. Authoritative per-payment fee quotes, confirmed net deposit/fee/refund semantics,
   stable transfer references/idempotency and debit-from-subaccount capability.
6. Verified payout evidence matches wallet, reference, amount, currency and final
   debit/return outcome. A timeout, 404, or unknown status is **not** NOT_DEBITED.
7. Sandbox contract tests, real PostgreSQL/RLS/concurrency tests, provider sandbox
   lifecycle tests, recovery/duplicate/replay tests and a separately authorised
   small live pilot. Register sandbox before a reviewed live release.
8. Paginated funding reconciliation must cover the complete transaction window,
   including refunds and fees; don't silently return only the latest provider page.

The server-only `EmployerFundingProvider` interface covers setup, account details,
balance, fee quotes, incoming-funding verification, payouts/status and webhooks.
**No external provider operation is currently wired to this interface.** Test
adapters are local test doubles only. Do not claim sandbox or live integration
has been validated by the unit/HTTP suites.

## Data and money safety

New tables (additive; existing payroll calculations and approval rules unchanged):

- `payroll_wallets`: one employer wallet per organisation, encrypted application
  and funding account, setup/environment bindings and balance projections.
- `payroll_wallet_deposits`: provider-reference-unique funding state.
- `payroll_wallet_ledger`: immutable journal with available/pending/reserved/paid
  deltas, provider and payroll references, actor and timestamps.
- `payroll_wallet_reservations`: immutable, idempotent payroll submission evidence.
- `payroll_wallet_attempts`: a new encrypted-beneficiary snapshot and reference
  for **each** payout attempt; retries never overwrite historical attempts.

RLS is enabled and forced on all five tables. Composite tenant foreign keys and
payroll-reference triggers prevent cross-tenant links. The journal and reservation
evidence reject updates/deletes. Balance CHECKs prevent negative projections.
Every journal/projection mutation and summary audit are in the same transaction.
Money is checked integer NGN minor units, bounded by the existing PostgreSQL Int
storage. Overflow fails closed rather than rounding or truncating.

Provider-reported pending deposits do not increase available funds. Confirmed
funding is credited once by wallet/reference/status, with separate fee entries.
Refund evidence must reference a confirmed deposit; the adapter must report the
original credited principal/fee consistently and verify the return. A refund that
would overdraw available funds places a reconciliation hold; it does not erase
history or invent funds. No customer refund-initiation API is included.

Payment selection requires the processed/locked, approved, unreversed payroll,
an approved batch, reviewed NGN employee bank details and amounts equal to the
run's frozen net payslips. It does not recalculate payroll. Fee-inclusive quotes
are confirmed again on submission; changed fees require another admin review.
Available funds are capped by provider-backed available balance. Balances are
never replaced by a provider snapshot or editable through an API.

Reservations lock the employer wallet then batch; reserve net salaries plus fees
and persist all attempt references before network I/O. Requests carry UUID
idempotency keys. Cross-route guards prevent exporting/manual marking of wallet
batches and block wallet submission of already exported/provider-paid batches.
Existing bank-file payments must be reconciled before migration to this route.

Submission claims each queued attempt before the provider call. After a crash,
unclaimed attempts can be dispatched by reconciliation; claimed attempts are
looked up, never blindly resent. Unknown outcomes retain reservations. A confirmed
no-debit failure releases principal plus unused fees; confirmed success consumes
the reservation, recording actual fees. Confirmed returned principal restores
available funds; fees are never presumed returned. Only failed attempts can be
retried, with new rows/references. Late contradictory evidence or excessive fees
puts spending on hold. Hold removal is intentionally not a browser operation:
support must reconcile underlying evidence through a reviewed recovery procedure.

Scheduled reconciliation (minute 3 then every ten minutes) checks confirmed
funding, unclaimed submissions and payout outcomes, including later reversals.
It detects a provider balance below locally available funds and holds spending;
it never uses a balance difference as a deposit. Run one active scheduler for this
initial release and add production monitoring/queueing before scale-out. The
bounded reconciliation pass processes up to 100 attempts; no external job queue
is added. Manual reconciliation is available to payment approvers.

## Endpoints and permissions

All authenticated paths begin `/api/v1/payments/employer-wallet`:

| Method | Path | Existing permission / extra control |
| --- | --- | --- |
| GET | `/`, `/ledger`, `/history` | `payments:read:organisation`; paginated histories |
| POST | `/setup`, `/setup/status` | `settings:update:organisation` + step-up (Owner) |
| GET | `/batches/:id/quote`, `/batches/:id/retry-quote` | `payments:read:organisation` |
| POST | `/batches/:id/pay`, `/batches/:id/retry` | `payments:approve:organisation` + step-up |
| POST | `/reconcile` | `payments:approve:organisation` |
| POST | `/webhooks/:organisationId` | Public transport, unavailable until an approved adapter verifies signature + re-queries evidence; exact wallet/environment match required |

There is no API to type in a successful deposit, set a balance, activate an account
or feed settlement evidence from the browser. Existing batch approval (including
its audited Owner override) is unchanged. The global rate limiter applies.

## Deployment / configuration

Do not apply this migration to production without normal review/backup procedures.
Apply once **before** deploying this API:

```powershell
# From packages/db, using the migration/admin connection and existing helper:
node --env-file=.env scripts/apply-sql.cjs migrations/03_employer_payroll_wallet.sql
pnpm exec prisma generate
```

Build shared types before API/web. `BANK_ENCRYPTION_KEY` must be explicitly set to
a secure 32-byte key (base64 recommended); employer applications refuse the fixed
development fallback. Back it up securely; don't rotate it without re-encryption.
`SCHEDULER_ENABLED=true` enables reconciliation **only when an approved adapter
exists**. Existing `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_HASH`,
`PAYSTACK_SECRET_KEY`, and `PAYMENTS_ENABLED` remain subscription configuration;
they do not activate employer wallets. No new placeholder secret or activation
flag is added. Future adapter credentials must be server-only and independently
reviewed. Company funding accounts are never hard-coded in environment variables.

`03_employer_payroll_wallet.down.sql` only rolls back an empty installation and
refuses when wallet records exist. Preserve financial history with forward fixes.
No migration or live DB change was automatically applied by this implementation.

## Verification

```powershell
pnpm --filter @ascenda/types build
pnpm --filter @ascenda/api exec jest --runInBand
pnpm --filter @ascenda/api type-check
pnpm --filter @ascenda/web type-check
# Migrated staging only; rollback-only synthetic rows:
node --env-file=packages/db/.env apps/api/test/e2e/employer-wallet-rls.cjs
```

Unit/service tests cover fee-inclusive reservations, confirmed/duplicate/pending
deposits, unknown outcomes, confirmed failures/returns, attempts/retries, encrypted
setup, provider/tenant binding and idempotent submission. HTTP tests use real
validation, permission and step-up guards, with identity/database/provider doubles.
The RLS script checks all five tables, tenant links, nonnegative money, duplicate
funding references and immutability using real PostgreSQL. It requires a privileged
staging connection able to `SET ROLE ascenda_app`; it always rolls back. It was
added, not run against an unreviewed database. Real multi-connection concurrency,
provider sandbox and responsive/browser acceptance remain release gates.
