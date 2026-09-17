// Data-access helpers for raw_leads + the config tables. Raw parameterized SQL via the Neon driver.

import { getSql } from './db';
import type { CanonicalLead, LeadSource, RawLeadRow } from './types';

// ── raw_leads (the ledger/inbox/queue) ────────────────────────

/**
 * Capture an inbound lead durably. Idempotent on (source, source_message_id): a re-delivered webhook
 * (same source-native id) is a no-op. Returns `deduped: true` when the row already existed.
 */
export async function insertRawLead(input: {
  source: LeadSource;
  sourceMessageId: string | null;
  rawPayload: unknown;
  shadow: boolean;
}): Promise<{ id: string | null; deduped: boolean }> {
  const sql = getSql();
  const rows = (await sql`
    insert into raw_leads (source, source_message_id, raw_payload, shadow, status)
    values (
      ${input.source},
      ${input.sourceMessageId},
      ${JSON.stringify(input.rawPayload)}::jsonb,
      ${input.shadow},
      'received'
    )
    on conflict (source, source_message_id) where source_message_id is not null do nothing
    returning id
  `) as { id: string }[];

  if (rows.length === 0) return { id: null, deduped: true };
  return { id: rows[0].id, deduped: false };
}

export async function getRawLead(id: string): Promise<RawLeadRow | null> {
  const sql = getSql();
  const rows = (await sql`select * from raw_leads where id = ${id}`) as RawLeadRow[];
  return rows[0] ?? null;
}

/** Mark a lead successfully processed (shadow: would_write set, crm_id null; live: crm_id set). */
export async function markWritten(
  id: string,
  input: {
    canonical: CanonicalLead;
    wouldWrite: unknown;
    crmId: string | null;
    duplicateOf?: string | null;
    duplicateReason?: string | null;
    driftReason?: string | null;
  },
): Promise<void> {
  const sql = getSql();
  await sql`
    update raw_leads set
      canonical        = ${JSON.stringify(input.canonical)}::jsonb,
      would_write      = ${JSON.stringify(input.wouldWrite)}::jsonb,
      crm_id           = ${input.crmId},
      duplicate_of     = ${input.duplicateOf ?? null},
      duplicate_reason = ${input.duplicateReason ?? null},
      drift_reason     = ${input.driftReason ?? null},
      status           = 'written',
      updated_at       = now()
    where id = ${id}
  `;
}

/**
 * Whether a contact match between a NEW lead (source `a`) and an EARLIER lead (source `b`) carries
 * genuine duplicate signal worth flagging for review.
 *
 * The one pairing that does NOT: **phone↔phone**. A repeat phone call is a fresh, deliberate contact
 * event — the design treats repeat callers as legitimately SEPARATE leads, not duplicates. And a true
 * Twilio webhook re-delivery is already collapsed at insert by the CallSid idempotency constraint, so
 * two *distinct* phone rows sharing a number are, by construction, two real separate calls. Flagging
 * them was pure noise (empirically ~88% of all flags — see the 2026-09-04 dedupe-window review).
 *
 * Every other pairing keeps its flag: cross-source (same person reached us two ways — the classic
 * lead-count-inflating dup) and a repeat web submission of the same contact (an accidental resubmit
 * worth a human glance).
 */
export function isDuplicateSignal(a: LeadSource, b: LeadSource): boolean {
  if (a === 'phone' && b === 'phone') return false;
  return true;
}

/** A candidate prior match as returned by the dedupe query. Carries `received_at` so the temporal
 *  window + strictly-earlier test is applied in pure code (see `selectPriorMatch`). */
interface PriorCandidate {
  id: string;
  source: LeadSource;
  received_at: string;
  phone_match: boolean | null;
  email_match: boolean | null;
}

/**
 * Pick the EARLIEST contact-match that is a genuine duplicate signal for a new lead — the authoritative
 * dedupe decision, kept pure (no DB) so it's fully unit-testable; `findPriorMatch` is the thin SQL
 * wrapper that feeds it. Candidates may arrive in any order.
 *
 * Temporally honest: a match must be STRICTLY EARLIER than the current lead's `receivedAt` and within
 * `windowDays` before it. This is what makes re-scoring safe — reconstructing exactly what live flow
 * would have produced. Without the strictly-earlier bound, re-running dedupe over history (e.g.
 * `scripts/reprocess.ts`) could flag a lead "forward" to a lead that actually arrived LATER, inventing
 * a duplicate that live flow never saw. Anchoring to receipt time (not "now") also fixes a live-flow
 * edge: two same-contact leads arriving close together where the first is processed — via retry or the
 * cron drain — only after the second has already landed.
 */
export function selectPriorMatch(
  current: { source: LeadSource; receivedAt: string; windowDays: number },
  candidates: PriorCandidate[],
): { id: string; reason: string } | null {
  const anchor = new Date(current.receivedAt).getTime();
  const floor = anchor - current.windowDays * 86_400_000; // windowDays in ms
  let best: { id: string; reason: string; t: number } | null = null;
  for (const c of candidates) {
    const t = new Date(c.received_at).getTime();
    if (!(t < anchor && t >= floor)) continue; // strictly-earlier, within window
    if (!isDuplicateSignal(current.source, c.source)) continue;
    const reasons: string[] = [];
    if (c.phone_match) reasons.push('phone');
    if (c.email_match) reasons.push('email');
    if (reasons.length === 0) continue; // shouldn't happen (query only returns matches), belt-and-braces
    if (!best || t < best.t) best = { id: c.id, reason: reasons.join(','), t }; // earliest wins
  }
  return best ? { id: best.id, reason: best.reason } : null;
}

/**
 * Cross-source dedupe (flag-don't-drop): find the earliest OTHER lead strictly BEFORE this one, within
 * `windowDays`, that shares its phone or email AND carries genuine duplicate signal (see
 * `isDuplicateSignal` — phone↔phone repeat callers are excluded by design). Returns the match + reason,
 * or null. The caller flags — never merges. Candidates are cheap (a given contact recurs rarely); the
 * SQL bounds by contact + time for efficiency, and the pure `selectPriorMatch` is the authority for the
 * window + strictly-earlier + signal rules, keeping them DB-free and testable.
 */
export async function findPriorMatch(input: {
  source: LeadSource;
  phone: string | null;
  email: string | null;
  excludeId: string;
  receivedAt: string; // the current lead's receipt time — the temporal anchor
  windowDays: number;
}): Promise<{ id: string; reason: string } | null> {
  const { source, phone, email, excludeId, receivedAt, windowDays } = input;
  if (!phone && !email) return null;
  const sql = getSql();
  const rows = (await sql`
    select id, source, received_at,
           (canonical->>'phone' = ${phone}) as phone_match,
           (lower(canonical->>'email') = lower(${email})) as email_match
    from raw_leads
    where id <> ${excludeId}
      and canonical is not null
      and received_at <  ${receivedAt}::timestamptz
      and received_at >= ${receivedAt}::timestamptz - (${windowDays} * interval '1 day')
      and (
        (${phone}::text is not null and canonical->>'phone' = ${phone})
        or (${email}::text is not null and lower(canonical->>'email') = lower(${email}))
      )
    order by received_at asc
    limit 50
  `) as PriorCandidate[];
  return selectPriorMatch({ source, receivedAt, windowDays }, rows);
}

/**
 * Atomically claim ONE lead for processing (fast path). Sets it to 'processing' and bumps attempts,
 * only if it's still claimable. Returns null if it's terminal or already claimed by the cron.
 */
export async function claimLead(id: string): Promise<RawLeadRow | null> {
  const sql = getSql();
  const rows = (await sql`
    update raw_leads set
      status = 'processing', processing_started_at = now(), attempts = attempts + 1, updated_at = now()
    where id = ${id} and status in ('received', 'failed')
    returning *
  `) as RawLeadRow[];
  return rows[0] ?? null;
}

/**
 * Atomically claim a BATCH of due leads (cron drain). Picks up new/retry-due rows AND stuck rows
 * (status='processing' past the visibility timeout — a fast path that died mid-flight). FOR UPDATE
 * SKIP LOCKED so concurrent drains don't collide. Single statement — no interactive transaction.
 */
export async function claimDueBatch(limit = 50, stuckMinutes = 5): Promise<RawLeadRow[]> {
  const sql = getSql();
  return (await sql`
    update raw_leads set
      status = 'processing', processing_started_at = now(), attempts = attempts + 1, updated_at = now()
    where id in (
      select id from raw_leads
      where next_attempt_at <= now()
        and (
          status in ('received', 'failed')
          or (status = 'processing' and processing_started_at < now() - (${stuckMinutes} * interval '1 minute'))
        )
      order by next_attempt_at
      for update skip locked
      limit ${limit}
    )
    returning *
  `) as RawLeadRow[];
}

/** A recoverable failure — schedule a retry with backoff. (attempts is bumped at claim time.) */
export async function markFailed(id: string, reason: string, backoffSeconds: number): Promise<void> {
  const sql = getSql();
  await sql`
    update raw_leads set
      status             = 'failed',
      dead_letter_reason = ${reason},
      next_attempt_at    = now() + (${backoffSeconds} * interval '1 second'),
      updated_at         = now()
    where id = ${id}
  `;
}

/** Exhausted retries — hold + alert, never discard. */
export async function markDeadLetter(id: string, reason: string): Promise<void> {
  const sql = getSql();
  await sql`
    update raw_leads set status = 'dead_letter', dead_letter_reason = ${reason}, updated_at = now()
    where id = ${id}
  `;
}

// ── config lookups ────────────────────────────────────────────

/** param -> channel (web attribution). e.g. { gclid: 'Google', msclkid: 'Bing', ... } */
export async function getParamChannelMap(): Promise<Record<string, string>> {
  const sql = getSql();
  const rows = (await sql`select param, channel from param_channel_map`) as {
    param: string;
    channel: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.param, r.channel]));
}

/** channel -> MS Custom Lead Capture id. */
export async function getCaptureId(channel: string): Promise<string | null> {
  const sql = getSql();
  const rows = (await sql`select capture_id from capture_map where channel = ${channel}`) as {
    capture_id: string;
  }[];
  return rows[0]?.capture_id ?? null;
}

/** dialed number -> {campaign, captureId} (phone attribution). Null when no tracked line matches. */
export async function getDniEntry(
  dialedNumber: string,
): Promise<{ campaign: string; captureId: string } | null> {
  const sql = getSql();
  const rows = (await sql`
    select campaign, capture_id from dni_number_map where dialed_number = ${dialedNumber}
  `) as { campaign: string; capture_id: string }[];
  if (!rows[0]) return null;
  return { campaign: rows[0].campaign, captureId: rows[0].capture_id };
}

// ── dashboard queries ─────────────────────────────────────────

export interface RecentLead {
  id: string;
  source: string;
  status: string;
  shadow: boolean;
  crm_id: string | null;
  received_at: string;
  channel: string | null;
  product: string | null;
  first_name: string | null;
  last_name: string | null;
  capture_id: string | null;
  duplicate_of: string | null;
  duplicate_reason: string | null;
  drift_reason: string | null;
}

export async function getRecentLeads(limit = 25): Promise<RecentLead[]> {
  const sql = getSql();
  return (await sql`
    select id, source, status, shadow, crm_id, received_at, duplicate_of, duplicate_reason, drift_reason,
           canonical->>'channel'         as channel,
           canonical->>'productInterest' as product,
           canonical->>'firstName'       as first_name,
           canonical->>'lastName'        as last_name,
           would_write->>'id'            as capture_id
    from raw_leads
    order by received_at desc
    limit ${limit}
  `) as RecentLead[];
}

export async function getDuplicateCount(): Promise<number> {
  const sql = getSql();
  const rows = (await sql`
    select count(*)::int as n from raw_leads where duplicate_of is not null
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}

/** Count of leads flagged as drift (normalized suspiciously-empty) — the dashboard alert number. */
export async function getDriftCount(): Promise<number> {
  const sql = getSql();
  const rows = (await sql`
    select count(*)::int as n from raw_leads where drift_reason is not null
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}

export interface LeadFilters {
  source?: string | null;
  status?: string | null;
  channel?: string | null;
  from?: string | null; // ISO date/datetime
  to?: string | null;
  limit?: number;
}

export interface LeadExportRow {
  id: string;
  received_at: string;
  source: string;
  status: string;
  channel: string | null;
  campaign: string | null;
  region: string | null;
  // Attribution click-ids (web) — for the PPC specialist to reconcile against the ad platforms.
  gclid: string | null;
  fbclid: string | null;
  msclkid: string | null;
  oppref: string | null;
  ttclid: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  zip: string | null;
  product: string | null;
  schedule_appointment: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  capture_id: string | null;
  source_message_id: string | null;
  duplicate_of: string | null;
  duplicate_reason: string | null;
  drift_reason: string | null;
}

/** Filterable lead query for the reporting view + CSV export. All filters optional (null = no filter). */
export async function getLeadsFiltered(f: LeadFilters): Promise<LeadExportRow[]> {
  const sql = getSql();
  const limit = Math.min(f.limit ?? 500, 10000);
  return (await sql`
    select id, received_at, source, status,
           canonical->>'channel'          as channel,
           canonical->>'campaign'         as campaign,
           canonical->>'region'           as region,
           canonical->'clickIds'->>'gclid'   as gclid,
           canonical->'clickIds'->>'fbclid'  as fbclid,
           canonical->'clickIds'->>'msclkid' as msclkid,
           canonical->'clickIds'->>'oppref'  as oppref,
           canonical->'clickIds'->>'ttclid'  as ttclid,
           canonical->>'firstName'        as first_name,
           canonical->>'lastName'         as last_name,
           canonical->>'phone'            as phone,
           canonical->>'email'            as email,
           canonical->>'city'             as city,
           canonical->>'state'            as state,
           canonical->>'county'           as county,
           canonical->>'zip'              as zip,
           canonical->>'productInterest'  as product,
           canonical->>'scheduleAppointment' as schedule_appointment,
           canonical->>'appointmentDate'  as appointment_date,
           canonical->>'appointmentTime'  as appointment_time,
           would_write->>'id'             as capture_id,
           source_message_id, duplicate_of, duplicate_reason, drift_reason
    from raw_leads
    where (${f.source ?? null}::text is null or source = ${f.source ?? null})
      and (${f.status ?? null}::text is null or status = ${f.status ?? null})
      and (${f.channel ?? null}::text is null or canonical->>'channel' = ${f.channel ?? null})
      and (${f.from ?? null}::timestamptz is null or received_at >= ${f.from ?? null})
      and (${f.to ?? null}::timestamptz is null or received_at <= ${f.to ?? null})
    order by received_at desc
    limit ${limit}
  `) as LeadExportRow[];
}

export async function getStatusCounts(): Promise<Record<string, number>> {
  const sql = getSql();
  const rows = (await sql`select status, count(*)::int as n from raw_leads group by status`) as {
    status: string;
    n: number;
  }[];
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export async function getSourceCounts(): Promise<{ source: string; n: number }[]> {
  const sql = getSql();
  return (await sql`
    select source, count(*)::int as n from raw_leads group by source order by n desc
  `) as { source: string; n: number }[];
}

/** The most recent consent wording version (web checkbox). */
export async function getLatestConsentVersion(): Promise<string | null> {
  const sql = getSql();
  const rows = (await sql`
    select version from consent_versions order by effective_from desc limit 1
  `) as { version: string }[];
  return rows[0]?.version ?? null;
}

// ── Login throttle (per-IP failed-attempt tracking) ──────────────

/** How many failed logins this IP has made within the window. */
export async function recentLoginFailures(ip: string, windowMinutes: number): Promise<number> {
  const sql = getSql();
  const rows = (await sql`
    select count(*)::int as n from login_failures
    where ip = ${ip} and at > now() - (${windowMinutes} * interval '1 minute')
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}

/** Record a failed login for this IP; opportunistically prune day-old rows to keep the table bounded. */
export async function recordLoginFailure(ip: string): Promise<void> {
  const sql = getSql();
  await sql`insert into login_failures (ip) values (${ip})`;
  await sql`delete from login_failures where at < now() - interval '1 day'`;
}

/** Clear an IP's failures after a successful login — so legitimate users never accumulate toward a lock. */
export async function clearLoginFailures(ip: string): Promise<void> {
  const sql = getSql();
  await sql`delete from login_failures where ip = ${ip}`;
}
