-- Additive PAY-17 employer funding release. Apply with the migration connection.
-- Does NOT create provider accounts, credit funds or change existing payrolls.
BEGIN;
CREATE TABLE payroll_wallets (
  id text PRIMARY KEY, "organisationId" text NOT NULL UNIQUE REFERENCES organisations(id),
  "setupReference" text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (status IN ('NOT_STARTED','PENDING_VERIFICATION','ACTIVE','REJECTED')),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  provider text, mode text CHECK (mode IN ('TEST','LIVE')),
  "providerWalletReference" text UNIQUE, "applicationEncrypted" text,
  "fundingAccountEncrypted" text, "bankName" text, "accountName" text,
  "pendingMinorUnits" integer NOT NULL DEFAULT 0 CHECK ("pendingMinorUnits" >= 0),
  "availableMinorUnits" integer NOT NULL DEFAULT 0 CHECK ("availableMinorUnits" >= 0),
  "reservedMinorUnits" integer NOT NULL DEFAULT 0 CHECK ("reservedMinorUnits" >= 0),
  "paidMinorUnits" integer NOT NULL DEFAULT 0 CHECK ("paidMinorUnits" >= 0),
  "lastReconciledAt" timestamp(3), "reconciliationRequired" boolean NOT NULL DEFAULT false,
  "createdBy" text NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, "organisationId")
);
CREATE TABLE payroll_wallet_ledger (
  id text PRIMARY KEY, "organisationId" text NOT NULL, "walletId" text NOT NULL,
  "eventKey" text NOT NULL, type text NOT NULL, status text NOT NULL,
  "amountMinorUnits" integer NOT NULL CHECK ("amountMinorUnits" >= 0),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  "pendingDelta" integer NOT NULL DEFAULT 0, "availableDelta" integer NOT NULL DEFAULT 0,
  "reservedDelta" integer NOT NULL DEFAULT 0, "paidDelta" integer NOT NULL DEFAULT 0,
  "providerReference" text NOT NULL, "payrollRunId" text, "paymentBatchId" text,
  "actorId" text NOT NULL, "occurredAt" timestamp(3) NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("walletId", "organisationId") REFERENCES payroll_wallets(id, "organisationId"),
  UNIQUE ("walletId", "eventKey")
);
CREATE INDEX ON payroll_wallet_ledger ("organisationId", "createdAt");
CREATE TABLE payroll_wallet_deposits (
  id text PRIMARY KEY, "organisationId" text NOT NULL, "walletId" text NOT NULL,
  "providerReference" text NOT NULL, "amountMinorUnits" integer NOT NULL CHECK ("amountMinorUnits" > 0),
  "feeMinorUnits" integer NOT NULL CHECK ("feeMinorUnits" >= 0 AND "feeMinorUnits" <= "amountMinorUnits"),
  status text NOT NULL CHECK (status IN ('PENDING','CONFIRMED','FAILED','REFUNDED')),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("walletId", "organisationId") REFERENCES payroll_wallets(id, "organisationId"),
  UNIQUE ("walletId", "providerReference")
);
CREATE INDEX ON payroll_wallet_deposits ("organisationId");
CREATE TABLE payroll_wallet_reservations (
  id text PRIMARY KEY, "organisationId" text NOT NULL, "walletId" text NOT NULL,
  "paymentBatchId" text NOT NULL REFERENCES payment_batches(id),
  "payrollRunId" text NOT NULL REFERENCES payroll_runs(id), "requestKey" text NOT NULL,
  retry boolean NOT NULL DEFAULT false,
  "totalMinorUnits" integer NOT NULL CHECK ("totalMinorUnits" > 0),
  "feeMinorUnits" integer NOT NULL CHECK ("feeMinorUnits" >= 0),
  "createdBy" text NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("walletId", "organisationId") REFERENCES payroll_wallets(id, "organisationId"),
  UNIQUE ("walletId", "requestKey"), UNIQUE (id, "organisationId")
);
CREATE INDEX ON payroll_wallet_reservations ("organisationId", "paymentBatchId");
CREATE TABLE payroll_wallet_attempts (
  id text PRIMARY KEY, "organisationId" text NOT NULL, "walletId" text NOT NULL,
  "reservationId" text NOT NULL, "paymentBatchId" text NOT NULL REFERENCES payment_batches(id),
  "payrollRunId" text NOT NULL REFERENCES payroll_runs(id),
  "paymentId" text NOT NULL REFERENCES payments(id), "workerId" text NOT NULL REFERENCES workers(id),
  reference text NOT NULL UNIQUE, "attemptNumber" integer NOT NULL CHECK ("attemptNumber" > 0),
  "amountMinorUnits" integer NOT NULL CHECK ("amountMinorUnits" > 0),
  "feeReservedMinorUnits" integer NOT NULL CHECK ("feeReservedMinorUnits" >= 0),
  "actualFeeMinorUnits" integer CHECK ("actualFeeMinorUnits" >= 0),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','PROCESSING','PAID','FAILED','REVERSED')),
  "providerTransferId" text, "beneficiaryEncrypted" text NOT NULL,
  "submittedAt" timestamp(3), "lastCheckedAt" timestamp(3), "completedAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("walletId", "organisationId") REFERENCES payroll_wallets(id, "organisationId"),
  FOREIGN KEY ("reservationId", "organisationId") REFERENCES payroll_wallet_reservations(id, "organisationId"),
  UNIQUE ("paymentId", "attemptNumber")
);
CREATE INDEX ON payroll_wallet_attempts ("organisationId", "paymentBatchId");

-- Reject cross-tenant references even if an application bug passes a foreign ID.
CREATE FUNCTION payroll_wallet_check_references() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payment_batches WHERE id = NEW."paymentBatchId"
      AND "organisationId" = NEW."organisationId" AND "payrollRunId" = NEW."payrollRunId") THEN
    RAISE EXCEPTION 'Invalid payroll wallet batch';
  END IF;
  IF TG_TABLE_NAME = 'payroll_wallet_attempts' THEN
    IF NOT EXISTS (
      SELECT 1 FROM payments WHERE id = NEW."paymentId" AND "organisationId" = NEW."organisationId"
      AND "paymentBatchId" = NEW."paymentBatchId" AND "workerId" = NEW."workerId"
      AND "amountMinorUnits" = NEW."amountMinorUnits" AND currency = NEW.currency) THEN
      RAISE EXCEPTION 'Invalid payroll wallet payment';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wallet_reservation_scope BEFORE INSERT ON payroll_wallet_reservations
  FOR EACH ROW EXECUTE FUNCTION payroll_wallet_check_references();
CREATE TRIGGER wallet_attempt_scope BEFORE INSERT OR UPDATE ON payroll_wallet_attempts
  FOR EACH ROW EXECUTE FUNCTION payroll_wallet_check_references();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_wallets','payroll_wallet_ledger','payroll_wallet_deposits','payroll_wallet_reservations','payroll_wallet_attempts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO ascenda_app USING ("organisationId" = current_org_id()) WITH CHECK ("organisationId" = current_org_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO ascenda_app', t);
    EXECUTE format('REVOKE DELETE, TRUNCATE ON %I FROM ascenda_app', t);
  END LOOP;
END $$;
REVOKE UPDATE ON payroll_wallet_ledger, payroll_wallet_reservations FROM ascenda_app;

-- Ledger rows and reservation evidence cannot be rewritten, even by accidental admin updates.
CREATE FUNCTION payroll_wallet_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Payroll wallet journal is immutable'; END $$;
CREATE TRIGGER immutable_wallet_ledger BEFORE UPDATE OR DELETE ON payroll_wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION payroll_wallet_immutable();
CREATE TRIGGER immutable_wallet_reservation BEFORE UPDATE OR DELETE ON payroll_wallet_reservations
  FOR EACH ROW EXECUTE FUNCTION payroll_wallet_immutable();
COMMIT;
