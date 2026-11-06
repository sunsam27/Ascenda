// Real PostgreSQL isolation test. Uses only synthetic rows in one transaction;
// ALWAYS rolls back, never touches files, never sends notifications.
// node --env-file=packages/db/.env apps/api/test/e2e/documents-rls.cjs
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const requireDb = createRequire(resolve(__dirname, '../../../../packages/db/package.json'));
const { Client } = requireDb('pg');
const assert = require('node:assert/strict');

async function main() {
  const url = process.env.DIRECT_URL;
  if (!url || !process.env.ASCENDA_APP_PASSWORD) throw new Error('DIRECT_URL and ASCENDA_APP_PASSWORD are required');
  const direct = url.replace(/([?&])sslmode=[^&]*/, '$1').replace(/[?&]$/, '');
  const appUrl = new URL(direct);
  appUrl.username = appUrl.username.includes('.') ? `ascenda_app.${appUrl.username.split('.')[1]}` : 'ascenda_app';
  appUrl.password = process.env.ASCENDA_APP_PASSWORD;
  const admin = new Client({ connectionString: direct, ssl: { rejectUnauthorized: false } });
  const client = new Client({ connectionString: appUrl.toString(), ssl: { rejectUnauthorized: false } });
  await admin.connect();
  try {
    const orgs = await admin.query('SELECT id FROM organisations ORDER BY id LIMIT 2');
    const users = await admin.query('SELECT id FROM users ORDER BY id LIMIT 1');
    if (orgs.rows.length < 2 || !users.rows.length) throw new Error('At least two organisations and one user are required');
    const [orgA, orgB] = orgs.rows.map((r) => r.id);
    const userId = users.rows[0].id;
    await client.connect();
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_org',$1,true)", [orgA]);
    const documentId = randomUUID(); const policyId = randomUUID();
    const announcementId = randomUUID(); const recipientId = randomUUID();
    await client.query(`INSERT INTO documents (id, "organisationId", type, name, "storageKey", "mimeType", "sizeBytes", "uploadedBy", "updatedAt")
      VALUES ($1,$2,'POLICY','RLS rollback fixture','not-a-real-file','text/plain',1,$3,now())`, [documentId, orgA, userId]);
    await client.query(`INSERT INTO policy_recipients (id,"organisationId","documentId","userId") VALUES ($1,$2,$3,$4)`, [policyId, orgA, documentId, userId]);
    await client.query(`INSERT INTO announcements (id,"organisationId",title,body,audience,"createdBy") VALUES ($1,$2,'RLS rollback fixture','synthetic','{}'::jsonb,$3)`, [announcementId, orgA, userId]);
    await client.query(`INSERT INTO announcement_recipients (id,"organisationId","announcementId","userId") VALUES ($1,$2,$3,$4)`, [recipientId, orgA, announcementId, userId]);
    const role = await client.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user');
    assert.equal(role.rows[0].rolsuper, false); assert.equal(role.rows[0].rolbypassrls, false);
    const fixtures = [['documents', documentId], ['policy_recipients', policyId], ['announcements', announcementId], ['announcement_recipients', recipientId]];
    for (const [table, id] of fixtures) {
      await client.query("SELECT set_config('app.current_org',$1,true)", [orgA]);
      assert.equal((await client.query(`SELECT id FROM ${table} WHERE id=$1`, [id])).rowCount, 1, `${table}: own tenant read`);
      await client.query("SELECT set_config('app.current_org',$1,true)", [orgB]);
      assert.equal((await client.query(`SELECT id FROM ${table} WHERE id=$1`, [id])).rowCount, 0, `${table}: other tenant hidden`);
      assert.equal((await client.query(`UPDATE ${table} SET id=id WHERE id=$1`, [id])).rowCount, 0, `${table}: other tenant cannot update`);
      await client.query("SELECT set_config('app.current_org','',true)");
      assert.equal((await client.query(`SELECT id FROM ${table} WHERE id=$1`, [id])).rowCount, 0, `${table}: missing context hidden`);
    }
    console.log('PASS: real ascenda_app RLS on documents, policies, announcements and recipients; own read/cross-tenant read+update/missing context. All fixtures rolled back.');
  } finally { await client.query('ROLLBACK').catch(() => undefined); await client.end(); await admin.end(); }
}
main().catch((error) => { console.error(`Documents RLS test failed: ${error.message}`); process.exitCode = 1; });
