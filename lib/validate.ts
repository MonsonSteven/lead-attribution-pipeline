// Drift detection (hardening #1). Defensive parsing + always-capture-raw already mean drift never
// *loses* a lead (the raw is preserved + reprocessable). The remaining gap: a renamed/mis-parsed source
// field silently normalizes to nulls. This flags a lead that came out suspiciously-empty so drift
// SCREAMS (dashboard flag + a logged warning) instead of whispering. Flag, never drop — see design §10.
//
// Motivating case: the malformed-JSON Twilio call that landed with no phone and organic fallback. That
// lead has no phone AND no email → `no-contact`, which is exactly what should have raised a flag.

import type { CanonicalLead } from './types';

/**
 * Returns a comma-joined drift reason string, or null if the lead looks healthy.
 *  - `no-contact` — no phone AND no email (ALL sources). An uncontactable lead is almost always a parse
 *    failure, not a real lead; the single highest-signal, lowest-false-positive check. EXEMPTION: a phone
 *    lead whose caller number was present and valid but out-of-region (`provenance.foreignCaller`, e.g.
 *    an overseas call). The number is intentionally dropped (Summit is US/CA-only), NOT a parse failure — so
 *    it must not masquerade as drift and desensitize the alert. See lib/normalize/phone.ts.
 *  - `no-name` — a name-bearing source (web-form, vendor:*) with neither first nor last name. Phone
 *    leads legitimately have no name (the adapter writes the `Na`/`Na` placeholder), so phone is exempt.
 */
export function detectDrift(lead: CanonicalLead): string | null {
  const reasons: string[] = [];

  const hasPhone = typeof lead.phone === 'string' && lead.phone.trim() !== '';
  const hasEmail = typeof lead.email === 'string' && lead.email.trim() !== '';
  const foreignCaller = lead.source === 'phone' && lead.provenance?.foreignCaller === true;
  if (!hasPhone && !hasEmail && !foreignCaller) reasons.push('no-contact');

  const nameExpected = lead.source === 'web-form' || lead.source.startsWith('vendor:');
  if (nameExpected) {
    const hasName =
      (typeof lead.firstName === 'string' && lead.firstName.trim() !== '') ||
      (typeof lead.lastName === 'string' && lead.lastName.trim() !== '');
    if (!hasName) reasons.push('no-name');
  }

  return reasons.length ? reasons.join(',') : null;
}
