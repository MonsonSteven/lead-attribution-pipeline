// Database access for the APP (Vercel serverless functions).
//
// Neon HTTP driver — no connection pooling to manage, ideal for serverless. Node scripts
// (migrate/seed) use node-postgres instead (a long-lived session suits DDL/bulk work).
//
// Raw SQL, no ORM — auditable (IT security review), dependency-light (the project thesis), and it lets
// the queue use explicit `... FOR UPDATE SKIP LOCKED` without an abstraction hiding it.
//
// Lazy init: importing this module never throws, so `next build` works without DATABASE_URL set. The
// error only surfaces on the first actual query at runtime.

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let _sql: NeonQueryFunction<false, false> | null = null;

/** Tagged-template SQL client: `getSql()\`SELECT * FROM raw_leads WHERE id = ${id}\`` (parameterized). */
export function getSql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set — see .env.example / DB-SETUP.md');
    _sql = neon(url);
  }
  return _sql;
}

// Note on the queue claim (processor drain): claim rows atomically in a SINGLE statement so no
// interactive transaction is needed over HTTP:
//   UPDATE raw_leads SET status='processing', processing_started_at=now(), attempts=attempts+1
//   WHERE id IN (
//     SELECT id FROM raw_leads
//     WHERE status IN ('received','failed') AND next_attempt_at <= now()
//     ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT ${batch}
//   ) RETURNING *;
