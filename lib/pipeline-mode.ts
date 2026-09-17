// Cutover control — which sources write LIVE to the CRM vs stay in shadow. Migration is source-by-source
// (design §4: prove parity on one source, flip it, keep the rest shadow), so this is per-source, never
// a single global switch.
//
// THREE independent gates must ALL hold before one lead is written live, so the default — and any
// misconfiguration — fails safe to shadow (a wrongly-shadowed lead is harmless; Zapier still writes it):
//   1. master switch OFF   — PIPELINE_SHADOW_MODE=false   (unset/anything-else = shadow everything)
//   2. source opted IN     — source ∈ PIPELINE_LIVE_SOURCES (comma list, e.g. "web-form"; default empty)
//   3. CRM creds present   — MARKETSHARP_SUBMIT_URL + MARKETSHARP_API_KEY both set
//
// Cutover of Wave 1 (website) becomes: set the creds, set PIPELINE_SHADOW_MODE=false, set
// PIPELINE_LIVE_SOURCES=web-form, redeploy. Everything else stays shadow until its own parity is proven.

/** True only when the MarketSharp write endpoint + key are both configured. */
export function marketSharpConfigured(): boolean {
  return Boolean(process.env.MARKETSHARP_SUBMIT_URL && process.env.MARKETSHARP_API_KEY);
}

/** Canonical sources explicitly opted in to live writes (default none). */
export function liveSources(): string[] {
  return (process.env.PIPELINE_LIVE_SOURCES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Should this source's leads be written live to the CRM right now? All three gates must hold. */
export function shouldWriteLive(source: string): boolean {
  if (process.env.PIPELINE_SHADOW_MODE !== 'false') return false; // master shadow (default)
  if (!marketSharpConfigured()) return false; // no creds → cannot go live, fail safe to shadow
  return liveSources().includes(source);
}
