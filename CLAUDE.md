# CLAUDE.md: Ascenda build instructions

Read this first in every session. Source of truth: product scope `Ascenda_PRD_v2.docx`; security `docs/SECURITY.md`; structure `docs/ARCHITECTURE.md`; visual design `docs/DESIGN_SYSTEM.md`, `docs/COLORS.md`, `docs/TYPOGRAPHY.md`. Read the design files before building any UI.

## What Ascenda is
People, payroll and workforce intelligence platform for churches, SMEs, NGOs and schools. One workforce: employees, ministers, volunteers, contractors, interns. Payroll and payments are the core. Release 1 scope is every PRD item tagged P0.

## Non-negotiables
1. **Tenant isolation:** every tenant table has `organisation_id` and RLS. Never query without organisation scope. Add a tenant-isolation test for every new endpoint.
2. **Permissions on the server,** default deny, field-level for compensation, bank, ID, medical and performance data.
3. **Money:** integer minor units or fixed-point only. Never float. Payroll calculations are pure functions with tests.
4. **Audit:** every sensitive state change emits an audit event. Never log secrets or sensitive values.
5. **Separation of duties:** preparer cannot approve their own run; nobody approves changes to their own pay or bank details.
6. **Rules are data:** statutory and policy rules are effective-dated configuration, not constants in code.
7. **Never invent statutory rules.** If a country's tax or pension rule is unknown, stop and ask; leave a clearly marked TODO with a failing test.

## Working method
- Work from one PRD requirement ID at a time (for example `PAY-06`). Name it in the commit and PR.
- Write the acceptance test from the PRD (section 12) before the implementation.
- Small, reviewable changes. Run lint, types and tests before declaring done.
- Ask before: adding a dependency, changing the data model of a shipped table, changing auth or permission logic, anything touching payroll calculation.
- Definition of done: see `docs/SECURITY.md` section 12, plus tests, docs updated, migration reversible.

## UI rules
- Follow `docs/DESIGN_SYSTEM.md` (glass for navigation and summary cards; solid surfaces for tables, forms, payslips), `docs/COLORS.md` and `docs/TYPOGRAPHY.md`. Use tokens only, never raw hex or ad-hoc sizes.
- Font: Space Grotesk, with tabular numbers for money and tables.
- Icons: rounded line icons (Lucide or similar). Never Apple SF Symbols.
- Text on Accent is dark, never white. Muted text never sits on glass.
- Always provide solid fallbacks and honour `prefers-reduced-transparency` and `prefers-reduced-motion`.
- Mobile-first, touch targets at least 44px, WCAG 2.1 AA, real buttons and links, labelled inputs.
- Terminology comes from organisation settings (Department vs Ministry, Employee vs Pastor), not hard-coded strings.

## Conventions
- TypeScript strict (or equivalent typing). One module per bounded context; no cross-module table access.
- API: versioned, validated DTOs with explicit allow-lists; consistent error shape; pagination on every list.
- Database: UUID primary keys, `created_at`/`updated_at`, soft delete only where law or history requires.
- Tests: unit for payroll and leave rules, integration for APIs, e2e for the pay cycle and leave journeys.

## Out of scope for Release 1
Recruitment, performance, automated bank payments, loans and benefits, LMS, AI assistant, native mobile app, SMS/WhatsApp. Do not build them unless asked.
