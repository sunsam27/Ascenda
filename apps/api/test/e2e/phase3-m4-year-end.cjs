// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 M4 TEST — Year-end statements & statutory remittance schedules
// "PAY-16: year-end employee statements and statutory remittance schedules."
//
// Covers over the real API + database:
//   * Statements frozen from processed payslips, idempotent per (worker, year),
//     immutable, totalling to the payslip sums; private PDF download.
//   * Remittance schedule aggregating the year's statutory lines, split
//     employee vs employer, with the LOC-03 "unvalidated pack" flag surfaced.
//   * Tax-year window is configuration data (PayrollConfig.taxYearStartMonth).
//   * Self-service scoping (a worker sees only their own statement).
//   * Audits (YEAR_END_STATEMENT_GENERATED/ACCESSED, REMITTANCE_SCHEDULE_EXPORTED)
//     and the unauthenticated guard.
//
// Run (from repo root, API + DB running):
//   node --env-file=packages\db\.env apps\api\test\e2e\phase3-m4-year-end.cjs
// ─────────────────────────────────────────────────────────────────────────────
const { Client } = require('C:\\Users\\shegz\\dev\\Ascenda\\packages\\db\\node_modules\\pg');
const argon2 = require('C:\\Users\\shegz\\dev\\Ascenda\\node_modules\\.pnpm\\argon2@0.43.1\\node_modules\\argon2');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/v1';
let cookie = '';
let passed = 0;
let failed = 0;

function heading(title) {
  console.log(`\n${title}`);
}

function check(ok, msg, detail) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${msg}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${msg}${detail ? ` — ${detail}` : ''}`);
  }
}

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (setCookies.length) {
    const jar = new Map();
    cookie
      .split('; ')
      .filter(Boolean)
      .forEach((pair) => {
        const i = pair.indexOf('=');
        jar.set(pair.slice(0, i), pair.slice(i + 1));
      });
    setCookies.forEach((c) => {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    });
    cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function reqRaw(method, path) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: cookie ? { Cookie: cookie } : {},
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    contentType: res.headers.get('content-type') || '',
    buf,
    text: buf.toString('utf8'),
  };
}

const dataOf = (r) => (r.json && r.json.data ? r.json.data : {});

async function login(email) {
  cookie = '';
  const res = await req('POST', '/auth/login', {
    email,
    password: 'AscendaDemo123!',
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
}

async function createWorker(payload) {
  const res = await req('POST', '/workers', payload);
  const w = dataOf(res);
  if (!w.id) {
    throw new Error(`worker create failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return w.id;
}

async function createComp(workerId, body) {
  const res = await req('POST', `/workers/${workerId}/compensation`, body);
  const comp = dataOf(res);
  if (!comp.id) {
    throw new Error(`comp create failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return comp.id;
}

async function main() {
  await login('owner@ascenda.dev');

  const stamp = Date.now().toString(36);
  const cleanup = {
    workerIds: [],
    compIds: [],
    runIds: [],
    packIds: [],
    payslipRunIds: [],
    userIds: [],
    bankWorkerIds: [],
  };

  const db = new Client({
    connectionString: (process.env.DIRECT_URL || '').replace(
      /([?&])sslmode=[^&]*/,
      '$1',
    ),
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  let orgId = null;

  try {
    // ── Fixtures ────────────────────────────────────────────────────────────
    heading('FIXTURES');

    const orgRow = await db.query(
      `SELECT m."organisationId" FROM memberships m
       JOIN users u ON u.id = m."userId"
       WHERE u.email = 'owner@ascenda.dev' LIMIT 1`,
    );
    orgId = orgRow.rows[0].organisationId;

    await db.query(
      `DELETE FROM year_end_statements WHERE "workerId" IN (
         SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M4-%')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payslips WHERE "payrollRunId" IN (
         SELECT id FROM payroll_runs WHERE "organisationId" = $1 AND notes LIKE 'M4 e2e %')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payslips WHERE "workerId" IN (
         SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M4-%')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payments WHERE "payrollRunId" IN (
         SELECT id FROM payroll_runs WHERE "organisationId" = $1 AND notes LIKE 'M4 e2e %')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payroll_items WHERE "payrollRunId" IN (
         SELECT id FROM payroll_runs WHERE "organisationId" = $1 AND notes LIKE 'M4 e2e %')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payroll_run_approvals WHERE "payrollRunId" IN (
         SELECT id FROM payroll_runs WHERE "organisationId" = $1 AND notes LIKE 'M4 e2e %')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payroll_runs WHERE "organisationId" = $1 AND notes LIKE 'M4 e2e %'`,
      [orgId],
    );
    await db.query(
      `DELETE FROM statutory_rule_packs WHERE "organisationId" = $1 AND version LIKE 'M4-%'`,
      [orgId],
    );
    await db.query(
      `DELETE FROM compensation_records WHERE "workerId" IN (
         SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M4-%')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM bank_accounts WHERE "workerId" IN (
         SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M4-%')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M4-%'`,
      [orgId],
    );
    await db.query(
      `DELETE FROM audit_log WHERE "actorId" IN (
         SELECT id FROM users WHERE email LIKE 'm4-%@ascenda.test')`,
    );
    await db.query(
      `DELETE FROM memberships WHERE "userId" IN (
         SELECT id FROM users WHERE email LIKE 'm4-%@ascenda.test')`,
    );
    await db.query(`DELETE FROM users WHERE email LIKE 'm4-%@ascenda.test'`);

    const orgCountry = await db.query(
      `SELECT country FROM organisations WHERE id = $1`,
      [orgId],
    );
    const country = orgCountry.rows[0].country || 'NG';

    const paEmail = `m4-pa-${stamp}@ascenda.test`;
    const passwordHash = await argon2.hash('AscendaDemo123!', {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
    const paUser = await db.query(
      `INSERT INTO users (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'Pat', 'Admin', now(), now()) RETURNING id`,
      [paEmail, passwordHash],
    );
    cleanup.userIds.push(paUser.rows[0].id);
    await db.query(
      `INSERT INTO memberships (id, "organisationId", "userId", role, "isActive", "acceptedAt", "createdBy", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'PAYROLL_ADMINISTRATOR', true, now(), $3, now(), now())`,
      [orgId, paUser.rows[0].id, paUser.rows[0].id],
    );

    const workerA = await createWorker({
      employeeNumber: `M4-A-${stamp}`,
      firstName: 'Ada',
      lastName: 'Alpha',
      email: `m4-a-${stamp}@example.test`,
      category: 'EMPLOYEE',
      employmentType: 'FULL_TIME',
      jobTitle: 'Engineer',
      status: 'ACTIVE',
      startDate: '2026-06-01',
    });
    const workerB = await createWorker({
      employeeNumber: `M4-B-${stamp}`,
      firstName: 'Ben',
      lastName: 'Beta',
      email: `m4-b-${stamp}@example.test`,
      category: 'EMPLOYEE',
      employmentType: 'FULL_TIME',
      jobTitle: 'Analyst',
      status: 'ACTIVE',
      startDate: '2026-06-01',
    });
    cleanup.workerIds.push(workerA, workerB);

    cleanup.compIds.push(
      await createComp(workerA, {
        payFrequency: 'MONTHLY',
        validFrom: '2026-06-01',
        components: [
          { code: 'BASIC_SALARY', label: 'Basic salary', amountMinorUnits: 1000000 },
        ],
      }),
    );
    cleanup.compIds.push(
      await createComp(workerB, {
        payFrequency: 'MONTHLY',
        validFrom: '2026-06-01',
        components: [
          { code: 'BASIC_SALARY', label: 'Basic salary', amountMinorUnits: 500000 },
        ],
      }),
    );

    for (const workerId of [workerA, workerB]) {
      await db.query(
        `INSERT INTO bank_accounts (id, "organisationId", "workerId", "bankName", "bankCode",
           "accountNumberEncrypted", "accountNumberMasked", "accountName", "isVerified", "isPrimary",
           "createdBy", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, 'Test Bank', '000', 'enc', '****1234', 'Test User', true, true, $3, now(), now())`,
        [orgId, workerId, workerId],
      );
      cleanup.bankWorkerIds.push(workerId);
    }

    const calRes = await req('GET', '/payroll/pay-calendars?pageSize=200');
    const monthly = (calRes.json.data || []).find((c) => c.name === 'Monthly');
    check(!!monthly, 'seeded "Monthly" pay calendar present');

    // A validated statutory pack so the remittance schedule has lines.
    await login(paEmail);
    const pack = dataOf(
      await req('POST', '/payroll/statutory-rule-packs', {
        country,
        version: `M4-live-${stamp}`,
        validFrom: '2026-01-01',
        rules: [
          {
            code: 'PAYE',
            label: 'Income tax',
            kind: 'PERCENT_CAPPED',
            base: 'GROSS',
            side: 'EMPLOYEE',
            itemType: 'TAX',
            rateBps: 1000,
          },
          {
            code: 'EMPLOYEE_PENSION',
            label: 'Employee pension',
            kind: 'PERCENT_CAPPED',
            base: 'GROSS',
            side: 'EMPLOYEE',
            itemType: 'EMPLOYEE_PENSION',
            rateBps: 800,
          },
          {
            code: 'EMPLOYER_PENSION',
            label: 'Employer pension',
            kind: 'PERCENT_CAPPED',
            base: 'GROSS',
            side: 'EMPLOYER',
            itemType: 'EMPLOYER_PENSION',
            rateBps: 1000,
          },
        ],
      }),
    );
    cleanup.packIds.push(pack.id);
    const validated = dataOf(
      await req('PATCH', `/payroll/statutory-rule-packs/${pack.id}/validation`, {
        validated: true,
      }),
    );
    check(validated.validated === true, 'F1 statutory pack created + validated');

    // ── Process a run (creates payslips for the tax year) ───────────────────
    heading('PROCESS A RUN (payslips feed the year-end)');
    const runRes = await req('POST', '/payroll/runs', {
      payCalendarId: monthly.id,
      periodStart: '2026-12-01',
      periodEnd: '2026-12-31',
      notes: `M4 e2e year-end ${stamp}`,
    });
    const run = dataOf(runRes);
    if (!run.id) {
      throw new Error(`run create failed: ${runRes.status} ${JSON.stringify(runRes.json)}`);
    }
    cleanup.runIds.push(run.id);
    cleanup.payslipRunIds.push(run.id);

    await req('POST', `/payroll/runs/${run.id}/prepare`);
    await req('POST', `/payroll/runs/${run.id}/submit`);
    await login('owner@ascenda.dev');
    await req('POST', `/payroll/runs/${run.id}/approve`, {});
    const processRes = await req('POST', `/payroll/runs/${run.id}/process`);
    const payslips = (await req('GET', `/payslips?payrollRunId=${run.id}`)).json.data || [];
    check(
      payslips.length >= 2,
      'P1 run processed and payslips generated',
      `status=${processRes.status} n=${payslips.length}`,
    );

    const slipA = payslips.find((p) => p.workerId === workerA);
    // Worker A gross 1,000,000: tax 10% = 100,000; pension 8% = 80,000;
    // employer pension 10% = 100,000 (cost). Net = 1,000,000 − 180,000 = 820,000.
    check(
      slipA &&
        slipA.grossMinorUnits === 1000000 &&
        slipA.deductionsMinorUnits === 180000 &&
        slipA.netMinorUnits === 820000 &&
        slipA.employerCostsMinorUnits === 100000,
      'P2 payslip A reconciles (gross 1,000,000 / deductions 180,000 / net 820,000 / employer 100,000)',
      JSON.stringify(slipA),
    );

    // ── PAY-16a: YEAR-END STATEMENTS ────────────────────────────────────────
    heading('PAY-16a YEAR-END STATEMENTS');
    const gen = dataOf(
      await req('POST', '/payroll/year-end/statements', { year: 2026 }),
    );
    check(
      gen.created >= 2 && gen.taxYearLabel === '2026',
      'Y1 statements generated for tax year 2026',
      JSON.stringify(gen),
    );

    const listRes = await req('GET', '/payroll/year-end/statements?pageSize=100');
    const statements = listRes.json.data || [];
    const stmtA = statements.find((s) => s.workerId === workerA);
    check(
      !!stmtA && statements.length >= 2,
      'Y2 statements listed',
      `n=${statements.length}`,
    );
    check(
      stmtA &&
        stmtA.grossMinorUnits === 1000000 &&
        stmtA.deductionsMinorUnits === 180000 &&
        stmtA.netMinorUnits === 820000 &&
        stmtA.employerCostsMinorUnits === 100000 &&
        stmtA.payslipCount === 1,
      'Y3 statement A totals reconcile with the payslip',
      JSON.stringify(stmtA),
    );
    check(
      stmtA && stmtA.validatedByProfessional === true,
      'Y4 statement carries the validated-pack flag (LOC-03)',
    );
    const taxLine = (stmtA?.lines || []).find((l) => l.description === 'Income tax');
    check(
      taxLine && taxLine.amountMinorUnits === -100000,
      'Y5 statement line rolls the tax up for the year (−100,000)',
      JSON.stringify(taxLine),
    );

    // Idempotency: re-generating creates no duplicates.
    const gen2 = dataOf(
      await req('POST', '/payroll/year-end/statements', { year: 2026 }),
    );
    const afterRes = await req('GET', '/payroll/year-end/statements?pageSize=100');
    const afterCount = (afterRes.json.data || []).length;
    check(
      gen2.created === 0 && afterCount === statements.length,
      'Y6 regenerating is a no-op (idempotent)',
      `created=${gen2.created} before=${statements.length} after=${afterCount}`,
    );

    const pdf = await reqRaw('GET', `/payroll/year-end/statements/${stmtA.id}/pdf`);
    check(
      pdf.status === 200 &&
        pdf.contentType.includes('application/pdf') &&
        pdf.buf.slice(0, 5).toString() === '%PDF-',
      'Y7 statement PDF downloads (application/pdf, %PDF- magic)',
      `status=${pdf.status} ct=${pdf.contentType}`,
    );

    // ── PAY-16b: REMITTANCE SCHEDULE ────────────────────────────────────────
    heading('PAY-16b REMITTANCE SCHEDULE');
    const remitRes = await req('GET', '/payroll/year-end/remittance?year=2026');
    const remit = dataOf(remitRes);
    check(
      remit.taxYearLabel === '2026',
      'R1 remittance schedule for tax year 2026',
      JSON.stringify(remit).slice(0, 160),
    );
    // Employee: A tax 100,000 + pension 80,000; B gross 500,000 → tax 50,000,
    // pension 40,000. Employee total = 270,000.
    check(
      remit.employeeTotalMinorUnits === 270000,
      'R2 employee-side statutory total = 270,000',
      `got=${remit.employeeTotalMinorUnits}`,
    );
    // Employer: A 100,000 + B 50,000 = 150,000.
    check(
      remit.employerTotalMinorUnits === 150000,
      'R3 employer-side statutory total = 150,000',
      `got=${remit.employerTotalMinorUnits}`,
    );
    const employerLine = (remit.lines || []).find((l) => l.side === 'EMPLOYER');
    check(
      employerLine && employerLine.amountMinorUnits === 150000,
      'R4 employer pension grouped on the employer side',
      JSON.stringify(employerLine),
    );
    check(
      remit.validatedByProfessional === true,
      'R5 schedule surfaces the validated-pack flag',
    );

    const csv = await reqRaw('GET', '/payroll/year-end/remittance/export?year=2026');
    check(
      csv.status === 200 &&
        csv.contentType.includes('text/csv') &&
        csv.text.startsWith('\uFEFF') &&
        csv.text.includes('tax_year,scheme,side') &&
        csv.text.includes('Income tax'),
      'R6 remittance CSV exports (BOM, header, scheme rows)',
      `status=${csv.status} ct=${csv.contentType}`,
    );

    // ── TAX-YEAR CONFIG ─────────────────────────────────────────────────────
    heading('TAX-YEAR WINDOW IS CONFIGURATION');
    await login(paEmail);
    const cfg = dataOf(
      await req('PATCH', '/payroll/config', { taxYearStartMonth: 4 }),
    );
    check(cfg.taxYearStartMonth === 4, 'C1 tax-year start month is configurable');
    // With an April start, year 2026 = [2026-04-01, 2027-04-01): the Dec-2026
    // payslips fall inside it, so the schedule is NOT empty.
    const remit2 = dataOf(
      await req('GET', '/payroll/year-end/remittance?year=2026'),
    );
    check(
      remit2.taxYearLabel === '2026/2027' && remit2.lines.length > 0,
      'C2 April-start year 2026/2027 includes the Dec-2026 payslips',
      `label=${remit2.taxYearLabel} lines=${remit2.lines.length}`,
    );
    // But an April-start 2025 = [2025-04-01, 2026-04-01) excludes Dec-2026.
    const remit3 = dataOf(
      await req('GET', '/payroll/year-end/remittance?year=2025'),
    );
    check(
      remit3.taxYearLabel === '2025/2026' && remit3.lines.length === 0,
      'C3 earlier April-start year excludes the Dec-2026 payslips (empty schedule)',
      `label=${remit3.taxYearLabel} lines=${remit3.lines.length}`,
    );
    await req('PATCH', '/payroll/config', { taxYearStartMonth: 1 });

    // ── SELF-SERVICE SCOPING ────────────────────────────────────────────────
    heading('SELF-SERVICE SCOPING');
    const selfEmail = `m4-self-${stamp}@ascenda.test`;
    const selfUser = await db.query(
      `INSERT INTO users (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'Solo', 'Self', now(), now()) RETURNING id`,
      [selfEmail, passwordHash],
    );
    cleanup.userIds.push(selfUser.rows[0].id);
    await db.query(
      `INSERT INTO memberships (id, "organisationId", "userId", role, "isActive", "acceptedAt", "createdBy", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'EMPLOYEE_SELF', true, now(), $3, now(), now())`,
      [orgId, selfUser.rows[0].id, selfUser.rows[0].id],
    );
    await db.query(`UPDATE workers SET "userId" = $2 WHERE id = $1`, [
      workerA,
      selfUser.rows[0].id,
    ]);

    await login(selfEmail);
    const selfStatements = (
      await req('GET', '/payroll/year-end/statements')
    ).json.data || [];
    check(
      selfStatements.length >= 1 &&
        selfStatements.every((s) => s.workerId === workerA),
      'SC1 employee sees only their own statement',
      `n=${selfStatements.length}`,
    );
    const otherStmt = statements.find((s) => s.workerId !== workerA);
    const denied = await req('GET', `/payroll/year-end/statements/${otherStmt.id}`);
    check(
      denied.status === 404,
      'SC2 employee cannot read another worker’s statement (404)',
      `status=${denied.status}`,
    );
    const selfRemit = await req('GET', '/payroll/year-end/remittance?year=2026');
    check(
      selfRemit.status === 403,
      'SC3 employee cannot read the remittance schedule (403)',
      `status=${selfRemit.status}`,
    );
    const selfGen = await req('POST', '/payroll/year-end/statements', { year: 2026 });
    check(
      selfGen.status === 403,
      'SC4 employee cannot generate statements (403)',
      `status=${selfGen.status}`,
    );

    await login('owner@ascenda.dev');

    // ── AUDIT ───────────────────────────────────────────────────────────────
    heading('AUDIT');
    const auditCounts = await db.query(
      `SELECT action, count(*)::int AS n FROM audit_log
       WHERE action IN ('YEAR_END_STATEMENT_GENERATED','YEAR_END_STATEMENT_ACCESSED','REMITTANCE_SCHEDULE_EXPORTED')
       GROUP BY action`,
    );
    const byAction = Object.fromEntries(auditCounts.rows.map((r) => [r.action, r.n]));
    for (const action of [
      'YEAR_END_STATEMENT_GENERATED',
      'YEAR_END_STATEMENT_ACCESSED',
      'REMITTANCE_SCHEDULE_EXPORTED',
    ]) {
      check((byAction[action] || 0) >= 1, `A1 audit row present: ${action}`, JSON.stringify(byAction));
    }

    // ── GUARDS ──────────────────────────────────────────────────────────────
    heading('GUARDS');
    cookie = '';
    const unauth = await fetch(`${BASE}/payroll/year-end/statements`);
    check(unauth.status === 401, 'G1 unauthenticated request rejected (401)', `status=${unauth.status}`);
  } finally {
    try {
      const runIds = cleanup.runIds.filter(Boolean);
      const workerIds = cleanup.workerIds.filter(Boolean);
      if (workerIds.length) {
        await db.query(`DELETE FROM year_end_statements WHERE "workerId" = ANY($1)`, [workerIds]);
      }
      if (runIds.length) {
        await db.query(`DELETE FROM payslips WHERE "payrollRunId" = ANY($1)`, [runIds]);
        await db.query(`DELETE FROM payments WHERE "payrollRunId" = ANY($1)`, [runIds]);
        await db.query(`DELETE FROM payroll_items WHERE "payrollRunId" = ANY($1)`, [runIds]);
        await db.query(`DELETE FROM payroll_run_approvals WHERE "payrollRunId" = ANY($1)`, [runIds]);
      }
      if (workerIds.length) {
        await db.query(`DELETE FROM payslips WHERE "workerId" = ANY($1)`, [workerIds]);
        await db.query(`UPDATE workers SET "managerId" = NULL WHERE id = ANY($1)`, [workerIds]);
        await db.query(`UPDATE workers SET "userId" = NULL WHERE id = ANY($1)`, [workerIds]);
      }
      if (runIds.length) {
        await db.query(`DELETE FROM payroll_runs WHERE id = ANY($1)`, [runIds]);
      }
      if (cleanup.packIds.filter(Boolean).length) {
        await db.query(`DELETE FROM statutory_rule_packs WHERE id = ANY($1)`, [cleanup.packIds.filter(Boolean)]);
      }
      if (cleanup.compIds.filter(Boolean).length) {
        await db.query(`DELETE FROM compensation_records WHERE id = ANY($1)`, [cleanup.compIds.filter(Boolean)]);
      }
      if (workerIds.length) {
        await db.query(`DELETE FROM bank_accounts WHERE "workerId" = ANY($1)`, [workerIds]);
        await db.query(`DELETE FROM workers WHERE id = ANY($1)`, [workerIds]);
      }
      const allIds = [
        ...runIds,
        ...workerIds,
        ...cleanup.userIds,
        ...cleanup.packIds.filter(Boolean),
      ];
      if (allIds.length) {
        await db.query(`DELETE FROM audit_log WHERE "targetId" = ANY($1)`, [allIds]);
      }
      if (cleanup.userIds.length) {
        await db.query(`DELETE FROM audit_log WHERE "actorId" = ANY($1)`, [cleanup.userIds]);
        await db.query(`DELETE FROM memberships WHERE "userId" = ANY($1)`, [cleanup.userIds]);
        await db.query(`DELETE FROM users WHERE id = ANY($1)`, [cleanup.userIds]);
      }
      await db.query(`DELETE FROM payroll_config WHERE "organisationId" = $1`, [orgId]);
      console.log('\n  (cleanup done)');
    } catch (cleanupError) {
      console.log(`\n  (cleanup warning: ${cleanupError.message})`);
    }
    await db.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('E2E errored:', error);
  process.exit(1);
});
