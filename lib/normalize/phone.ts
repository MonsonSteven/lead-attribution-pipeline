// Twilio inbound-call (Class C) normalizer. Unlike every other source, attribution comes not from a
// param but from WHICH TRACKED LINE was dialed (`To`), looked up in dni_number_map -> {campaign,
// captureId}; fallback "Organic Incoming Call". The caller (`From`) is the lead's phone. Name/email are
// absent on a raw call, so they stay null here and the adapter writes the Na / na@na.com placeholders.
// See the design doc §8d.

import type { CanonicalLead } from '../types';
import { getDniEntry } from '../repo';
import { asObj, pick } from './shared';
import { toE164, toNationalDigits, isForeignPhone } from '../phone';

const ORGANIC_CALL_CAMPAIGN = 'Organic Incoming Call';

// Best-effort coarse channel — for reporting/filtering ONLY. It never affects the CRM write, which
// keys off the dialed line -> captureId (adapter). The fine-grained truth lives in `campaign`. Matched
// against the real DNI campaign families seen in prod (GoogleMyBusiness_*, LocalServices_*, *WKRG, ...).
function deriveChannel(campaign: string, matched: boolean): string {
  if (!matched) return 'organic-call';
  const c = campaign.toLowerCase();
  if (c.includes('google')) return 'Google';
  if (c.includes('bing')) return 'Bing';
  if (c.includes('facebook')) return 'Facebook';
  // LocalServices_* (no space) is the real prod spelling; also match "local service(s)" and a standalone "lsa".
  if (c.includes('localservice') || c.includes('local service') || /\blsa\b/.test(c)) return 'LSA';
  if (c.includes('wkrg') || /\btv\b/.test(c)) return 'TV';
  return 'Phone'; // a tracked line with no recognized family — still correctly attributed via captureId
}

export async function normalizePhone(
  raw: unknown,
  // Injectable DNI lookup (defaults to the real repo call); tests pass a stub to stay DB-free.
  getDni: typeof getDniEntry = getDniEntry,
): Promise<CanonicalLead> {
  const p = asObj(raw);

  // The dialed (To) line is the attribution key. Resolve campaign here (a pipeline concern); the
  // adapter separately resolves the MS capture id from the same table (an adapter concern).
  const to = pick(p, 'To', 'to', 'dialedNumber', 'dialed_number');
  const dn = toNationalDigits(to);
  const entry = dn ? await getDni(dn) : null;
  const campaign = entry?.campaign ?? ORGANIC_CALL_CAMPAIGN;

  // The CALLER (From) is the lead. the company's world is US/CA, so a non-NANP caller is dropped to null
  // (not written to the CRM) — but if it was a real international number (e.g. overseas spam calls),
  // note it so drift can tell an out-of-region caller apart from a genuine parse failure (see validate.ts).
  const from = pick(p, 'From', 'from', 'phone');
  const phone = toE164(from);
  const foreignCaller = phone === null && isForeignPhone(from);

  return {
    firstName: pick(p, 'First Name', 'FirstName', 'first_name', 'first'), // null -> adapter writes 'Na'
    lastName: pick(p, 'Last Name', 'LastName', 'last_name', 'last'),
    phone,
    city: pick(p, 'City', 'city'),
    state: pick(p, 'State', 'state'),
    zip: pick(p, 'Zip', 'zip', 'Zip Code'),
    productInterest: campaign, // call template: MS Notes = campaign (see §5 / adapter buildInterests)
    dialedNumber: to, // the tracked line; adapter re-derives national digits for the id lookup
    campaign,
    channel: deriveChannel(campaign, Boolean(entry)),
    source: 'phone',
    provenance: {
      callSid: pick(p, 'CallSid', 'call_sid', 'callSid'),
      dialedNumberNational: dn,
      dniMatched: Boolean(entry),
      ...(foreignCaller ? { foreignCaller: true } : {}),
    },
  };
}

/** CallSid is Twilio's globally-unique per-call id — the source-native idempotency key. */
export function phoneSourceMessageId(raw: unknown): string | null {
  return pick(asObj(raw), 'CallSid', 'call_sid', 'callSid');
}
