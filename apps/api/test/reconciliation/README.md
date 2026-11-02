# Payroll parallel-run reconciliation

Compares Ascenda's per-worker payroll output with a pilot customer's payroll
ledger for the same pay period. The comparison is exact: every money field is
an integer number of minor units with **zero tolerance**, per the Phase 3 exit
test in `ROADMAP.md`.

This harness does not calculate statutory rules and cannot substitute for the
professional validation of the launch-country rule pack. It is the evidence
tool for the pilot parallel run.

## Files

- `reconcile-payroll.cjs` - CSV comparator and self-test.
- `export-run-actuals.sql` - exports one processed Ascenda run in the canonical
  format.
- `fixtures/` - synthetic fixtures used by the self-test and examples.
- `PHASE3-EXIT-CHECKLIST.md` - the operator checklist and sign-off record.

## Quick start

```powershell
# Verify the harness itself
node apps/api/test/reconciliation/reconcile-payroll.cjs --selftest

# Golden fixture: must pass
node apps/api/test/reconciliation/reconcile-payroll.cjs `
  --actual apps/api/test/reconciliation/fixtures/ascenda-actual.csv `
  --expected apps/api/test/reconciliation/fixtures/pilot-expected.csv

# Golden fixture with one minor-unit error: must fail
node apps/api/test/reconciliation/reconcile-payroll.cjs `
  --actual apps/api/test/reconciliation/fixtures/ascenda-actual.csv `
  --expected apps/api/test/reconciliation/fixtures/pilot-expected-one-minor-unit-off.csv
```

Use `--report <path>` to write a JSON evidence report containing every diff and
the per-currency totals.

## Canonical CSV

Required columns, all amounts in integer minor units:

| Column | Meaning |
| --- | --- |
| `employee_number` | Stable worker identifier; must match between both files. |
| `currency` | ISO 4217 code, uppercase (for example `NGN`). |
| `gross_minor_units` | Employee gross pay. |
| `deductions_minor_units` | Total employee deductions, as a positive magnitude. |
| `net_minor_units` | Employee net pay. Must equal gross minus deductions. |
| `employer_costs_minor_units` | Employer-side cost (pension etc.), not deducted from net. |

Optional: `worker_name` (display only, never compared).

Example:

```csv
employee_number,currency,gross_minor_units,deductions_minor_units,net_minor_units,employer_costs_minor_units,worker_name
ASC-001,NGN,67500000,11000000,56500000,7500000,Ada Alpha
```

Do **not** put decimal points, thousands separators or currency symbols in the
amount columns. Convert major units to minor units with integer arithmetic
(1 NGN = 100 kobo, so `675000.00` becomes `67500000`).

## Exporting Ascenda actuals

Run this against a **processed** run (payslips exist) using the direct database
URL, not the pooled URL:

```powershell
psql "$env:DIRECT_URL" -v ON_ERROR_STOP=1 -v run_id='<payroll-run-uuid>' `
  -f apps/api/test/reconciliation/export-run-actuals.sql |
  Out-File -Encoding utf8 actual.csv
```

The harness accepts UTF-8 (with or without BOM) and UTF-16 files, so a direct
PowerShell `>` redirect also works.

The SQL mirrors the payroll domain fold: gross is net minus signed deduction
lines, deductions are the negated signed deduction lines, and employer costs
come from the frozen payslip. It supports normal and reversal runs.

## SQL smoke test

`sql-smoke.sql` exercises `export-run-actuals.sql` against temporary tables with
known payroll items and payslips. It runs inside a transaction and rolls back,
so it never touches real data. The expected output is
`fixtures/sql-smoke-expected.csv`.

```powershell
psql "$env:DIRECT_URL" -q -v ON_ERROR_STOP=1 `
  -f apps/api/test/reconciliation/sql-smoke.sql |
  Out-File -Encoding utf8 sql-smoke-actual.csv

node apps/api/test/reconciliation/reconcile-payroll.cjs `
  --actual sql-smoke-actual.csv `
  --expected apps/api/test/reconciliation/fixtures/sql-smoke-expected.csv
```

`-q` suppresses psql command tags so the output is pure CSV.

## Normalizing the pilot ledger

1. Select the same workers, pay period and currency as the Ascenda run.
2. Map the customer's worker identifier to `employee_number`; keep it stable.
3. Convert every amount to integer minor units exactly. Where the source has
   decimals, multiply by 100 using integer math; do not round floats.
4. Make deductions positive magnitudes. If the ledger stores them as negatives,
   remove the sign.
5. Keep employer costs separate; never add them to gross or subtract them from
   net.
6. Verify `net = gross - deductions` for every row before running the harness.

The harness rejects duplicate employee numbers, invalid currencies, non-integer
amounts and internally inconsistent rows, so a malformed ledger fails closed.

## Matching rules

- Worker sets must match exactly: a worker only in the pilot file is
  `MISSING_IN_ACTUAL`; a worker only in Ascenda is `EXTRA_IN_ACTUAL`.
- `gross`, `deductions`, `net` and `employer_costs` must match exactly in minor
  units.
- Currency must match.
- Per-currency totals are reported for evidence and must have zero deltas.

## Exit codes

- `0` - exact match, or self-test passed.
- `1` - any structural error, any difference, or invalid arguments/files.

## Limits

- Comparison is per worker and per aggregate money field, not per payslip line.
  Use the frozen payslip lines to investigate a difference.
- Reversal runs can be exported, but the pilot exit evidence must be a normal
  processed run for the agreed pay period.
- The harness is read-only; it never changes payroll data.
