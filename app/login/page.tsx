import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AUTH_COOKIE, authToken, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MINUTES } from '@/lib/auth';
import { clearLoginFailures, recentLoginFailures, recordLoginFailure } from '@/lib/repo';

export const dynamic = 'force-dynamic';

/** Client IP for throttling — Vercel sets x-forwarded-for from the real connection. */
async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
}

async function login(formData: FormData): Promise<void> {
  'use server';
  const pw = process.env.DASHBOARD_PASSWORD;
  const entered = String(formData.get('password') ?? '');
  const nextParamRaw = String(formData.get('next') ?? '/');
  const next = nextParamRaw.startsWith('/') ? nextParamRaw : '/';
  const enc = encodeURIComponent(next);
  const ip = await clientIp();

  // Brute-force gate: throttle the ATTACKER (IP), never the shared password. Fail OPEN — a DB hiccup
  // must never lock out the whole team. (redirect() throws internally, so it stays out of the try.)
  let locked = false;
  try {
    locked = (await recentLoginFailures(ip, LOGIN_WINDOW_MINUTES)) >= LOGIN_MAX_FAILURES;
  } catch {
    locked = false;
  }
  if (locked) redirect(`/login?error=locked&next=${enc}`);

  if (pw && entered === pw) {
    try { await clearLoginFailures(ip); } catch { /* fail open */ }
    const token = await authToken(pw);
    (await cookies()).set(AUTH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 12, // 12h
    });
    redirect(next);
  }

  try { await recordLoginFailure(ip); } catch { /* fail open */ }
  redirect(`/login?error=1&next=${enc}`);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const error = sp.error;
  const next = sp.next ?? '/';

  return (
    <div style={{ maxWidth: 360, margin: '8vh auto 0' }}>
      <img
        src="/summit-logo.svg"
        alt="Summit Home Improvement"
        width={112}
        height={112}
        style={{ display: 'block', height: 112, width: 'auto', margin: '0 auto 16px' }}
      />
      <h2 style={{ textAlign: 'center' }}>Sign in</h2>
      <p className="note" style={{ color: 'var(--muted)', textAlign: 'center' }}>Summit Lead Pipeline — internal dashboard.</p>
      <form action={login} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoFocus
          required
          style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 6, font: 'inherit' }}
        />
        {error === 'locked' ? (
          <div style={{ color: 'var(--warn)', fontSize: '0.85rem' }}>
            Too many attempts from this network. Please wait a few minutes and try again.
          </div>
        ) : error ? (
          <div style={{ color: 'var(--warn)', fontSize: '0.85rem' }}>Incorrect password. Try again.</div>
        ) : null}
        <button
          type="submit"
          style={{ padding: '10px 12px', background: 'var(--brand-blue)', color: 'var(--white)', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
