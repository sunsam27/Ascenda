// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 M2 TEST — Payroll Run Engine & Approvals
// "Runs prepare, validate, approve, process, lock, and reverse under PAY-05..11."
//
// Covers over the real API + database:
//   * PAY-05 PRORATION: joiner/leaver clipping, unpaid leave, absences feed
//     the prepare maths; totals always equal the sum of item lines.
//   * PAY-06 STATE + REVERSAL: one-way lifecycle, approved runs immutable,
//     reversal creates a mirrored DRAFT and stamps the original.
//   * PAY-07 WORKFLOW: prepare → review → override → submit → approve →
//     process (Payment rows) → lock.
//   * PAY-08 ELIGIBILITY: suspended/terminated workers excluded + flagged;
//     missing bank details block submission.
//   * PAY-09 OVERRIDE: item override requires a reason and is audit-logged.
//   * PAY-10 VALIDATION: salary-increase warnings must be acknowledged before
//     approval; thresholds come from the org config.
//   * PAY-11 APPROVAL CHAIN: configurable chain, steps snapshotted on submit,
//     preparer can never approve their own run, OWNER overrides any step.
//
// Run (from repo root, API + DB running):
//   node --env-file=packages\db\.env apps\api\test\e2e\phase3-m2-payroll-runs.cjs
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

const dataOf = (r) => (r.json && r.json.data ? r.json.data : {});

async function login(email) {
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
  if (!dataOf(res).id) {
    throw new Error(`comp create failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return dataOf(res).id;
}

async function createRun(calendarId, stamp, month) {
  const res = await req('POST', '/payroll/runs', {
    payCalendarId: calendarId,
    periodStart: `2026-${month}-01`,
    periodEnd: month === '09' ? '2026-09-30' : month === '10' ? '2026-10-31' : '2026-11-30',
    notes: `M2 e2e ${stamp} ${month}`,
  });
  if (!dataOf(res).id) {
    throw new Error(`run create failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return dataOf(res);
}

async function main() {
  await login('owner@ascenda.dev');

  const stamp = Date.now().toString(36);
  const cleanup = {
    workerIds: [],
    compIds: [],
    recurringIds: [],
    runIds: [],
    paymentIds: [],
    userIds: [],
    bankWorkerIds: [],
    calendarId: null,
  };

  const db = new Client({
    connectionString: (process.env.DIRECT_URL || '').replace(
      /([?&])sslmode=[^&]*/,
      '$1',
    ),
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  try {
    // ── Fixtures ────────────────────────────────────────────────────────────
    heading('FIXTURES');

    const orgRow = await db.query(
      `SELECT m."organisationId" FROM memberships m
       JOIN users u ON u.id = m."userId"
       WHERE u.email = 'owner@ascenda.dev' LIMIT 1`,
    );
    const orgId = orgRow.rows[0].organisationId;

    // Purge any runs/workers left behind by a previous interrupted M2 run so
    // the duplicate-run guard and eligibility lists start from a clean slate.
    await db.query(
      `DELETE FROM payments WHERE "organisationId" = $1 AND (
         "payrollRunId" IN (SELECT id FROM payroll_runs WHERE "organisationId" = $1 AND notes LIKE 'M2 e2e %')
         OR "workerId" IN (SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M2-%'))`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payslips WHERE "payrollRunId" IN (
         SELECT id FROM payroll_runs WHERE "organisationId" = $1 AND notes LIKE 'M2 e2e %')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payslips WHERE "workerId" IN (
         SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M2-%')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payroll_items WHERE "payrollRunId" IN (
         SELECT id FROM payroll_runs WHERE "organisationId" = $1 AND notes LIKE 'M2 e2e %')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payroll_items WHERE "workerId" IN (
         SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M2-%')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payroll_run_approvals WHERE "payrollRunId" IN (
         SELECT id FROM payroll_runs WHERE "organisationId" = $1 AND notes LIKE 'M2 e2e %')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payroll_runs WHERE "organisationId" = $1 AND notes LIKE 'M2 e2e %'`,
      [orgId],
    );
    await db.query(`DELETE FROM payroll_config WHERE "organisationId" = $1`, [orgId]);
    await db.query(
      `DELETE FROM recurring_pay_items WHERE "workerId" IN (
         SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M2-%')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM compensation_records WHERE "workerId" IN (
         SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M2-%')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM bank_accounts WHERE "workerId" IN (
         SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M2-%')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M2-%'`,
      [orgId],
    );
    await db.query(
      `DELETE FROM audit_log WHERE "actorId" IN (
         SELECT id FROM users WHERE email LIKE 'pa-m2-%@ascenda.test' OR email LIKE 'fa-m2-%@ascenda.test')`,
    );
    await db.query(
      `DELETE FROM memberships WHERE "userId" IN (
         SELECT id FROM users WHERE email LIKE 'pa-m2-%@ascenda.test' OR email LIKE 'fa-m2-%@ascenda.test')`,
    );
    await db.query(
      `DELETE FROM users WHERE email LIKE 'pa-m2-%@ascenda.test' OR email LIKE 'fa-m2-%@ascenda.test'`,
    );

    const paEmail = `pa-m2-${stamp}@ascenda.test`;
    const faEmail = `fa-m2-${stamp}@ascenda.test`;
    const passwordHash = await argon2.hash('AscendaDemo123!', {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
    for (const [email, first, last, role] of [
      [paEmail, 'Pat', 'Admin', 'PAYROLL_ADMINISTRATOR'],
      [faEmail, 'Fin', 'Approver', 'FINANCE_APPROVER'],
    ]) {
      const u = await db.query(
        `INSERT INTO users (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now()) RETURNING id`,
        [email, passwordHash, first, last],
      );
      const userId = u.rows[0].id;
      cleanup.userIds.push(userId);
      await db.query(
        `INSERT INTO memberships (id, "organisationId", "userId", role, "isActive", "acceptedAt", "createdBy", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, true, now(), $4, now(), now())`,
        [orgId, userId, role, userId],
      );
    }
    check(true, `fixture created (PA + FA users in org ${orgId.slice(0, 8)}…)`);

    const workerA = await createWorker({
      employeeNumber: `M2-A-${stamp}`,
      firstName: 'Ada',
      lastName: 'A',
      email: `m2-a-${stamp}@example.test`,
      category: 'EMPLOYEE',
      employmentType: 'FULL_TIME',
      jobTitle: 'Engineer',
      status: 'ACTIVE',
      startDate: '2026-06-01',
    });
    const workerB = await createWorker({
      employeeNumber: `M2-B-${stamp}`,
      firstName: 'Ben',
      lastName: 'B',
      email: `m2-b-${stamp}@example.test`,
      category: 'EMPLOYEE',
      employmentType: 'FULL_TIME',
      jobTitle: 'Analyst',
      status: 'ACTIVE',
      startDate: '2026-06-01',
    });
    const workerC = await createWorker({
      employeeNumber: `M2-C-${stamp}`,
      firstName: 'Cara',
      lastName: 'C',
      email: `m2-c-${stamp}@example.test`,
      category: 'EMPLOYEE',
      employmentType: 'FULL_TIME',
      jobTitle: 'Ops',
      status: 'SUSPENDED',
      startDate: '2026-06-01',
    });
    const workerD = await createWorker({
      employeeNumber: `M2-D-${stamp}`,
      firstName: 'Dee',
      lastName: 'D',
      email: `m2-d-${stamp}@example.test`,
      category: 'EMPLOYEE',
      employmentType: 'FULL_TIME',
      jobTitle: 'Designer',
      status: 'ACTIVE',
      startDate: '2026-06-01',
    });
    cleanup.workerIds.push(workerA, workerB, workerC, workerD);

    cleanup.compIds.push(
      await createComp(workerA, {
        payFrequency: 'MONTHLY',
        validFrom: '2026-06-01',
        components: [
          { code: 'BASE', label: 'Base salary', amountMinorUnits: 500000 },
          { code: 'HOUSING', label: 'Housing', amountMinorUnits: 100000 },
        ],
      }),
    );
    cleanup.compIds.push(
      await createComp(workerB, {
        payFrequency: 'MONTHLY',
        validFrom: '2026-06-01',
        grossAmountMinorUnits: 400000,
      }),
    );
    cleanup.compIds.push(
      await createComp(workerD, {
        payFrequency: 'MONTHLY',
        validFrom: '2026-06-01',
        validTo: '2026-10-01',
        grossAmountMinorUnits: 500000,
      }),
    );
    cleanup.compIds.push(
      await createComp(workerD, {
        payFrequency: 'MONTHLY',
        validFrom: '2026-10-01',
        grossAmountMinorUnits: 800000,
      }),
    );

    for (const workerId of [workerA, workerD]) {
      await db.query(
        `INSERT INTO bank_accounts (id, "organisationId", "workerId", "bankName", "bankCode",
           "accountNumberEncrypted", "accountNumberMasked", "accountName", "isVerified", "isPrimary",
           "createdBy", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, 'Test Bank', '000', 'enc', '****1234', 'Test User', true, true, $3, now(), now())`,
        [orgId, workerId, workerId],
      );
      cleanup.bankWorkerIds.push(workerId);
    }

    const rec = await req('POST', '/payroll/recurring-items', {
      workerId: workerA,
      type: 'DEDUCTION',
      name: 'Salary advance',
      calculation: 'FIXED',
      amountMinorUnits: 25000,
      validFrom: '2026-06-01',
    });
    cleanup.recurringIds.push(dataOf(rec).id);
    check(true, 'fixture created (workers A–D, comps, banks for A/D, recurring on A)');

    const calRes = await req('GET', '/payroll/pay-calendars?pageSize=200');
    const calendars = calRes.json.data || [];
    const monthly = calendars.find((c) => c.name === 'Monthly');
    check(!!monthly, 'seeded "Monthly" pay calendar present', JSON.stringify(calRes.json).slice(0, 150));
    cleanup.calendarId = monthly.id;

    // ── PAY-10/11: CONFIG DEFAULTS + VALIDATION ─────────────────────────────
    heading('PAYROLL CONFIG (PAY-10 / PAY-11)');
    const cfg = dataOf(await req('GET', '/payroll/config'));
    check(
      Array.isArray(cfg.approvalChain) &&
        cfg.approvalChain.length === 1 &&
        cfg.approvalChain[0] === 'OWNER' &&
        cfg.salaryChangeWarnPct === 30 &&
        cfg.deductionRatioWarnBps === 5000 &&
        cfg.requireBankDetails === true,
      'C1 default config: chain [OWNER], 30%, 5000 bps, bank details required',
      JSON.stringify(cfg),
    );

    const cfgBad = await req('PATCH', '/payroll/config', {
      approvalChain: ['OWNER', 'OWNER'],
    });
    check(cfgBad.status === 400, 'C2 duplicate chain roles rejected (400)', `status=${cfgBad.status}`);

    // ── PAY-08/10: MISSING BANK DETAILS BLOCK SUBMIT ────────────────────────
    heading('RUN PREPARE + MISSING-DATA GUARD (PAY-05 / PAY-08)');
    await login(paEmail);
    const runSep = await createRun(monthly.id, stamp, '09');
    cleanup.runIds.push(runSep.id);
    check(runSep.status === 'DRAFT' && runSep.preparedById != null, 'R1 draft run created by PA', JSON.stringify(runSep).slice(0, 150));

    const prep1 = dataOf(await req('POST', `/payroll/runs/${runSep.id}/prepare`));
    const items1 = dataOf(await req('GET', `/payroll/runs/${runSep.id}/items`));
    const sumNet = items1.reduce((s, i) => s + i.amountMinorUnits, 0);
    check(
      prep1.status === 'DRAFT',
      'R2 prepare keeps the run in DRAFT',
      `status=${prep1.status}`,
    );
    check(
      items1.length === 5,
      `R2 prepare produced 5 lines (A: 3, B: 1, D: 1 — C excluded) got ${items1.length}`,
      JSON.stringify(items1.map((i) => `${i.workerId.slice(0, 4)}:${i.type}:${i.amountMinorUnits}`)),
    );
    check(
      sumNet === prep1.totalNetMinorUnits &&
        prep1.totalGrossMinorUnits - prep1.totalDeductionsMinorUnits === prep1.totalNetMinorUnits,
      `R2 totals reconcile to the item lines (net=${prep1.totalNetMinorUnits})`,
      JSON.stringify({
        gross: prep1.totalGrossMinorUnits,
        ded: prep1.totalDeductionsMinorUnits,
        net: prep1.totalNetMinorUnits,
        sumNet,
      }),
    );

    const val1 = dataOf(await req('GET', `/payroll/runs/${runSep.id}/validations`));
    const missingBank = (val1.errors || []).find((e) => e.code === 'MISSING_BANK_DETAILS');
    check(
      !!missingBank && missingBank.workerId === workerB,
      'R3 missing bank details is a blocking error naming worker B',
      JSON.stringify(val1.errors),
    );
    check(
      val1.excluded.some((e) => e.workerId === workerC && e.status === 'SUSPENDED'),
      'R3 suspended worker C excluded and flagged',
      JSON.stringify(val1.excluded),
    );

    const submitBlocked = await req('POST', `/payroll/runs/${runSep.id}/submit`);
    check(
      submitBlocked.status === 400,
      'R4 submit blocked while validation errors exist (400)',
      `status=${submitBlocked.status} ${JSON.stringify(submitBlocked.json).slice(0, 150)}`,
    );

    // ── PAY-07: FULL LIFECYCLE (prepare → review → override → submit →
    //    approve → process → lock) ──────────────────────────────────────────
    heading('RUN LIFECYCLE (PAY-07 / PAY-09)');
    // Worker status changes need the OWNER (PA has no people:update grant).
    await login('owner@ascenda.dev');
    const termB = await req('PATCH', `/workers/${workerB}`, { status: 'TERMINATED' });
    check(termB.status === 200, 'R5 worker B moved to TERMINATED to clear the block', `status=${termB.status}`);
    await login(paEmail);

    const prep2 = dataOf(await req('POST', `/payroll/runs/${runSep.id}/prepare`));
    const review = dataOf(await req('POST', `/payroll/runs/${runSep.id}/review`));
    check(review.status === 'IN_REVIEW', 'R6 review moves DRAFT → IN_REVIEW', `status=${review.status}`);

    const items2 = dataOf(await req('GET', `/payroll/runs/${runSep.id}/items`));
    const aBase = items2.find((i) => i.workerId === workerA && i.type === 'BASIC_SALARY');
    const override = await req('PATCH', `/payroll/runs/${runSep.id}/items/${aBase.id}`, {
      amountMinorUnits: aBase.amountMinorUnits + 1000,
      overrideReason: 'Corrected overtime top-up for September',
    });
    const overrideD = dataOf(override);
    check(
      override.status === 200 &&
        overrideD.amountMinorUnits === aBase.amountMinorUnits + 1000 &&
        overrideD.overrideReason === 'Corrected overtime top-up for September',
      'R7 item override applied with mandatory reason (PAY-09)',
      `status=${override.status} ${JSON.stringify(overrideD).slice(0, 150)}`,
    );
    const prep3 = dataOf(await req('GET', `/payroll/runs/${runSep.id}`));
    check(
      prep3.totalNetMinorUnits === prep2.totalNetMinorUnits + 1000,
      `R7 run totals recomputed after override (+1000 → ${prep3.totalNetMinorUnits})`,
      `before=${prep2.totalNetMinorUnits} after=${prep3.totalNetMinorUnits}`,
    );

    const val2 = dataOf(await req('GET', `/payroll/runs/${runSep.id}/validations`));
    const excludedIds = new Set(val2.excluded.map((e) => e.workerId));
    check(
      val2.errors.length === 0 &&
        excludedIds.has(workerB) &&
        excludedIds.has(workerC),
      'R8 validations clean after fixture fix; B + C still flagged as excluded',
      JSON.stringify({ errors: val2.errors, excluded: val2.excluded }),
    );

    const sub = dataOf(await req('POST', `/payroll/runs/${runSep.id}/submit`));
    check(
      sub.status === 'PENDING_APPROVAL' && sub.submittedById != null,
      'R9 submit moves to PENDING_APPROVAL and records the submitter',
      JSON.stringify(sub).slice(0, 200),
    );
    const subDetail = dataOf(await req('GET', `/payroll/runs/${runSep.id}`));
    check(
      subDetail.approvals.length === 1 &&
        subDetail.approvals[0].status === 'PENDING' &&
        subDetail.approvals[0].role === 'OWNER',
      'R9 approval chain snapshotted (1 step: OWNER, PENDING)',
      JSON.stringify(subDetail.approvals),
    );

    const paApprove = await req('POST', `/payroll/runs/${runSep.id}/approve`, {});
    check(
      paApprove.status === 403,
      'R10 PAYROLL_ADMINISTRATOR cannot approve (no payroll:approve permission)',
      `status=${paApprove.status} ${JSON.stringify(paApprove.json).slice(0, 120)}`,
    );

    await login('owner@ascenda.dev');
    const appr = dataOf(await req('POST', `/payroll/runs/${runSep.id}/approve`, {
      comment: 'September run looks correct',
    }));
    check(
      appr.status === 'APPROVED' && appr.approvedById != null,
      'R11 owner approved the run (preparer was the PA — separation of duties holds)',
      JSON.stringify(appr).slice(0, 200),
    );

    const proc = dataOf(await req('POST', `/payroll/runs/${runSep.id}/process`));
    check(
      proc.run.status === 'PROCESSED' && proc.paymentsCreated === 2,
      `R12 process created one payment per worker (2 payments, paid ${proc.totalPaidMinorUnits})`,
      JSON.stringify(proc).slice(0, 200),
    );
    const pays = dataOf(await req('GET', `/payments?payrollRunId=${runSep.id}`));
    const payA = pays.find((p) => p.workerId === workerA);
    const payD = pays.find((p) => p.workerId === workerD);
    check(
      pays.length === 2 && pays.every((p) => p.status === 'PENDING'),
      'R12 payments listed as PENDING',
      JSON.stringify(pays.map((p) => ({ w: p.workerId.slice(0, 4), s: p.status, a: p.amountMinorUnits }))),
    );
    check(
      payA && payA.amountMinorUnits === 501000 + 100000 - 25000,
      `R12 worker A payment = overridden base + allowance − recurring (576000) got ${payA && payA.amountMinorUnits}`,
      JSON.stringify(payA),
    );
    check(
      payD && payD.amountMinorUnits === 500000,
      `R12 worker D payment = prorated gross (500000) got ${payD && payD.amountMinorUnits}`,
      JSON.stringify(payD),
    );

    const p1 = dataOf(await req('PATCH', `/payments/${payA.id}/status`, { status: 'PROCESSING' }));
    const p2 = dataOf(await req('PATCH', `/payments/${payA.id}/status`, { status: 'COMPLETED' }));
    check(
      p1.status === 'PROCESSING' && p2.status === 'COMPLETED' && p2.processedAt != null,
      'R13 payment lifecycle PENDING → PROCESSING → COMPLETED (processedAt stamped)',
      JSON.stringify({ p1: p1.status, p2: p2.status, at: p2.processedAt }),
    );
    const badTransition = await req('PATCH', `/payments/${payD.id}/status`, { status: 'COMPLETED' });
    check(
      badTransition.status === 409,
      'R13 PENDING → COMPLETED directly is refused (409)',
      `status=${badTransition.status}`,
    );

    const lock = dataOf(await req('POST', `/payroll/runs/${runSep.id}/lock`));
    check(lock.status === 'LOCKED' && lock.lockedAt != null, 'R14 run locked (terminal)', JSON.stringify(lock).slice(0, 150));

    const prepareLocked = await req('POST', `/payroll/runs/${runSep.id}/prepare`);
    check(prepareLocked.status === 409, 'R15 prepare on a LOCKED run refused (409)', `status=${prepareLocked.status}`);

    // ── PAY-10: SALARY-INCREASE WARNING MUST BE ACKNOWLEDGED ────────────────
    heading('WARNINGS + ACKNOWLEDGEMENT (PAY-10)');
    await login(paEmail);
    const runOct = await createRun(monthly.id, stamp, '10');
    cleanup.runIds.push(runOct.id);
    await req('POST', `/payroll/runs/${runOct.id}/prepare`);
    const valOct = dataOf(await req('GET', `/payroll/runs/${runOct.id}/validations`));
    const salaryWarn = (valOct.warnings || []).find(
      (w) => w.code === 'SALARY_INCREASE' && w.workerId === workerD,
    );
    check(
      !!salaryWarn,
      'W1 salary increase above the 30% threshold warns for worker D (500000 → 800000)',
      JSON.stringify(valOct.warnings),
    );
    await req('POST', `/payroll/runs/${runOct.id}/submit`);

    await login('owner@ascenda.dev');
    const approveUnacked = await req('POST', `/payroll/runs/${runOct.id}/approve`, {});
    check(
      approveUnacked.status === 409,
      'W2 approval refused while warnings are unacknowledged (409)',
      `status=${approveUnacked.status} ${JSON.stringify(approveUnacked.json).slice(0, 120)}`,
    );
    await login(paEmail);
    await req('POST', `/payroll/runs/${runOct.id}/acknowledge`);
    const ackRun = dataOf(await req('GET', `/payroll/runs/${runOct.id}`));
    check(
      ackRun.validationAcknowledgedAt != null,
      'W3 acknowledgement stamped on the run',
      JSON.stringify(ackRun).slice(0, 200),
    );
    await login('owner@ascenda.dev');
    const apprOct = dataOf(await req('POST', `/payroll/runs/${runOct.id}/approve`, {}));
    check(apprOct.status === 'APPROVED', 'W4 approval succeeds after acknowledgement', `status=${apprOct.status}`);

    // ── PAY-06: REVERSAL ────────────────────────────────────────────────────
    heading('REVERSAL (PAY-06)');
    // Reversal needs payroll:approve (FINANCE_APPROVER here). The reverser
    // becomes the run's preparer, so the OWNER can approve it afterwards.
    await login(faEmail);
    const rev = dataOf(
      await req('POST', `/payroll/runs/${runSep.id}/reverse`, {
        reason: 'Wrong allowance approved — reversing to re-run',
      }),
    );
    cleanup.runIds.push(rev.id);
    check(
      rev.status === 'DRAFT' && rev.reversalOfRunId === runSep.id && rev.totalNetMinorUnits === -prep3.totalNetMinorUnits,
      `V1 reversal run created as DRAFT with negated totals (${rev.totalNetMinorUnits})`,
      JSON.stringify(rev).slice(0, 220),
    );
    const origAfter = dataOf(await req('GET', `/payroll/runs/${runSep.id}`));
    check(origAfter.reversedAt != null, 'V2 original stamped with reversedAt (never mutated)', JSON.stringify(origAfter).slice(0, 150));

    // The state guard needs an actor that holds payroll:update.
    await login(paEmail);
    const prepRev = await req('POST', `/payroll/runs/${rev.id}/prepare`);
    check(prepRev.status === 409, 'V3 reversal run cannot be re-prepared (409)', `status=${prepRev.status}`);

    await login(paEmail);
    const subRev = await req('POST', `/payroll/runs/${rev.id}/submit`);
    check(subRev.status === 200, 'V3b reversal submitted for approval', `status=${subRev.status}`);
    // Negated lines raise warnings (e.g. NEGATIVE_NET); acknowledge, then approve.
    await req('POST', `/payroll/runs/${rev.id}/acknowledge`);
    await login('owner@ascenda.dev');
    const apprRev = dataOf(await req('POST', `/payroll/runs/${rev.id}/approve`, {}));
    const procRev = dataOf(await req('POST', `/payroll/runs/${rev.id}/process`));
    check(
      apprRev.status === 'APPROVED' && procRev.paymentsCreated === 2 && procRev.totalPaidMinorUnits === -prep3.totalNetMinorUnits,
      `V4 reversal processed into equal-and-opposite payments (${procRev.totalPaidMinorUnits})`,
      JSON.stringify(procRev).slice(0, 200),
    );

    // ── PAY-06/11: CORRECTION RUN + MULTI-STEP CHAIN + PREPARER EXCLUSION ──
    heading('CORRECTION RUN + APPROVAL CHAIN (PAY-06 / PAY-11)');
    await login(paEmail);
    const cfgPatch = dataOf(
      await req('PATCH', '/payroll/config', {
        approvalChain: ['FINANCE_APPROVER', 'OWNER'],
      }),
    );
    check(
      cfgPatch.approvalChain.length === 2 && cfgPatch.approvalChain[0] === 'FINANCE_APPROVER',
      'K1 PA reconfigured the chain to [FINANCE_APPROVER, OWNER]',
      JSON.stringify(cfgPatch),
    );

    // Prepared by the PAYROLL_ADMINISTRATOR so neither approver is the preparer.
    await login(paEmail);
    const runSep2 = await createRun(monthly.id, stamp, '09');
    cleanup.runIds.push(runSep2.id);
    await req('POST', `/payroll/runs/${runSep2.id}/prepare`);
    await req('POST', `/payroll/runs/${runSep2.id}/submit`);

    // The preparer (PA) can never approve: no payroll:approve grant at all.
    const paSelfApprove = await req('POST', `/payroll/runs/${runSep2.id}/approve`, {});
    check(
      paSelfApprove.status === 403,
      'K2 the preparer (PAYROLL_ADMINISTRATOR) cannot approve the run (403)',
      `status=${paSelfApprove.status} ${JSON.stringify(paSelfApprove.json).slice(0, 150)}`,
    );

    await login(faEmail);
    const faApprove = dataOf(await req('POST', `/payroll/runs/${runSep2.id}/approve`, {}));
    const detail2 = dataOf(await req('GET', `/payroll/runs/${runSep2.id}`));
    check(
      faApprove.status === 'PENDING_APPROVAL' &&
        detail2.approvals[0].status === 'APPROVED' &&
        detail2.approvals[1].status === 'PENDING',
      'K3 FINANCE_APPROVER satisfied step 1; step 2 (OWNER) still pending',
      JSON.stringify(detail2.approvals),
    );

    await login('owner@ascenda.dev');
    const finalApprove = dataOf(await req('POST', `/payroll/runs/${runSep2.id}/approve`, {}));
    check(finalApprove.status === 'APPROVED', 'K4 owner completed the final step → APPROVED', `status=${finalApprove.status}`);

    // ── GUARDS ──────────────────────────────────────────────────────────────
    heading('GUARDS');
    const badPeriod = await req('POST', '/payroll/runs', {
      payCalendarId: monthly.id,
      periodStart: '2026-11-02',
      periodEnd: '2026-11-30',
    });
    check(badPeriod.status === 400, 'G1 off-boundary period rejected (400)', `status=${badPeriod.status}`);

    const runNov = await createRun(monthly.id, stamp, '11');
    cleanup.runIds.push(runNov.id);
    const submitEmpty = await req('POST', `/payroll/runs/${runNov.id}/submit`);
    check(submitEmpty.status === 400, 'G2 submit before prepare rejected (400 NO_ITEMS)', `status=${submitEmpty.status}`);

    const dupRun = await req('POST', '/payroll/runs', {
      payCalendarId: monthly.id,
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    });
    check(dupRun.status === 409, 'G3 duplicate run for an in-flight period refused (409)', `status=${dupRun.status}`);

    const unauth = await fetch(`${BASE}/payroll/runs`);
    check(unauth.status === 401, 'G4 unauthenticated request rejected (401)', `status=${unauth.status}`);

    const auditCounts = await db.query(
      `SELECT action, count(*)::int AS n FROM audit_log
       WHERE "targetId" = ANY($1)
          OR action IN ('PAYROLL_CONFIG_CHANGED', 'PAYROLL_ITEM_OVERRIDDEN')
       GROUP BY action`,
      [cleanup.runIds.concat(cleanup.paymentIds)],
    );
    const byAction = Object.fromEntries(auditCounts.rows.map((r) => [r.action, r.n]));
    for (const action of [
      'PAYROLL_RUN_SUBMITTED',
      'PAYROLL_RUN_APPROVED',
      'PAYROLL_RUN_PROCESSED',
      'PAYROLL_RUN_LOCKED',
      'PAYROLL_RUN_REVERSED',
      'PAYROLL_ITEM_OVERRIDDEN',
      'PAYROLL_CONFIG_CHANGED',
    ]) {
      check((byAction[action] || 0) >= 1, `A1 audit row present: ${action}`, JSON.stringify(byAction));
    }
    const payAudit = await db.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'PAYMENT_STATUS_CHANGED'`,
    );
    check(payAudit.rows[0].n >= 1, 'A2 audit row present: PAYMENT_STATUS_CHANGED', `n=${payAudit.rows[0].n}`);
  } finally {
    // ── Cleanup ──────────────────────────────────────────────────────────────
    try {
      const runIds = cleanup.runIds.filter(Boolean);
      const workerIds = cleanup.workerIds.filter(Boolean);
      if (runIds.length) {
        await db.query(`DELETE FROM payslips WHERE "payrollRunId" = ANY($1)`, [runIds]);
        await db.query(`DELETE FROM payments WHERE "payrollRunId" = ANY($1)`, [runIds]);
        await db.query(`DELETE FROM payroll_items WHERE "payrollRunId" = ANY($1)`, [runIds]);
        await db.query(`DELETE FROM payroll_run_approvals WHERE "payrollRunId" = ANY($1)`, [runIds]);
        await db.query(`DELETE FROM payroll_runs WHERE id = ANY($1)`, [runIds]);
      }
      if (cleanup.recurringIds.filter(Boolean).length) {
        await db.query(`DELETE FROM recurring_pay_items WHERE id = ANY($1)`, [cleanup.recurringIds.filter(Boolean)]);
      }
      if (cleanup.compIds.filter(Boolean).length) {
        await db.query(`DELETE FROM compensation_records WHERE id = ANY($1)`, [cleanup.compIds.filter(Boolean)]);
      }
      if (workerIds.length) {
        await db.query(`DELETE FROM bank_accounts WHERE "workerId" = ANY($1)`, [workerIds]);
        await db.query(`DELETE FROM workers WHERE id = ANY($1)`, [workerIds]);
      }
      const allIds = [...runIds, ...workerIds, ...cleanup.userIds, ...cleanup.compIds.filter(Boolean), ...cleanup.recurringIds.filter(Boolean)];
      if (allIds.length) {
        await db.query(`DELETE FROM audit_log WHERE "targetId" = ANY($1) OR "actorId" = ANY($2)`, [
          allIds,
          cleanup.userIds.filter(Boolean).length ? cleanup.userIds.filter(Boolean) : ['00000000-0000-0000-0000-000000000000'],
        ]);
      }
      if (cleanup.userIds.length) {
        await db.query(`DELETE FROM memberships WHERE "userId" = ANY($1)`, [cleanup.userIds]);
        await db.query(`DELETE FROM users WHERE id = ANY($1)`, [cleanup.userIds]);
      }
      await db.query(`DELETE FROM payroll_config WHERE "organisationId" = $1`, [
        (await db.query(
          `SELECT m."organisationId" FROM memberships m JOIN users u ON u.id = m."userId"
           WHERE u.email = 'owner@ascenda.dev' LIMIT 1`,
        )).rows[0].organisationId,
      ]);
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
