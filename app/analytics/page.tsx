// Analytics dashboard — visualized lead data over the live pipeline. Server-fetches aggregates
// (getAnalytics) honoring the range/source/channel/state filters, then hands them to the client view.

import Link from 'next/link';
import { getAnalytics, type AnalyticsFilters } from '@/lib/analytics';
import AnalyticsDashboard from './AnalyticsDashboard';

export const dynamic = 'force-dynamic';

function parse(sp: Record<string, string | string[] | undefined>): AnalyticsFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const daysRaw = one(sp.days);
  const days = daysRaw === '0' ? null : daysRaw != null && /^\d+$/.test(daysRaw) ? Number(daysRaw) : 30;
  const source = one(sp.source);
  const channel = one(sp.channel);
  const state = one(sp.state);
  return {
    days,
    source: source && ['phone', 'web-form', 'vendor', 'social'].includes(source) ? source : null,
    channel: channel || null,
    state: state === 'Florida' || state === 'Alabama' ? state : null,
  };
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parse(sp);

  let data: Awaited<ReturnType<typeof getAnalytics>> | null = null;
  let dbError: string | null = null;
  try {
    data = await getAnalytics(filters);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <p style={{ margin: '0 0 8px' }}><Link href="/">← Dashboard</Link></p>
      <h2>Lead analytics</h2>
      <p className="note" style={{ color: 'var(--muted)', marginTop: 4 }}>
        Visualized over the live pipeline · shadow mode. Every figure is drawn from data already captured — no new collection.
      </p>
      {dbError ? (
        <div className="card" style={{ borderColor: 'var(--warn)', marginTop: 16 }}>
          <div className="label" style={{ color: 'var(--warn)' }}>Database not reachable</div>
          <div className="note">{dbError}</div>
        </div>
      ) : data && data.count === 0 ? (
        <>
          <AnalyticsDashboard data={data} />
          <p className="a-empty" style={{ marginTop: 8 }}>No leads in this range yet — widen the date range or clear filters.</p>
        </>
      ) : data ? (
        <div style={{ marginTop: 16 }}><AnalyticsDashboard data={data} /></div>
      ) : null}
    </>
  );
}
