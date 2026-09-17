// CSV export of leads, honoring the same filters as the /leads view.
//   GET /api/export?source=vendor:leadbridge&from=2026-08-01&to=2026-08-31&status=written

import { type NextRequest, NextResponse } from 'next/server';
import { getLeadsFiltered } from '@/lib/repo';
import { parseFilters, toCsv } from '@/lib/report';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const filters = parseFilters(sp);
  const rows = await getLeadsFiltered({ ...filters, limit: 10000 });
  const csv = toCsv(rows);

  const tag = (filters.source ?? 'all').replace(/[^a-z0-9-]+/gi, '-');
  const day = new Date().toISOString().slice(0, 10);
  const filename = `leads_${tag}_${day}.csv`;

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
