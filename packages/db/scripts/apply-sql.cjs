// Applies a .sql file over the privileged (DIRECT_URL) connection.
// The `__APP_PASSWORD__` token is replaced with ASCENDA_APP_PASSWORD.
//
//   pnpm --filter @ascenda/db db:rls
//
// Uses the `pg` simple-query protocol so multi-statement DDL runs in one call.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const sqlFile = process.argv[2];
  if (!sqlFile) {
    console.error('usage: node apply-sql.cjs <file.sql>');
    process.exit(1);
  }

  const password = process.env.ASCENDA_APP_PASSWORD;
  if (!password) {
    console.error('ASCENDA_APP_PASSWORD is not set');
    process.exit(1);
  }

  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DIRECT_URL / DATABASE_URL is not set');
    process.exit(1);
  }

  let sql = fs.readFileSync(path.resolve(sqlFile), 'utf8');
  sql = sql.split('__APP_PASSWORD__').join(password);

  const client = new Client({
    connectionString: connectionString.replace(/([?&])sslmode=[^&]*/, '$1').replace(/[?&]$/, ''),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    console.log(`✓ Applied ${sqlFile}`);
  } finally {
    await client.end();
  }
})().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
