// Reviewed staging only, after migration 04. Synthetic fixtures, always rollback; no SMTP/API calls.
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const requireDb = createRequire(resolve(__dirname, '../../../../packages/db/package.json'));
const { Client } = requireDb('pg');
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Reviewed staging app-role DATABASE_URL required');
  // Explicit opt-in for reviewed dev databases using the migration helper's
  // self-signed TLS setup. Keep normal certificate verification by default.
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
      await db.query(
        'SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user',
      )
    ).rows[0];
    assert.equal(role.name, 'ascenda_app', 'test must use the actual application connection');
    assert.equal(role.rolsuper, false);
    assert.equal(role.rolbypassrls, false);
    const admin = randomUUID(),
      ownerA = randomUUID(),
      ownerB = randomUUID(),
      orgA = randomUUID(),
      orgB = randomUUID(),
      plan = randomUUID(),
      event = randomUUID(),
      email = randomUUID();
    for (const [id, isAdmin] of [
      [admin, true],
      [ownerA, false],
      [ownerB, false],
    ]) {
      await db.query(
        `INSERT INTO users(id,email,"passwordHash","firstName","lastName","isPlatformAdmin","updatedAt") VALUES($1,$2,'not-a-real-password','Test','Fixture',$3,now())`,
        [id, `${id}@example.invalid`, isAdmin],
      );
    }
    for (const [id, owner] of [
      [orgA, ownerA],
      [orgB, ownerB],
    ]) {
      await db.query("SELECT set_config('app.current_org',$1,true)", [id]);
      await db.query(
        `INSERT INTO organisations(id,name,slug,type,country,currency,timezone,"updatedAt") VALUES($1,'Synthetic test org',$1,'SME','NG','NGN','Africa/Lagos',now())`,
        [id],
      );
      await db.query(
        `INSERT INTO memberships(id,"organisationId","userId",role,"createdBy","updatedAt") VALUES($1,$2,$3,'OWNER',$3,now())`,
        [randomUUID(), id, owner],
      );
    }
    await db.query(
      `INSERT INTO plans(id,code,name,"priceMinorUnits",currency,"updatedAt") VALUES($1,$1,'Synthetic plan',10000,'NGN',now())`,
      [plan],
    );
    for (const [organisationId, status] of [
      [orgA, 'ACTIVE'],
      [orgB, 'CANCELLED'],
    ]) {
      await db.query("SELECT set_config('app.current_org',$1,true)", [organisationId]);
      await db.query(
        `INSERT INTO subscriptions(id,"organisationId","planId",status,"updatedAt") VALUES($1,$2,$3,$4,now())`,
        [randomUUID(), organisationId, plan, status],
      );
    }
    const payload = {
      planId: plan,
      planName: 'Synthetic plan',
      oldPriceMinorUnits: 10000,
      newPriceMinorUnits: 20000,
      oldCurrency: 'NGN',
      newCurrency: 'NGN',
      oldBillingPeriod: 'ANNUALLY',
      newBillingPeriod: 'ANNUALLY',
      changedAt: new Date().toISOString(),
    };
    await db.query("SELECT set_config('app.current_org','',true)");
    await db.query("SELECT set_config('app.current_user_id',$1,true)", [admin]);
    const audience = await db.query('SELECT * FROM plan_price_notice_audience($1)', [plan]);
    assert.deepEqual(
      audience.rows.map((r) => r.organisationId),
      [orgA],
      'only active/past-due subscribed organisations included',
    );
    await db.query(
      `INSERT INTO platform_plan_events(id,"actorId","planId",action,details,"notificationPayload","audienceOrganisationIds") VALUES($1,$2,$3,'PLAN_UPDATED','{}',$4,$5)`,
      [event, admin, plan, payload, [orgA]],
    );
    async function denied(sql, params) {
      await db.query('SAVEPOINT expected_denial');
      let failed = false;
      try {
        await db.query(sql, params);
      } catch {
        failed = true;
      } finally {
        await db.query('ROLLBACK TO SAVEPOINT expected_denial');
      }
      assert.equal(failed, true, 'operation must be denied');
    }
    await denied('UPDATE platform_plan_events SET details=$1 WHERE id=$2', [
      { changed: true },
      event,
    ]);
    await db.query("SELECT set_config('app.current_user_id',$1,true)", [ownerA]);
    assert.equal(
      (await db.query('SELECT id FROM platform_plan_events WHERE id=$1', [event])).rowCount,
      0,
      'organisation Owner cannot read platform history',
    );
    await denied('SELECT * FROM plan_price_notice_audience($1)', [plan]);
    await denied(
      `INSERT INTO platform_plan_events(id,"actorId","planId",action,details,"fanoutCompletedAt") VALUES($1,$2,$3,'PLAN_CREATED','{}',now())`,
      [randomUUID(), ownerA, plan],
    );
    await db.query("SELECT set_config('app.current_org',$1,true)", [orgA]);
    await db.query(
      `INSERT INTO plan_price_emails(id,"eventId","organisationId","recipientUserId",payload) VALUES($1,$2,$3,$4,$5)`,
      [email, event, orgA, ownerA, payload],
    );
    const duplicate = await db.query(
      `INSERT INTO plan_price_emails(id,"eventId","organisationId","recipientUserId",payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT("eventId","organisationId","recipientUserId") DO NOTHING`,
      [randomUUID(), event, orgA, ownerA, payload],
    );
    assert.equal(duplicate.rowCount, 0, 'fan-out retries do not duplicate intents');
    await denied('UPDATE plan_price_emails SET payload=$1 WHERE id=$2', [
      { tampered: true },
      email,
    ]);
    await denied(
      `INSERT INTO plan_price_emails(id,"eventId","organisationId","recipientUserId",payload) VALUES($1,$2,$3,$4,$5)`,
      [randomUUID(), event, orgA, ownerB, payload],
    );
    await db.query("SELECT set_config('app.current_org',$1,true)", [orgB]);
    assert.equal(
      (await db.query('SELECT id FROM plan_price_emails WHERE id=$1', [email])).rowCount,
      0,
      'other tenant email intent hidden',
    );
    await denied(
      `INSERT INTO plan_price_emails(id,"eventId","organisationId","recipientUserId",payload) VALUES($1,$2,$3,$4,$5)`,
      [randomUUID(), event, orgB, ownerB, payload],
    );
    await db.query("SELECT set_config('app.current_org','',true)");
    assert.equal(
      (await db.query('SELECT id FROM plan_price_emails WHERE id=$1', [email])).rowCount,
      0,
      'missing tenant fails closed',
    );
    console.log(
      'PASS: platform/tenant isolation, audience policy, immutable payloads, recipient membership and duplicate-intent prevention; all fixtures rolled back.',
    );
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    await db.end();
  }
}
main().catch((error) => {
  console.error(`Platform-admin RLS test failed: ${error.message}`);
  process.exitCode = 1;
});
