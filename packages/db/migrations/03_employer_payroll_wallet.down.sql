-- Empty-install rollback ONLY. Never discard financial history.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM payroll_wallet_ledger) OR EXISTS (SELECT 1 FROM payroll_wallet_reservations)
    OR EXISTS (SELECT 1 FROM payroll_wallets) THEN
    RAISE EXCEPTION 'Rollback refused: employer wallet records exist; use a forward migration';
  END IF;
END $$;
DROP TABLE payroll_wallet_attempts, payroll_wallet_reservations, payroll_wallet_deposits, payroll_wallet_ledger, payroll_wallets;
DROP FUNCTION payroll_wallet_check_references();
DROP FUNCTION payroll_wallet_immutable();
COMMIT;
