# Phase 3 exit checklist - pilot parallel payroll reconciliation

Status: harness ready, pilot execution pending.

Phase 3 cannot be marked complete from code and synthetic fixtures alone. The
two exit criteria are:

- Launch-country statutory rule pack validated by a payroll professional
  (`ROADMAP.md:29`).
- Parallel run against a pilot customer's real payroll matches to the smallest
  currency unit (`ROADMAP.md:33`).

Real pilot payroll data and the professional sign-off are external inputs. Do
not commit either to git. Keep evidence in the approved secure location.

## Gate A - statutory rule pack validation

- [ ] Confirm the exact launch-country rule pack version and effective date used
      by the pilot organisation.
- [ ] A qualified payroll professional has reviewed the pack against current
      law and the organisation's payroll practice.
- [ ] The review covers: tax bands and reliefs, employee pension, employer
      pension, other mandatory deductions, rounding, and effective dates.
- [ ] Every known limitation or excluded case is written down with a reason.
- [ ] Written sign-off is stored with the exit evidence.

Record:

| Field | Value |
| --- | --- |
| Country | |
| Rule pack ID / version | |
| Effective date | |
| Validator name and role | |
| Validator organisation | |
| Review date | |
| Evidence path | |
| Open exceptions | |

No rate or rule may be invented to make a reconciliation pass. If the pack is
wrong, fix the pack through the normal professional-validation process and
re-run the pilot.

## Gate B - pilot parallel run

### Preconditions

- [ ] Pilot organisation, pay period and currency are agreed in writing.
- [ ] The Ascenda run is `PROCESSED` (payslips exist) or later; never a draft.
- [ ] Payroll inputs are frozen for the period: compensation, recurring items,
      attendance/overtime, approved reimbursements, leavers and joiners.
- [ ] The statutory pack from Gate A is the one used by the run.
- [ ] The customer's payroll ledger for the same workers and period is
      available.
- [ ] Data-sharing approval covers the reconciliation and the evidence location.

### Steps

1. Record run metadata: organisation, run ID, period start/end, currency,
   worker count, pack version.
2. Export Ascenda actuals using the direct database URL:

   ```powershell
   psql "$env:DIRECT_URL" -v ON_ERROR_STOP=1 -v run_id='<payroll-run-uuid>' `
     -f apps/api/test/reconciliation/export-run-actuals.sql |
     Out-File -Encoding utf8 actual.csv
   ```

3. Normalize the customer ledger to the canonical CSV described in
   `README.md`. Convert amounts to integer minor units exactly; deductions are
   positive magnitudes; employer costs stay separate.
4. Run the harness with zero tolerance and write the evidence report:

   ```powershell
   node apps/api/test/reconciliation/reconcile-payroll.cjs `
     --actual actual.csv `
     --expected pilot-expected.csv `
     --report reconciliation-report.json
   ```

5. If the harness fails, triage every difference into one category:
   - data mapping or normalization error,
   - Ascenda defect,
   - customer ledger defect,
   - statutory rule or pack difference,
   - agreed, documented exclusion.
6. Fix the root cause, re-freeze inputs if anything changed, and re-run from
   step 2. Never edit only one side of the comparison to force a pass.
7. Attach the final zero-diff report and both input hashes to the evidence pack.
8. Get written pilot sign-off from the customer payroll owner and the internal
   payroll lead.

### Acceptance criteria

- [ ] Worker sets match exactly: no `MISSING_IN_ACTUAL`, no `EXTRA_IN_ACTUAL`.
- [ ] Zero differences in `gross`, `deductions`, `net` and `employer_costs` at
      zero minor-unit tolerance.
- [ ] Zero currency mismatches.
- [ ] `net = gross - deductions` holds for both sides.
- [ ] Per-currency totals match exactly.
- [ ] Gate A sign-off is attached.
- [ ] Any exclusions are listed and approved in writing.

Recommended: repeat the parallel run for a second consecutive pay period before
declaring the exit test complete.

### Evidence pack

- Run metadata (organisation, run ID, period, currency, worker count, pack
  version).
- `actual.csv` and its SHA-256 hash.
- `pilot-expected.csv` and its SHA-256 hash.
- `reconciliation-report.json` from the final passing run.
- Gate A professional-validation sign-off.
- Triage log for every difference found, including the resolution.
- Written pilot and internal sign-off.

### Sign-off

| Role | Name | Date | Signature / approval reference |
| --- | --- | --- | --- |
| Customer payroll owner | | | |
| Ascenda payroll lead | | | |
| Payroll professional (Gate A) | | | |

## Definition of done

Phase 3 exits only when Gate A and Gate B are both checked, the evidence pack is
stored securely, and the final harness report has zero differences.
