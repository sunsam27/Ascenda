# Legacy payout recovery runbook

New employers use [company payroll funding](./wallet/README.md), not merchant-owned
provider accounts. Direct-bank connections and the old provider-connection/funding
interface have been removed, along with public provider account setup/replacement/
disconnection endpoints. The backend described here remains for existing payment
records and in-flight reconciliation only. Do not delete retained credentials or
disable webhooks while those transfers are unresolved. Employer funding is still
awaiting its own approved adapter; removing the old setup does not activate it.

## Safety rules

- Never retry `PROCESSING`/`QUEUED` payouts or pay them separately by bank file.
  A timeout does not prove the provider rejected a transfer.
- Retry through Ascenda only after a definite failure. The action resends only
  `FAILED` payouts; `PAID` and `REVERSED` payouts are excluded.
- Do not edit payout status or references directly in the database. Preserve
  provider evidence and the audit trail. Never include keys or raw bank details
  in logs, screenshots, tickets or chat.
- A live balance check is not a wallet reservation and excludes transfer fees.
  Keep a fee buffer and avoid concurrent runs against the same provider wallet,
  including transfers made outside Ascenda.

## Preserve existing transfers during deployment

1. Apply `packages/db/prisma/schema.prisma` using the reviewed database release
   procedure and regenerate the Prisma client. This release adds nullable
   `paystackBankCode`/`flutterwaveBankCode` to bank accounts and payout attempt
   metadata (`attemptCount` defaults to 1). No manual code backfill is required.
2. Configure and securely back up `BANK_ENCRYPTION_KEY`. Do not rotate it without
   a re-encryption plan for existing bank details and payout credentials.
3. Set `API_PUBLIC_URL` to the public HTTPS API origin, check `API_PREFIX`, and
   enable `SCHEDULER_ENABLED=true`. `PAYMENTS_ENABLED` gates billing checkout,
   not salary payouts.
4. Do not create new merchant-owned payout accounts. Keep the existing configured
   webhook URLs for accounts with payment history:
   `POST /api/v1/payments/webhooks/paystack/:organisationId` or
   `POST /api/v1/payments/webhooks/flutterwave/:organisationId`.
   Paystack signs raw payloads using the connected secret key;
   Flutterwave requires the configured `verif-hash` secret.
5. Do not rotate the encryption key or provider credentials without a reviewed
   recovery plan. The old account setup API is no longer available.

## Before resolving an existing batch

1. Review the processed payroll and batch total/currency; do not alter payroll
   calculations to work around a payout error.
2. Confirm primary account details and clear payroll review flags only after
   checking changes. In the worker bank panel, use provider codes copied from
   the provider's current bank list under **Advanced payment routing** (collapsed
   and admin-only); do not derive them from account numbers. The normal add-account
   form only collects bank and account details.
   Overrides take precedence; blanks fall back to the generic bank code.
   Changing the account/bank clears stale overrides unless explicitly replaced.
3. Verify provider evidence before resolving a failed transfer; never resend a
   successful, reversed or unknown transfer through employer funding.
4. Legacy balance/status/retry APIs remain permissioned for compatibility. They
   are not advertised in the employer interface. Any intervention must follow
   existing approval, step-up, auditing and incident procedures. Do not fund a
   retired merchant route as a workaround for unconfigured employer funding.

## Incident triage

| Symptom | Action |
| --- | --- |
| Balance refresh fails | Check provider health, credentials, currency and connectivity. No new transfers should start from this request. Fix and try again. |
| Insufficient funds | Top up including a fee buffer, then initiate or retry as appropriate. |
| Bank details need review | Verify details and provider codes, then have payroll review the account before proceeding. Code edits also trigger review. |
| `PROCESSING` for over 20–30 minutes | Check the provider dashboard using the exact attempt reference, webhook delivery logs, scheduler health and API warnings. Do not retry or issue an external duplicate payment. |
| `FAILED` / `PARTIALLY_PAID` | Inspect each failed reason, fix the cause, verify provider evidence, then choose **Retry failed** with step-up. Successful transfers are excluded. |
| Paystack OTP error | Disable transfer OTP; verify the original attempt in Paystack before retrying. |
| `REVERSED` | Confirm the provider returned funds and reconcile the original transfer. Escalate for an authorised manual resolution; automated retry excludes reversals. |
| Amount/currency mismatch webhook warning | Preserve the event/reference, compare provider evidence with the batch, and escalate. Do not force success. |
| Credentials cannot be decrypted | Check the encryption-key deployment/backup. Do not replace the key to hide the problem. Escalate before changing credentials. |

### Reconciliation

The scheduler polls at ten-minute intervals, up to 100 stale payouts per tenant
per run. Payouts must be older than ten minutes and not checked in the last ten
minutes. Confirm scheduler enablement and provider lookup logs when investigating.
There is no public manual reconciliation endpoint. An engineer can invoke
`PayoutsService.reconcileStalePayouts()` in an authenticated organisation context.

Lookup errors leave attempts processing for a later check. A definite provider
404 marks the payout failed and permits retry; inspect the provider dashboard
before retrying if this conflicts with known transfer evidence. Reconciliation
and webhooks use the same status/audit path.

### Escalation evidence

Collect organisation/batch/payout IDs, attempt reference and count, provider
transfer ID, currency and integer amount, relevant timestamps, sanitised failure
reason, provider dashboard status and webhook delivery status. Audit entries are
`PAYOUT_BATCH_INITIATED` (`retry` flag), `PAYOUT_STATUS_CHANGED` (`source`),
`PAYOUT_ACCOUNT_CHANGED`, and `BANK_DETAILS_CHANGED`.

## Verification

From the repository root:

```powershell
pnpm --filter @ascenda/api exec jest payouts-retry bank-accounts.service --runInBand
pnpm --filter @ascenda/api exec jest --runInBand
pnpm --filter @ascenda/api type-check
pnpm --filter @ascenda/web type-check
```

The HTTP lifecycle suite in `payouts/payouts-retry.spec.ts` starts an isolated
Nest server with real controllers/service, RBAC, step-up verification and webhook
signatures. It covers initiation, duplicate rejection, live-balance failure,
retry references, signed/duplicate webhooks and cross-tenant not-found responses.
Identity, provider network and database/RLS are doubles: it does **not** prove
real PostgreSQL RLS, login/session wiring or provider sandbox behaviour.

Before production, use a dedicated staging tenant/provider test wallet to
exercise approval → initiation → webhook → paid, a definite rejection → retry,
and missed webhook → scheduler reconciliation. Verify real tenant isolation,
audit records, masked responses and provider dashboard totals. Never run this
manual acceptance check with a production payroll batch.

## Stopping new payouts

Pause operator initiation/retry and escalate; there is no payout cancel action.
Do not disable reconciliation or webhooks for already submitted transfers.
Customer-facing account replacement/disconnection has been retired. Preserve the
credentials needed for unresolved transfers and coordinate changes through support.
For a suspected key compromise, coordinate provider-side containment and
credential recovery with incident responders while tracking existing transfers.
