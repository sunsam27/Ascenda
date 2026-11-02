\set ON_ERROR_STOP on

COPY (
  WITH per_worker AS (
    SELECT
      pi."workerId",
      SUM(pi."amountMinorUnits")::bigint AS net_minor_units,
      SUM(
        CASE
          WHEN pi."type" IN ('DEDUCTION', 'TAX', 'EMPLOYEE_PENSION')
            THEN pi."amountMinorUnits"
          ELSE 0
        END
      )::bigint AS deduction_signed
    FROM payroll_items pi
    WHERE pi."payrollRunId" = :'run_id'
    GROUP BY pi."workerId"
  )
  SELECT
    w."employeeNumber" AS employee_number,
    r.currency AS currency,
    (pw.net_minor_units - pw.deduction_signed) AS gross_minor_units,
    (-pw.deduction_signed) AS deductions_minor_units,
    pw.net_minor_units AS net_minor_units,
    COALESCE(ps."employerCostsMinorUnits", 0)::bigint AS employer_costs_minor_units,
    w."firstName" || ' ' || w."lastName" AS worker_name
  FROM per_worker pw
  JOIN workers w ON w.id = pw."workerId"
  JOIN payroll_runs r ON r.id = :'run_id'
  LEFT JOIN payslips ps
    ON ps."payrollRunId" = r.id
   AND ps."workerId" = pw."workerId"
  ORDER BY w."employeeNumber"
) TO STDOUT WITH (FORMAT csv, HEADER true);
