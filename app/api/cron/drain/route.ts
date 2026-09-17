// Cron drain — the reliability backstop. Runs every 15 min (see vercel.json). Claims due/stuck leads
// and processes them, catching anything the after() fast path missed (a function killed mid-flight, a
// retry that's now due, a row stuck in 'processing' past the visibility timeout).
//
// ⚠ Cadence note: Neon's free tier scales the DB compute to zero after 5 min idle (locked, not
// configurable). A sub-5-min cron would keep the compute awake 24/7 and burn the free compute allowance,
// so keep this comfortably >5 min. The real-time path is after() on ingest; this is only the backstop —
// slower is fine while we're in shadow. Crank it back up (or move to a paid Neon plan) near cutover.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set in the project
// env. We also accept `?secret=` for manual/local invocation.

import { after, type NextRequest, NextResponse } from 'next/server';
import { drainDue } from '@/lib/processor';
import { getReconciliation } from '@/lib/reconcile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured (dev) — allow
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const query = new URL(req.url).searchParams.get('secret');
  return bearer === secret || query === secret;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await drainDue(100);
    // Reconciliation backstop: after draining, check integrity and alert (log-trail) on any gap so a
    // silent miss becomes a visible number. Non-fatal — a reconcile error must never fail the drain.
    let recon: { ok: boolean; attention: string[] } | null = null;
    try {
      const r = await getReconciliation(null);
      recon = { ok: r.ok, attention: r.attention };
      if (!r.ok) console.warn(`[reconcile] ATTENTION — ${r.attention.join(' · ')}`);
    } catch (e) {
      console.error('[reconcile] check failed (non-fatal):', e);
    }
    return NextResponse.json({ ok: true, ...result, reconciled: recon?.ok ?? null });
  } catch (err) {
    console.error('[cron drain] failed:', err);
    return NextResponse.json({ ok: false, error: 'drain failed' }, { status: 500 });
  }
}
