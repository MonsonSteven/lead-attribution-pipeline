// Recompute the cross-source dedupe flags (duplicate_of / duplicate_reason) over the whole ledger,
// temporally-honest — for each lead, its flag becomes the earliest STRICTLY-EARLIER in-window lead
// that shares its phone/email AND carries genuine duplicate signal (phone↔phone repeat callers are
// excluded; see lib/repo.ts isDuplicateSignal). Idempotent, transactional, touches only the two
// duplicate_* columns (never status / canonical / would_write).
//
// Relationship to scripts/reprocess.ts: both are now temporally honest (as of 2026-09-04, findPriorMatch
// anchors its window to each lead's received_at and matches only STRICTLY-EARLIER rows, so reprocess is
// also safe to re-run over history). Prefer THIS script for a bulk re-score of just the dup flags: it's a
// single set-based UPDATE that touches only the two duplicate_* columns — no status churn, no re-running
// normalizers/would_write. It mirrors findPriorMatch's rule exactly (strictly-earlier + window + the
// phone↔phone exclusion).
//
//   node scripts/recompute-dedupe.mjs            (uses PIPELINE_DEDUPE_WINDOW_DAYS or 30)
//   node scripts/recompute-dedupe.mjs --dry-run  (report the delta, change nothing)
import pg from 'pg';
try { process.loadEnvFile('.env'); } catch { /* ambient env */ }
const url = process.env.DATABASE_URL;
if (!url) { console.error('✖ DATABASE_URL not set'); process.exit(1); }
const windowDays = Number(process.env.PIPELINE_DEDUPE_WINDOW_DAYS ?? 30);
const dryRun = process.argv.includes('--dry-run');

// The temporally-honest match for every candidate row d: earliest strictly-earlier in-window row m
// sharing contact, excluding phone↔phone. Reason mirrors findPriorMatch ('phone' / 'email' / 'phone,email').
const matchCTE = `
  with recomputed as (
    select d.id as did, m.id as mid,
           nullif(concat_ws(',',
             case when d.canonical->>'phone' is not null and m.canonical->>'phone' = d.canonical->>'phone' then 'phone' end,
             case when d.canonical->>'email' is not null and lower(m.canonical->>'email') = lower(d.canonical->>'email') then 'email' end
           ), '') as reason
    from raw_leads d
    join lateral (
      select m.id, m.canonical, m.source
      from raw_leads m
      where m.id <> d.id
        and m.canonical is not null
        and m.received_at < d.received_at
        and m.received_at >= d.received_at - (${windowDays} * interval '1 day')
        and (
          (d.canonical->>'phone' is not null and m.canonical->>'phone' = d.canonical->>'phone')
          or (d.canonical->>'email' is not null and lower(m.canonical->>'email') = lower(d.canonical->>'email'))
        )
        and not (d.source = 'phone' and m.source = 'phone')
      order by m.received_at asc
      limit 1
    ) m on true
    where d.canonical is not null
  )`;

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const before = (await client.query(
    `select count(*)::int as n from raw_leads where duplicate_of is not null`)).rows[0].n;

  // What WOULD the flag set become?
  const after = (await client.query(`${matchCTE} select count(*)::int as n from recomputed`)).rows[0].n;
  console.log(`window=${windowDays}d  flagged now=${before}  flagged after=${after}  (Δ ${after - before})`);

  if (dryRun) { console.log('--dry-run: no changes written'); }
  else {
    await client.query('begin');
    // 1) clear every existing flag, 2) set the recomputed matches. Two steps inside one txn = atomic.
    const cleared = (await client.query(
      `update raw_leads set duplicate_of=null, duplicate_reason=null, updated_at=now()
       where duplicate_of is not null returning id`)).rowCount;
    const set = (await client.query(`${matchCTE}
      update raw_leads d set duplicate_of=r.mid, duplicate_reason=r.reason, updated_at=now()
      from recomputed r where d.id = r.did returning d.id`)).rowCount;
    await client.query('commit');
    console.log(`cleared ${cleared} old flag(s), set ${set} recomputed flag(s)`);
  }
} catch (e) {
  try { await client.query('rollback'); } catch {}
  console.error('✖ recompute failed:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
