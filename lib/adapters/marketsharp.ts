// MarketSharp adapter — the ONLY place MS dialect lives (MSM_* keys, Na/na@na.com defaults, the
// MSM_interests notes cram, capture-id resolution). Canonical stays clean; this translates. See §7.
//
// For the MVP this only *composes* the payload (shadow `would_write`); the actual HTTP submit is added
// when we leave shadow mode.

import { getCaptureId, getDniEntry } from '../repo';
import { toNationalDigits } from '../phone';
import type { CanonicalLead } from '../types';

export interface MarketSharpPayload {
  id: string | null; // MS Custom Lead Capture id (the attribution key)
  MSM_firstname: string;
  MSM_lastname: string;
  MSM_cellphone: string;
  MSM_email: string;
  MSM_address1: string;
  MSM_address2: string;
  MSM_city: string;
  MSM_state: string;
  MSM_zip: string;
  MSM_interests: string;
}

/**
 * Resolve the MS capture id, keyed to how each source is registered in capture_map:
 *  - phone      → per dialed line (dni_number_map), fallback organic-call
 *  - vendor:*   → by source (capture_map is keyed `vendor:leadbridge` etc.; channel is a display name)
 *  - web / lead-ads → by channel (organic-web | Google | Bing | Facebook | TikTok | ...)
 */
async function resolveCaptureId(lead: CanonicalLead): Promise<string | null> {
  if (lead.source === 'phone') {
    const dn = toNationalDigits(lead.dialedNumber);
    if (dn) {
      const entry = await getDniEntry(dn);
      if (entry) return entry.captureId;
    }
    return getCaptureId('organic-call'); // fallback (Website/Internet - Phone Calls)
  }
  if (lead.source.startsWith('vendor:')) {
    return getCaptureId(lead.source);
  }
  return lead.channel ? getCaptureId(lead.channel) : null;
}

/** Per-source MSM_interests (the notes field). web: labeled triple · call: campaign · vendor: raw product. */
function buildInterests(lead: CanonicalLead): string {
  if (lead.source === 'phone') return lead.campaign ?? '';
  if (lead.source === 'web-form') {
    const p = lead.productInterest ?? '';
    const d = lead.appointmentDate ?? '';
    const t = lead.appointmentTime ?? '';
    // TODO: converge exact whitespace vs Zapier during shadow-diff (empty vs populated).
    return `${p} | ApptDate: ${d} | ApptTime: ${t}`;
  }
  // vendors: raw label passthrough
  return lead.productInterest ?? '';
}

/** A failed live write. `retryAfterSeconds` is set on a rate-limit (429/503) so the drain can honor it. */
export class MarketSharpWriteError extends Error {
  constructor(message: string, public status: number, public retryAfterSeconds: number | null) {
    super(message);
    this.name = 'MarketSharpWriteError';
  }
}

/**
 * Live write to MarketSharp (the "submit lead" call — the same one Zapier makes today, using the
 * write-only admin API key). Gated upstream by `shouldWriteLive`; this only runs once a source is cut
 * over. Idempotency is enforced by the caller (never called for a row that already has a crm_id).
 *
 * ⚠ ENDPOINT/AUTH TO CONFIRM ON CONNECT: the exact submit URL + how the api key is presented come from
 * the current Zapier "Submit to MarketSharp" step (fast path) or MarketSharp support. Structured here as
 * a form-encoded POST of the MSM_* payload (the `id` field is the Custom Lead Capture form id) with the
 * key as a bearer header — swap to whatever the Zapier step actually uses. Success = any 2xx; crmId is
 * best-effort from the response.
 */
export async function writeLead(payload: MarketSharpPayload): Promise<{ crmId: string | null }> {
  const url = process.env.MARKETSHARP_SUBMIT_URL;
  const key = process.env.MARKETSHARP_API_KEY;
  if (!url || !key) throw new MarketSharpWriteError('MarketSharp write creds not configured', 0, null);

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) body.set(k, v == null ? '' : String(v));

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Bearer ${key}` },
    body: body.toString(),
  });

  if (res.status === 429 || res.status === 503) {
    const ra = Number(res.headers.get('retry-after'));
    throw new MarketSharpWriteError(`MarketSharp rate-limited (${res.status})`, res.status, Number.isFinite(ra) ? ra : null);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new MarketSharpWriteError(`MarketSharp write failed: ${res.status} ${detail}`, res.status, null);
  }

  const text = await res.text().catch(() => '');
  let crmId: string | null = null;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const cand = j.id ?? j.Id ?? j.leadId ?? j.contactId ?? j.inquiryId;
    crmId = cand == null ? null : String(cand);
  } catch {
    crmId = text.trim() ? text.trim().slice(0, 120) : null;
  }
  return { crmId };
}

export async function buildMarketSharpPayload(
  lead: CanonicalLead,
  // Injectable capture-id resolver (defaults to the real DB-backed one); tests pass a stub to stay DB-free.
  resolveId: (lead: CanonicalLead) => Promise<string | null> = resolveCaptureId,
): Promise<MarketSharpPayload> {
  const isCall = lead.source === 'phone';
  const captureId = await resolveId(lead);
  return {
    id: captureId,
    MSM_firstname: isCall ? 'Na' : lead.firstName ?? '',
    MSM_lastname: isCall ? 'Na' : lead.lastName ?? '',
    MSM_cellphone: lead.phone ?? '',
    MSM_email: isCall ? 'na@na.com' : lead.email ?? '',
    MSM_address1: isCall ? '' : lead.address1 ?? '',
    MSM_address2: '', // MS-architected, always empty
    MSM_city: lead.city ?? '',
    MSM_state: lead.state ?? '',
    MSM_zip: lead.zip ?? '',
    MSM_interests: buildInterests(lead),
  };
}
