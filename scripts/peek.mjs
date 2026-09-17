// Debug helper: print the most recent raw_leads rows (id, source, status, canonical, would_write).
//   Usage: npm run peek            (latest 5)
//          node scripts/peek.mjs 10

import pg from 'pg';

try {
  process.loadEnvFile('.env');
} catch {
  /* rely on ambient env */
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✖ DATABASE_URL is not set');
  process.exit(1);
}
const limit = Number(process.argv[2] ?? 5);

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  const { rows } = await client.query(
    `select id, source, source_message_id, status, attempts, shadow, crm_id,
            dead_letter_reason, canonical, would_write, received_at
     from raw_leads order by received_at desc limit $1`,
    [limit],
  );
  console.log(`\n${rows.length} most-recent raw_leads:\n`);
  for (const r of rows) {
    console.log('─'.repeat(72));
    console.log(`id            ${r.id}`);
    console.log(`source        ${r.source}   status=${r.status}  attempts=${r.attempts}  shadow=${r.shadow}`);
    console.log(`source_msg_id ${r.source_message_id}`);
    if (r.dead_letter_reason) console.log(`⚠ reason      ${r.dead_letter_reason}`);
    console.log(`canonical     ${JSON.stringify(r.canonical, null, 2)}`);
    console.log(`would_write   ${JSON.stringify(r.would_write, null, 2)}`);
  }
  console.log('─'.repeat(72));
} catch (err) {
  console.error('✖ peek failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
