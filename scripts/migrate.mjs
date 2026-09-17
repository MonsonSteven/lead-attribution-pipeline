// Apply db/schema.sql to the Neon database. Idempotent — safe to re-run.
// Uses node-postgres (a session connection suits multi-statement DDL); the app uses the Neon HTTP driver.
//   Usage: DATABASE_URL=... npm run migrate

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Load .env (Node doesn't do this automatically for plain scripts, unlike Next for the app).
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env present — fall back to ambient environment */
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✖ DATABASE_URL is not set — see .env.example');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, '..', 'db', 'schema.sql'), 'utf8');

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  await client.query(schema); // simple-query protocol runs the whole file (no params)
  console.log('✅ schema applied');
} catch (err) {
  console.error('✖ migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
