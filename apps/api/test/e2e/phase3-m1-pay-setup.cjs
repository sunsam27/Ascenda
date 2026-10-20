// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 M1 TEST — Pay Setup
// "Pay structure, recurring pay items, and pay calendars pass PAY-01..PAY-04."
//
// Covers four PRD areas over the real API + database:
//   * PAY-01 PAY STRUCTURE: components drive the gross (sum invariant),
//     gross-only legacy writes synthesise a BASE line, updates keep the
//     invariant, invalid structures rejected (mismatch/duplicate/missing).
//   * PAY-02 RECURRING DEDUCTIONS: fixed and percentage items, XOR money
//     fields, calculation-method switching clears the stale amount form,
//     list filters, lifecycle (create → read → update → delete).
//   * PAY-03 EMPLOYER COSTS: employer pension as a percentage of gross, list
//     filtering by type.
//   * PAY-04 PAY CALENDAR: seeded monthly calendar, period maths for a year,
//     invalid configurations rejected, CRUD + PAY_CALENDAR_CHANGED audit.
//
// Run (from repo root, API + DB running):
//   node --env-file=packages\db\.env apps\api\test\e2e\phase3-m1-pay-setup.cjs
// ─────────────────────────────────────────────────────────────────────────────
const { Client } = require('C:\\Users\\shegz\\dev\\Ascenda\\packages\\db\\node_modules\\pg');

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

async function createWorker(payload) {
  const res = await req('POST', '/workers', payload);
  const w = dataOf(res);
  if (!w.id) {
    throw new Error(`worker create failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return w.id;
}

async function main() {
  const login = await req('POST', '/auth/login', {
    email: 'owner@ascenda.dev',
    password: 'AscendaDemo123!',
  });
  if (login.status !== 200 && login.status !== 201) {
    throw new Error(`login failed: ${login.status} ${JSON.stringify(login.json)}`);
  }

  const stamp = Date.now().toString(36);
  const compIds = [];
  const itemIds = [];
  const calendarIds = [];
  let workerId = null;

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
    workerId = await createWorker({
      employeeNumber: `PAY-M1-${stamp}`,
      firstName: 'Pay',
      lastName: 'Setup',
      email: `pay-m1-${stamp}@example.test`,
      category: 'EMPLOYEE',
      employmentType: 'FULL_TIME',
      jobTitle: 'QA',
      startDate: '2026-01-01',
    });
    check(!!workerId, 'fixture created (worker)');

    // ── PAY-01: PAY STRUCTURE (components drive the gross) ──────────────────
    heading('PAY STRUCTURE (PAY-01)');

    const compBase = `/workers/${workerId}/compensation`;

    // P1: components are the source of truth — the gross is their sum.
    const p1 = await req('POST', compBase, {
      payFrequency: 'MONTHLY',
      validFrom: '2026-01-01',
      validTo: '2026-02-01',
      components: [
        { code: 'BASE', label: 'Base salary', amountMinorUnits: 500000 },
        { code: 'HOUSING', label: 'Housing', amountMinorUnits: 100000 },
      ],
    });
    const p1d = dataOf(p1);
    compIds.push(p1d.id);
    check(
      p1.status === 201 && p1d.grossAmountMinorUnits === 600000,
      'P1 gross computed as sum(BASE 500000 + HOUSING 100000 = 600000)',
      `status=${p1.status} gross=${p1d.grossAmountMinorUnits} ${JSON.stringify(p1.json).slice(0, 200)}`,
    );
    check(
      Array.isArray(p1d.components) && p1d.components.length === 2,
      'P1 components echoed back (2 lines)',
      JSON.stringify(p1d.components),
    );

    // P2: a disagreeing gross is a client error (PRD PAY-01).
    const p2 = await req('POST', compBase, {
      payFrequency: 'MONTHLY',
      validFrom: '2026-06-01',
      components: [{ code: 'BASE', label: 'Base salary', amountMinorUnits: 500000 }],
      grossAmountMinorUnits: 999999,
    });
    check(
      p2.status === 400,
      'P2 components/gross mismatch rejected (400)',
      `status=${p2.status} ${JSON.stringify(p2.json).slice(0, 200)}`,
    );

    // P3: a write with neither components nor gross is invalid.
    const p3 = await req('POST', compBase, {
      payFrequency: 'MONTHLY',
      validFrom: '2026-07-01',
    });
    check(
      p3.status === 400,
      'P3 compensation without components or gross rejected (400)',
      `status=${p3.status} ${JSON.stringify(p3.json).slice(0, 200)}`,
    );

    // P4: duplicate component codes rejected.
    const p4 = await req('POST', compBase, {
      payFrequency: 'MONTHLY',
      validFrom: '2026-08-01',
      components: [
        { code: 'BASE', label: 'Base', amountMinorUnits: 100000 },
        { code: 'BASE', label: 'Base again', amountMinorUnits: 50000 },
      ],
    });
    check(
      p4.status === 400,
      'P4 duplicate component codes rejected (400)',
      `status=${p4.status} ${JSON.stringify(p4.json).slice(0, 200)}`,
    );

    // P5: legacy gross-only write stores no breakdown but reads back a BASE line.
    const p5 = await req('POST', compBase, {
      payFrequency: 'MONTHLY',
      validFrom: '2026-02-01',
      validTo: '2026-03-01',
      grossAmountMinorUnits: 700000,
    });
    const p5d = dataOf(p5);
    compIds.push(p5d.id);
    check(
      p5.status === 201 && p5d.grossAmountMinorUnits === 700000,
      'P5 legacy gross-only write accepted (700000)',
      `status=${p5.status} ${JSON.stringify(p5.json).slice(0, 200)}`,
    );
    check(
      Array.isArray(p5d.components) &&
        p5d.components.length === 1 &&
        p5d.components[0].code === 'BASE' &&
        p5d.components[0].amountMinorUnits === 700000,
      'P5 read synthesises a single BASE line for legacy rows',
      JSON.stringify(p5d.components),
    );

    // P6: a components update recomputes the gross.
    const p6 = await req('PATCH', `${compBase}/${p1d.id}`, {
      components: [
        { code: 'BASE', label: 'Base salary', amountMinorUnits: 600000 },
        { code: 'HOUSING', label: 'Housing', amountMinorUnits: 100000 },
      ],
    });
    const p6d = dataOf(p6);
    check(
      p6.status === 200 && p6d.grossAmountMinorUnits === 700000,
      'P6 components update recomputes gross (600000 + 100000 = 700000)',
      `status=${p6.status} gross=${p6d.grossAmountMinorUnits}`,
    );

    // P7: a mismatching update is rejected and the record is untouched.
    const p7 = await req('PATCH', `${compBase}/${p1d.id}`, {
      components: [{ code: 'BASE', label: 'Base salary', amountMinorUnits: 1 }],
      grossAmountMinorUnits: 424242,
    });
    check(
      p7.status === 400,
      'P7 mismatching update rejected (400)',
      `status=${p7.status} ${JSON.stringify(p7.json).slice(0, 200)}`,
    );
    const p7list = dataOf(await req('GET', compBase)) || [];
    const p7row = p7list.find((r) => r.id === p1d.id);
    check(
      p7row && p7row.grossAmountMinorUnits === 700000,
      'P7 rejected update left the record untouched (still 700000)',
      JSON.stringify(p7row).slice(0, 200),
    );

    // P8: a gross-only update resets the breakdown to a single BASE line.
    const p8 = await req('PATCH', `${compBase}/${p5d.id}`, {
      grossAmountMinorUnits: 800000,
    });
    const p8d = dataOf(p8);
    check(
      p8.status === 200 &&
        p8d.grossAmountMinorUnits === 800000 &&
        p8d.components.length === 1 &&
        p8d.components[0].code === 'BASE' &&
        p8d.components[0].amountMinorUnits === 800000,
      'P8 gross-only update resets components to one BASE line (800000)',
      `status=${p8.status} ${JSON.stringify(p8d.components)}`,
    );

    // P9: the current-rate read reflects the breakdown for the right date.
    const p9 = await req('GET', `${compBase}/current?asOf=2026-01-15`);
    const p9d = dataOf(p9);
    check(
      p9d && p9d.grossAmountMinorUnits === 700000 && p9d.components.length === 2,
      'P9 current rate on 2026-01-15 is the updated components record (700000, 2 lines)',
      JSON.stringify(p9d).slice(0, 200),
    );
    const p10 = await req('GET', `${compBase}/current?asOf=2026-02-15`);
    const p10d = dataOf(p10);
    check(
      p10d && p10d.grossAmountMinorUnits === 800000 && p10d.components[0].code === 'BASE',
      'P10 current rate on 2026-02-15 is the gross-only record (800000, BASE)',
      JSON.stringify(p10d).slice(0, 200),
    );

    // ── PAY-02: RECURRING DEDUCTIONS ────────────────────────────────────────
    heading('RECURRING DEDUCTIONS (PAY-02)');

    const items = '/payroll/recurring-items';

    // R1: fixed deduction.
    const r1 = await req('POST', items, {
      workerId,
      type: 'DEDUCTION',
      name: 'Cooperative',
      calculation: 'FIXED',
      amountMinorUnits: 5000,
      validFrom: '2026-01-01',
    });
    const r1d = dataOf(r1);
    itemIds.push(r1d.id);
    check(
      r1.status === 201 && r1d.amountMinorUnits === 5000 && r1d.rateBps == null,
      'R1 fixed deduction created (amount 5000, no rate)',
      `status=${r1.status} ${JSON.stringify(r1.json).slice(0, 200)}`,
    );

    // R2: FIXED without an amount is invalid (XOR money fields).
    const r2 = await req('POST', items, {
      workerId,
      type: 'DEDUCTION',
      name: 'Hollow',
      calculation: 'FIXED',
      validFrom: '2026-01-01',
    });
    check(
      r2.status === 400,
      'R2 FIXED without amount rejected (400)',
      `status=${r2.status} ${JSON.stringify(r2.json).slice(0, 200)}`,
    );

    // R3: amount and rate together are invalid (XOR).
    const r3 = await req('POST', items, {
      workerId,
      type: 'DEDUCTION',
      name: 'Both',
      calculation: 'FIXED',
      amountMinorUnits: 1000,
      rateBps: 100,
      validFrom: '2026-01-01',
    });
    check(
      r3.status === 400,
      'R3 amount + rate together rejected (400)',
      `status=${r3.status} ${JSON.stringify(r3.json).slice(0, 200)}`,
    );

    // R4: the type allow-list excludes salaries (PAY-02/03 only).
    const r4 = await req('POST', items, {
      workerId,
      type: 'BASIC_SALARY',
      name: 'Nope',
      calculation: 'FIXED',
      amountMinorUnits: 1000,
      validFrom: '2026-01-01',
    });
    check(
      r4.status === 400,
      'R4 type outside allow-list rejected (400)',
      `status=${r4.status} ${JSON.stringify(r4.json).slice(0, 200)}`,
    );

    // R5: percentage deduction.
    const r5 = await req('POST', items, {
      workerId,
      type: 'DEDUCTION',
      name: 'Union dues',
      calculation: 'PERCENTAGE',
      rateBps: 250,
      validFrom: '2026-01-01',
    });
    const r5d = dataOf(r5);
    itemIds.push(r5d.id);
    check(
      r5.status === 201 && r5d.rateBps === 250 && r5d.amountMinorUnits == null,
      'R5 percentage deduction created (250 bps, no amount)',
      `status=${r5.status} ${JSON.stringify(r5.json).slice(0, 200)}`,
    );

    // R6: invalid period rejected.
    const r6 = await req('POST', items, {
      workerId,
      type: 'DEDUCTION',
      name: 'Backwards',
      calculation: 'FIXED',
      amountMinorUnits: 100,
      validFrom: '2026-05-01',
      validTo: '2026-04-01',
    });
    check(
      r6.status === 400,
      'R6 validTo before validFrom rejected (400)',
      `status=${r6.status} ${JSON.stringify(r6.json).slice(0, 200)}`,
    );

    // R7: unknown worker → 404.
    const r7 = await req('POST', items, {
      workerId: '00000000-0000-4000-8000-000000000000',
      type: 'DEDUCTION',
      name: 'Ghost',
      calculation: 'FIXED',
      amountMinorUnits: 100,
      validFrom: '2026-01-01',
    });
    check(
      r7.status === 404,
      'R7 unknown worker rejected (404)',
      `status=${r7.status}`,
    );

    // R8: switching FIXED → PERCENTAGE without a rate is invalid — the stale
    // amount must not ride along with the new method.
    const r8 = await req('PATCH', `${items}/${r1d.id}`, {
      calculation: 'PERCENTAGE',
    });
    check(
      r8.status === 400,
      'R8 method switch without a rate rejected — stale amount cleared (400)',
      `status=${r8.status} ${JSON.stringify(r8.json).slice(0, 200)}`,
    );

    // R9: the same switch with a rate succeeds and clears the amount.
    const r9 = await req('PATCH', `${items}/${r1d.id}`, {
      calculation: 'PERCENTAGE',
      rateBps: 150,
    });
    const r9d = dataOf(r9);
    check(
      r9.status === 200 && r9d.rateBps === 150 && r9d.amountMinorUnits == null,
      'R9 method switch applied (rate 150 bps, amount cleared)',
      `status=${r9.status} ${JSON.stringify(r9d).slice(0, 200)}`,
    );

    // R10: list filters by type + worker + active flag.
    const r10 = await req(
      'GET',
      `${items}?workerId=${workerId}&type=DEDUCTION&active=true&pageSize=200`,
    );
    const r10list = Array.isArray(dataOf(r10)) ? dataOf(r10) : r10.json.data || [];
    const r10types = new Set(r10list.map((i) => i.type));
    check(
      r10.status === 200 &&
        r10list.length >= 2 &&
        r10types.size === 1 &&
        r10types.has('DEDUCTION'),
      `R10 type+worker+active filters applied (${r10list.length} deductions)`,
      JSON.stringify(r10.json).slice(0, 200),
    );

    // ── PAY-03: EMPLOYER COSTS ──────────────────────────────────────────────
    heading('EMPLOYER COSTS (PAY-03)');

    const e1 = await req('POST', items, {
      workerId,
      type: 'EMPLOYER_PENSION',
      name: 'Employer pension',
      calculation: 'PERCENTAGE',
      rateBps: 1000,
      validFrom: '2026-01-01',
    });
    const e1d = dataOf(e1);
    itemIds.push(e1d.id);
    check(
      e1.status === 201 && e1d.type === 'EMPLOYER_PENSION' && e1d.rateBps === 1000,
      'E1 employer pension cost created (1000 bps of gross)',
      `status=${e1.status} ${JSON.stringify(e1.json).slice(0, 200)}`,
    );

    const e2 = await req(
      'GET',
      `${items}?workerId=${workerId}&type=EMPLOYER_PENSION&active=true`,
    );
    const e2list = Array.isArray(dataOf(e2)) ? dataOf(e2) : e2.json.data || [];
    check(
      e2.status === 200 &&
        e2list.length === 1 &&
        e2list[0].id === e1d.id,
      'E2 employer-cost list filtered by type (exactly the pension item)',
      JSON.stringify(e2list).slice(0, 200),
    );

    // ── PAY-04: PAY CALENDAR ────────────────────────────────────────────────
    heading('PAY CALENDAR (PAY-04)');

    const cals = '/payroll/pay-calendars';
    const list1 = await req('GET', `${cals}?pageSize=200`);
    const list1data = Array.isArray(dataOf(list1)) ? dataOf(list1) : list1.json.data || [];
    const seeded = list1data.find((c) => c.name === 'Monthly');
    check(
      list1.status === 200 && !!seeded,
      'C1 seeded "Monthly" pay calendar present',
      JSON.stringify(list1.json).slice(0, 200),
    );
    check(
      seeded && seeded.dayOfMonth === 28 && seeded.cutOffDayOfMonth === 25,
      'C1 seed configuration: pay day 28, cut-off 25',
      JSON.stringify(seeded),
    );

    // C2: period maths for a full year (monthly, paid the following month).
    let janPeriod = null;
    let febPeriod = null;
    if (seeded) {
      const periodsRes = await req(
        'GET',
        `${cals}/${seeded.id}/periods?year=2026`,
      );
      const periods = dataOf(periodsRes);
      janPeriod = (periods || []).find((p) => p.periodStart === '2026-01-01');
      febPeriod = (periods || []).find((p) => p.periodStart === '2026-02-01');
      check(
        periodsRes.status === 200 && periods.length === 12,
        'C2 full year yields 12 monthly periods',
        `count=${(periods || []).length}`,
      );
      check(
        janPeriod &&
          janPeriod.periodEnd === '2026-01-31' &&
          janPeriod.payDate === '2026-02-28',
        'C2 January is paid on 28 February (following month, day 28)',
        JSON.stringify(janPeriod),
      );
      check(
        febPeriod && febPeriod.payDate === '2026-03-28',
        'C2 February is paid on 28 March',
        JSON.stringify(febPeriod),
      );
      check(
        janPeriod && typeof janPeriod.beforeCutOff === 'boolean',
        'C2 each period carries its cut-off state',
        JSON.stringify(janPeriod),
      );
    }

    // C3: invalid configurations rejected (domain rules, not just DTO guards).
    const c3a = await req('POST', cals, {
      name: `NoDay-${stamp}`,
      frequency: 'MONTHLY',
    });
    check(
      c3a.status === 400,
      'C3 MONTHLY without dayOfMonth rejected (400)',
      `status=${c3a.status} ${JSON.stringify(c3a.json).slice(0, 200)}`,
    );
    const c3b = await req('POST', cals, {
      name: `NoDow-${stamp}`,
      frequency: 'BIWEEKLY',
    });
    check(
      c3b.status === 400,
      'C3 BIWEEKLY without dayOfWeek rejected (400)',
      `status=${c3b.status} ${JSON.stringify(c3b.json).slice(0, 200)}`,
    );
    const c3c = await req('POST', cals, {
      name: `BadCut-${stamp}`,
      frequency: 'MONTHLY',
      dayOfMonth: 28,
      cutOffDayOfMonth: 32,
    });
    check(
      c3c.status === 400,
      'C3 cut-off outside 1–31 rejected (400)',
      `status=${c3c.status} ${JSON.stringify(c3c.json).slice(0, 200)}`,
    );

    // C4: create → periods → rename → audit → delete.
    const c4 = await req('POST', cals, {
      name: `Biweekly Test ${stamp}`,
      frequency: 'BIWEEKLY',
      dayOfWeek: 5,
      cutOffDayOfMonth: 3,
    });
    const c4d = dataOf(c4);
    calendarIds.push(c4d.id);
    check(
      c4.status === 201 && c4d.frequency === 'BIWEEKLY' && c4d.dayOfWeek === 5,
      'C4 biweekly calendar created (pays Fridays, cut-off day 3)',
      `status=${c4.status} ${JSON.stringify(c4.json).slice(0, 200)}`,
    );

    const c4periods = await req('GET', `${cals}/${c4d.id}/periods?year=2026`);
    const c4plist = dataOf(c4periods);
    check(
      c4periods.status === 200 && Array.isArray(c4plist) && c4plist.length >= 26,
      `C4 biweekly calendar yields the year's cycles (${(c4plist || []).length})`,
      `count=${(c4plist || []).length}`,
    );

    const c5 = await req('PATCH', `${cals}/${c4d.id}`, {
      name: `Biweekly Renamed ${stamp}`,
    });
    check(
      c5.status === 200 && dataOf(c5).name === `Biweekly Renamed ${stamp}`,
      'C5 calendar renamed',
      `status=${c5.status} ${JSON.stringify(c5.json).slice(0, 200)}`,
    );

    const auditCal = await db.query(
      `SELECT action FROM audit_log WHERE "targetId" = $1 AND action = 'PAY_CALENDAR_CHANGED'`,
      [c4d.id],
    );
    check(
      auditCal.rows.length >= 2,
      `C5 PAY_CALENDAR_CHANGED audited for create + update (${auditCal.rows.length} rows)`,
      `rows=${auditCal.rows.length}`,
    );

    const c6 = await req('DELETE', `${cals}/${c4d.id}`);
    check(
      c6.status === 204 || c6.status === 200,
      'C6 calendar deleted',
      `status=${c6.status}`,
    );
    const c7 = await req('GET', `${cals}/${c4d.id}`);
    check(
      c7.status === 404,
      'C6 deleted calendar reads back 404',
      `status=${c7.status}`,
    );
    const auditCal2 = await db.query(
      `SELECT action FROM audit_log WHERE "targetId" = $1 AND action = 'PAY_CALENDAR_CHANGED'`,
      [c4d.id],
    );
    check(
      auditCal2.rows.length >= 3,
      'C6 delete also audited (PAY_CALENDAR_CHANGED)',
      `rows=${auditCal2.rows.length}`,
    );

    // ── AUDIT: recurring pay items (PAY-02/03) ──────────────────────────────
    heading('AUDIT (PAY-02 / PAY-03 writes)');

    const auditItems = await db.query(
      `SELECT "targetId" FROM audit_log WHERE action = 'RECURRING_PAY_ITEM_CHANGED' AND "targetId" = ANY($1)`,
      [itemIds],
    );
    check(
      auditItems.rows.length >= itemIds.length,
      `A1 every recurring pay item write audited (RECURRING_PAY_ITEM_CHANGED: ${auditItems.rows.length}/${itemIds.length} items)`,
      `rows=${auditItems.rows.length}`,
    );

    // R11: delete lifecycle → 204 then 404.
    const rDel = await req('DELETE', `${items}/${r5d.id}`);
    check(
      rDel.status === 204 || rDel.status === 200,
      'R11 recurring pay item deleted',
      `status=${rDel.status}`,
    );
    const rGet = await req('GET', `${items}/${r5d.id}`);
    check(
      rGet.status === 404,
      'R11 deleted item reads back 404',
      `status=${rGet.status}`,
    );

    // ── RBAC / AUTH sanity ──────────────────────────────────────────────────
    heading('AUTH GUARD');
    const noAuth = await fetch(`${BASE}/payroll/pay-calendars`);
    check(noAuth.status === 401, 'X1 unauthenticated request rejected (401)', `status=${noAuth.status}`);
  } finally {
    // ── Cleanup ───────────────────────────────────────────────────────────────
    try {
      const ids = [
        ...compIds.filter(Boolean),
        ...itemIds.filter(Boolean),
        ...calendarIds.filter(Boolean),
        ...(workerId ? [workerId] : []),
      ];
      if (compIds.filter(Boolean).length) {
        await db.query(`DELETE FROM compensation_records WHERE id = ANY($1)`, [
          compIds.filter(Boolean),
        ]);
      }
      if (itemIds.filter(Boolean).length) {
        await db.query(`DELETE FROM recurring_pay_items WHERE id = ANY($1)`, [
          itemIds.filter(Boolean),
        ]);
      }
      if (calendarIds.filter(Boolean).length) {
        await db.query(`DELETE FROM pay_calendars WHERE id = ANY($1)`, [
          calendarIds.filter(Boolean),
        ]);
      }
      if (workerId) {
        await db.query(`DELETE FROM workers WHERE id = $1`, [workerId]);
      }
      if (ids.length) {
        await db.query(`DELETE FROM audit_log WHERE "targetId" = ANY($1)`, [ids]);
      }
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
