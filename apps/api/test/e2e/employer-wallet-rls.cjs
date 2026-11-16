// Staging only, after migration 03. All synthetic fixtures share one transaction
// and are ALWAYS rolled back. No provider, email or external payment calls.
// node --env-file=packages/db/.env apps/api/test/e2e/employer-wallet-rls.cjs
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { Client } = createRequire(resolve(__dirname, '../../../../packages/db/package.json'))('pg');

async function main() {
  if (!process.env.DIRECT_URL) throw new Error('DIRECT_URL for a migrated staging database is required');
  const client = new Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();
  const ids = () => ({ org: randomUUID(), wallet: randomUUID(), worker: randomUUID(), calendar: randomUUID(), run: randomUUID(), batch: randomUUID(), payment: randomUUID(), ledger: randomUUID(), deposit: randomUUID(), reservation: randomUUID(), attempt: randomUUID() });
  const a = ids(), b = ids();
  try {
    await client.query('BEGIN');
    for (const f of [a, b]) {
      await client.query(`INSERT INTO organisations (id,name,slug,type,country,currency,timezone,"updatedAt") VALUES ($1,'Wallet rollback fixture',$1,'SME','NG','NGN','Africa/Lagos',now())`, [f.org]);
      await client.query(`INSERT INTO workers (id,"organisationId","employeeNumber","firstName","lastName",email,category,"employmentType","jobTitle","startDate","createdBy","updatedAt") VALUES ($1,$2,'TEST','Wallet','Fixture','test@example.invalid','EMPLOYEE','FULL_TIME','Test',now(),'test',now())`, [f.worker, f.org]);
      await client.query(`INSERT INTO pay_calendars (id,"organisationId",name,frequency,"createdBy","updatedAt") VALUES ($1,$2,'Rollback','MONTHLY','test',now())`, [f.calendar, f.org]);
      await client.query(`INSERT INTO payroll_runs (id,"organisationId","payCalendarId","periodStart","periodEnd","preparedById",currency,"createdBy","updatedAt") VALUES ($1,$2,$3,now(),now(),'test','NGN','test',now())`, [f.run, f.org, f.calendar]);
      await client.query(`INSERT INTO payment_batches (id,"organisationId","payrollRunId",reference,label,currency,"createdBy","updatedAt") VALUES ($1,$2,$3,$1,'Rollback','NGN','test',now())`, [f.batch, f.org, f.run]);
      await client.query(`INSERT INTO payments (id,"organisationId","payrollRunId","paymentBatchId","workerId","amountMinorUnits",currency,reference,description,"createdBy","updatedAt") VALUES ($1,$2,$3,$4,$5,100,'NGN',$1,'Rollback','test',now())`, [f.payment, f.org, f.run, f.batch, f.worker]);
      await client.query(`INSERT INTO payroll_wallets (id,"organisationId","setupReference","createdBy") VALUES ($1,$2,$1,'test')`, [f.wallet, f.org]);
      await client.query(`INSERT INTO payroll_wallet_ledger (id,"organisationId","walletId","eventKey",type,status,"amountMinorUnits","providerReference","actorId","occurredAt") VALUES ($1,$2,$3,'one','DEPOSIT','CONFIRMED',100,'deposit-fixture','test',now())`, [f.ledger, f.org, f.wallet]);
      await client.query(`INSERT INTO payroll_wallet_deposits (id,"organisationId","walletId","providerReference","amountMinorUnits","feeMinorUnits",status) VALUES ($1,$2,$3,'deposit-fixture',100,0,'CONFIRMED')`, [f.deposit, f.org, f.wallet]);
      await client.query(`INSERT INTO payroll_wallet_reservations (id,"organisationId","walletId","paymentBatchId","payrollRunId","requestKey","totalMinorUnits","feeMinorUnits","createdBy") VALUES ($1,$2,$3,$4,$5,$1,100,0,'test')`, [f.reservation, f.org, f.wallet, f.batch, f.run]);
      await client.query(`INSERT INTO payroll_wallet_attempts (id,"organisationId","walletId","reservationId","paymentBatchId","payrollRunId","paymentId","workerId",reference,"attemptNumber","amountMinorUnits","feeReservedMinorUnits","beneficiaryEncrypted") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$1,1,100,0,'not-real-bank-data')`, [f.attempt, f.org, f.wallet, f.reservation, f.batch, f.run, f.payment, f.worker]);
    }
    await client.query('SET LOCAL ROLE ascenda_app');
    const { rows: [role] } = await client.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user');
    assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
    const tables = [['payroll_wallets','wallet'], ['payroll_wallet_ledger','ledger'], ['payroll_wallet_deposits','deposit'], ['payroll_wallet_reservations','reservation'], ['payroll_wallet_attempts','attempt']];
    for (const [table, key] of tables) {
      await client.query("SELECT set_config('app.current_org',$1,true)", [a.org]);
      assert.equal((await client.query(`SELECT id FROM ${table} WHERE id=$1`, [a[key]])).rowCount, 1, `${table} own tenant`);
      assert.equal((await client.query(`SELECT id FROM ${table} WHERE id=$1`, [b[key]])).rowCount, 0, `${table} foreign tenant hidden`);
      await client.query("SELECT set_config('app.current_org','',true)");
      assert.equal((await client.query(`SELECT id FROM ${table} WHERE id=$1`, [a[key]])).rowCount, 0, `${table} missing context hidden`);
    }
    await client.query("SELECT set_config('app.current_org',$1,true)", [a.org]);
    async function rejected(sql, params, label) {
      await client.query('SAVEPOINT rejected_write');
      let error;
      try { await client.query(sql, params); } catch (caught) { error = caught; }
      await client.query('ROLLBACK TO SAVEPOINT rejected_write');
      assert.ok(error, label);
    }
    await rejected('UPDATE payroll_wallet_ledger SET status=status WHERE id=$1', [a.ledger], 'journal is immutable');
    await rejected('DELETE FROM payroll_wallet_reservations WHERE id=$1', [a.reservation], 'reservation evidence is immutable');
    await rejected('UPDATE payroll_wallets SET "availableMinorUnits"=-1 WHERE id=$1', [a.wallet], 'negative funds denied');
    await rejected(`INSERT INTO payroll_wallet_deposits (id,"organisationId","walletId","providerReference","amountMinorUnits","feeMinorUnits",status) VALUES ($1,$2,$3,'foreign',100,0,'CONFIRMED')`, [randomUUID(), a.org, b.wallet], 'foreign wallet link denied');
    await rejected(`INSERT INTO payroll_wallet_deposits (id,"organisationId","walletId","providerReference","amountMinorUnits","feeMinorUnits",status) VALUES ($1,$2,$3,'deposit-fixture',100,0,'CONFIRMED')`, [randomUUID(), a.org, a.wallet], 'duplicate deposit denied');
    await rejected(`INSERT INTO payroll_wallet_reservations (id,"organisationId","walletId","paymentBatchId","payrollRunId","requestKey","totalMinorUnits","feeMinorUnits","createdBy") VALUES ($1,$2,$3,$4,$5,$1,100,0,'test')`, [randomUUID(), a.org, a.wallet, b.batch, b.run], 'foreign payroll reference denied');
    console.log('PASS: employer wallet RLS, missing context, cross-tenant references, journal immutability, deposit uniqueness and nonnegative balances. Synthetic fixtures rolled back.');
  } finally { await client.query('ROLLBACK').catch(() => undefined); await client.end(); }
}
main().catch((error) => { console.error(`Employer wallet RLS test failed: ${error.message}`); process.exitCode = 1; });
