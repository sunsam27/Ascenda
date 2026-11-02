// PHASE 4 TEST - Onboarding and offboarding lifecycle
//
// Covers:
//   * ONB-01 onboarding checklist: every new worker gets the default tasks,
//     progress tracks required work, completed/waived both resolve a task.
//   * ONB-02 auto-create for CSV imports as well as direct worker creation.
//   * ONB-03 offboarding: start a case, block a second case, block completion
//     with outstanding tasks, completing tasks/cancel, and exit status sync.
//
// Run (from repo root, API + DB running):
//   node --env-file=packages\db\.env apps\api\test\e2e\phase4-onboarding-offboarding.cjs
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
    console.log(`  FAIL  ${msg}${detail ? ` - ${detail}` : ''}`);
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
const dateOnly = (value) => (value ? String(value).slice(0, 10) : '');

async function createWorker(stamp, suffix, overrides = {}) {
  const res = await req('POST', '/workers', {
    employeeNumber: `ONB-${suffix}-${stamp}`,
    firstName: 'Life',
    lastName: `Cycle${suffix}`,
    email: `life-${suffix.toLowerCase()}-${stamp}@example.test`,
    category: 'EMPLOYEE',
    employmentType: 'FULL_TIME',
    jobTitle: 'QA',
    startDate: '2026-01-05',
    ...overrides,
  });
  const worker = dataOf(res);
  if (!worker.id) {
    throw new Error(`worker create failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return worker;
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
  const workerIds = [];
  const checklistIds = [];
  const offboardingIds = [];
  const auditIds = [];

  const db = new Client({
    connectionString: (process.env.DIRECT_URL || '').replace(
      /([?&])sslmode=[^&]*/,
      '$1',
    ),
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  try {
    // ---- ONB-01 / ONB-02: direct create gives the default checklist --------
    heading('ONBOARDING - DIRECT CREATE (ONB-01)');

    const workerA = await createWorker(stamp, 'A');
    workerIds.push(workerA.id);

    let onboardingRes = await req('GET', `/talent/onboarding/${workerA.id}`);
    let onboarding = dataOf(onboardingRes);
    checklistIds.push(onboarding.id);
    auditIds.push(onboarding.id, workerA.id);

    check(
      onboardingRes.status === 200 && !!onboarding.id,
      'GET /talent/onboarding/:workerId returns the auto-created checklist',
      `status=${onboardingRes.status} ${JSON.stringify(onboardingRes.json).slice(0, 200)}`,
    );
    check(
      Array.isArray(onboarding.tasks) && onboarding.tasks.length === 9,
      'default checklist has 9 tasks',
      `tasks=${onboarding.tasks && onboarding.tasks.length}`,
    );
    check(
      onboarding.status === 'IN_PROGRESS' && onboarding.progressPct === 0,
      'checklist starts IN_PROGRESS at 0%',
      `status=${onboarding.status} pct=${onboarding.progressPct}`,
    );
    check(
      onboarding.totalTasks === 9 &&
        onboarding.outstandingTasks === 9 &&
        onboarding.resolvedTasks === 0,
      'summary counts 9 required / 9 outstanding',
      JSON.stringify({
        total: onboarding.totalTasks,
        outstanding: onboarding.outstandingTasks,
        resolved: onboarding.resolvedTasks,
      }),
    );

    const firstTask = onboarding.tasks[0];
    const completeFirst = await req('PATCH', `/talent/onboarding/tasks/${firstTask.id}`, {
      status: 'COMPLETED',
    });
    onboarding = dataOf(completeFirst);
    auditIds.push(onboarding.id);

    check(
      completeFirst.status === 200 &&
        onboarding.progressPct === 11 &&
        onboarding.resolvedTasks === 1 &&
        onboarding.outstandingTasks === 8,
      'completing 1 of 9 tasks reports 11% progress',
      `status=${completeFirst.status} pct=${onboarding.progressPct}`,
    );

    const secondTask = onboarding.tasks.find((t) => t.id !== firstTask.id);
    const waiveSecond = await req('PATCH', `/talent/onboarding/tasks/${secondTask.id}`, {
      status: 'WAIVED',
    });
    onboarding = dataOf(waiveSecond);
    auditIds.push(onboarding.id);

    check(
      waiveSecond.status === 200 &&
        onboarding.progressPct === 22 &&
        onboarding.resolvedTasks === 2 &&
        onboarding.outstandingTasks === 7,
      'waiving a task also counts towards progress (22%)',
      `status=${waiveSecond.status} pct=${onboarding.progressPct}`,
    );

    const reopen = await req('PATCH', `/talent/onboarding/tasks/${firstTask.id}`, {
      status: 'PENDING',
    });
    onboarding = dataOf(reopen);
    auditIds.push(onboarding.id);

    check(
      reopen.status === 200 &&
        onboarding.progressPct === 11 &&
        onboarding.outstandingTasks === 8 &&
        !onboarding.tasks.find((t) => t.id === firstTask.id).completedAt,
      'reopening a task clears completedAt and drops progress',
      `status=${reopen.status} pct=${onboarding.progressPct}`,
    );

    for (const task of onboarding.tasks) {
      const res = await req('PATCH', `/talent/onboarding/tasks/${task.id}`, {
        status: 'COMPLETED',
      });
      if (res.status !== 200) {
        throw new Error(`final task update failed: ${res.status}`);
      }
      onboarding = dataOf(res);
    }
    auditIds.push(onboarding.id);

    check(
      onboarding.status === 'COMPLETED' &&
        onboarding.progressPct === 100 &&
        onboarding.outstandingTasks === 0 &&
        !!onboarding.completedAt,
      'completing every task marks the checklist COMPLETED at 100%',
      `status=${onboarding.status} pct=${onboarding.progressPct}`,
    );

    // ---- ONB-02: CSV import backfills onboarding ------------- -------------
    heading('ONBOARDING - CSV IMPORT (ONB-02)');

    const csvEmployee = `ONB-CSV-${stamp}`;
    const csv = [
      'employeeNumber,firstName,lastName,email,jobTitle,startDate',
      `${csvEmployee},Imported,Worker,imported-${stamp}@example.test,Analyst,2026-02-02`,
    ].join('\n');
    const imported = await req('POST', '/workers/import', { csv });
    const importResult = dataOf(imported);

    check(
      imported.status === 201 && importResult.created === 1,
      'CSV import creates the worker',
      `status=${imported.status} ${JSON.stringify(imported.json).slice(0, 200)}`,
    );

    const search = await req('GET', `/workers?search=${encodeURIComponent(csvEmployee)}`);
    const importedWorker = (dataOf(search) || [])[0];
    if (importedWorker) {
      workerIds.push(importedWorker.id);
      auditIds.push(importedWorker.id);
    }
    check(!!importedWorker, 'imported worker is discoverable through the API');

    const importedOnboardingRes = importedWorker
      ? await req('GET', `/talent/onboarding/${importedWorker.id}`)
      : { status: 0, json: {} };
    const importedOnboarding = dataOf(importedOnboardingRes);
    if (importedOnboarding.id) {
      checklistIds.push(importedOnboarding.id);
      auditIds.push(importedOnboarding.id);
    }

    check(
      importedOnboardingRes.status === 200 &&
        importedOnboarding.tasks &&
        importedOnboarding.tasks.length === 9,
      'imported worker receives the same 9-task onboarding checklist',
      `status=${importedOnboardingRes.status} tasks=${importedOnboarding.tasks && importedOnboarding.tasks.length}`,
    );

    // ---- OFFBOARDING: start, guardrails, complete, status sync ------------
    heading('OFFBOARDING (ONB-03)');

    const tooEarly = await req('POST', '/talent/offboarding', {
      workerId: workerA.id,
      exitReason: 'RESIGNATION',
      lastWorkingDate: '2025-12-31',
    });
    check(
      tooEarly.status === 400,
      'last working date before the start date is rejected (400)',
      `status=${tooEarly.status} ${JSON.stringify(tooEarly.json).slice(0, 200)}`,
    );

    const offboardingRes = await req('POST', '/talent/offboarding', {
      workerId: workerA.id,
      exitReason: 'RESIGNATION',
      reasonDetail: 'Relocating',
      lastWorkingDate: '2026-12-31',
      noticeDate: '2026-12-01',
    });
    let offboarding = dataOf(offboardingRes);
    offboardingIds.push(offboarding.id);
    auditIds.push(offboarding.id, workerA.id);

    check(
      offboardingRes.status === 201 &&
        offboarding.status === 'IN_PROGRESS' &&
        offboarding.tasks.length === 5,
      'starting offboarding creates an in-progress case with 5 tasks',
      `status=${offboardingRes.status} case=${offboarding.status} tasks=${offboarding.tasks && offboarding.tasks.length}`,
    );
    check(
      offboarding.workerId === workerA.id &&
        offboarding.exitReason === 'RESIGNATION' &&
        dateOnly(offboarding.lastWorkingDate) === '2026-12-31',
      'case stores worker, exit reason and last working date',
      JSON.stringify({
        workerId: offboarding.workerId,
        reason: offboarding.exitReason,
        lastDay: offboarding.lastWorkingDate,
      }),
    );

    const duplicate = await req('POST', '/talent/offboarding', {
      workerId: workerA.id,
      exitReason: 'DISMISSAL',
      lastWorkingDate: '2026-12-31',
    });
    check(
      duplicate.status === 409,
      'a second in-progress case for the same worker is rejected (409)',
      `status=${duplicate.status} ${JSON.stringify(duplicate.json).slice(0, 200)}`,
    );

    const earlyComplete = await req('POST', `/talent/offboarding/${offboarding.id}/complete`);
    check(
      earlyComplete.status === 400 &&
        JSON.stringify(earlyComplete.json).includes('Final pay'),
      'completion with outstanding tasks is rejected and lists them',
      `status=${earlyComplete.status} ${JSON.stringify(earlyComplete.json).slice(0, 240)}`,
    );

    for (const task of offboarding.tasks) {
      const res = await req('PATCH', `/talent/offboarding/tasks/${task.id}`, {
        status: 'COMPLETED',
      });
      if (res.status !== 200) {
        throw new Error(`offboarding task update failed: ${res.status} ${JSON.stringify(res.json)}`);
      }
      offboarding = dataOf(res);
    }
    auditIds.push(offboarding.id);

    check(
      offboarding.progressPct === 100 && offboarding.outstandingTasks === 0,
      'completing every offboarding task reports 100%',
      `pct=${offboarding.progressPct} outstanding=${offboarding.outstandingTasks}`,
    );

    const completeRes = await req('POST', `/talent/offboarding/${offboarding.id}/complete`);
    const completed = dataOf(completeRes);
    auditIds.push(completed.id, workerA.id);

    check(
      completeRes.status === 201 && completed.status === 'COMPLETED',
      'completing the case marks it COMPLETED',
      `status=${completeRes.status} case=${completed.status}`,
    );

    const workerAfter = await req('GET', `/workers/${workerA.id}`);
    const workerAfterData = dataOf(workerAfter);
    check(
      workerAfterData.status === 'RESIGNED',
      'resignation moves the worker to RESIGNED',
      `status=${workerAfterData.status}`,
    );
    check(
      dateOnly(workerAfterData.endDate) === '2026-12-31',
      'worker endDate is set to the last working date (feeds final pay)',
      `endDate=${workerAfterData.endDate}`,
    );

    const afterComplete = await req(
      'PATCH',
      `/talent/offboarding/tasks/${offboarding.tasks[0].id}`,
      { status: 'PENDING' },
    );
    check(
      afterComplete.status === 400,
      'tasks on a completed case cannot be changed (400)',
      `status=${afterComplete.status} ${JSON.stringify(afterComplete.json).slice(0, 200)}`,
    );

    // ---- OFFBOARDING: dismissal mapping and cancellation ------------------
    heading('OFFBOARDING - DISMISSAL AND CANCEL');

    const workerB = await createWorker(stamp, 'B');
    workerIds.push(workerB.id);
    auditIds.push(workerB.id);
    const workerBOnboarding = dataOf(await req('GET', `/talent/onboarding/${workerB.id}`));
    if (workerBOnboarding.id) {
      checklistIds.push(workerBOnboarding.id);
      auditIds.push(workerBOnboarding.id);
    }

    const dismissRes = await req('POST', '/talent/offboarding', {
      workerId: workerB.id,
      exitReason: 'DISMISSAL',
      lastWorkingDate: '2026-11-30',
    });
    let dismissal = dataOf(dismissRes);
    offboardingIds.push(dismissal.id);
    auditIds.push(dismissal.id, workerB.id);

    for (const task of dismissal.tasks) {
      const res = await req('PATCH', `/talent/offboarding/tasks/${task.id}`, {
        status: 'COMPLETED',
      });
      if (res.status === 200) dismissal = dataOf(res);
    }
    const dismissed = await req('POST', `/talent/offboarding/${dismissal.id}/complete`);
    auditIds.push(dismissal.id, workerB.id);
    const workerBAfter = await req('GET', `/workers/${workerB.id}`);

    check(
      dismissed.status === 201 && dataOf(workerBAfter).status === 'TERMINATED',
      'non-resignation reasons move the worker to TERMINATED',
      `complete=${dismissed.status} status=${dataOf(workerBAfter).status}`,
    );

    const workerC = await createWorker(stamp, 'C');
    const workerCBefore = await req('GET', `/workers/${workerC.id}`);
    workerIds.push(workerC.id);
    auditIds.push(workerC.id);
    const workerCOnboarding = dataOf(await req('GET', `/talent/onboarding/${workerC.id}`));
    if (workerCOnboarding.id) {
      checklistIds.push(workerCOnboarding.id);
      auditIds.push(workerCOnboarding.id);
    }

    const cancelStart = await req('POST', '/talent/offboarding', {
      workerId: workerC.id,
      exitReason: 'OTHER',
      lastWorkingDate: '2026-10-30',
    });
    const cancelCase = dataOf(cancelStart);
    offboardingIds.push(cancelCase.id);
    auditIds.push(cancelCase.id, workerC.id);

    const cancelled = await req('POST', `/talent/offboarding/${cancelCase.id}/cancel`);
    const workerCAfter = await req('GET', `/workers/${workerC.id}`);
    auditIds.push(cancelCase.id, workerC.id);

    check(
      cancelled.status === 201 && dataOf(cancelled).status === 'CANCELLED',
      'an in-progress case can be cancelled',
      `status=${cancelled.status} case=${dataOf(cancelled).status}`,
    );
    check(
      dataOf(workerCAfter).status === dataOf(workerCBefore).status &&
        !dataOf(workerCAfter).endDate,
      'cancelling leaves the worker status and end date unchanged',
      `before=${dataOf(workerCBefore).status} after=${dataOf(workerCAfter).status} endDate=${dataOf(workerCAfter).endDate}`,
    );

    // ---- Listing and search ----------------------------------------------
    heading('LISTING');

    const listOnboarding = await req('GET', `/talent/onboarding?search=${encodeURIComponent('Life')}`);
    const onboardingRows = dataOf(listOnboarding) || [];
    check(
      listOnboarding.status === 200 &&
        Array.isArray(onboardingRows) &&
        onboardingRows.some((row) => row.workerId === workerA.id),
      'onboarding list supports worker search and returns summaries',
      `status=${listOnboarding.status}`,
    );

    const listOffboarding = await req('GET', '/talent/offboarding?status=COMPLETED');
    const offboardingRows = dataOf(listOffboarding) || [];
    check(
      listOffboarding.status === 200 &&
        offboardingRows.some((row) => row.id === offboarding.id),
      'offboarding list filters by status and includes the completed case',
      `status=${listOffboarding.status} rows=${offboardingRows.length}`,
    );
  } finally {
    try {
      const ids = [...new Set(auditIds.filter(Boolean))];
      if (workerIds.length) {
        await db.query('DELETE FROM workers WHERE id = ANY($1)', [workerIds]);
      }
      if (ids.length) {
        await db.query('DELETE FROM audit_log WHERE "targetId" = ANY($1)', [ids]);
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
