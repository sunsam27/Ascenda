# Payments Module

**Bounded context:** payments

## Employer-first payroll funding

The primary Payments experience is now **Company payroll funding**: company setup,
verified funding-account status, pending/available/reserved balances, salary-payment
review and an organisation ledger. No employer provider login is required for this
new journey. **Partner activation is not yet enabled**; applications remain pending
and no funding account or successful balance is simulated. See the
[employer funding implementation and activation gates](./wallet/README.md).

Direct-bank connection scaffolding and employer-managed provider setup have been
removed. Employers cannot add provider keys or connect their own merchant account.
Both Payments entry points now render the employer funding panel directly; the
previous provider-dashboard funding, manual-payment and bank-file controls are no
longer part of that interface. Employee bank details remain unchanged.

The merchant-owned payout backend below is retained for compatibility with existing
records and in-flight payments, including signed webhooks and reconciliation. It is
not the employer funding wallet or the onboarding route for new employers. No
payment history, stored account data or subscription payment integration was deleted.

Worker payments and salary payouts (PRD PAY-07, PAY-12) plus the provider
payout account used to move money in-platform.

## Interfaces

Modules communicate through explicit interfaces/events — never by accessing
another module's tables directly.

- `PaymentsService` — payment/batch lifecycle, exports.
- `PayoutsService` — provider account, transfers, webhooks, retry and
  reconciliation.
- `PayoutGateway` (`payouts/payout-provider.ts`) — provider adapter contract.
  Implementations: `paystack-payout.provider.ts`, `flutterwave-payout.provider.ts`.

## Payout flow

1. A processed payroll run creates `DRAFT` payment batches and `PENDING`
   payments.
2. An approver approves the batch (step-up, `payments:approve`), which marks its
   payments `APPROVED`.
3. "Pay in-platform" (`POST /payments/batches/:id/payout`, step-up,
   `payments:approve`) creates one `Payout` per payment (`QUEUED`) and calls the
   provider synchronously. Results are persisted as `PROCESSING`, `PAID`,
   `FAILED` or `REVERSED`, and the batch rolls up to `PAID`,
   `PARTIALLY_PAID` or `FAILED`.
4. Provider webhooks (`POST /payments/webhooks/{provider}/{organisationId}`)
   update transfers asynchronously. Signatures are verified against the
   connected account's credentials before anything is written.

Amounts are always integer minor units. Account numbers are encrypted at rest
and only decrypted inside the payout path; logs and summaries are masked.

## Retry failed transfers

`POST /payments/batches/:id/payout/retry` (step-up, `payments:approve`)

- Only `FAILED` or `PARTIALLY_PAID` batches are eligible.
- Only `FAILED` payouts are retried. `PAID` and `REVERSED` transfers are never
  resent.
- Each retry reuses the payout row (`Payout.paymentId` is unique), increments
  `attemptCount`, and issues a fresh provider reference
  (`<payment reference>-R<attempt>`).
- The batch returns to `PROCESSING` and rolls up again as results arrive.
- The retry is audited as `PAYOUT_BATCH_INITIATED` with `retry: true`, and each
  status change is audited as `PAYOUT_STATUS_CHANGED`.

Reversed transfers must be handled manually: money may already have left the
provider wallet, so the system will not automatically re-send them.

## Reconciliation

Webhooks are best-effort. `PayoutsService.reconcileStalePayouts()` polls the
provider for payouts that have been `QUEUED`/`PROCESSING` for at least 10
minutes and have not been checked in the last 10 minutes. The scheduler runs it
every 10 minutes when `SCHEDULER_ENABLED=true`:

```
SCHEDULER_ENABLED=true
```

Reconciliation uses the same persistence and auditing path as webhooks
(`source: RECONCILIATION`). A failed provider lookup is logged and retried on the
next run and never marks a payout failed by itself — with one exception: a
definite `404 Not Found` long after the attempt means the provider never received
the transfer, so the payout is marked `FAILED` and becomes retryable.

Ambiguous initiation failures (timeouts, 5xx/429, malformed provider responses)
are deliberately left `PROCESSING` rather than `FAILED`, so a retry cannot send
the same salary twice. Explicit 4xx rejections and provider-reported failures are
recorded as `FAILED`. Force a manual check with:

```bash
# inside an authenticated request/org context
payoutsService.reconcileStalePayouts();
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `PAYMENTS_ENABLED` | Gates subscription checkout in billing (default `false`); payout endpoints are separate. |
| `BANK_ENCRYPTION_KEY` | 32-byte key used to encrypt worker bank details and payout credentials. Production must set it. |
| `API_PUBLIC_URL` | Public HTTPS base used to render webhook URLs. |
| `API_PREFIX` | API path prefix (default `api/v1`). |
| `SCHEDULER_ENABLED` | Enables reconciliation and other background jobs. |

`GET /payments/payout-options`, `PUT /payments/payout-account` and
`DELETE /payments/payout-account` have been removed. There is no customer-facing
provider-credential setup/replacement/disconnection API. Existing credentials are
retained solely for legacy compatibility and reconciliation; any necessary key
recovery must follow a reviewed operational procedure. Paystack webhook signatures
use the retained account secret key; Flutterwave uses its retained `verif-hash` secret.

## Operational notes

See [the payout operations runbook](./PAYOUT-RUNBOOK.md) for deployment,
pre-flight checks, incident triage and acceptance testing.

- Paystack transfer OTP must be disabled in the dashboard, or automated
  transfers will fail with a clear OTP error.
- Separation of duties is enforced on approval: the batch creator cannot approve
  their own batch unless they are an OWNER (same override as payroll runs). The
  self-approval override is recorded on the approval audit entry.
- The provider balance is fetched live immediately before every initiation and
  retry, then persisted on the payout account. If the live lookup fails the run
  aborts rather than authorising against a stale snapshot.
- Amounts are stored with a two-decimal convention. Zero-decimal currencies
  (XOF, XAF, UGX, RWF, MWK, …) are rejected at initiation/retry when a payment
  is not a whole major unit, so a provider is never sent an invalid fraction.
- Providers publish different bank code tables. `BankAccount.bankCode` holds the
  generic CBN/NIBSS code, while `paystackBankCode` and `flutterwaveBankCode` are
  optional per-provider overrides. Payout preparation prefers the active
  provider's override and falls back to `bankCode`. Payroll admins can set the
  overrides from the worker's bank-account panel; employees cannot.

## Notes

- All service methods accept and filter by `organisationId`.
- Add a tenant-isolation test for every new endpoint.
- Sensitive fields must be classified and encrypted/masked.
