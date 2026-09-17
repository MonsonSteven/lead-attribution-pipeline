// Reporting view — filter leads by source / channel / status / date range, and export to CSV.
// The bar is >= the Zapier per-source tables the PPC specialist uses today.

import Link from 'next/link';
import { getLeadsFiltered, getSourceCounts } from '@/lib/repo';
import { filtersToQuery, parseFilters } from '@/lib/report';
import LeadsTable from './LeadsTable';

export const dynamic = 'force-dynamic';

const STATUSES = ['received', 'processing', 'written', 'failed', 'dead_letter'];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const [rows, sourceCounts] = await Promise.all([
    getLeadsFiltered({ ...filters, limit: 1000 }),
    getSourceCounts(),
  ]);
  const exportHref = `/api/export${filtersToQuery(filters)}`;

  const field: React.CSSProperties = {
    padding: '7px 9px',
    border: '1px solid var(--line)',
    borderRadius: 6,
    font: 'inherit',
    background: 'var(--white)',
  };

  return (
    <>
      <p style={{ margin: '0 0 8px' }}>
        <Link href="/">← Dashboard</Link>
      </p>
      <h2>Leads &amp; export</h2>

      {/* Filter form (GET → same page with query params) */}
      <form method="GET" action="/leads" className="leads-filter">
        <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: 'var(--muted)' }}>
          Source
          <select name="source" defaultValue={filters.source ?? ''} style={field}>
            <option value="">All sources</option>
            {sourceCounts.map((s) => (
              <option key={s.source} value={s.source}>
                {s.source} ({s.n})
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: 'var(--muted)' }}>
          Status
          <select name="status" defaultValue={filters.status ?? ''} style={field}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: 'var(--muted)' }}>
          Channel
          <input name="channel" defaultValue={filters.channel ?? ''} placeholder="e.g. Google" style={field} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: 'var(--muted)' }}>
          From
          <input type="date" name="from" defaultValue={filters.from ?? ''} style={field} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: 'var(--muted)' }}>
          To
          <input type="date" name="to" defaultValue={filters.to ?? ''} style={field} />
        </label>
        <button type="submit" style={{ ...field, background: 'var(--brand-blue)', color: 'var(--white)', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
          Filter
        </button>
        <Link href="/leads" style={{ ...field, textDecoration: 'none', color: 'var(--muted)' }}>
          Reset
        </Link>
      </form>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span className="note" style={{ color: 'var(--muted)' }}>
          {rows.length} lead{rows.length === 1 ? '' : 's'}
          {rows.length === 1000 ? ' (showing first 1000)' : ''}
        </span>
        <a
          href={exportHref}
          style={{ padding: '8px 14px', background: 'var(--brand-blue)', color: 'var(--white)', borderRadius: 6, textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem' }}
        >
          ⬇ Export CSV
        </a>
      </div>

      {rows.length === 0 ? (
        <p className="note" style={{ color: 'var(--muted)' }}>No leads match these filters.</p>
      ) : (
        <LeadsTable rows={rows} />
      )}
    </>
  );
}
