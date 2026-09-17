// Generic lead receiver — one handler for every source (website + vendors + future).
// URL: POST /api/receivers/<slug>  where <slug> is a key in lib/sources.ts (website, leadbridge, ...).
//
// Capture-before-process: store raw + ACK before anything else; fail-closed (non-2xx) if the durable
// write fails, so the sender retries. Process on the after() fast path; the cron drain is the backstop.

import { after, type NextRequest, NextResponse } from 'next/server';
import { insertRawLead } from '@/lib/repo';
import { processRawLead } from '@/lib/processor';
import { getSourceDef } from '@/lib/sources';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ source: string }> };

function authorized(req: NextRequest): boolean {
  const secret = process.env.RECEIVER_WEBHOOK_SECRET;
  if (!secret) return true; // dev: no secret configured
  const provided =
    req.headers.get('x-webhook-secret') ?? new URL(req.url).searchParams.get('secret');
  return provided === secret;
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { source: slug } = await ctx.params;
  const def = getSourceDef(slug);
  if (!def) return NextResponse.json({ ok: false, error: `unknown source "${slug}"` }, { status: 404 });

  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Parse body once (JSON or form-encoded).
  const bodyText = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    payload = Object.fromEntries(new URLSearchParams(bodyText));
  }

  const shadow = process.env.PIPELINE_SHADOW_MODE !== 'false';
  const sourceMessageId = def.extractMessageId(payload);

  let id: string | null;
  try {
    const res = await insertRawLead({ source: def.source, sourceMessageId, rawPayload: payload, shadow });
    if (res.deduped) return NextResponse.json({ ok: true, deduped: true });
    id = res.id;
  } catch (err) {
    console.error(`[receiver ${slug}] capture failed:`, err);
    return NextResponse.json({ ok: false, error: 'capture failed' }, { status: 503 });
  }

  if (id) {
    const leadId = id;
    after(() => processRawLead(leadId));
  }
  return NextResponse.json({ ok: true, id, source: def.source, shadow });
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { source: slug } = await ctx.params;
  const def = getSourceDef(slug);
  if (!def) return NextResponse.json({ ok: false, error: `unknown source "${slug}"` }, { status: 404 });
  return NextResponse.json({ ok: true, receiver: slug, source: def.source, method: 'POST' });
}
