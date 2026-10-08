# Ascenda Security Specification

Applies to all code, infrastructure and operations. Derives from PRD v2.0 section 9. Ascenda stores salary, bank, identity and leave data, so these rules are launch requirements, not hardening for later. "MUST" is mandatory; "SHOULD" needs a written exception to skip.

## 1. Threat model (top risks)
| Threat | Example | Primary controls |
|---|---|---|
| Cross-tenant data leak | Org A reads Org B payroll | Tenant scoping + row-level security (section 3) |
| Privilege escalation | Manager reads salaries | Server-side RBAC, field-level permissions (section 4) |
| Payroll fraud | Insider changes own pay or bank details | Separation of duties, re-auth, approval chain, audit (section 6) |
| Account takeover | Phished admin | MFA, session controls, rate limiting (section 2) |
| Data exposure | Public file link, leaked export | Private storage, signed expiring URLs, audited exports (section 7) |
| Supply chain | Malicious dependency | Lockfiles, scanning, pinned versions (section 9) |

## 2. Authentication and sessions
- MUST hash passwords with Argon2id (or bcrypt cost 12+). Never log or return hashes.
- MUST check new passwords against a breached-password list; minimum length 12.
- MUST enforce MFA (TOTP or passkey) for Owner, Payroll Administrator, Finance Approver and HR Administrator. SHOULD offer to all users.
- MUST use short-lived access tokens with rotating refresh tokens; HttpOnly, Secure, SameSite=Lax cookies; idle timeout 30 min for admin roles.
- MUST rate-limit login, reset and MFA endpoints per account and per IP; lock progressively after repeated failures; return generic errors (no account enumeration).
- MUST invalidate all sessions on password change, MFA reset or role change.
- MUST require re-authentication (password or MFA) for: changing bank details, approving payroll or payments, exporting payroll data, changing roles.

## 3. Multi-tenancy and data isolation
- Every tenant-owned table MUST have `organisation_id NOT NULL`.
- MUST enable PostgreSQL row-level security on all such tables; the application sets `app.current_org` per request/transaction. Queries MUST NOT rely on application filters alone.
- Application DB role MUST NOT be a superuser and MUST NOT bypass RLS. Migrations use a separate role.
- Every file, cache key, queue job and search index entry MUST carry the organisation id.
- Automated test: for each endpoint, a user from Org B requesting an Org A id gets 404 (not 403).
- Users can belong to several organisations; role is evaluated per organisation membership.

## 4. Authorisation (RBAC and field-level)
- MUST enforce permissions on the server in one central policy layer; never rely on hidden UI.
- Default deny. A permission is `resource:action:scope` where scope is `self | team | department | location | organisation`.
- Restricted fields (separate permission each): `compensation`, `bank_details`, `national_id`, `medical_or_leave_reason`, `performance_review`, `special_category_data`.
- Lists, search, exports and analytics MUST apply the same scope filters as detail views.
- Small-group suppression: analytics on fewer than 5 people MUST NOT reveal individual values.
- Platform (Ascenda staff) roles are separate from organisation roles. Support access is time-limited, requires customer consent, is read-only by default and is fully audited. Support has no access to bank or payroll data by default.

## 5. Data protection
- TLS 1.2+ everywhere (HSTS enabled). No plaintext internal traffic across networks.
- Encryption at rest for databases, backups and object storage.
- Field-level encryption (envelope encryption with a managed KMS key) for bank account numbers, national IDs and tax IDs. Show masked values (last 4) by default; reveal is a permissioned, audited action.
- Secrets live in a secrets manager, never in code, images or logs. Rotate on a schedule and on staff change.
- Never log: passwords, tokens, bank numbers, national IDs, salary values, full request bodies for sensitive routes.
- Data minimisation: special-category fields (religion, health, ethnicity, disability) are optional, off by default and separately restricted. Religion is never required.
- Money uses integer minor units or fixed-point decimals. Never floating point.

## 6. Payroll and payment integrity
- Separation of duties: the preparer of a payroll run MUST NOT approve it; nobody approves a change to their own pay or bank details.
- Run states are one-way: Draft, In review, Pending approval, Approved, Processed, Locked. Approved runs are immutable; fixes use reversal or next-run adjustments, each audited.
- Bank detail changes: re-authentication, notify the worker and payroll/HR, and flag the next payment for review (typical fraud pattern).
- Pre-approval validation: missing bank data, duplicates, ineligible statuses, large salary jumps, excessive deductions. Blocking errors cannot be overridden; warnings require an acknowledged reason.
- Payment file export is permissioned, re-authenticated, audited and watermarked with run id and exporter.
- If automated payments are added later: dual approval, per-run and daily limits, allow-listed accounts, and mandatory test mode first.

## 7. Files and exports
- Documents stored in private object storage; access only via short-lived signed URLs after a permission check (default 5 minutes).
- Validate file type by content, enforce size limits, scan uploads for malware, strip metadata from images.
- Payslips are private to the worker and authorised payroll roles.
- Every export (CSV, Excel, PDF) is permission-checked and audited with who, what, filters and row count.

## 8. Audit log
- Append-only, tamper-evident (hash chain or write-once storage). Customers cannot edit or delete entries.
- MUST record: logins and failures, MFA changes, role or permission changes, compensation changes, bank detail changes, payroll and payment approvals, worker deletion, exports, access to restricted fields, approval-chain changes, support access.
- Each entry: actor, organisation, action, target, timestamp (UTC), IP, user agent, previous and new value (sensitive values masked).
- Retain per policy (proposed 7 years, confirm with counsel). Make filterable and exportable for Owner and Auditor roles.

## 9. Application security
- Validate and encode all input and output; parameterised queries only; no string-built SQL.
- Protect against OWASP Top 10: CSRF tokens on cookie-auth state-changing requests, strict CORS, Content-Security-Policy, X-Content-Type-Options, frame-ancestors none, Referrer-Policy.
- Prevent mass assignment: explicit DTO allow-lists on every write endpoint.
- Use opaque or UUID ids; never trust ids from the client without a scope check (IDOR).
- Dependencies: lockfiles, automated vulnerability scanning in CI, update critical fixes within 7 days, SBOM per release.
- CI gates: static analysis, secret scanning, dependency scan, tests including tenant-isolation and permission suites. No merge on failure.
- Independent penetration test before launch and annually; fix criticals before release.

## 10. Infrastructure and operations
- Environments isolated (dev, staging, prod); no production data in non-production without anonymisation.
- Least-privilege cloud IAM, MFA for all engineers, no shared accounts, short-lived credentials.
- Private networking for databases; only the load balancer is public; WAF in front of the application.
- Encrypted automated backups, point-in-time recovery, restore tested quarterly. Targets: RPO 24h or better, RTO 8h.
- Central logging and alerting on auth anomalies, failed payroll jobs, spikes in exports, and permission denials.
- Documented incident response with severity levels, on-call, and a customer/regulator notification procedure.

## 11. Privacy and compliance
- Map each launch country's data-protection law with counsel (for Nigeria, the Nigeria Data Protection Act; confirm requirements, registration duties and cross-border transfer rules). Decide hosting region from this.
- Support data-subject requests: access, correction, deletion or anonymisation, with statutory record-keeping exceptions.
- Configurable retention per data type; automated deletion or anonymisation jobs with audit entries.
- Provide a data processing agreement and sub-processor list to customers. Record lawful basis and consent where relevant (for example candidates).

## 12. Definition of done (security)
A feature is not done until: permissions defined and tested, tenant-isolation test added, sensitive fields classified and encrypted/masked, audit events emitted, no sensitive data in logs, input validated, and abuse cases (rate limit, IDOR, over-posting) considered.
