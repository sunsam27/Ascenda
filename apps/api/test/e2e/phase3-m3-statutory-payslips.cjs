// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 M3 TEST — Statutory packs, Payslips, Payment export, Reimbursements
// "LOC-02/03 + PAY-12/13/14: rules-as-data, private PDF payslips, bank-upload
//  payment file, and the reimbursement approval flow."
//
// Covers over the real API + database:
//   * M3a STATUTORY RULE PACKS (PAY-12 partial / LOC-02/03): packs are org
//     configured DATA (never invented); structural validation rejects bad
//     rules (400); packs are effective-dated and flagged not-validated until a
//     professional marks them; the run engine applies an active pack at prepare
//     (employee lines become deductions, employer lines are a tracked cost).
//   * M3b PAYSLIPS (PAY-13): one immutable payslip per worker per processed run;
//     totals reconcile; self-service PDF download (self-scoped, audited).
//   * M3c PAYMENT FILE EXPORT (PAY-12): bank-upload CSV, audit-logged.
//   * M3d REIMBURSEMENTS (PAY-14): submit → manager → finance → folded into the
//     next run as a REIMBURSEMENT earning and stamped PAID.
//
// Run (from repo root, API + DB running):
//   node --env-file=packages\db\.env apps\api\test\e2e\phase3-m3-statutory-payslips.cjs
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
    contentDisposition: res.headers.get('content-disposition') || '',
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
  if (!dataOf(res).id) {
    throw new Error(`comp create failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return dataOf(res).id;
}

async function createRun(calendarId, stamp, notes) {
  const res = await req('POST', '/payroll/runs', {
    payCalendarId: calendarId,
    periodStart: '2026-12-01',
    periodEnd: '2026-12-31',
    notes,
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
    runIds: [],
    packIds: [],
    claimIds: [],
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
    const orgId0 = orgRow.rows[0].organisationId;
    orgId = orgId0;

    await db.query(
      `DELETE FROM payslips WHERE "payrollRunId" IN (
         SELECT id FROM payroll_runs WHERE "organisationId" = $1 AND notes LIKE 'M3 e2e %')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payslips WHERE "workerId" IN (
         SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M3-%')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payments WHERE "payrollRunId" IN (
         SELECT id FROM payroll_runs WHERE "organisationId" = $1 AND notes LIKE 'M3 e2e %')
         OR "workerId" IN (SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M3-%')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM expense_claims WHERE "organisationId" = $1 AND (
         "workerId" IN (SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M3-%')
         OR "paidPayrollRunId" IN (SELECT id FROM payroll_runs WHERE "organisationId" = $1 AND notes LIKE 'M3 e2e %'))`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payroll_items WHERE "payrollRunId" IN (
         SELECT id FROM payroll_runs WHERE "organisationId" = $1 AND notes LIKE 'M3 e2e %')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payroll_items WHERE "workerId" IN (
         SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M3-%')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payroll_run_approvals WHERE "payrollRunId" IN (
         SELECT id FROM payroll_runs WHERE "organisationId" = $1 AND notes LIKE 'M3 e2e %')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM payroll_runs WHERE "organisationId" = $1 AND notes LIKE 'M3 e2e %'`,
      [orgId],
    );
    await db.query(
      `DELETE FROM statutory_rule_packs WHERE "organisationId" = $1 AND version LIKE 'M3-%'`,
      [orgId],
    );
    await db.query(
      `DELETE FROM compensation_records WHERE "workerId" IN (
         SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M3-%')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM bank_accounts WHERE "workerId" IN (
         SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M3-%')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M3-%'`,
      [orgId],
    );
    await db.query(
      `DELETE FROM audit_log WHERE "actorId" IN (
         SELECT id FROM users WHERE email LIKE 'm3-%@ascenda.test')`,
    );
    await db.query(
      `DELETE FROM memberships WHERE "userId" IN (
         SELECT id FROM users WHERE email LIKE 'm3-%@ascenda.test')`,
    );
    await db.query(`DELETE FROM users WHERE email LIKE 'm3-%@ascenda.test'`);

    const orgCountry = await db.query(
      `SELECT country, currency FROM organisations WHERE id = $1`,
      [orgId],
    );
    const country = orgCountry.rows[0].country || 'NG';

    // A manager (for the reimbursement manager step) and a finance approver.
    const managerEmail = `m3-mgr-${stamp}@ascenda.test`;
    const financeEmail = `m3-fin-${stamp}@ascenda.test`;
    const paEmail = `m3-pa-${stamp}@ascenda.test`;
    const passwordHash = await argon2.hash('AscendaDemo123!', {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
    const userIds = {};
    for (const [email, first, last, role] of [
      [managerEmail, 'Mel', 'Manager', 'MANAGER'],
      [financeEmail, 'Fin', 'Approver', 'FINANCE_APPROVER'],
      [paEmail, 'Pat', 'Admin', 'PAYROLL_ADMINISTRATOR'],
    ]) {
      const u = await db.query(
        `INSERT INTO users (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now()) RETURNING id`,
        [email, passwordHash, first, last],
      );
      userIds[role] = u.rows[0].id;
      cleanup.userIds.push(u.rows[0].id);
      await db.query(
        `INSERT INTO memberships (id, "organisationId", "userId", role, "isActive", "acceptedAt", "createdBy", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, true, now(), $4, now(), now())`,
        [orgId, u.rows[0].id, role, u.rows[0].id],
      );
    }

    // Workers: two active employees; A has a manager link (the manager user).
    const workerA = await createWorker({
      employeeNumber: `M3-A-${stamp}`,
      firstName: 'Ada',
      lastName: 'Alpha',
      email: `m3-a-${stamp}@example.test`,
      category: 'EMPLOYEE',
      employmentType: 'FULL_TIME',
      jobTitle: 'Engineer',
      status: 'ACTIVE',
      startDate: '2026-06-01',
    });
    const workerB = await createWorker({
      employeeNumber: `M3-B-${stamp}`,
      firstName: 'Ben',
      lastName: 'Beta',
      email: `m3-b-${stamp}@example.test`,
      category: 'EMPLOYEE',
      employmentType: 'FULL_TIME',
      jobTitle: 'Analyst',
      status: 'ACTIVE',
      startDate: '2026-06-01',
    });
    cleanup.workerIds.push(workerA, workerB);

    // Link worker B to the manager user so the manager may decide B's claim.
    await db.query(
      `UPDATE workers SET "managerId" = (
         SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M3-MGR-%' LIMIT 1)
       WHERE id = $2 AND EXISTS (SELECT 1 FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'M3-MGR-%')`,
      [orgId, workerB],
    );
    // Create a manager worker record and link the manager user to it.
    const managerWorker = await createWorker({
      employeeNumber: `M3-MGR-${stamp}`,
      firstName: 'Mel',
      lastName: 'Manager',
      email: `m3-mgr-worker-${stamp}@example.test`,
      category: 'EMPLOYEE',
      employmentType: 'FULL_TIME',
      jobTitle: 'Manager',
      status: 'ACTIVE',
      startDate: '2026-06-01',
    });
    cleanup.workerIds.push(managerWorker);
    await db.query(`UPDATE workers SET "userId" = $2 WHERE id = $1`, [
      managerWorker,
      userIds.MANAGER,
    ]);
    await db.query(`UPDATE workers SET "managerId" = $2 WHERE id = $1`, [
      workerB,
      managerWorker,
    ]);

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
    cleanup.compIds.push(
      await createComp(managerWorker, {
        payFrequency: 'MONTHLY',
        validFrom: '2026-06-01',
        grossAmountMinorUnits: 700000,
      }),
    );

    for (const workerId of [workerA, workerB, managerWorker]) {
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
    const calendars = calRes.json.data || [];
    const monthly = calendars.find((c) => c.name === 'Monthly');
    check(!!monthly, 'seeded "Monthly" pay calendar present', JSON.stringify(calRes.json).slice(0, 150));

    // ── M3a: STATUTORY RULE PACKS (PAY-12 / LOC-02 / LOC-03) ────────────────
    heading('M3a STATUTORY RULE PACKS (PAY-12 / LOC-02 / LOC-03)');

    const emptyPack = dataOf(
      await req('POST', '/payroll/statutory-rule-packs', {
        country,
        version: `M3-empty-${stamp}`,
        rules: [],
        validFrom: '2026-01-01',
      }),
    );
    check(
      !!emptyPack.id && emptyPack.validated === false && emptyPack.rules.length === 0,
      'S1 empty pack created, flagged not-validated by a professional',
      JSON.stringify(emptyPack).slice(0, 180),
    );
    cleanup.packIds.push(emptyPack.id);

    const invalidPack = await req('POST', '/payroll/statutory-rule-packs', {
      country,
      version: `M3-bad-${stamp}`,
      validFrom: '2026-01-01',
      rules: [
        { code: 'PAYE', label: 'Tax', kind: 'PERCENT_BANDS', base: 'GROSS', side: 'EMPLOYEE', itemType: 'TAX' },
      ],
    });
    check(
      invalidPack.status === 400,
      'S2 PERCENT_BANDS rule without bands rejected (400)',
      `status=${invalidPack.status} ${JSON.stringify(invalidPack.json).slice(0, 150)}`,
    );

    const dupCode = await req('POST', '/payroll/statutory-rule-packs', {
      country,
      version: `M3-dup-${stamp}`,
      validFrom: '2026-01-01',
      rules: [
        { code: 'X', label: 'a', kind: 'FLAT', base: 'GROSS', side: 'EMPLOYEE', itemType: 'DEDUCTION', amountMinorUnits: 100 },
        { code: 'X', label: 'b', kind: 'FLAT', base: 'GROSS', side: 'EMPLOYEE', itemType: 'DEDUCTION', amountMinorUnits: 200 },
      ],
    });
    check(dupCode.status === 400, 'S3 duplicate rule code rejected (400)', `status=${dupCode.status}`);

    const pack = dataOf(
      await req('POST', '/payroll/statutory-rule-packs', {
        country,
        version: `M3-live-${stamp}`,
        validFrom: '2026-01-01',
        rules: [
          {
            code: 'PAYE',
            label: 'Income tax',
            kind: 'PERCENT_BANDS',
            base: 'GROSS',
            side: 'EMPLOYEE',
            itemType: 'TAX',
            bands: [
              { upToMinorUnits: 300000, rateBps: 500 },
              { upToMinorUnits: null, rateBps: 1000 },
            ],
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
    check(
      !!pack.id && pack.rules.length === 3,
      'S4 valid pack created with 3 rules',
      JSON.stringify(pack).slice(0, 180),
    );

    const listed = await req('GET', `/payroll/statutory-rule-packs?country=${country}`);
    check(
      (listed.json.data || []).some((p) => p.id === pack.id),
      'S5 pack appears in the country list',
      `n=${(listed.json.data || []).length}`,
    );

    const validated = dataOf(
      await req('PATCH', `/payroll/statutory-rule-packs/${pack.id}/validation`, { validated: true }),
    );
    check(
      validated.validated === true && !!validated.validatedAt,
      'S6 pack marked validated by a professional (LOC-03)',
      JSON.stringify(validated).slice(0, 150),
    );

    // Editing a validated pack clears the validation.
    const reEdited = dataOf(
      await req('PATCH', `/payroll/statutory-rule-packs/${pack.id}`, {
        rules: pack.rules,
      }),
    );
    check(reEdited.validated === false, 'S7 editing a pack clears its validation flag');

    // ── Run through the lifecycle so statutory lines are applied + payslips ──
    heading('M3a/M3b APPLY STATUTORY AT PREPARE → PAYSLIPS AT PROCESS');

    // The preparer and the approver must be different people (separation of
    // duties). The payroll administrator creates, prepares and submits; the
    // owner approves and processes.
    await login(paEmail);
    const run = await createRun(monthly.id, stamp, `M3 e2e statutory ${stamp}`);
    cleanup.runIds.push(run.id);
    cleanup.payslipRunIds.push(run.id);

    const prepared = dataOf(await req('POST', `/payroll/runs/${run.id}/prepare`));
    const items = (await req('GET', `/payroll/runs/${run.id}/items`)).json.data || [];
    const workerAItems = items.filter((i) => i.workerId === workerA);
    const payeA = workerAItems.find((i) => i.description === 'Income tax');
    const pensionA = workerAItems.find((i) => i.description === 'Employee pension');

    // Worker A gross = 1,000,000. PAYE: 5% of 300k + 10% of 700k = 15k + 70k = 85k.
    // Pension: 8% of 1,000,000 = 80,000.
    check(
      !!payeA && payeA.amountMinorUnits === -85000,
      'P1 PAYE banded tax line applied at prepare (−85,000)',
      JSON.stringify(payeA),
    );
    check(
      !!pensionA && pensionA.amountMinorUnits === -80000,
      'P2 employee pension line applied at prepare (−80,000)',
      JSON.stringify(pensionA),
    );
    const itemsTotalNet = items.reduce((s, i) => s + i.amountMinorUnits, 0);
    check(
      prepared.totalNetMinorUnits === itemsTotalNet,
      'P3 run total net reconciles with the sum of every item line',
      `run=${prepared.totalNetMinorUnits} lines=${itemsTotalNet}`,
    );
    const workerANet = workerAItems.reduce((s, i) => s + i.amountMinorUnits, 0);
    check(
      workerANet === 835000,
      'P4 worker A net = 1,000,000 gross − 85,000 tax − 80,000 pension = 835,000',
      `net=${workerANet}`,
    );

    const submitRes = await req('POST', `/payroll/runs/${run.id}/submit`);
    check(
      submitRes.status === 200 || submitRes.status === 201,
      'P5 submit accepted',
      `status=${submitRes.status} ${JSON.stringify(submitRes.json).slice(0, 200)}`,
    );
    await login('owner@ascenda.dev');
    const approveRes = await req('POST', `/payroll/runs/${run.id}/approve`, {});
    check(
      approveRes.status === 200 || approveRes.status === 201,
      'P6 approve accepted',
      `status=${approveRes.status} ${JSON.stringify(approveRes.json).slice(0, 200)}`,
    );
    const processRes = await req('POST', `/payroll/runs/${run.id}/process`);
    const processed = dataOf(processRes);
    check(
      processed.paymentsCreated >= 2,
      'P7 process created payments',
      `status=${processRes.status} ${JSON.stringify(processRes.json).slice(0, 200)}`,
    );

    const payslips = (await req('GET', `/payslips?payrollRunId=${run.id}`)).json.data || [];
    check(
      payslips.length >= 2,
      'PS1 one payslip per worker created at process',
      `n=${payslips.length}`,
    );
    const slipA = payslips.find((p) => p.workerId === workerA);
    check(
      !!slipA &&
        slipA.grossMinorUnits === 1000000 &&
        slipA.deductionsMinorUnits === 165000 &&
        slipA.netMinorUnits === 835000 &&
        slipA.employerCostsMinorUnits === 100000,
      'PS2 payslip totals reconcile (gross 1,000,000 / deductions 165,000 / net 835,000 / employer 100,000)',
      JSON.stringify(slipA),
    );

    const pdf = await reqRaw('GET', `/payslips/${slipA.id}/pdf`);
    check(
      pdf.status === 200 &&
        pdf.contentType.includes('application/pdf') &&
        pdf.buf.slice(0, 5).toString() === '%PDF-',
      'PS3 payslip PDF downloads (application/pdf, %PDF- magic)',
      `status=${pdf.status} ct=${pdf.contentType}`,
    );

    // ── M3c: PAYMENT FILE EXPORT (PAY-12) ───────────────────────────────────
    heading('M3c PAYMENT FILE EXPORT (PAY-12)');
    const csv = await reqRaw('GET', `/payments/export?payrollRunId=${run.id}`);
    check(
      csv.status === 200 && csv.contentType.includes('text/csv'),
      'E1 payment export returns a CSV',
      `status=${csv.status} ct=${csv.contentType}`,
    );
    check(
      csv.text.includes('reference,worker_name') && csv.text.includes('PAY-'),
      'E2 CSV has the header row and payment references',
      csv.text.slice(0, 60),
    );
    check(
      csv.contentDisposition.includes('attachment'),
      'E3 export is served as an attachment',
      csv.contentDisposition,
    );

    // ── M3d: REIMBURSEMENTS (PAY-14) ────────────────────────────────────────
    heading('M3d REIMBURSEMENTS (PAY-14)');

    const claim = dataOf(
      await req('POST', '/expense-claims', {
        workerId: workerB,
        type: 'TRAVEL',
        description: 'Client visit taxi',
        amountMinorUnits: 45000,
      }),
    );
    cleanup.claimIds.push(claim.id);
    check(
      !!claim.id && claim.status === 'SUBMITTED',
      'R1 claim submitted (SUBMITTED)',
      JSON.stringify(claim).slice(0, 150),
    );

    // Finance cannot decide before the manager step.
    await login(financeEmail);
    const financeEarly = await req('POST', `/expense-claims/${claim.id}/finance-decision`, {
      decision: 'APPROVE',
    });
    check(financeEarly.status === 409, 'R2 finance decision before manager step refused (409)', `status=${financeEarly.status}`);

    await login(managerEmail);
    const managerApprove = dataOf(
      await req('POST', `/expense-claims/${claim.id}/manager-decision`, { decision: 'APPROVE' }),
    );
    check(managerApprove.status === 'MANAGER_APPROVED', 'R3 manager approved the claim', managerApprove.status);

    await login(financeEmail);
    const financeApprove = dataOf(
      await req('POST', `/expense-claims/${claim.id}/finance-decision`, { decision: 'APPROVE' }),
    );
    check(financeApprove.status === 'FINANCE_APPROVED', 'R4 finance approved the claim', financeApprove.status);

    // Fold the approved claim into a fresh run (its period is later).
    await login('owner@ascenda.dev');
    const run2Res = await req('POST', '/payroll/runs', {
      payCalendarId: monthly.id,
      periodStart: '2027-01-01',
      periodEnd: '2027-01-31',
      notes: `M3 e2e reimburse ${stamp}`,
    });
    const run2 = dataOf(run2Res);
    if (!run2.id) {
      throw new Error(`run2 create failed: ${run2Res.status} ${JSON.stringify(run2Res.json)}`);
    }
    cleanup.runIds.push(run2.id);
    cleanup.payslipRunIds.push(run2.id);
    await req('POST', `/payroll/runs/${run2.id}/prepare`);
    const items2 = (await req('GET', `/payroll/runs/${run2.id}/items`)).json.data || [];
    const reimbLine = items2.find((i) => i.workerId === workerB && i.type === 'REIMBURSEMENT');
    check(
      !!reimbLine && reimbLine.amountMinorUnits === 45000,
      'R5 approved reimbursement folded into the run as an earning',
      JSON.stringify(reimbLine),
    );

    const claimAfter = dataOf(await req('GET', `/expense-claims/${claim.id}`));
    check(
      claimAfter.status === 'PAID' && claimAfter.paidPayrollRunId === run2.id,
      'R6 claim stamped PAID against the run',
      JSON.stringify(claimAfter).slice(0, 150),
    );

    // ── SELF-SERVICE SCOPING ────────────────────────────────────────────────
    heading('SELF-SERVICE SCOPING');
    const selfEmail = `m3-self-${stamp}@ascenda.test`;
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
    const selfSlips = (await req('GET', '/payslips')).json.data || [];
    check(
      selfSlips.length >= 1 && selfSlips.every((p) => p.workerId === workerA),
      'SC1 employee sees only their own payslips',
      `n=${selfSlips.length}`,
    );
    const selfNoAccess = await req('GET', `/payslips/${slipA.id}`);
    check(selfNoAccess.status === 200, 'SC2 employee can read their own payslip', `status=${selfNoAccess.status}`);
    const otherSlip = payslips.find((p) => p.workerId !== workerA);
    const selfDenied = await req('GET', `/payslips/${otherSlip.id}`);
    check(selfDenied.status === 404, 'SC3 employee cannot read another worker’s payslip (404)', `status=${selfDenied.status}`);

    await login('owner@ascenda.dev');

    // ── AUDIT ───────────────────────────────────────────────────────────────
    heading('AUDIT');
    const auditCounts = await db.query(
      `SELECT action, count(*)::int AS n FROM audit_log
       WHERE "targetId" = ANY($1)
          OR "targetId" = ANY($2)
          OR action IN ('PAYSLIP_GENERATED','PAYSLIP_ACCESSED','PAYMENTS_EXPORTED','STATUTORY_RULE_PACK_CHANGED','EXPENSE_CLAIM_CREATED','EXPENSE_CLAIM_STATUS_CHANGED')
       GROUP BY action`,
      [cleanup.runIds.concat(cleanup.claimIds), cleanup.packIds],
    );
    const byAction = Object.fromEntries(auditCounts.rows.map((r) => [r.action, r.n]));
    for (const action of [
      'PAYSLIP_GENERATED',
      'PAYSLIP_ACCESSED',
      'PAYMENTS_EXPORTED',
      'STATUTORY_RULE_PACK_CHANGED',
      'EXPENSE_CLAIM_CREATED',
      'EXPENSE_CLAIM_STATUS_CHANGED',
    ]) {
      check((byAction[action] || 0) >= 1, `A1 audit row present: ${action}`, JSON.stringify(byAction));
    }

    // ── GUARDS ──────────────────────────────────────────────────────────────
    heading('GUARDS');
    cookie = '';
    const unauth = await fetch(`${BASE}/payroll/statutory-rule-packs`);
    check(unauth.status === 401, 'G1 unauthenticated request rejected (401)', `status=${unauth.status}`);
  } finally {
    try {
      const runIds = cleanup.runIds.filter(Boolean);
      const workerIds = cleanup.workerIds.filter(Boolean);
      if (runIds.length) {
        await db.query(`DELETE FROM payslips WHERE "payrollRunId" = ANY($1)`, [runIds]);
        await db.query(`DELETE FROM payments WHERE "payrollRunId" = ANY($1)`, [runIds]);
        await db.query(`DELETE FROM payroll_items WHERE "payrollRunId" = ANY($1)`, [runIds]);
        await db.query(`DELETE FROM payroll_run_approvals WHERE "payrollRunId" = ANY($1)`, [runIds]);
        await db.query(`DELETE FROM expense_claims WHERE "paidPayrollRunId" = ANY($1)`, [runIds]);
      }
      if (workerIds.length) {
        await db.query(`DELETE FROM payslips WHERE "workerId" = ANY($1)`, [workerIds]);
        await db.query(`DELETE FROM expense_claims WHERE "workerId" = ANY($1)`, [workerIds]);
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
        ...cleanup.claimIds.filter(Boolean),
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
