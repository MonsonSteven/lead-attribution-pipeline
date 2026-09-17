// Re-run captured lead(s) through the current processor code (e.g. after a normalizer fix).
// Resets matching rows to 'received' and drains them with the real pipeline path.
//   npx tsx scripts/reprocess.ts <source_message_id>
//   npx tsx scripts/reprocess.ts --all-web      (reprocess every web-form lead)
//
// Dedupe note: as of 2026-09-04 this is safe to re-run over history — findPriorMatch anchors its
// window to each lead's own received_at and only matches STRICTLY-EARLIER rows, so re-scoring can't
// flag a lead "forward" to a later one. (For a bulk re-score of just the dup flags without touching
// status/canonical/would_write, prefer scripts/recompute-dedupe.mjs.)

import { getSql } from '../lib/db';
import { drainDue } from '../lib/processor';

async function main() {
  process.loadEnvFile('.env');
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: npx tsx scripts/reprocess.ts <source_message_id | --all-web>');
    process.exit(1);
  }
  const sql = getSql();

  const reset =
    arg === '--all-web'
      ? ((await sql`update raw_leads set status='received', next_attempt_at=now() where source='web-form' returning id`) as { id: string }[])
      : ((await sql`update raw_leads set status='received', next_attempt_at=now() where source_message_id=${arg} returning id`) as { id: string }[]);

  console.log(`reset ${reset.length} row(s) to received`);
  const res = await drainDue(500);
  console.log('drained:', res);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
