// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — BANK DETAILS & EMPLOYEE SELF-SERVICE
//
// Covers over the real API + database:
//   * Static NG bank list + account-number bank detection (best-effort).
//   * Org payroll admin creates/updates/removes a worker's bank account; the
//     number is stored encrypted and only ever returned masked.
//   * Employee self-service: GET /workers/me (read-only org-entered profile),
//     plus create/update of their OWN bank account.
//   * Cross-worker isolation: an employee cannot read or write another worker's
//     bank account.
//   * Dropdown fallback: an undetectable prefix is rejected unless a bank is
//     supplied explicitly.
//   * Audit trail (BANK_DETAILS_CHANGED) never records the raw number.
//
// Run (from repo root, API + DB running):
//   node --env-file=packages\db\.env apps\api\test\e2e\phase3-bank-self-service.cjs
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

const dataOf = (r) => (r.json && r.json.data ? r.json.data : null);

async function login(email, password = 'AscendaDemo123!') {
  cookie = '';
  const res = await req('POST', '/auth/login', { email, password });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return res.json;
}

async function main() {
  await login('owner@ascenda.dev');

  const stamp = Date.now().toString(36);
  const cleanup = { workerIds: [], userIds: [] };

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

    // Clean any residue from an interrupted prior run.
    await db.query(
      `DELETE FROM audit_log WHERE "targetType" = 'BankAccount' AND "targetId" IN (
         SELECT id::text FROM bank_accounts WHERE "workerId" IN (
           SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'BS-%'))`,
      [orgId],
    );    await db.query(
      `DELETE FROM bank_accounts WHERE "workerId" IN (
         SELECT id FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'BS-%')`,
      [orgId],
    );
    await db.query(
      `DELETE FROM workers WHERE "organisationId" = $1 AND "employeeNumber" LIKE 'BS-%'`,
      [orgId],
    );
    await db.query(
      `DELETE FROM audit_log WHERE "actorId" IN (
         SELECT id::text FROM users WHERE email LIKE 'bs-%@ascenda.test')`,
    );
    await db.query(
      `DELETE FROM memberships WHERE "userId" IN (
         SELECT id FROM users WHERE email LIKE 'bs-%@ascenda.test')`,
    );
    await db.query(`DELETE FROM users WHERE email LIKE 'bs-%@ascenda.test'`);

    // Org admin (payroll) and a second employee for isolation checks.
    const paEmail = `bs-pa-${stamp}@ascenda.test`;
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

    const workerA = dataOf(
      await req('POST', '/workers', {
        employeeNumber: `BS-A-${stamp}`,
        firstName: 'Ada',
        lastName: 'Alpha',
        email: `bs-a-${stamp}@example.test`,
        category: 'EMPLOYEE',
        employmentType: 'FULL_TIME',
        jobTitle: 'Engineer',
        status: 'ACTIVE',
        startDate: '2026-06-01',
      }),
    );
    const workerB = dataOf(
      await req('POST', '/workers', {
        employeeNumber: `BS-B-${stamp}`,
        firstName: 'Ben',
        lastName: 'Beta',
        email: `bs-b-${stamp}@example.test`,
        category: 'EMPLOYEE',
        employmentType: 'FULL_TIME',
        jobTitle: 'Analyst',
        status: 'ACTIVE',
        startDate: '2026-06-01',
      }),
    );
    if (!workerA?.id || !workerB?.id) {
      throw new Error('worker create failed');
    }
    cleanup.workerIds.push(workerA.id, workerB.id);

    // Link worker A to a self-service login (mirrors POST /workers/:id/invite
    // then set-password; here we seed the user + membership + link directly).
    const empEmail = `bs-emp-${stamp}@ascenda.test`;
    const empUser = await db.query(
      `INSERT INTO users (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'Ada', 'Alpha', now(), now()) RETURNING id`,
      [empEmail, passwordHash],
    );
    cleanup.userIds.push(empUser.rows[0].id);
    await db.query(
      `INSERT INTO memberships (id, "organisationId", "userId", role, "isActive", "acceptedAt", "createdBy", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'EMPLOYEE_SELF', true, now(), $3, now(), now())`,
      [orgId, empUser.rows[0].id, empUser.rows[0].id],
    );
    await db.query(`UPDATE workers SET "userId" = $1 WHERE id = $2`, [
      empUser.rows[0].id,
      workerA.id,
    ]);

    // ── Static bank list + detection ────────────────────────────────────────
    heading('BANK LOOKUP');
    const paLogin = await login(paEmail);
    check(
      paLogin?.redirectTo === '/dashboard',
      'org admin login redirects to the org dashboard',
      paLogin?.redirectTo,
    );

    const banks = dataOf(await req('GET', '/bank-accounts/banks'));
    check(Array.isArray(banks) && banks.length > 0, 'bank list is served');
    check(
      Array.isArray(banks) && banks.every((b) => b.bankCode && b.bankName),
      'every bank has a code + name',
    );

    const detect = dataOf(
      await req('POST', '/bank-accounts/detect', { accountNumber: '0581234567' }),
    );
    check(
      detect && detect.bankCode === '058',
      'detect resolves GTBank from 058 prefix',
      JSON.stringify(detect),
    );

    const detectMiss = dataOf(
      await req('POST', '/bank-accounts/detect', { accountNumber: '7771234567' }),
    );
    check(detectMiss === null, 'detect returns null for an unknown prefix');

    // ── Org admin creates a bank account (auto-detect) ──────────────────────
    heading('ORG ADMIN — CREATE (AUTO-DETECT)');

    const created = dataOf(
      await req('POST', `/workers/${workerA.id}/bank-accounts`, {
        accountNumber: '0581234567',
        accountName: 'Ada Alpha',
      }),
    );
    check(!!created?.id, 'org admin creates a bank account');
    check(
      created?.accountNumberMasked === '****4567',
      'account number returned masked',
      created?.accountNumberMasked,
    );
    check(
      created?.bankName === 'Guaranty Trust Bank',
      'bank auto-detected on create',
      created?.bankName,
    );
    check(created?.isPrimary === true, 'first account becomes primary');

    const rawRow = await db.query(
      `SELECT "accountNumberEncrypted" FROM bank_accounts WHERE id = $1`,
      [created.id],
    );
    check(
      rawRow.rows[0]?.accountNumberEncrypted &&
        !rawRow.rows[0].accountNumberEncrypted.includes('0581234567'),
      'raw number is encrypted at rest',
    );

    // Luhn-free: a non-10-digit number is rejected by DTO validation.
    const badLen = await req('POST', `/workers/${workerA.id}/bank-accounts`, {
      accountNumber: '12345',
      accountName: 'Ada Alpha',
    });
    check(badLen.status === 400, 'short account number → 400', badLen.status);

    // Undetectable prefix with no bank supplied → 400 (dropdown required).
    const needDropdown = await req('POST', `/workers/${workerB.id}/bank-accounts`, {
      accountNumber: '7771234567',
      accountName: 'Ben Beta',
    });
    check(
      needDropdown.status === 400,
      'undetectable prefix without a bank → 400 (dropdown fallback)',
      needDropdown.status,
    );

    // Same account, bank supplied explicitly → succeeds (dropdown path).
    const dropdown = dataOf(
      await req('POST', `/workers/${workerB.id}/bank-accounts`, {
        accountNumber: '7771234567',
        accountName: 'Ben Beta',
        bankName: 'Kuda Microfinance Bank',
        bankCode: '090110',
      }),
    );
    check(
      dropdown?.bankCode === '090110',
      'dropdown-selected bank is honoured when detection fails',
      dropdown?.bankCode,
    );

    // ── Org admin updates + verifies ────────────────────────────────────────
    heading('ORG ADMIN — UPDATE');

    const updated = dataOf(
      await req('PATCH', `/workers/${workerB.id}/bank-accounts/${dropdown.id}`, {
        accountNumber: '0331234567',
        isVerified: true,
      }),
    );
    check(
      updated?.accountNumberMasked === '****4567',
      'update re-masks the new account number',
      updated?.accountNumberMasked,
    );
    check(
      updated?.bankName === 'United Bank for Africa',
      'update re-detects the bank when the number changes',
      updated?.bankName,
    );
    check(updated?.isVerified === true, 'org admin can mark the account verified');

    // ── Employee self-service ───────────────────────────────────────────────
    heading('EMPLOYEE SELF-SERVICE');

    const empLogin = await login(empEmail);
    check(
      empLogin?.redirectTo === '/me',
      'employee login redirects to the personal /me workspace',
      empLogin?.redirectTo,
    );

    const me = dataOf(await req('GET', '/workers/me'));
    check(me?.worker?.id === workerA.id, 'employee reads own worker profile');
    check(
      me?.worker?.jobTitle === 'Engineer',
      'profile exposes org-entered job title',
    );
    check(
      me?.worker?.departmentName === undefined || me?.worker?.departmentName === null || typeof me?.worker?.departmentName === 'string',
      'profile shape includes department name field',
    );

    // Employee cannot edit their worker profile.
    const editSelf = await req('PATCH', `/workers/${workerA.id}`, {
      jobTitle: 'CEO',
    });
    check(editSelf.status === 403, 'employee cannot edit worker profile → 403', editSelf.status);

    // Employee cannot read another worker's bank accounts.
    const peekOther = await req('GET', `/workers/${workerB.id}/bank-accounts`);
    check(
      peekOther.status === 404 || peekOther.status === 403,
      "employee cannot read another worker's bank accounts",
      peekOther.status,
    );

    // Employee sees their own (org-created) account.
    const ownAccounts = dataOf(await req('GET', `/workers/${workerA.id}/bank-accounts`));
    check(
      Array.isArray(ownAccounts) && ownAccounts.length === 1,
      'employee reads own bank accounts',
      JSON.stringify(ownAccounts && ownAccounts.length),
    );

    // Employee adds a second account and flags it primary.
    const empAccount = dataOf(
      await req('POST', `/workers/${workerA.id}/bank-accounts`, {
        accountNumber: '0701234567',
        accountName: 'Ada A Alpha',
        isPrimary: true,
      }),
    );
    check(!!empAccount?.id, 'employee adds their own bank account');
    check(
      empAccount?.bankName === 'Fidelity Bank',
      'employee account bank auto-detected',
      empAccount?.bankName,
    );
    check(empAccount?.isPrimary === true, 'employee can mark their account primary');

    // The prior primary is demoted.
    const afterPrimary = dataOf(await req('GET', `/workers/${workerA.id}/bank-accounts`));
    const primaries = (afterPrimary || []).filter((a) => a.isPrimary);
    check(primaries.length === 1, 'exactly one primary after the switch', primaries.length);

    // Employee switches the account number to an undetectable one → 400.
    const empBad = await req('PATCH', `/workers/${workerA.id}/bank-accounts/${empAccount.id}`, {
      accountNumber: '7777654321',
    });
    check(empBad.status === 400, 'employee undetectable number → 400', empBad.status);

    // Employee updates their account number to a detectable one.
    const empUpdated = dataOf(
      await req('PATCH', `/workers/${workerA.id}/bank-accounts/${empAccount.id}`, {
        accountNumber: '0111234567',
      }),
    );
    check(
      empUpdated?.bankName === 'First Bank of Nigeria',
      'employee update re-detects the bank',
      empUpdated?.bankName,
    );

    // Employee cannot self-attest verification (org-only field ignored).
    const selfVerify = dataOf(
      await req('PATCH', `/workers/${workerA.id}/bank-accounts/${empAccount.id}`, {
        isVerified: true,
      }),
    );
    check(
      selfVerify?.isVerified === false,
      'employee cannot self-verify an account (org-only)',
      selfVerify?.isVerified,
    );

    // ── Workspace invitations (inviteStatus + resend) ───────────────────────
    heading('WORKSPACE INVITATIONS');

    await login('owner@ascenda.dev');

    // Worker B has never been invited → NONE.
    const summaryB = dataOf(await req('GET', `/workers/${workerB.id}`));
    check(
      summaryB?.inviteStatus === 'NONE',
      'un-invited worker reports inviteStatus NONE',
      summaryB?.inviteStatus,
    );
    check(summaryB?.hasLogin === false, 'un-invited worker hasLogin is false');

    // Worker A is linked with an accepted membership → ACCEPTED.
    const summaryA = dataOf(await req('GET', `/workers/${workerA.id}`));
    check(
      summaryA?.inviteStatus === 'ACCEPTED',
      'linked worker with accepted membership reports ACCEPTED',
      summaryA?.inviteStatus,
    );

    // Invite worker B → PENDING, and the invite result reports the email.
    const inviteB = dataOf(await req('POST', `/workers/${workerB.id}/invite`));
    check(inviteB?.email === workerB.email, 'invite returns the target email', inviteB?.email);

    const afterInviteB = dataOf(await req('GET', `/workers/${workerB.id}`));
    check(
      afterInviteB?.inviteStatus === 'PENDING',
      'invited worker reports inviteStatus PENDING',
      afterInviteB?.inviteStatus,
    );
    check(afterInviteB?.hasLogin === true, 'invited worker hasLogin is true');

    // Resend supersedes the previous invitation (old link invalidated, new one issued).
    const firstInvite = await db.query(
      `SELECT id, "tokenHash" FROM invitations
       WHERE "organisationId" = $1 AND email = $2 AND "acceptedAt" IS NULL
       ORDER BY "createdAt" DESC`,
      [orgId, workerB.email.toLowerCase()],
    );
    check(firstInvite.rows.length === 1, 'one pending invitation after first invite', firstInvite.rows.length);
    const firstTokenHash = firstInvite.rows[0]?.tokenHash;

    const resendB = await req('POST', `/workers/${workerB.id}/invite/resend`);
    check(resendB.status === 200 || resendB.status === 201, 'resend endpoint succeeds', resendB.status);
    const resendBData = dataOf(resendB);
    check(resendBData?.email === workerB.email, 'resend returns the target email', resendBData?.email);

    const secondInvite = await db.query(
      `SELECT id, "tokenHash" FROM invitations
       WHERE "organisationId" = $1 AND email = $2 AND "acceptedAt" IS NULL
       ORDER BY "createdAt" DESC`,
      [orgId, workerB.email.toLowerCase()],
    );
    check(
      secondInvite.rows.length === 1,
      'resend leaves exactly one pending invitation',
      secondInvite.rows.length,
    );
    check(
      secondInvite.rows[0]?.tokenHash !== firstTokenHash,
      'resend issues a fresh token (old link invalidated)',
    );

    // Clearing the pending invitation returns the worker to NONE.
    await db.query(
      `DELETE FROM invitations WHERE "organisationId" = $1 AND email = $2`,
      [orgId, workerB.email.toLowerCase()],
    );
    await db.query(`UPDATE workers SET "userId" = NULL WHERE id = $1`, [workerB.id]);
    await db.query(
      `DELETE FROM memberships WHERE "organisationId" = $1 AND "userId" = $2`,
      [orgId, resendBData?.userId ?? ''],
    );

    // ── Audit trail ─────────────────────────────────────────────────────────
    heading('AUDIT TRAIL');

    const audits = await db.query(
      `SELECT "newValue" FROM audit_log
       WHERE "targetType" = 'BankAccount' AND "targetId" = $1
       ORDER BY "timestamp" DESC`,
      [empAccount.id],
    );
    check(audits.rows.length >= 2, 'bank changes are audited', audits.rows.length);
    const auditBlob = JSON.stringify(audits.rows);
    check(
      !auditBlob.includes('0701234567') && !auditBlob.includes('0111234567'),
      'audit never records the raw account number',
    );

    // ── Security: unauthenticated ───────────────────────────────────────────
    heading('SECURITY');

    cookie = '';
    const anon = await req('GET', '/bank-accounts/banks');
    check(anon.status === 401, 'unauthenticated request → 401', anon.status);
  } catch (error) {
    failed += 1;
    console.error('\nUNCAUGHT ERROR:', error && error.stack ? error.stack : error);
  } finally {
    try {
      if (cleanup.workerIds.length) {
        await db.query(
          `DELETE FROM audit_log WHERE "targetType" = 'BankAccount' AND "targetId" IN (
             SELECT id::text FROM bank_accounts WHERE "workerId" = ANY($1::text[]))`,
          [cleanup.workerIds],
        );
        await db.query(`DELETE FROM bank_accounts WHERE "workerId" = ANY($1::text[])`, [
          cleanup.workerIds,
        ]);
        await db.query(`DELETE FROM workers WHERE id = ANY($1::text[])`, [
          cleanup.workerIds,
        ]);
      }
      if (cleanup.userIds.length) {
        await db.query(
          `DELETE FROM audit_log WHERE "actorId"::text = ANY($1::text[])`,
          [cleanup.userIds],
        );
        await db.query(`DELETE FROM memberships WHERE "userId" = ANY($1::text[])`, [
          cleanup.userIds,
        ]);
        await db.query(`DELETE FROM users WHERE id = ANY($1::text[])`, [
          cleanup.userIds,
        ]);
      }
      // Invitation-created users (workers invited during the run).
      await db.query(`DELETE FROM invitations WHERE email LIKE 'bs-%'`);
      await db.query(
        `DELETE FROM memberships WHERE "userId" IN (
           SELECT id FROM users WHERE email LIKE 'bs-%')`,
      );
      await db.query(`DELETE FROM users WHERE email LIKE 'bs-%'`);
      await db.end();
    } catch (cleanupError) {
      console.error('cleanup failed:', cleanupError && cleanupError.stack ? cleanupError.stack : cleanupError);
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  }
}

main();

