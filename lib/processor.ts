// Processor: normalize a claimed raw_lead by source, compose the CRM payload, and either shadow-log
// it (would_write) or write it live. Claim-based so the fast path (after()) and the cron drain can't
// double-process the same lead. Runs off the durable row, so retries are safe.

import { buildMarketSharpPayload, writeLead, MarketSharpWriteError } from './adapters/marketsharp';
import { shouldWriteLive } from './pipeline-mode';
import { normalizeWebsite } from './normalize/website';
import { normalizeLeadBridge } from './normalize/leadbridge';
import { normalizeHomeQuote } from './normalize/homequote';
import { normalizeRenovatePros } from './normalize/renovatepros';
import { normalizePhone } from './normalize/phone';
import { claimDueBatch, claimLead, findPriorMatch, markDeadLetter, markFailed, markWritten } from './repo';
import { detectDrift } from './validate';
import type { CanonicalLead, RawLeadRow } from './types';

const MAX_ATTEMPTS = 5;

async function normalizeBySource(row: RawLeadRow): Promise<CanonicalLead> {
  switch (row.source) {
    case 'web-form':
      return normalizeWebsite(row.raw_payload);
    case 'vendor:leadbridge':
      return normalizeLeadBridge(row.raw_payload);
    case 'vendor:homequote':
      return normalizeHomeQuote(row.raw_payload);
    case 'vendor:renovatepros':
      return normalizeRenovatePros(row.raw_payload);
    case 'phone':
      return normalizePhone(row.raw_payload);
    // meta/tiktok lead-ads: added as their receivers land
    default:
      throw new Error(`no normalizer for source "${row.source}"`);
  }
}

/** Exponential backoff: 60s, 120s, 240s, ... capped at 1h. */
function backoffSeconds(attempts: number): number {
  return Math.min(60 * 2 ** attempts, 3600);
}

/** Do the work on an already-claimed row (status='processing'). Finalizes to written/failed/dead_letter. */
async function processClaimed(row: RawLeadRow): Promise<void> {
  try {
    const canonical = await normalizeBySource(row);
    const wouldWrite = await buildMarketSharpPayload(canonical);

    // Cross-source dedupe (flag-don't-drop): flag if this lead's phone/email matches an earlier one
    // within the window. We record the match for review; the lead still flows normally.
    const windowDays = Number(process.env.PIPELINE_DEDUPE_WINDOW_DAYS ?? 30);
    const match = await findPriorMatch({
      source: row.source,
      phone: canonical.phone ?? null,
      email: canonical.email ?? null,
      excludeId: row.id,
      receivedAt: row.received_at, // anchor the dedupe window to receipt time, not "now" — see repo.ts
      windowDays,
    });
    const dup = { duplicateOf: match?.id ?? null, duplicateReason: match?.reason ?? null };

    // Drift alerting (flag-don't-drop): a lead that normalized suspiciously-empty is almost certainly a
    // parse failure (renamed source field, malformed payload). Flag it + log a warning so it surfaces on
    // the dashboard and in the Vercel logs — the lead still flows.
    const driftReason = detectDrift(canonical);
    if (driftReason) {
      console.warn(
        `[drift] lead ${row.id} (source=${row.source}, msgId=${row.source_message_id ?? 'n/a'}) ` +
          `normalized suspiciously-empty: ${driftReason}`,
      );
    }

    // Per-source cutover decision at PROCESS time (not capture time) — see pipeline-mode.ts. Defaults to
    // shadow for every source until all three gates are set, so this is a no-op change until cutover.
    if (!shouldWriteLive(row.source)) {
      // Shadow: record what we WOULD send; don't write (Zapier still does the real write).
      await markWritten(row.id, { canonical, wouldWrite, crmId: null, ...dup, driftReason });
      return;
    }
    // Live write. Idempotent: if a prior attempt already got a crmId, never re-POST — just finalize.
    if (row.crm_id) {
      await markWritten(row.id, { canonical, wouldWrite, crmId: row.crm_id, ...dup, driftReason });
      return;
    }
    const { crmId } = await writeLead(wouldWrite);
    await markWritten(row.id, { canonical, wouldWrite, crmId, ...dup, driftReason });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // Honor a rate-limit's Retry-After (reliability #3); otherwise exponential backoff.
    const retryAfter = err instanceof MarketSharpWriteError ? err.retryAfterSeconds : null;
    // row.attempts already reflects this attempt (bumped at claim time).
    if (row.attempts >= MAX_ATTEMPTS) {
      await markDeadLetter(row.id, reason); // held + alerting, never discarded
    } else {
      await markFailed(row.id, reason, retryAfter ?? backoffSeconds(row.attempts));
    }
  }
}

/** Fast path: claim one lead by id and process it. No-op if it's terminal or already claimed. */
export async function processRawLead(id: string): Promise<void> {
  const row = await claimLead(id);
  if (!row) return;
  await processClaimed(row);
}

/** Cron backstop: claim + process a batch of due/stuck leads. Returns how many were handled. */
export async function drainDue(limit = 100): Promise<{ claimed: number }> {
  const rows = await claimDueBatch(limit);
  for (const row of rows) {
    await processClaimed(row);
  }
  return { claimed: rows.length };
}
