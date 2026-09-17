// Reconciliation (hardening #2). The "did every lead we received actually land?" number, per source —
// the backstop that turns any silent gap into a visible, alerting figure (design §10 #2).
//
// What it answers automatically from our own ledger:
//   • integrity — of everything RECEIVED, how much is written vs failed vs dead-letter vs genuinely stuck
//   • staleness — rows sitting in received/processing past the sweeper window (should be ~0)
//   • silence   — a source that has history but has gone quiet longer than expected (e.g. a feed that
//                 broke — exactly what the FF-401 outage looked like: web went silent)
//
// The remaining piece — cross-checking our counts against each SOURCE'S OWN totals (LeadBridge portal,
// Meta, and Zapier during the shadow run) — needs those external numbers; tracked separately. This gives
// the fully-automatable half now.

import { getSql } from './db';

/** Rows in received/processing older than this are "stuck", not in-flight (sweeper runs at 5 min). */
const STUCK_MINUTES = 10;
/** A source with history but silent longer than this is flagged for a look (informational). */
const SILENCE_HOURS = 24;

export interface SourceReconciliation {
  source: string;
  received: number; // total rows (within window)
  written: number; // successfully processed (shadow: composed; live: written to CRM)
  failed: number; // failed an attempt, will retry (transient)
  dead_letter: number; // exhausted retries — held for replay (ATTENTION)
  in_flight: number; // received/processing within the sweeper window (normal transient)
  stuck: number; // received/processing past the sweeper window (ATTENTION — never processed)
  drift: number; // flagged suspiciously-empty
  duplicates: number; // flagged likely-dup
  last_received_at: string | null;
  hours_since_last: number | null;
  reconciled: boolean; // nothing stuck and nothing dead-lettered
  silent: boolean; // has history but quiet beyond SILENCE_HOURS
}

export interface ReconciliationReport {
  windowHours: number | null; // null = all-time
  sources: SourceReconciliation[];
  totals: { received: number; written: number; failed: number; dead_letter: number; stuck: number };
  attention: string[]; // human-readable anomaly lines (empty = all good)
  ok: boolean; // no stuck, no dead-letter anywhere
}

export async function getReconciliation(windowHours: number | null = null): Promise<ReconciliationReport> {
  const sql = getSql();
  const rows = (await sql`
    select source,
      count(*)::int                                                                          as received,
      count(*) filter (where status = 'written')::int                                        as written,
      count(*) filter (where status = 'failed')::int                                         as failed,
      count(*) filter (where status = 'dead_letter')::int                                    as dead_letter,
      count(*) filter (where status in ('received','processing')
                         and received_at >= now() - (${STUCK_MINUTES} * interval '1 minute'))::int as in_flight,
      count(*) filter (where status in ('received','processing')
                         and received_at <  now() - (${STUCK_MINUTES} * interval '1 minute'))::int as stuck,
      count(*) filter (where drift_reason is not null)::int                                  as drift,
      count(*) filter (where duplicate_of is not null)::int                                  as duplicates,
      max(received_at)                                                                       as last_received_at,
      extract(epoch from (now() - max(received_at))) / 3600.0                                as hours_since_last
    from raw_leads
    where (${windowHours}::int is null or received_at >= now() - (${windowHours} * interval '1 hour'))
    group by source
    order by received desc
  `) as Array<Omit<SourceReconciliation, 'reconciled' | 'silent'> & { hours_since_last: number | null }>;

  const sources: SourceReconciliation[] = rows.map((r) => {
    const hrs = r.hours_since_last == null ? null : Math.round(Number(r.hours_since_last) * 10) / 10;
    return {
      ...r,
      hours_since_last: hrs,
      reconciled: r.stuck === 0 && r.dead_letter === 0,
      silent: hrs != null && hrs > SILENCE_HOURS,
    };
  });

  const totals = sources.reduce(
    (a, s) => ({
      received: a.received + s.received,
      written: a.written + s.written,
      failed: a.failed + s.failed,
      dead_letter: a.dead_letter + s.dead_letter,
      stuck: a.stuck + s.stuck,
    }),
    { received: 0, written: 0, failed: 0, dead_letter: 0, stuck: 0 },
  );

  const attention: string[] = [];
  for (const s of sources) {
    if (s.dead_letter > 0) attention.push(`${s.source}: ${s.dead_letter} dead-letter (needs replay)`);
    if (s.stuck > 0) attention.push(`${s.source}: ${s.stuck} stuck >${STUCK_MINUTES}m (not processed)`);
    if (s.failed > 0) attention.push(`${s.source}: ${s.failed} failed (retrying)`);
    if (s.silent) attention.push(`${s.source}: silent ${s.hours_since_last}h (last lead) — feed OK?`);
  }

  // "ok" = integrity holds (nothing stuck or dead-lettered). Failed=transient, silence=informational.
  const ok = totals.stuck === 0 && totals.dead_letter === 0;
  return { windowHours, sources, totals, attention, ok };
}
