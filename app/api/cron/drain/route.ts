// Cron drain — the reliability backstop. Runs daily (see vercel.json). Claims due/stuck leads
// and processes them, catching anything the after() fast path missed (a function killed mid-flight, a
// retry that's now due, a row stuck in 'processing' past the visibility timeout).
//
// ⚠ Cadence note: the REAL-TIME path is after() on ingest — the cron is only the backstop, so its
// frequency is not on the critical path. This demo runs it once a day: Vercel's Hobby (free) tier
// caps cron jobs at one run per day, and a daily drain is plenty for a backstop (and it won't keep
// Neon's free-tier compute — which scales to zero after ~5 min idle — awake). In production you'd
// crank this up (e.g. */15) on a paid plan.
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
