// Staging only. Synthetic aggregate fixtures, one transaction, unconditional rollback.
// node --env-file=packages/db/.env apps/api/test/e2e/analytics-rls.cjs
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const requireDb = createRequire(resolve(__dirname, '../../../../packages/db/package.json'));
const { Client } = requireDb('pg');

async function main() {
  if (!process.env.DIRECT_URL) throw new Error('A privileged staging DIRECT_URL is required');
  const client = new Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const orgs = (await client.query('SELECT id FROM organisations ORDER BY id LIMIT 2')).rows;
    const users = (await client.query('SELECT id FROM users ORDER BY id LIMIT 1')).rows;
    if (orgs.length !== 2 || !users.length)
      throw new Error('Staging requires two organisations and one user');
    const actor = users[0].id;
    const fixtures = [];
    for (const { id: org } of orgs) {
      const worker = randomUUID(),
        calendar = randomUUID(),
        run = randomUUID(),
        slip = randomUUID();
      const leaveType = randomUUID(),
        leave = randomUUID(),
        attendance = randomUUID();
      await client.query(
        `INSERT INTO workers (id,"organisationId","employeeNumber","firstName","lastName",email,category,"employmentType",status,"jobTitle","startDate","updatedAt","createdBy")
        VALUES ($1,$2,$1,'Analytics','Fixture','analytics-fixture@example.invalid','EMPLOYEE','FULL_TIME','ACTIVE','Fixture','2026-01-01',now(),$3)`,
        [worker, org, actor],
      );
      await client.query(
        `INSERT INTO pay_calendars (id,"organisationId",name,frequency,"updatedAt","createdBy") VALUES ($1,$2,'Analytics rollback fixture','MONTHLY',now(),$3)`,
        [calendar, org, actor],
      );
      await client.query(
        `INSERT INTO payroll_runs (id,"organisationId","payCalendarId","periodStart","periodEnd",status,"preparedById",currency,"updatedAt","createdBy")
        VALUES ($1,$2,$3,'2026-01-01','2026-01-31','PROCESSED',$4,'NGN',now(),$4)`,
        [run, org, calendar, actor],
      );
      await client.query(
        `INSERT INTO payslips (id,"organisationId","payrollRunId","workerId","periodLabel","periodStart","periodEnd",currency,"grossMinorUnits","netMinorUnits","updatedAt")
        VALUES ($1,$2,$3,$4,'January 2026','2026-01-01','2026-01-31','NGN',101,101,now())`,
        [slip, org, run, worker],
      );
      await client.query(
        `INSERT INTO leave_types (id,"organisationId",name,category,"defaultBalance","isPaid","updatedAt","createdBy")
        VALUES ($1,$2,'Analytics rollback fixture','ANNUAL',20,true,now(),$3)`,
        [leaveType, org, actor],
      );
      await client.query(
        `INSERT INTO leave_requests (id,"organisationId","workerId","leaveTypeId","startDate","endDate",days,status,"updatedAt","createdBy")
        VALUES ($1,$2,$3,$4,'2026-01-15','2026-01-15',0.5,'APPROVED',now(),$5)`,
        [leave, org, worker, leaveType, actor],
      );
      await client.query(
        `INSERT INTO attendance_records (id,"organisationId","workerId",date,status,"updatedAt","createdBy")
        VALUES ($1,$2,$3,'2026-01-16','PRESENT',now(),$4)`,
        [attendance, org, worker, actor],
      );
      fixtures.push({ org, worker, slip, leave, attendance });
    }
    await client.query('SET LOCAL ROLE ascenda_app');
    const role = (
      await client.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
    ).rows[0];
    assert.equal(role.rolsuper, false);
    assert.equal(role.rolbypassrls, false);
    const queries = [
      ['workers', 'worker', 'COUNT(*)::int AS value'],
      ['attendance_records', 'attendance', 'COUNT(*)::int AS value'],
      ['leave_requests', 'leave', 'COALESCE(SUM(days),0)::text AS value'],
      ['payslips', 'slip', 'COALESCE(SUM("grossMinorUnits"),0)::int AS value'],
    ];
    for (const current of fixtures) {
      await client.query("SELECT set_config('app.current_org',$1,true)", [current.org]);
      const directory = await client.query(
        `SELECT id,"employeeNumber","firstName","lastName",category,status,"jobTitle","startDate","endDate"
        FROM workers WHERE id=ANY($1::text[]) ORDER BY "employeeNumber",id`,
        [fixtures.map((f) => f.worker)],
      );
      assert.equal(directory.rowCount, 1, 'directory: only one tenant contributes');
      assert.equal(directory.rows[0].id, current.worker, 'directory: own workforce only');
      for (const [table, key, aggregate] of queries) {
        // Static table/column fragments above only; every fixture value is parameterised.
        const ids = fixtures.map((f) => f[key]);
        const own = await client.query(
          `SELECT "organisationId", ${aggregate} FROM ${table} WHERE id=ANY($1::text[]) GROUP BY "organisationId"`,
          [ids],
        );
        assert.equal(own.rowCount, 1, `${table}: exactly one tenant contributes`);
        assert.equal(own.rows[0].organisationId, current.org, `${table}: own tenant only`);
        assert.equal(
          Number(own.rows[0].value),
          table === 'payslips' ? 101 : table === 'leave_requests' ? 0.5 : 1,
        );
        const other = fixtures.find((f) => f.org !== current.org);
        const hidden = await client.query(
          `SELECT COUNT(*)::int AS count FROM ${table} WHERE id=$1`,
          [other[key]],
        );
        assert.equal(hidden.rows[0].count, 0, `${table}: other tenant excluded`);
      }
    }
    await client.query("SELECT set_config('app.current_org','',true)");
    for (const [table, key] of queries) {
      const rows = await client.query(
        `SELECT COUNT(*)::int AS count FROM ${table} WHERE id=ANY($1::text[])`,
        [fixtures.map((f) => f[key])],
      );
      assert.equal(rows.rows[0].count, 0, `${table}: missing context fails closed`);
    }
    console.log(
      'PASS: analytics source aggregates enforce tenant isolation and missing-context denial. All fixtures rolled back.',
    );
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}
main().catch((error) => {
  console.error(`Analytics RLS test failed: ${error.message}`);
  process.exitCode = 1;
});
