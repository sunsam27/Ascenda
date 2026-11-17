// Reviewed development DB only. Synthetic fixtures, always rollback; no SMTP/API calls.
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const requireDb = createRequire(resolve(__dirname, '../../../../packages/db/package.json'));
const { Client } = requireDb('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Reviewed app-role DATABASE_URL required');
  const allowSelfSigned = process.env.DB_TEST_ALLOW_SELF_SIGNED === 'true';
  const connectionString = allowSelfSigned
    ? process.env.DATABASE_URL.replace(/([?&])sslmode=[^&]*/, '$1').replace(/[?&]$/, '')
    : process.env.DATABASE_URL;
  const db = new Client({
    connectionString,
    ...(allowSelfSigned ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await db.connect();
  try {
    await db.query('BEGIN');
    const role = (
      await db.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
    ).rows[0];
    assert.equal(role.rolsuper, false, 'use the restricted application role');
    assert.equal(role.rolbypassrls, false, 'RLS must not be bypassed');

    const admin = randomUUID();
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const ownerC = randomUUID();
    const orgA = randomUUID();
    const orgB = randomUUID();
    const orgC = randomUUID();
    const paidPlan = randomUUID();
    const freePlan = randomUUID();

    for (const [id, isAdmin] of [[admin, true], [ownerA, false], [ownerB, false], [ownerC, false]]) {
      await db.query(
        `INSERT INTO users(id,email,"passwordHash","firstName","lastName","isPlatformAdmin","updatedAt") VALUES($1,$2,'not-real','Test','Fixture',$3,now())`,
        [id, `${id}@example.invalid`, isAdmin],
      );
    }
    for (const [id, owner] of [[orgA, ownerA], [orgB, ownerB], [orgC, ownerC]]) {
      await db.query("SELECT set_config('app.current_org',$1,true)", [id]);
      await db.query(
        `INSERT INTO organisations(id,name,slug,type,country,currency,timezone,"updatedAt") VALUES($1,'Synthetic access org',$1,'SME','NG','NGN','Africa/Lagos',now())`,
        [id],
      );
      await db.query(
        `INSERT INTO memberships(id,"organisationId","userId",role,"createdBy","updatedAt") VALUES($1,$2,$3,'OWNER',$3,now())`,
        [randomUUID(), id, owner],
      );
    }
    await db.query("SELECT set_config('app.current_org','',true)");
    await db.query(
      `INSERT INTO plans(id,code,name,"priceMinorUnits",currency,"isFree","updatedAt") VALUES($1,$1,'Paid fixture',10000,'NGN',false,now())`,
      [paidPlan],
    );
    await db.query(
      `INSERT INTO plans(id,code,name,"priceMinorUnits",currency,"isFree","updatedAt") VALUES($1,$1,'Free fixture',0,'NGN',true,now())`,
      [freePlan],
    );

    const paidPolicy = {
      people: true, timeLeave: true, documents: true,
      payroll: true, payments: true, analytics: true,
    };
    await db.query("SELECT set_config('app.current_user_id',$1,true)", [admin]);
    await db.query(
      `INSERT INTO plan_feature_policies("planId","enabledFeatures","trialDays","trialFeatures","defaultDemoDays","updatedBy") VALUES($1,$2,0,'{}',14,$3)`,
      [paidPlan, paidPolicy, admin],
    );
    await db.query(
      `INSERT INTO plan_feature_policies("planId","enabledFeatures","trialDays","trialFeatures","defaultDemoDays","updatedBy") VALUES($1,$2,7,$3,14,$4)`,
      [freePlan, { people: true, timeLeave: true, documents: true, payroll: false, payments: false, analytics: false },
        { payroll: true }, admin],
    );

    async function denied(label, sql, params) {
      await db.query('SAVEPOINT expected_denial');
      let failed = false;
      try {
        await db.query(sql, params);
      } catch {
        failed = true;
      } finally {
        await db.query('ROLLBACK TO SAVEPOINT expected_denial');
      }
      assert.equal(failed, true, `${label} must be denied`);
    }
    async function noRows(label, sql, params) {
      const result = await db.query(sql, params);
      assert.equal(result.rowCount, 0, `${label} must affect no rows`);
    }

    await db.query("SELECT set_config('app.current_user_id',$1,true)", [ownerA]);
    await noRows('non-admin policy write',
      `UPDATE plan_feature_policies SET "enabledFeatures"=$2 WHERE "planId"=$1`,
      [paidPlan, { payroll: false }],
    );
    await denied('non-admin organisation listing', 'SELECT * FROM subscription_admin_organisations($1,$2,$3)', ['', 25, 0]);

    await db.query("SELECT set_config('app.current_user_id',$1,true)", [admin]);
    const orgs = await db.query('SELECT * FROM subscription_admin_organisations($1,$2,$3)', ['', 25, 0]);
    const visibleOrgs = orgs.rows.map((r) => r.organisationId);
    assert.ok([orgA, orgB, orgC].every((id) => visibleOrgs.includes(id)), 'platform admin can list organisation billing metadata');

    for (const [organisationId, status, planId] of [[orgA, 'ACTIVE', paidPlan], [orgB, 'ACTIVE', paidPlan], [orgC, 'ACTIVE', freePlan]]) {
      await db.query("SELECT set_config('app.current_org',$1,true)", [organisationId]);
      await db.query(
        `INSERT INTO subscriptions(id,"organisationId","planId",status,"updatedAt") VALUES($1,$2,$3,$4,now())`,
        [randomUUID(), organisationId, planId, status],
      );
    }

    await db.query("SELECT set_config('app.current_org',$1,true)", [orgA]);
    await db.query(
      `INSERT INTO organisation_access_controls("organisationId","manualState","demoFeatures","demoExpiresAt","updatedBy") VALUES($1,'AUTO',$2,now()+interval '1 day',$3)`,
      [orgA, { payroll: true }, admin],
    );
    const periodEnd = new Date(Date.now() + 7 * 86400000);
    const eventId = randomUUID();
    await db.query(
      `INSERT INTO subscription_lifecycle_events("id","organisationId","periodEnd","kind") VALUES($1,$2,$3,'REMINDER_7')`,
      [eventId, orgA, periodEnd],
    );
    const duplicate = await db.query(
      `INSERT INTO subscription_lifecycle_events("id","organisationId","periodEnd","kind") VALUES($1,$2,$3,'REMINDER_7') ON CONFLICT("organisationId","periodEnd","kind") DO NOTHING`,
      [randomUUID(), orgA, periodEnd],
    );
    assert.equal(duplicate.rowCount, 0, 'reminder ledger is idempotent');
    await denied('lifecycle marker deletion', 'DELETE FROM subscription_lifecycle_events WHERE id=$1', [eventId]);
    await denied('lifecycle marker mutation', 'UPDATE subscription_lifecycle_events SET kind=$1 WHERE id=$2', ['RESTORED', eventId]);

    await db.query("SELECT set_config('app.current_user_id',$1,true)", [ownerA]);
    assert.equal((await db.query('SELECT * FROM organisation_access_controls')).rowCount, 1, 'tenant can read own control');
    await noRows('non-admin control write',
      `UPDATE organisation_access_controls SET "manualState"='SUSPENDED' WHERE "organisationId"=$1`,
      [orgA],
    );
    assert.equal(
      (await db.query('SELECT * FROM subscription_lifecycle_events WHERE id=$1', [eventId])).rowCount,
      1,
      'tenant can read own lifecycle marker',
    );

    await db.query("SELECT set_config('app.current_org',$1,true)", [orgB]);
    assert.equal((await db.query('SELECT * FROM organisation_access_controls')).rowCount, 0, 'other tenant controls hidden');
    assert.equal(
      (await db.query('SELECT * FROM subscription_lifecycle_events WHERE id=$1', [eventId])).rowCount,
      0,
      'other tenant reminders hidden',
    );

    await db.query("SELECT set_config('app.current_org',$1,true)", [orgA]);
    await db.query("SELECT set_config('app.current_user_id',$1,true)", [admin]);
    await db.query(
      `UPDATE organisation_access_controls SET "demoExpiresAt"=now()-interval '1 minute' WHERE "organisationId"=$1`,
      [orgA],
    );
    const expired = await db.query('SELECT * FROM expire_current_organisation_overrides()');
    assert.deepEqual(expired.rows.map((r) => r.reason), ['DEMO_EXPIRED']);
    const afterExpiry = (
      await db.query('SELECT * FROM organisation_access_controls WHERE "organisationId"=$1', [orgA])
    ).rows[0];
    assert.deepEqual(afterExpiry.demoFeatures, {});
    assert.equal(afterExpiry.demoExpiresAt, null);

    await db.query(
      `UPDATE organisation_access_controls SET "manualState"='SUSPENDED' WHERE "organisationId"=$1`,
      [orgA],
    );
    assert.equal((await db.query('SELECT restore_current_organisation_access_for_payment()')).rows[0].restore_current_organisation_access_for_payment, true);
    const restored = (
      await db.query('SELECT * FROM organisation_access_controls WHERE "organisationId"=$1', [orgA])
    ).rows[0];
    assert.equal(restored.manualState, 'AUTO', 'verified payment restoration clears suspension');

    await db.query("SELECT set_config('app.current_org',$1,true)", [orgC]);
    await db.query("SELECT set_config('app.current_user_id',$1,true)", [ownerC]);
    await db.query('SELECT initialise_organisation_trial()');
    const trial = (
      await db.query('SELECT * FROM organisation_access_controls WHERE "organisationId"=$1', [orgC])
    ).rows[0];
    assert.deepEqual(trial.demoFeatures, { payroll: true }, 'free signup gets only configured trial features');
    assert.ok(trial.trialStartedAt, 'trial start is recorded');

    console.log(
      'PASS: subscription policies, tenant isolation, immutable reminders, finite expiry, verified-payment restoration and signup trial; all fixtures rolled back.',
    );
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    await db.end();
  }
}
main().catch((error) => {
  console.error(`Subscription access RLS test failed: ${error.message}`);
  process.exitCode = 1;
});
