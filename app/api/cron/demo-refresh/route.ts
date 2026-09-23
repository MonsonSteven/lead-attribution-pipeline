// Demo-refresh — a PORTFOLIO-DEMO-ONLY endpoint (not part of the real pipeline).
//
// The synthetic leads are all captured within seconds of running scripts/demo-seed.mjs, so on the
// analytics page they'd sit on a single day and then slide out of the "last N days" window as real
// time passes — leaving the graphs looking empty. This re-stamps every lead's received_at to a random
// point in the last 30 days ending now, so the dashboard + analytics always show a live, recent spread
// no matter how long ago the data was seeded. It never adds or deletes rows (count stays constant).
//
// Runs on a daily Vercel cron (see vercel.json) and is also called once at the end of demo-seed.
//
// Auth: same as the drain — Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; `?secret=` is
// accepted for manual/local invocation. Open when no secret is configured (dev).

import { type NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const query = new URL(req.url).searchParams.get('secret');
  return bearer === secret || query === secret;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const sql = getSql();
    // Spread every lead across the last 30 days ending now (fractional days → varied times of day).
    const rows = (await sql`
      update raw_leads
      set received_at = now() - (random() * interval '30 days')
      returning id
    `) as { id: string }[];
    return NextResponse.json({ ok: true, refreshed: rows.length, spreadDays: 30 });
  } catch (err) {
    console.error('[demo-refresh] failed:', err);
    return NextResponse.json({ ok: false, error: 'refresh failed' }, { status: 500 });
  }
}
