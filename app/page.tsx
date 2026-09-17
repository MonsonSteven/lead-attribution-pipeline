// Ops dashboard — live view of raw_leads (counts + recent leads). Queries the DB server-side.

import { getDriftCount, getDuplicateCount, getRecentLeads, getStatusCounts } from '@/lib/repo';
import { getReconciliation, type ReconciliationReport } from '@/lib/reconcile';

export const dynamic = 'force-dynamic'; // always live

function fmtTime(ts: string | Date): string {
  const d = ts instanceof Date ? ts : new Date(String(ts).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
}

export default async function DashboardHome() {
  let recent: Awaited<ReturnType<typeof getRecentLeads>> = [];
  let statusCounts: Record<string, number> = {};
  let recon: ReconciliationReport | null = null;
  let dupCount = 0;
  let driftCount = 0;
  let dbError: string | null = null;

  try {
    [recent, statusCounts, recon, dupCount, driftCount] = await Promise.all([
      getRecentLeads(25),
      getStatusCounts(),
      getReconciliation(null),
      getDuplicateCount(),
      getDriftCount(),
    ]);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const written = statusCounts['written'] ?? 0;
  const failed = statusCounts['failed'] ?? 0;
  const dead = statusCounts['dead_letter'] ?? 0;

  if (dbError) {
    return (
      <>
        <h2>Pipeline status</h2>
        <div className="card" style={{ borderColor: 'var(--warn)' }}>
          <div className="label" style={{ color: 'var(--warn)' }}>Database not reachable</div>
          <div className="note">{dbError}</div>
          <div className="note">Set <code>DATABASE_URL</code> and restart — see DB-SETUP.md.</div>
        </div>
      </>
    );
  }

  return (
    <>
      <p>
        <span className="badge">Shadow mode · live</span>
      </p>

      <h2>Pipeline status</h2>
      <div className="grid">
        <div className="card">
          <div className="label">Total leads</div>
          <div className="value">{total}</div>
          <div className="note">captured in raw_leads</div>
        </div>
        <div className="card">
          <div className="label">Processed</div>
          <div className="value">{written}</div>
          <div className="note">normalized + shadow-composed</div>
        </div>
        <div className="card">
          <div className="label">Failed (retrying)</div>
          <div className="value" style={{ color: failed ? 'var(--warn)' : undefined }}>{failed}</div>
          <div className="note">will retry with backoff</div>
        </div>
        <div className="card">
          <div className="label">Dead-letter</div>
          <div className="value" style={{ color: dead ? 'var(--warn)' : undefined }}>{dead}</div>
          <div className="note">held for replay — never dropped</div>
        </div>
        <div className="card">
          <div className="label">Flagged dups</div>
          <div className="value" style={{ color: dupCount ? 'var(--warn)' : undefined }}>{dupCount}</div>
          <div className="note">likely duplicates — flagged, not merged</div>
        </div>
        <div className="card" style={driftCount ? { borderColor: 'var(--warn)' } : undefined}>
          <div className="label" style={driftCount ? { color: 'var(--warn)' } : undefined}>⚠ Drift</div>
          <div className="value" style={{ color: driftCount ? 'var(--warn)' : undefined }}>{driftCount}</div>
          <div className="note">normalized suspiciously-empty — check the source</div>
        </div>
      </div>

      {recon && recon.sources.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>Reconciliation — did every lead land?</h2>
          <div
            className="card"
            style={{
              borderColor: recon.ok ? 'var(--ok)' : 'var(--warn)',
              background: recon.ok ? undefined : '#fffbeb',
              marginBottom: 14,
            }}
          >
            <div className="label" style={{ color: recon.ok ? 'var(--ok)' : 'var(--warn)' }}>
              {recon.ok ? '✅ All sources reconciled' : `⚠ ${recon.attention.length} item(s) need attention`}
            </div>
            <div className="note">
              {recon.totals.written}/{recon.totals.received} received leads processed
              {recon.totals.stuck ? ` · ${recon.totals.stuck} stuck` : ''}
              {recon.totals.dead_letter ? ` · ${recon.totals.dead_letter} dead-letter` : ''}
              {recon.totals.failed ? ` · ${recon.totals.failed} retrying` : ''}
            </div>
            {!recon.ok && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--warn)', fontSize: '0.85rem' }}>
                {recon.attention.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', borderBottom: '2px solid var(--line)' }}>
                  {['Source', 'Received', 'Processed', 'Retrying', 'Dead-letter', 'Stuck', 'Drift', 'Dups', 'Last lead'].map((h) => (
                    <th key={h} style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recon.sources.map((s) => {
                  const warn = (n: number) => (n ? { color: 'var(--warn)', fontWeight: 600 } : undefined);
                  return (
                    <tr key={s.source} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '7px 10px' }}>
                        {s.reconciled ? '✅' : '⚠'} {s.source}
                      </td>
                      <td style={{ padding: '7px 10px' }}>{s.received}</td>
                      <td style={{ padding: '7px 10px' }}>{s.written}</td>
                      <td style={{ padding: '7px 10px', ...warn(s.failed) }}>{s.failed}</td>
                      <td style={{ padding: '7px 10px', ...warn(s.dead_letter) }}>{s.dead_letter}</td>
                      <td style={{ padding: '7px 10px', ...warn(s.stuck) }}>{s.stuck}</td>
                      <td style={{ padding: '7px 10px', ...warn(s.drift) }}>{s.drift}</td>
                      <td style={{ padding: '7px 10px' }}>{s.duplicates}</td>
                      <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', ...(s.silent ? { color: 'var(--warn)' } : {}) }}>
                        {s.hours_since_last == null ? '—' : s.hours_since_last < 1 ? '<1h ago' : `${s.hours_since_last}h ago`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 style={{ marginTop: 32 }}>
        Recent leads <span style={{ fontSize: '0.8rem', fontWeight: 400, color: 'var(--muted)' }}>· latest 25 · <a href="/leads">see all →</a></span>
      </h2>
      {recent.length === 0 ? (
        <p className="note" style={{ color: 'var(--muted)' }}>
          No leads yet. Point a Fluent Forms webhook at <code>/api/receivers/website</code>.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)', borderBottom: '2px solid var(--line)' }}>
                <th style={{ padding: '8px 10px' }}>Received</th>
                <th style={{ padding: '8px 10px' }}>Source</th>
                <th style={{ padding: '8px 10px' }}>Channel</th>
                <th style={{ padding: '8px 10px' }}>Name</th>
                <th style={{ padding: '8px 10px' }}>Product</th>
                <th style={{ padding: '8px 10px' }}>Status</th>
                <th style={{ padding: '8px 10px' }}>CRM write</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{fmtTime(r.received_at)}</td>
                  <td style={{ padding: '8px 10px' }}>{r.source}</td>
                  <td style={{ padding: '8px 10px' }}>{r.channel ?? '—'}</td>
                  <td style={{ padding: '8px 10px' }}>{[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}</td>
                  <td style={{ padding: '8px 10px' }}>{r.product ?? '—'}</td>
                  <td style={{ padding: '8px 10px' }}>
                    {r.status}
                    {r.duplicate_of && (
                      <span
                        title={`likely duplicate (${r.duplicate_reason}) — flagged, not merged`}
                        style={{ marginLeft: 6, padding: '1px 7px', borderRadius: 999, fontSize: '0.7rem', background: '#fde68a', color: 'var(--warn)' }}
                      >
                        dup
                      </span>
                    )}
                    {r.drift_reason && (
                      <span
                        title={`drift: normalized suspiciously-empty (${r.drift_reason}) — likely a parse/source issue`}
                        style={{ marginLeft: 6, padding: '1px 7px', borderRadius: 999, fontSize: '0.7rem', background: '#fecaca', color: '#b91c1c' }}
                      >
                        drift
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    {r.shadow ? (
                      <span className="badge" title={`would-write capture id: ${r.capture_id ?? 'n/a'}`}>
                        shadow
                      </span>
                    ) : (
                      r.crm_id ?? '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
