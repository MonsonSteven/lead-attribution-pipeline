// Auth gate for the human-facing UI. Runs on everything EXCEPT the public machine endpoints
// (receivers, cron), the login/logout routes, and static assets. Inactive unless DASHBOARD_PASSWORD is set.

import { type NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, authToken } from './lib/auth';

export const config = {
  // Gate everything EXCEPT: public machine endpoints (receivers, cron), the login/logout routes,
  // Next internals, and any static image asset (logo, favicon, apple-icon, etc.) — assets aren't
  // sensitive, and gating them 307s the file to /login so the browser gets HTML instead of the image.
  matcher: [
    '/((?!api/receivers|api/cron|login|logout|_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)).*)',
  ],
};

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return NextResponse.next(); // gate disabled (e.g. local dev)

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  const expected = await authToken(pw);
  if (cookie && cookie === expected) return NextResponse.next();

  // Unauthenticated: 401 for API (e.g. /api/export), redirect to /login for pages.
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', req.nextUrl.pathname);
  return NextResponse.redirect(url);
}
