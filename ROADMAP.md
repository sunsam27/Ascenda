# Ascenda Build Roadmap (Release 1 first)

Order is chosen so each step is testable and the riskiest parts (tenancy, permissions, payroll) are proven early. Durations are rough and depend on team size; treat as sequence, not commitment.

## Phase 0: Foundations
- Repo, CI gates, environments, secrets management, observability.
- Organisations, users, memberships, login, MFA, sessions.
- RBAC engine with scopes and field-level permissions; Postgres RLS; tenant-isolation test harness.
- Audit log service. Design tokens and glass component library (Space Grotesk, icons, light/solid fallbacks).
- **Exit test:** a user in Org B can never read Org A data; every admin action appears in the audit log.

## Phase 1: People
- Worker model (category, employment type, job role), statuses, effective-dated compensation.
- Departments/ministries, locations, directory and search, document store.
- CSV import with validate, duplicate detection and preview.
- Organisation setup flow including country and currency, organisation-type terminology.
- **Exit test:** import 500 workers; managers see only their scope.

## Phase 2: Time and leave
- Attendance (manual and clock in/out), holiday calendars.
- Leave types, balances, approval workflow engine, delegation and escalation, team calendar basics.
- **Exit test:** leave balance and holiday maths pass the acceptance criteria.
  - ✅ Verified — `apps/api/test/e2e/phase2-exit.cjs` (19/19): weekends/one-off/recurring/location
    holidays + half days (LVE-03); entitlement, reduce-on-final-approval,
    restore-on-cancel, insufficient-balance rejection (LVE-01/LVE-02).

## Phase 3: Payroll and payments
- Pay structures, deductions, employer-side costs, pay calendar, proration.
- Launch-country rule pack, validated by a payroll professional. Reference test suite.
- Payroll run states, validation, approval chain, locking, reversal.
- Payslips (PDF, private), payment batches for contractors, stipends and reimbursements, payment file export.
- Reimbursement claims.
- **Exit test:** parallel run against a pilot customer's real payroll matches to the smallest currency unit.

## Phase 4: Service, onboarding, self-service
- Onboarding and offboarding checklists; offboarding feeds final pay.
- Volunteer profiles, availability, rosters, shifts, notifications.
- Employee and volunteer self-service, announcements, policy acknowledgements, global search.

## Phase 5: Analytics and hardening
- Dashboards (workforce, payroll, attendance) with defined metrics; standard reports and audited exports.
- Penetration test, load test, backup restore drill, accessibility audit, data-protection review.
- Pilot with 3 to 5 organisations; fix, then launch.

## After Release 1
- **Release 2:** recruitment, performance, accounting export, QR/kiosk attendance, accrual rules, SSO, custom roles, e-signature, volunteer analytics.
- **Release 3+:** automated payments, loan management, benefits, multi-country, Smart Insights, AI assistant, native app.

## Risks to track weekly
Scope creep into Release 2; payroll rule correctness; pilot customer availability; naming/trademark clearance; hosting and data-transfer decision.
