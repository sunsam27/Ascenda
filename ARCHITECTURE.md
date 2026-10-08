# Ascenda Architecture (recommended baseline)

This is a recommendation to adapt to your team's skills, not a decision already made. Priorities: correctness of money, tenant isolation, and speed to a reliable Release 1.

## 1. Principles
1. **Modular monolith first.** One deployable with strict module boundaries. Split into services only when a clear scaling or team need appears.
2. **Tenant isolation at the database.** PostgreSQL row-level security on every tenant table (see SECURITY.md).
3. **Money is exact.** Integer minor units or fixed-point; one payroll engine; reference test cases.
4. **Rules are data.** Statutory rules, leave policies and approval chains are configuration versioned by effective date, not hard-coded.
5. **Everything auditable.** State changes emit audit events through one path.
6. **Mobile-first, low-bandwidth.** Small payloads, server-rendered or lightweight pages, works on low-end phones.

## 2. Suggested stack
| Layer | Suggestion | Why |
|---|---|---|
| Frontend | Next.js / React + TypeScript, Tailwind | Responsive, strong ecosystem, server rendering for slow networks |
| UI | Custom glass design tokens, Space Grotesk, Lucide or similar line icons | Matches the design; SF Symbols cannot be used outside Apple platforms |
| API | TypeScript (NestJS) or Python (Django/FastAPI) | Pick what the team knows; both fit |
| Database | PostgreSQL with RLS | Relational integrity for payroll and RLS for tenancy |
| Cache and queues | Redis plus a job queue | Payroll runs, imports, notifications run as background jobs |
| Files | S3-compatible private object storage | Signed URLs; encryption at rest |
| Auth | Managed identity provider or well-reviewed library | MFA, passkeys, SSO later |
| Observability | Structured logs, metrics, error tracking, uptime checks | Alert on failed payroll jobs |
| Infra | Containers, managed Postgres, IaC (Terraform) | Reproducible, auditable environments |

## 3. Module boundaries
`identity-access` · `organisations` · `people` · `time-leave` · `payroll` · `payments` · `talent` (onboarding, offboarding; later recruitment, performance) · `service` (volunteers, rosters) · `documents` · `analytics` · `notifications` · `audit` · `billing`

Rules: modules talk through explicit interfaces/events, not each other's tables. `payroll` reads attendance and leave through `time-leave`'s interface. `audit` and `notifications` are subscribers.

## 4. Key patterns
- **Effective-dated records:** compensation, leave policy, statutory rule packs and approval chains store `valid_from` / `valid_to`; queries ask "as of date".
- **Approval workflow engine:** generic `ApprovalWorkflow` with ordered steps and role or user approvers, delegation and escalation; reused by leave, payroll, reimbursements and payments.
- **Payroll engine:** pure, deterministic function `(worker, period, inputs, rule_pack) -> payslip lines`. No I/O inside; fully unit-testable with reference cases per country.
- **Outbox pattern:** events written in the same transaction, then published (notifications, audit, analytics).
- **Idempotent jobs:** payroll processing and imports can be retried safely.
- **Read models for analytics:** nightly or incremental aggregate tables so dashboards stay fast; apply the same permission scopes.

## 5. Core data model (summary)
See PRD v2.0 section 11. Anchor tables: `organisations`, `memberships`, `workers`, `compensation_records`, `bank_accounts`, `leave_requests`, `leave_balances`, `attendance_records`, `pay_calendars`, `payroll_runs`, `payroll_items`, `payments`, `approval_workflows`, `documents`, `audit_log`. Every table: `id` (UUID), `organisation_id`, `created_at`, `updated_at`, and `created_by` where relevant.

## 6. Environments and delivery
Trunk-based development, pull-request review, CI gates (lint, types, unit, integration, tenant-isolation, permission tests, security scans), preview environments, staging with anonymised data, blue/green or rolling production deploys, database migrations reviewed and backward compatible.

## 7. Decisions to record (ADRs)
Stack and hosting region; auth provider; payroll engine ownership; launch-country rule pack source; payment-file formats; analytics approach; file scanning vendor. Write each as a short ADR in `docs/adr/`.
