import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { AUTH_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  (await cookies()).delete(AUTH_COOKIE);
  return NextResponse.redirect(new URL('/login', req.url));
}
