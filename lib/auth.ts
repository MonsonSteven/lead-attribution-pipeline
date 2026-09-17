// Minimal shared-password gate for the human-facing UI (dashboard, /leads, CSV export).
// NOT for the machine endpoints — receivers use RECEIVER_WEBHOOK_SECRET, cron uses CRON_SECRET.
//
// The gate is active only when DASHBOARD_PASSWORD is set (so local dev stays open). The auth cookie
// holds a SHA-256 token derived from the password, never the password itself. Edge- and Node-safe
// (Web Crypto only) so both middleware and the login action can use it.

export const AUTH_COOKIE = 'dash_auth';

// Login brute-force throttle (per client IP, failed attempts only). Generous so normal fumbling — even
// several users behind one office IP — won't trip it, while a scripted attack does immediately.
export const LOGIN_MAX_FAILURES = 15;
export const LOGIN_WINDOW_MINUTES = 15;

export function gateEnabled(): boolean {
  return !!process.env.DASHBOARD_PASSWORD;
}

/** Deterministic token for a password (SHA-256 hex). Same input → same token, so it's stateless. */
export async function authToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`summit-lead-pipeline:v1:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
