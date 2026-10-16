// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 EXIT TEST — Time & Leave
// "Leave balance and holiday maths pass the acceptance criteria."
//
// Covers the two acceptance areas over the real API + database:
//   * HOLIDAY MATHS   (LVE-03): weekends, one-off org holidays, recurring
//     holidays, location-scoped holidays, and half-day boundaries.
//   * BALANCE MATHS   (LVE-01/LVE-02): entitlement, reduce-only-on-final-
//     approval, restore-on-cancel, and insufficient-balance rejection.
//
// Run (from repo root, API + DB running):
//   node --env-file=packages\db\.env apps\api\test\e2e\phase2-exit.cjs
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

async function requestDays(workerId, leaveTypeId, body) {
  const res = await req('POST', '/leave-requests', {
    workerId,
    leaveTypeId,
    submit: true,
    ...body,
  });
  const d = dataOf(res);
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`leave create failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return { res, request: d };
}

async function main() {
  const login = await req('POST', '/auth/login', {
    email: 'owner@ascenda.dev',
    password: 'AscendaDemo123!',
  });
  if (login.status !== 200 && login.status !== 201) {
    throw new Error(`login failed: ${login.status} ${JSON.stringify(login.json)}`);
  }

  const lts = await req('GET', '/leave-types?pageSize=50');
  const annual = (lts.json.data || []).find((t) => t.category === 'ANNUAL');
  if (!annual) throw new Error('no ANNUAL leave type in seed data');

  const stamp = Date.now().toString(36);
  const holidayIds = [];
  const requests = [];
  let locationId = null;
  let scopedWorkerId = null;
  let plainWorkerId = null;
  let customTypeId = null;

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
    const createdLoc = await req('POST', '/locations', {
      name: `ExitTest-${stamp}`,
      workDays: [1, 2, 3, 4, 5],
    });
    locationId = dataOf(createdLoc).id;

    const scoped = await createWorker({
      employeeNumber: `EXIT-A-${stamp}`,
      firstName: 'Scoped',
      lastName: 'Worker',
      email: `exit-scoped-${stamp}@example.test`,
      category: 'EMPLOYEE',
      employmentType: 'FULL_TIME',
      jobTitle: 'QA',
      startDate: '2026-01-01',
      locationId,
    });
    scopedWorkerId = scoped;

    const plain = await createWorker({
      employeeNumber: `EXIT-B-${stamp}`,
      firstName: 'Plain',
      lastName: 'Worker',
      email: `exit-plain-${stamp}@example.test`,
      category: 'EMPLOYEE',
      employmentType: 'FULL_TIME',
      jobTitle: 'QA',
      startDate: '2026-01-01',
    });
    plainWorkerId = plain;

    check(!!locationId && !!scopedWorkerId && !!plainWorkerId, 'fixtures created (location + 2 workers)');

    // ── HOLIDAY MATHS (LVE-03) ──────────────────────────────────────────────
    heading('HOLIDAY MATHS (LVE-03)');

    // H1: weekends excluded — Sat 3 Jan 2026 → Sun 4 Jan contains no working day.
    const weekend = await req('POST', '/leave-requests', {
      workerId: plainWorkerId,
      leaveTypeId: annual.id,
      startDate: '2026-01-03',
      endDate: '2026-01-04',
      submit: true,
    });
    check(
      weekend.status === 400,
      'H1 weekend-only span rejected as "no working days" (400)',
      `status=${weekend.status} ${JSON.stringify(weekend.json)}`,
    );

    // H1b: Fri 2 Jan → Mon 5 Jan spans a weekend → 2 working days.
    const overWeekend = await req('POST', '/leave-requests', {
      workerId: plainWorkerId,
      leaveTypeId: annual.id,
      startDate: '2026-01-02',
      endDate: '2026-01-05',
      submit: true,
    });
    requests.push(dataOf(overWeekend).id);
    check(
      dataOf(overWeekend).days === 2,
      'H1 weekends excluded (Fri→Mon counts only Fri + Mon = 2)',
      `days=${dataOf(overWeekend).days}`,
    );

    // H2: a one-off org-wide holiday inside a Mon–Fri week removes a day.
    const h2 = await req('POST', '/holidays', {
      name: `Exit one-off ${stamp}`,
      date: '2026-01-07', // Wednesday
      isRecurring: false,
    });
    holidayIds.push(dataOf(h2).id);
    const oneOff = await req('POST', '/leave-requests', {
      workerId: plainWorkerId,
      leaveTypeId: annual.id,
      startDate: '2026-01-05',
      endDate: '2026-01-09',
      submit: true,
    });
    requests.push(dataOf(oneOff).id);
    check(
      dataOf(h2).id !== undefined,
      'H2 one-off org holiday created',
      JSON.stringify(h2.json),
    );
    check(
      dataOf(oneOff).days === 4,
      'H2 one-off holiday excluded (Mon–Fri minus Wed = 4)',
      `days=${dataOf(oneOff).days}`,
    );

    // H3: recurring holiday matches the same month/day in a later year. The
    // seed ships "New Year's Day" as recurring; 2025-12-29 → 2026-01-02 hits it.
    const recurring = await req('POST', '/leave-requests', {
      workerId: plainWorkerId,
      leaveTypeId: annual.id,
      startDate: '2025-12-29',
      endDate: '2026-01-02',
      submit: true,
    });
    requests.push(dataOf(recurring).id);
    check(
      dataOf(recurring).days === 4,
      'H2 recurring holiday excluded (New Year Thu 1 Jan skips a day → 4)',
      `days=${dataOf(recurring).days}`,
    );

    // H3: a location-scoped holiday only affects workers at that location.
    const scopedHoliday = await req('POST', '/holidays', {
      name: `ExitTest scoped ${stamp}`,
      date: '2026-02-04', // Wed
      locationId,
      isRecurring: false,
    });
    holidayIds.push(dataOf(scopedHoliday).id);

    const scopedLeave = await req('POST', '/leave-requests', {
      workerId: scopedWorkerId,
      leaveTypeId: annual.id,
      startDate: '2026-02-02',
      endDate: '2026-02-06',
      submit: true,
    });
    requests.push(dataOf(scopedLeave).id);
    check(
      dataOf(scopedLeave).days === 4,
      'H3 location holiday applies to its workers (5 → 4)',
      `days=${dataOf(scopedLeave).days}`,
    );

    const plainLeave = await req('POST', '/leave-requests', {
      workerId: plainWorkerId,
      leaveTypeId: annual.id,
      startDate: '2026-02-02',
      endDate: '2026-02-06',
      submit: true,
    });
    requests.push(dataOf(plainLeave).id);
    check(
      dataOf(plainLeave).days === 5,
      'H3 location holiday does NOT affect other locations (still 5)',
      `status=${plainLeave.status} days=${dataOf(plainLeave).days} ${JSON.stringify(plainLeave.json).slice(0, 200)}`,
    );

    // H4: half-day boundaries subtract 0.5 (PRD LVE-03).
    const halfStart = await req('POST', '/leave-requests', {
      workerId: plainWorkerId,
      leaveTypeId: annual.id,
      startDate: '2026-03-02',
      endDate: '2026-03-06',
      startHalfDay: true,
      submit: true,
    });
    requests.push(dataOf(halfStart).id);
    check(
      dataOf(halfStart).days === 4.5,
      'H4 half-day start on a 5-day week → 4.5',
      `days=${dataOf(halfStart).days}`,
    );

    const halfBoth = await req('POST', '/leave-requests', {
      workerId: plainWorkerId,
      leaveTypeId: annual.id,
      startDate: '2026-03-09',
      endDate: '2026-03-13',
      startHalfDay: true,
      endHalfDay: true,
      submit: true,
    });
    requests.push(dataOf(halfBoth).id);
    check(
      dataOf(halfBoth).days === 4,
      'H4 half-day start + end → 4',
      `days=${dataOf(halfBoth).days}`,
    );

    // ── BALANCE MATHS (LVE-01 / LVE-02) ─────────────────────────────────────
    heading('BALANCE MATHS (LVE-01 / LVE-02)');

    const readAnnual = async (workerId) => {
      const res = await req('GET', `/leave-balances?workerId=${workerId}&year=2026`);
      const list = Array.isArray(dataOf(res)) ? dataOf(res) : res.json.data || [];
      return list.find((b) => b.leaveTypeId === annual.id) || {};
    };

    // B1: default entitlement materialises on read.
    const ent = await readAnnual(scopedWorkerId);
    check(
      Number(ent.accrued) === 20 && Number(ent.used) >= 0,
      'B1 default ANNUAL entitlement materialises on read (20)',
      JSON.stringify(ent),
    );

    // B2: only final approval moves the balance.
    const beforeUsed = Number((await readAnnual(scopedWorkerId)).used);
    const pending = await req('POST', '/leave-requests', {
      workerId: scopedWorkerId,
      leaveTypeId: annual.id,
      startDate: '2026-04-06',
      endDate: '2026-04-10',
      submit: true,
    });
    const pendingId = dataOf(pending).id;
    requests.push(pendingId);
    check(
      dataOf(pending).status === 'PENDING' || dataOf(pending).status === 'PENDING_APPROVAL',
      'B2 request is not yet approved',
      `status=${dataOf(pending).status}`,
    );
    const midUsed = Number((await readAnnual(scopedWorkerId)).used);
    check(
      midUsed === beforeUsed,
      'B2 balance unchanged while the request is pending',
      `before=${beforeUsed} after=${midUsed}`,
    );

    const approve = await req('POST', `/leave-requests/${pendingId}/decide`, {
      approve: true,
    });
    check(
      dataOf(approve).status === 'APPROVED',
      'B2 request approved',
      `status=${dataOf(approve).status} ${JSON.stringify(approve.json).slice(0, 160)}`,
    );
    const afterApprove = await readAnnual(scopedWorkerId);
    const expectedUsed = beforeUsed + dataOf(pending).days;
    check(
      Number(afterApprove.used) === expectedUsed,
      `B2 balance reduced by the approved days (used=${expectedUsed})`,
      JSON.stringify(afterApprove),
    );
    check(
      Number(afterApprove.balance) === Number(afterApprove.accrued) - expectedUsed,
      'B2 remaining = accrued − used',
      JSON.stringify(afterApprove),
    );

    // B3: cancellation restores the balance exactly.
    const cancel = await req('POST', `/leave-requests/${pendingId}/cancel`);
    check(
      dataOf(cancel).status === 'CANCELLED',
      'B3 approved request cancelled',
      `status=${dataOf(cancel).status}`,
    );
    const afterCancel = await readAnnual(scopedWorkerId);
    check(
      Number(afterCancel.used) === beforeUsed &&
        Number(afterCancel.balance) === Number(afterCancel.accrued) - beforeUsed,
      'B3 balance restored on cancel',
      JSON.stringify(afterCancel),
    );

    // B4: insufficient balance is rejected at submission time.
    const lowType = await req('POST', '/leave-types', {
      name: `EXITCAP-${stamp}`,
      category: 'STUDY',
      defaultBalance: 2,
      isPaid: true,
      requiresApproval: true,
      accrualMethod: 'NONE',
    });
    customTypeId = dataOf(lowType).id;
    const overspend = await req('POST', '/leave-requests', {
      workerId: plainWorkerId,
      leaveTypeId: customTypeId,
      startDate: '2026-05-04',
      endDate: '2026-05-08', // 5 working days > 2 entitled
      submit: true,
    });
    check(
      overspend.status === 409,
      'B4 over-request beyond entitlement rejected (409)',
      `status=${overspend.status} ${JSON.stringify(overspend.json).slice(0, 160)}`,
    );
  } finally {
    // ── Cleanup ───────────────────────────────────────────────────────────────
    try {
      const workerIds = [scopedWorkerId, plainWorkerId].filter(Boolean);
      if (requests.filter(Boolean).length) {
        const wf = await db.query(
          `SELECT id FROM approval_workflows WHERE "resourceId" = ANY($1)`,
          [requests.filter(Boolean)],
        );
        const wfIds = wf.rows.map((r) => r.id);
        if (wfIds.length) {
          await db.query(
            `DELETE FROM approval_steps WHERE "approvalWorkflowId" = ANY($1)`,
            [wfIds],
          );
        }
        await db.query(
          `DELETE FROM approval_workflows WHERE "resourceId" = ANY($1)`,
          [requests.filter(Boolean)],
        );
        await db.query(`DELETE FROM leave_requests WHERE id = ANY($1)`, [
          requests.filter(Boolean),
        ]);
      }
      if (workerIds.length) {
        await db.query(`DELETE FROM leave_balances WHERE "workerId" = ANY($1)`, [workerIds]);
        await db.query(`DELETE FROM workers WHERE id = ANY($1)`, [workerIds]);
      }
      if (holidayIds.length) {
        await db.query(`DELETE FROM holidays WHERE id = ANY($1)`, [holidayIds]);
      }
      if (locationId) {
        await db.query(`DELETE FROM locations WHERE id = $1`, [locationId]);
      }
      if (customTypeId) {
        await db.query(`DELETE FROM leave_types WHERE id = $1`, [customTypeId]);
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
