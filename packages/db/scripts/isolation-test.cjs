// ─────────────────────────────────────────────────────────────────────────────
// TENANT ISOLATION TEST HARNESS (ROADMAP Phase 0 exit)
//
// Proves, at the database layer, that the `ascenda_app` role cannot read or
// write another organisation's data — regardless of application code.
//
//   • Fixtures are created through the privileged DIRECT_URL connection.
//   • Assertions run as the RLS-enforced `ascenda_app` role.
//   • Cross-tenant access must yield ZERO rows (SECURITY.md §3).
//
// Run: pnpm --filter @ascenda/db db:isolation-test
// ─────────────────────────────────────────────────────────────────────────────
const { Client } = require('pg');

function stripSsl(url) {
  return (url || '').replace(/([?&])sslmode=[^&]*/, '$1').replace(/[?&]$/, '');
}

function appUrlFrom(directUrl, appPassword) {
  const u = new URL(directUrl);
  const ref = u.username.includes('.') ? u.username.split('.')[1] : u.username;
  const user = `ascenda_app.${ref}`;
  const host = u.host;
  return `postgresql://${user}:${appPassword}@${host}${u.pathname}`;
}

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const direct = process.env.DIRECT_URL;
  const appPassword = process.env.ASCENDA_APP_PASSWORD;
  if (!direct || !appPassword) {
    throw new Error('DIRECT_URL and ASCENDA_APP_PASSWORD must be set');
  }

  const admin = new Client({
    connectionString: stripSsl(direct),
    ssl: { rejectUnauthorized: false },
  });
  const app = new Client({
    connectionString: appUrlFrom(direct, appPassword),
    ssl: { rejectUnauthorized: false },
  });

  await admin.connect();
  await app.connect();

  const stamp = Date.now().toString(36);
  const ids = {};

  const runCtx = async (orgId, userId, fn) => {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.current_org', $1, true)`, [
        orgId ?? '',
      ]);
      await app.query(`SELECT set_config('app.current_user_id', $1, true)`, [
        userId ?? '',
      ]);
      const result = await fn();
      await app.query('COMMIT');
      return result;
    } catch (error) {
      await app.query('ROLLBACK');
      throw error;
    }
  };

  try {
    // ── Fixtures (privileged) ────────────────────────────────────────────────
    const orgA = await admin.query(
      `INSERT INTO organisations (id, name, slug, type, country, currency, timezone, "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'CHURCH', 'NG', 'NGN', 'Africa/Lagos', now()) RETURNING id`,
      ['Isolation Org A', `isolation-a-${stamp}`],
    );
    const orgB = await admin.query(
      `INSERT INTO organisations (id, name, slug, type, country, currency, timezone, "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'SME', 'NG', 'NGN', 'Africa/Lagos', now()) RETURNING id`,
      ['Isolation Org B', `isolation-b-${stamp}`],
    );
    ids.orgA = orgA.rows[0].id;
    ids.orgB = orgB.rows[0].id;

    const userA = await admin.query(
      `INSERT INTO users (id, email, "passwordHash", "firstName", "lastName", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'x', 'A', 'User', now()) RETURNING id`,
      [`isolation-a-${stamp}@example.test`],
    );
    const userB = await admin.query(
      `INSERT INTO users (id, email, "passwordHash", "firstName", "lastName", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'x', 'B', 'User', now()) RETURNING id`,
      [`isolation-b-${stamp}@example.test`],
    );
    ids.userA = userA.rows[0].id;
    ids.userB = userB.rows[0].id;

    await admin.query(
      `INSERT INTO memberships (id, "organisationId", "userId", role, "createdBy", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'OWNER', $2, now()),
              (gen_random_uuid(), $3, $4, 'OWNER', $4, now())`,
      [ids.orgA, ids.userA, ids.orgB, ids.userB],
    );

    const deptA = await admin.query(
      `INSERT INTO departments (id, "organisationId", name, "createdBy", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'Dept A', $2, now()) RETURNING id`,
      [ids.orgA, ids.userA],
    );
    const deptB = await admin.query(
      `INSERT INTO departments (id, "organisationId", name, "createdBy", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'Dept B', $2, now()) RETURNING id`,
      [ids.orgB, ids.userB],
    );
    ids.deptA = deptA.rows[0].id;
    ids.deptB = deptB.rows[0].id;

    // Time & leave tables (PRD LVE-01/LVE-03) — new tenant-scoped tables.
    const ltA = await admin.query(
      `INSERT INTO leave_types (id, "organisationId", name, category, "defaultBalance", "isPaid", "createdBy", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'Annual A', 'ANNUAL', 21, true, $2, now()) RETURNING id`,
      [ids.orgA, ids.userA],
    );
    const ltB = await admin.query(
      `INSERT INTO leave_types (id, "organisationId", name, category, "defaultBalance", "isPaid", "createdBy", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'Annual B', 'ANNUAL', 21, true, $2, now()) RETURNING id`,
      [ids.orgB, ids.userB],
    );
    ids.ltA = ltA.rows[0].id;
    ids.ltB = ltB.rows[0].id;

    const holA = await admin.query(
      `INSERT INTO holidays (id, "organisationId", name, date, "isRecurring", "createdBy", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'Holiday A', '2026-01-01', false, $2, now()) RETURNING id`,
      [ids.orgA, ids.userA],
    );
    const holB = await admin.query(
      `INSERT INTO holidays (id, "organisationId", name, date, "isRecurring", "createdBy", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'Holiday B', '2026-01-01', false, $2, now()) RETURNING id`,
      [ids.orgB, ids.userB],
    );
    ids.holA = holA.rows[0].id;
    ids.holB = holB.rows[0].id;

    // Workers, leave requests, approval workflow + steps (PRD LVE-02).
    const workerA = await admin.query(
      `INSERT INTO workers (id, "organisationId", "employeeNumber", "firstName", "lastName", email, category, "employmentType", status, "jobTitle", "startDate", "createdBy", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'Work', 'A', $3, 'EMPLOYEE', 'FULL_TIME', 'ACTIVE', 'Staff', now(), $4, now()) RETURNING id`,
      [ids.orgA, `A-${stamp}`, `work-a-${stamp}@example.test`, ids.userA],
    );
    const workerB = await admin.query(
      `INSERT INTO workers (id, "organisationId", "employeeNumber", "firstName", "lastName", email, category, "employmentType", status, "jobTitle", "startDate", "createdBy", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'Work', 'B', $3, 'EMPLOYEE', 'FULL_TIME', 'ACTIVE', 'Staff', now(), $4, now()) RETURNING id`,
      [ids.orgB, `B-${stamp}`, `work-b-${stamp}@example.test`, ids.userB],
    );
    ids.workerA = workerA.rows[0].id;
    ids.workerB = workerB.rows[0].id;

    const lrA = await admin.query(
      `INSERT INTO leave_requests (id, "organisationId", "workerId", "leaveTypeId", "startDate", "endDate", days, status, "createdBy", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, '2026-03-02', '2026-03-06', 5, 'PENDING', $4, now()) RETURNING id`,
      [ids.orgA, ids.workerA, ids.ltA, ids.userA],
    );
    const lrB = await admin.query(
      `INSERT INTO leave_requests (id, "organisationId", "workerId", "leaveTypeId", "startDate", "endDate", days, status, "createdBy", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, '2026-03-02', '2026-03-06', 5, 'PENDING', $4, now()) RETURNING id`,
      [ids.orgB, ids.workerB, ids.ltB, ids.userB],
    );
    ids.lrA = lrA.rows[0].id;
    ids.lrB = lrB.rows[0].id;

    const wfA = await admin.query(
      `INSERT INTO approval_workflows (id, "organisationId", name, "resourceType", "resourceId", "currentStep", status, "createdBy", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'WF A', 'leave_request', $2, 0, 'PENDING', $3, now()) RETURNING id`,
      [ids.orgA, ids.lrA, ids.userA],
    );
    const wfB = await admin.query(
      `INSERT INTO approval_workflows (id, "organisationId", name, "resourceType", "resourceId", "currentStep", status, "createdBy", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'WF B', 'leave_request', $2, 0, 'PENDING', $3, now()) RETURNING id`,
      [ids.orgB, ids.lrB, ids.userB],
    );
    ids.wfA = wfA.rows[0].id;
    ids.wfB = wfB.rows[0].id;

    const stepA = await admin.query(
      `INSERT INTO approval_steps (id, "approvalWorkflowId", "stepOrder", "approverId", status, "updatedAt")
       VALUES (gen_random_uuid(), $1, 0, $2, 'PENDING', now()) RETURNING id`,
      [ids.wfA, ids.userA],
    );
    const stepB = await admin.query(
      `INSERT INTO approval_steps (id, "approvalWorkflowId", "stepOrder", "approverId", status, "updatedAt")
       VALUES (gen_random_uuid(), $1, 0, $2, 'PENDING', now()) RETURNING id`,
      [ids.wfB, ids.userB],
    );
    ids.stepA = stepA.rows[0].id;
    ids.stepB = stepB.rows[0].id;

    // Attendance records (PRD ATT-01/ATT-02) — new tenant-scoped table.
    const attA = await admin.query(
      `INSERT INTO attendance_records (id, "organisationId", "workerId", date, source, status, "createdBy", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, '2026-03-02', 'MANUAL', 'PRESENT', $3, now()) RETURNING id`,
      [ids.orgA, ids.workerA, ids.userA],
    );
    const attB = await admin.query(
      `INSERT INTO attendance_records (id, "organisationId", "workerId", date, source, status, "createdBy", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, '2026-03-02', 'MANUAL', 'PRESENT', $3, now()) RETURNING id`,
      [ids.orgB, ids.workerB, ids.userB],
    );
    ids.attA = attA.rows[0].id;
    ids.attB = attB.rows[0].id;

    // Blackout periods (PRD LVE-05) — new tenant-scoped table.
    const boA = await admin.query(
      `INSERT INTO blackout_periods (id, "organisationId", name, "startDate", "endDate", "isRecurring", "createdBy", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'Blackout A', '2026-12-24', '2026-12-31', false, $2, now()) RETURNING id`,
      [ids.orgA, ids.userA],
    );
    const boB = await admin.query(
      `INSERT INTO blackout_periods (id, "organisationId", name, "startDate", "endDate", "isRecurring", "createdBy", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'Blackout B', '2026-12-24', '2026-12-31', false, $2, now()) RETURNING id`,
      [ids.orgB, ids.userB],
    );
    ids.boA = boA.rows[0].id;
    ids.boB = boB.rows[0].id;

    console.log('\nTenant isolation assertions (as ascenda_app):');

    // ── No context: nothing is visible ───────────────────────────────────────
    const noCtx = await app.query('SELECT count(*)::int AS n FROM departments');
    check('no context → 0 departments visible', noCtx.rows[0].n === 0);

    // ── Org A context sees only Org A ────────────────────────────────────────
    const aDepts = await runCtx(ids.orgA, ids.userA, () =>
      app.query('SELECT id FROM departments ORDER BY name'),
    );
    check(
      'Org A sees exactly its own department',
      aDepts.rows.length === 1 && aDepts.rows[0].id === ids.deptA,
      `rows=${JSON.stringify(aDepts.rows)}`,
    );

    const aOrgs = await runCtx(ids.orgA, ids.userA, () =>
      app.query('SELECT id FROM organisations'),
    );
    check(
      'Org A sees exactly its own organisation',
      aOrgs.rows.length === 1 && aOrgs.rows[0].id === ids.orgA,
    );

    // ── Cross-tenant read by primary key → 0 rows (→ app layer returns 404) ──
    const crossRead = await runCtx(ids.orgA, ids.userA, () =>
      app.query('SELECT id FROM departments WHERE id = $1', [ids.deptB]),
    );
    check('Org A cannot read Org B department by id', crossRead.rows.length === 0);

    // ── Cross-tenant write → 0 rows affected ─────────────────────────────────
    const crossWrite = await runCtx(ids.orgA, ids.userA, () =>
      app.query(`UPDATE departments SET name = 'hacked' WHERE id = $1`, [
        ids.deptB,
      ]),
    );
    check(
      'Org A cannot update Org B department',
      crossWrite.rowCount === 0,
      `rowCount=${crossWrite.rowCount}`,
    );

    // ── Cross-tenant insert with a foreign organisationId → rejected ─────────
    let insertBlocked = false;
    try {
      await runCtx(ids.orgA, ids.userA, () =>
        app.query(
          `INSERT INTO departments (id, "organisationId", name, "createdBy", "updatedAt")
           VALUES (gen_random_uuid(), $1, 'spoofed', $2, now())`,
          [ids.orgB, ids.userA],
        ),
      );
    } catch {
      insertBlocked = true;
    }
    check('Org A cannot insert a row tagged to Org B', insertBlocked);

    // ── Leave types: same isolation guarantees ───────────────────────────────
    const aLeaveTypes = await runCtx(ids.orgA, ids.userA, () =>
      app.query('SELECT id FROM leave_types'),
    );
    check(
      'Org A sees exactly its own leave type',
      aLeaveTypes.rows.length === 1 && aLeaveTypes.rows[0].id === ids.ltA,
      `rows=${JSON.stringify(aLeaveTypes.rows)}`,
    );
    const crossLtRead = await runCtx(ids.orgA, ids.userA, () =>
      app.query('SELECT id FROM leave_types WHERE id = $1', [ids.ltB]),
    );
    check('Org A cannot read Org B leave type by id', crossRead.rows.length === 0);

    // ── Holidays — new tenant table must be isolated too ─────────────────────
    const aHols = await runCtx(ids.orgA, ids.userA, () =>
      app.query('SELECT id FROM holidays'),
    );
    check(
      'Org A sees exactly its own holiday',
      aHols.rows.length === 1 && aHols.rows[0].id === ids.holA,
      `rows=${JSON.stringify(aHols.rows)}`,
    );

    const crossHolRead = await runCtx(ids.orgA, ids.userA, () =>
      app.query('SELECT id FROM holidays WHERE id = $1', [ids.holB]),
    );
    check('Org A cannot read Org B holiday by id', crossHolRead.rows.length === 0);

    const crossHolWrite = await runCtx(ids.orgA, ids.userA, () =>
      app.query(`UPDATE holidays SET name = 'hacked' WHERE id = $1`, [ids.holB]),
    );
    check(
      'Org A cannot update Org B holiday',
      crossHolWrite.rowCount === 0,
      `rowCount=${crossHolWrite.rowCount}`,
    );

    let holInsertBlocked = false;
    try {
      await runCtx(ids.orgA, ids.userA, () =>
        app.query(
          `INSERT INTO holidays (id, "organisationId", name, date, "isRecurring", "createdBy", "updatedAt")
           VALUES (gen_random_uuid(), $1, 'spoofed', '2026-02-01', false, $2, now())`,
          [ids.orgB, ids.userA],
        ),
      );
    } catch {
      holInsertBlocked = true;
    }
    check('Org A cannot insert a holiday tagged to Org B', holInsertBlocked);

    // ── Blackout periods — new tenant table must be isolated too ─────────────
    const aBlackouts = await runCtx(ids.orgA, ids.userA, () =>
      app.query('SELECT id FROM blackout_periods'),
    );
    check(
      'Org A sees exactly its own blackout period',
      aBlackouts.rows.length === 1 && aBlackouts.rows[0].id === ids.boA,
      `rows=${JSON.stringify(aBlackouts.rows)}`,
    );

    const crossBoRead = await runCtx(ids.orgA, ids.userA, () =>
      app.query('SELECT id FROM blackout_periods WHERE id = $1', [ids.boB]),
    );
    check('Org A cannot read Org B blackout period by id', crossBoRead.rows.length === 0);

    const crossBoWrite = await runCtx(ids.orgA, ids.userA, () =>
      app.query(`UPDATE blackout_periods SET name = 'hacked' WHERE id = $1`, [
        ids.boB,
      ]),
    );
    check(
      'Org A cannot update Org B blackout period',
      crossBoWrite.rowCount === 0,
      `rowCount=${crossBoWrite.rowCount}`,
    );

    let boInsertBlocked = false;
    try {
      await runCtx(ids.orgA, ids.userA, () =>
        app.query(
          `INSERT INTO blackout_periods (id, "organisationId", name, "startDate", "endDate", "isRecurring", "createdBy", "updatedAt")
           VALUES (gen_random_uuid(), $1, 'spoofed', '2026-01-01', '2026-01-05', false, $2, now())`,
          [ids.orgB, ids.userA],
        ),
      );
    } catch {
      boInsertBlocked = true;
    }
    check('Org A cannot insert a blackout period tagged to Org B', boInsertBlocked);

    // ── Leave requests & approval workflow (PRD LVE-02) ──────────────────────
    const aReq = await runCtx(ids.orgA, ids.userA, () =>
      app.query('SELECT id FROM leave_requests'),
    );
    check(
      'Org A sees exactly its own leave request',
      aReq.rows.length === 1 && aReq.rows[0].id === ids.lrA,
      `rows=${JSON.stringify(aReq.rows)}`,
    );
    const crossReqRead = await runCtx(ids.orgA, ids.userA, () =>
      app.query('SELECT id FROM leave_requests WHERE id = $1', [ids.lrB]),
    );
    check(
      'Org A cannot read Org B leave request by id',
      crossReqRead.rows.length === 0,
    );

    const aWf = await runCtx(ids.orgA, ids.userA, () =>
      app.query('SELECT id FROM approval_workflows'),
    );
    check(
      'Org A sees exactly its own approval workflow',
      aWf.rows.length === 1 && aWf.rows[0].id === ids.wfA,
      `rows=${JSON.stringify(aWf.rows)}`,
    );

    const aStep = await runCtx(ids.orgA, ids.userA, () =>
      app.query('SELECT id FROM approval_steps'),
    );
    check(
      'Org A sees exactly its own approval step',
      aStep.rows.length === 1 && aStep.rows[0].id === ids.stepA,
      `rows=${JSON.stringify(aStep.rows)}`,
    );
    const crossStepRead = await runCtx(ids.orgA, ids.userA, () =>
      app.query('SELECT id FROM approval_steps WHERE id = $1', [ids.stepB]),
    );
    check(
      'Org A cannot read Org B approval step by id',
      crossStepRead.rows.length === 0,
    );

    let reqInsertBlocked = false;
    try {
      await runCtx(ids.orgA, ids.userA, () =>
        app.query(
          `INSERT INTO leave_requests (id, "organisationId", "workerId", "leaveTypeId", "startDate", "endDate", days, status, "createdBy", "updatedAt")
           VALUES (gen_random_uuid(), $1, $2, $3, '2026-04-01', '2026-04-02', 2, 'PENDING', $4, now())`,
          [ids.orgB, ids.workerB, ids.ltB, ids.userA],
        ),
      );
    } catch {
      reqInsertBlocked = true;
    }
    check(
      'Org A cannot insert a leave request tagged to Org B',
      reqInsertBlocked,
    );

    // ── Attendance records (PRD ATT-01/ATT-02) — new tenant table ────────────
    const aAtt = await runCtx(ids.orgA, ids.userA, () =>
      app.query('SELECT id FROM attendance_records'),
    );
    check(
      'Org A sees exactly its own attendance record',
      aAtt.rows.length === 1 && aAtt.rows[0].id === ids.attA,
      `rows=${JSON.stringify(aAtt.rows)}`,
    );

    const crossAttRead = await runCtx(ids.orgA, ids.userA, () =>
      app.query('SELECT id FROM attendance_records WHERE id = $1', [ids.attB]),
    );
    check(
      'Org A cannot read Org B attendance record by id',
      crossAttRead.rows.length === 0,
    );

    const crossAttWrite = await runCtx(ids.orgA, ids.userA, () =>
      app.query(`UPDATE attendance_records SET status = 'ABSENT' WHERE id = $1`, [
        ids.attB,
      ]),
    );
    check(
      'Org A cannot update Org B attendance record',
      crossAttWrite.rowCount === 0,
      `rowCount=${crossAttWrite.rowCount}`,
    );

    let attInsertBlocked = false;
    try {
      await runCtx(ids.orgA, ids.userA, () =>
        app.query(
          `INSERT INTO attendance_records (id, "organisationId", "workerId", date, source, status, "createdBy", "updatedAt")
           VALUES (gen_random_uuid(), $1, $2, '2026-04-01', 'MANUAL', 'PRESENT', $3, now())`,
          [ids.orgB, ids.workerB, ids.userA],
        ),
      );
    } catch {
      attInsertBlocked = true;
    }
    check(
      'Org A cannot insert an attendance record tagged to Org B',
      attInsertBlocked,
    );

    // ── Org B symmetric check ────────────────────────────────────────────────
    const bCrossRead = await runCtx(ids.orgB, ids.userB, () =>
      app.query('SELECT id FROM departments WHERE id = $1', [ids.deptA]),
    );
    check('Org B cannot read Org A department by id', bCrossRead.rows.length === 0);

    // ── Memberships self-read (login path, no org yet) ───────────────────────
    const selfMemberships = await runCtx(null, ids.userA, () =>
      app.query('SELECT "organisationId" FROM memberships'),
    );
    check(
      'membership self-read exposes only the caller memberships',
      selfMemberships.rows.length === 1 &&
        selfMemberships.rows[0].organisationId === ids.orgA,
      `rows=${JSON.stringify(selfMemberships.rows)}`,
    );

    const blobMemberships = await runCtx(ids.orgA, ids.userA, () =>
      app.query(
        'SELECT count(*)::int AS n FROM memberships WHERE "organisationId" = $1',
        [ids.orgB],
      ),
    );
    check(
      'Org A user cannot see Org B memberships',
      blobMemberships.rows[0].n === 0,
    );
  } finally {
    // ── Teardown ─────────────────────────────────────────────────────────────
    if (ids.orgA) {
      await admin.query(`DELETE FROM departments WHERE "organisationId" = ANY($1)`, [
        [ids.orgA, ids.orgB],
      ]);
      await admin.query(`DELETE FROM holidays WHERE "organisationId" = ANY($1)`, [
        [ids.orgA, ids.orgB],
      ]);
      await admin.query(
        `DELETE FROM approval_steps WHERE "approvalWorkflowId" = ANY($1)`,
        [[ids.wfA, ids.wfB]],
      );
      await admin.query(
        `DELETE FROM approval_workflows WHERE "organisationId" = ANY($1)`,
        [[ids.orgA, ids.orgB]],
      );
      await admin.query(
        `DELETE FROM leave_requests WHERE "organisationId" = ANY($1)`,
        [[ids.orgA, ids.orgB]],
      );
      await admin.query(
        `DELETE FROM attendance_records WHERE "organisationId" = ANY($1)`,
        [[ids.orgA, ids.orgB]],
      );
      await admin.query(
        `DELETE FROM blackout_periods WHERE "organisationId" = ANY($1)`,
        [[ids.orgA, ids.orgB]],
      );
      await admin.query(`DELETE FROM workers WHERE "organisationId" = ANY($1)`, [
        [ids.orgA, ids.orgB],
      ]);
      await admin.query(`DELETE FROM leave_types WHERE "organisationId" = ANY($1)`, [
        [ids.orgA, ids.orgB],
      ]);
      await admin.query(`DELETE FROM memberships WHERE "organisationId" = ANY($1)`, [
        [ids.orgA, ids.orgB],
      ]);
      await admin.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [ids.userA, ids.userB],
      ]);
      await admin.query(`DELETE FROM organisations WHERE id = ANY($1)`, [
        [ids.orgA, ids.orgB],
      ]);
    }
    await admin.end();
    await app.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('\nIsolation test errored:', error.message);
  process.exit(1);
});
