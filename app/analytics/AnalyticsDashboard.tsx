'use client';

// Analytics dashboard view. The server (getAnalytics) does the aggregation; this renders it as
// hand-rolled SVG (no chart lib — dependency-light thesis). Range/source/channel/state filters navigate
// (server re-queries); granularity (day/week) + hover are client-only. Charts mirror the approved mock.

import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { AnalyticsData, CampaignRow, DailyPoint, DuplicateRow } from '@/lib/analytics';

const SRC_COLOR: Record<string, string> = { Phone: 'var(--c-blue)', Website: 'var(--c-amber)', Vendors: 'var(--c-teal)', Social: 'var(--c-violet)' };
const CH_COLOR: Record<string, string> = {
  Google: '#2563eb', LSA: '#d97706', Organic: '#0284c7', Vendors: '#15803d', Facebook: '#7c3aed', Bing: '#0d9488',
  TikTok: '#64748b', OpenAI: '#0d9488', TV: '#7c3aed', 'Phone (other)': '#64748b', Other: '#94a3b8', Unknown: '#94a3b8',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };

function toWeekly(daily: DailyPoint[]): DailyPoint[] {
  const out: DailyPoint[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    const wk = daily.slice(i, i + 7); if (!wk.length) continue;
    const a: DailyPoint = { date: wk[0].date, Phone: 0, Website: 0, Vendors: 0, Social: 0, total: 0 };
    wk.forEach((d) => { a.Phone += d.Phone; a.Website += d.Website; a.Vendors += d.Vendors; a.Social += d.Social; a.total += d.total; });
    out.push(a);
  }
  return out;
}

export default function AnalyticsDashboard({ data }: { data: AnalyticsData }) {
  const router = useRouter();
  const params = useSearchParams();
  const [gran, setGran] = useState<'day' | 'week'>('day');
  const [hover, setHover] = useState<number | null>(null);

  const f = data.filters;
  function nav(patch: Record<string, string | null>) {
    const q = new URLSearchParams(params?.toString());
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') q.delete(k); else q.set(k, v); }
    router.push(`/analytics?${q.toString()}`);
  }

  const series = useMemo(() => (gran === 'week' ? toWeekly(data.daily) : data.daily), [gran, data.daily]);
  const keys = data.sourceKeys.length ? data.sourceKeys : (['Phone'] as const);

  const rangeLabel = f.days ? `Last ${f.days} days` : 'All time';
  const cmp = data.comparison;
  const prevNote = f.days ? `vs prev ${f.days}d` : 'vs prev period';

  return (
    <>
      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', margin: '4px 0 20px' }}>
        <div className="a-seg" role="group" aria-label="Date range">
          {[7, 30, 90, 0].map((d) => (
            <button key={d} type="button" aria-pressed={(f.days ?? 0) === d} onClick={() => nav({ days: d ? String(d) : '0' })}>
              {d ? `${d}d` : 'All'}
            </button>
          ))}
        </div>
        <div className="a-sel">
          <select aria-label="Source" value={f.source ?? ''} onChange={(e) => nav({ source: e.target.value || null })}>
            <option value="">All sources</option>
            <option value="phone">Phone</option>
            <option value="web-form">Website</option>
            <option value="vendor">Vendors</option>
            <option value="social">Social lead ads</option>
          </select>
        </div>
        <div className="a-sel">
          <select aria-label="Channel" value={f.channel ?? ''} onChange={(e) => nav({ channel: e.target.value || null })}>
            <option value="">All channels</option>
            {data.channelOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="a-sel">
          <select aria-label="State" value={f.state ?? ''} onChange={(e) => nav({ state: e.target.value || null })}>
            <option value="">FL + AL + all</option>
            <option value="Florida">Florida</option>
            <option value="Alabama">Alabama</option>
          </select>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{rangeLabel} · {data.count.toLocaleString()} leads</span>
      </div>

      {/* KPIs — deltas are vs the immediately-preceding same-length window (null until prior data exists) */}
      <div className="a-kpis">
        <Kpi lab="Total leads" big={data.kpis.total.toLocaleString()} sub={`over ${rangeLabel.toLowerCase()}`}
          trend={cmp?.totalDeltaPct ?? null} trendNote={prevNote} spark={series.map((d) => d.total)} />
        <Kpi lab="Avg / day" big={String(data.kpis.avgPerDay)} sub="leads per day"
          trend={cmp?.avgDeltaPct ?? null} trendNote={prevNote} spark={data.daily.map((d) => d.total)} />
        <Kpi lab="Phone share" big={`${data.kpis.phoneSharePct}%`} sub="of all leads"
          trend={cmp?.phoneShareDeltaPts ?? null} trendUnit=" pts" trendNote={prevNote} spark={data.daily.map((d) => d.Phone)} />
        <Kpi lab="Top channel" big={data.kpis.topChannel} sub={`${data.kpis.topChannelPct}% of leads`} spark={data.daily.map((d) => d.total)} />
      </div>

      {/* Leads over time */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div><div className="a-eyebrow">Volume over time</div><h2 style={{ fontSize: '1.08rem' }}>Leads by source</h2></div>
          <div className="a-seg" role="group" aria-label="Granularity">
            <button type="button" aria-pressed={gran === 'day'} onClick={() => setGran('day')}>Daily</button>
            <button type="button" aria-pressed={gran === 'week'} onClick={() => setGran('week')}>Weekly</button>
          </div>
        </div>
        <AreaChart series={series} keys={keys as string[]} gran={gran} hover={hover} setHover={setHover}
          prior={gran === 'day' ? cmp?.previousDaily : undefined} />
        <div className="a-legend" style={{ marginTop: 10 }}>
          {keys.map((k) => (
            <span className="it" key={k}><span className="sw" style={{ background: SRC_COLOR[k] }} />{k}
              <span className="v">{series.reduce((a, d) => a + (d[k as keyof DailyPoint] as number), 0).toLocaleString()}</span></span>
          ))}
          {gran === 'day' && cmp?.previousDaily?.some((v) => v > 0) && (
            <span className="it"><span style={{ width: 16, borderTop: '2px dashed var(--muted)', display: 'inline-block' }} />previous period</span>
          )}
        </div>
      </div>

      <div className="a-duo">
        <div className="card">
          <div className="a-eyebrow">Where leads come from</div><h3 style={{ fontSize: '.95rem', marginBottom: 12 }}>Top campaigns</h3>
          <HBars rows={data.campaigns} labW={184} empty="No campaign-tagged leads in range" />
        </div>
        <div className="card">
          <div className="a-eyebrow">Marketing channel</div><h3 style={{ fontSize: '.95rem', marginBottom: 12 }}>Channel mix</h3>
          <Donut data={data.channelMix} total={data.count} />
        </div>
      </div>

      <div className="a-duo">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div><div className="a-eyebrow">Service area</div><h3 style={{ fontSize: '.95rem', marginBottom: 12 }}>Leads by city</h3></div>
            <span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{stateNote(data.stateSplit)}</span>
          </div>
          <HBars rows={data.cities} labW={120} empty="No city data in range" />
        </div>
        <div className="card">
          <div className="a-eyebrow">What they want</div><h3 style={{ fontSize: '.95rem', marginBottom: 12 }}>Product interest</h3>
          <HBars rows={data.products} labW={120} empty="No product-tagged leads yet (web/vendor only)" />
        </div>
      </div>

      {/* Per-campaign performance — the PPC detail view (sortable) */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="a-eyebrow">Campaign performance</div>
        <h3 style={{ fontSize: '.95rem', marginBottom: 12 }}>Leads by campaign</h3>
        <CampaignTable rows={data.campaignTable} />
      </div>

      {/* Flagged duplicates — flag-don't-drop, surfaced for review */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <div className="a-eyebrow">Data quality</div>
            <h3 style={{ fontSize: '.95rem', marginBottom: 12 }}>Flagged duplicates</h3>
          </div>
          <span style={{ fontSize: '.74rem', color: data.duplicates.total ? 'var(--warn)' : 'var(--muted)' }}>
            {data.duplicates.total} flagged{data.duplicates.total > data.duplicates.rows.length ? ` · showing ${data.duplicates.rows.length}` : ''}
          </span>
        </div>
        <DuplicatesPanel rows={data.duplicates.rows} />
      </div>
    </>
  );
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function CampaignTable({ rows }: { rows: CampaignRow[] }) {
  const [sortKey, setSortKey] = useState<'name' | 'channel' | 'source' | 'n' | 'lastAt'>('n');
  const [dir, setDir] = useState<1 | -1>(-1);
  if (!rows.length) return <div className="a-empty">No campaign-tagged leads in range</div>;
  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey] ?? '', bv = b[sortKey] ?? '';
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
  const th = (key: typeof sortKey, label: string, right = false) => (
    <th
      onClick={() => { if (sortKey === key) setDir((d) => (d === 1 ? -1 : 1)); else { setSortKey(key); setDir(key === 'name' || key === 'channel' || key === 'source' ? 1 : -1); } }}
      style={{ padding: '7px 10px', whiteSpace: 'nowrap', cursor: 'pointer', textAlign: right ? 'right' : 'left', userSelect: 'none' }}
    >
      {label}{sortKey === key ? (dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--muted)', borderBottom: '2px solid var(--line)' }}>
            {th('name', 'Campaign')}{th('channel', 'Channel')}{th('source', 'Source')}{th('n', 'Leads', true)}
            <th style={{ padding: '7px 10px', textAlign: 'right' }}>% of total</th>{th('lastAt', 'Last lead', true)}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.name} style={{ borderBottom: '1px solid var(--line)' }}>
              <td style={{ padding: '7px 10px' }}>{r.name}</td>
              <td style={{ padding: '7px 10px' }}>{r.channel}</td>
              <td style={{ padding: '7px 10px' }}>{r.source}</td>
              <td style={{ padding: '7px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.n.toLocaleString()}</td>
              <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{r.pct}%</td>
              <td style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--muted)' }}>{r.lastAt ? fmtWhen(r.lastAt) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DuplicatesPanel({ rows }: { rows: DuplicateRow[] }) {
  if (!rows.length) return <div className="a-empty">No duplicates flagged in range — clean.</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--muted)', borderBottom: '2px solid var(--line)' }}>
            {['Source', 'Contact', 'Matched on', 'When'].map((h) => (
              <th key={h} style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
              <td style={{ padding: '7px 10px' }}>{r.source}</td>
              <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{r.phone ?? r.email ?? '—'}</td>
              <td style={{ padding: '7px 10px' }}><span style={{ color: 'var(--warn)' }}>⚠ {r.reason}</span></td>
              <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtWhen(r.receivedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function stateNote(split: { name: string; pct: number }[]): string {
  const fl = split.find((s) => s.name === 'Florida')?.pct ?? 0;
  const al = split.find((s) => s.name === 'Alabama')?.pct ?? 0;
  const other = 100 - fl - al;
  return `FL ${fl}% · AL ${al}%${other > 0 ? ` · other ${other}%` : ''}`;
}

function Kpi({ lab, big, sub, trend, trendUnit = '%', trendNote = 'vs prev period', spark }: {
  lab: string; big: string; sub?: string; trend?: number | null; trendUnit?: string; trendNote?: string; spark: number[];
}) {
  return (
    <div className="card a-kpi">
      <div className="lab">{lab}</div>
      <div className="big">{big}</div>
      <div className="sub">
        {trend != null
          ? <><span className={`a-trend ${trend >= 0 ? 'up' : 'down'}`}>{trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}{trendUnit}</span> {trendNote}</>
          : sub}
      </div>
      <Spark vals={spark} />
    </div>
  );
}

function Spark({ vals }: { vals: number[] }) {
  const w = 150, h = 34, pad = 2;
  if (!vals.length) return <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 34, marginTop: 10 }} />;
  const mx = Math.max(...vals, 1), mn = Math.min(...vals);
  const X = (i: number) => pad + (vals.length === 1 ? w / 2 : i * (w - 2 * pad) / (vals.length - 1));
  const Y = (v: number) => h - pad - (v - mn) / ((mx - mn) || 1) * (h - 2 * pad);
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${X(vals.length - 1).toFixed(1)} ${h} L${X(0).toFixed(1)} ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 34, marginTop: 10, display: 'block' }}>
      <defs><linearGradient id="asg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--c-blue)" stopOpacity=".26" /><stop offset="1" stopColor="var(--c-blue)" stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill="url(#asg)" /><path d={line} fill="none" stroke="var(--c-blue)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={X(vals.length - 1)} cy={Y(vals[vals.length - 1])} r="3.2" fill="var(--c-blue)" />
    </svg>
  );
}

function AreaChart({ series, keys, gran, hover, setHover, prior }: { series: DailyPoint[]; keys: string[]; gran: string; hover: number | null; setHover: (i: number | null) => void; prior?: number[] }) {
  const W = 960, H = 300, m = { t: 14, r: 14, b: 26, l: 38 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const showPrior = Array.isArray(prior) && prior.length === series.length && prior.some((v) => v > 0);
  const maxTot = Math.max(...series.map((d) => d.total), ...(showPrior ? prior! : []), 1);
  const q = gran === 'week' ? 50 : 10;
  const yMax = Math.max(q, Math.ceil(maxTot / q) * q);
  const n = series.length;
  const X = (i: number) => m.l + (n <= 1 ? iw / 2 : i * iw / (n - 1));
  const Y = (v: number) => m.t + ih - (v / yMax) * ih;

  const ticks = 4;
  const grid = Array.from({ length: ticks + 1 }, (_, t) => { const val = Math.round(yMax * t / ticks); return { val, y: Y(val) }; });

  // stacked layers
  const cum = series.map(() => 0);
  const layers = keys.map((k) => {
    const top = series.map((d, i) => { cum[i] += (d[k as keyof DailyPoint] as number); return cum[i]; });
    const bot = series.map((_, i) => cum[i] - (series[i][k as keyof DailyPoint] as number));
    const up = top.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
    const down = bot.map((_, i) => `L${X(n - 1 - i).toFixed(1)} ${Y(bot[n - 1 - i]).toFixed(1)}`).join(' ');
    return { k, d: `${up} ${down} Z` };
  });

  // faint dashed line of the previous period's daily totals (aligned by day-index)
  const priorPath = showPrior ? prior!.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ') : null;

  const step = Math.max(1, Math.round(n / 6));
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement!; const r = svg.getBoundingClientRect();
    const sx = (e.clientX - r.left) / r.width * W;
    let i = Math.round((sx - m.l) / (iw / ((n - 1) || 1)));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const hv = hover != null && hover < n ? series[hover] : null;

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Leads over time by source">
        {grid.map((g) => (<g key={g.val}><line className="a-gridline" x1={m.l} y1={g.y} x2={W - m.r} y2={g.y} /><text className="a-axis" x={m.l - 8} y={g.y + 3.5} textAnchor="end">{g.val}</text></g>))}
        {layers.map((l) => <path key={l.k} d={l.d} fill={SRC_COLOR[l.k]} fillOpacity="0.85" stroke="var(--card)" strokeWidth="0.6" />)}
        {priorPath && <path d={priorPath} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.85" />}
        {series.map((d, i) => (i % step === 0 || i === n - 1) ? <text key={i} className="a-axis" x={X(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{fmtD(d.date)}</text> : null)}
        {hv && (<g><line x1={X(hover!)} y1={m.t} x2={X(hover!)} y2={m.t + ih} stroke="var(--brand-blue)" strokeWidth="1" strokeDasharray="3 3" />
          {(() => { let c = 0; return keys.map((k) => { c += (hv[k as keyof DailyPoint] as number); return <circle key={k} cx={X(hover!)} cy={Y(c)} r="3.6" fill={SRC_COLOR[k]} stroke="var(--card)" strokeWidth="1.5" />; }); })()}
        </g>)}
        <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hv && (
        <div className="a-tip" style={{ opacity: 1, left: `min(${(X(hover!) / W * 100).toFixed(1)}%, calc(100% - 170px))`, top: 8 }}>
          <div className="d">{fmtD(hv.date)}{gran === 'week' ? ' · week' : ''}</div>
          {keys.map((k) => (<div className="r" key={k}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="sw" style={{ width: 9, height: 9, borderRadius: 2, background: SRC_COLOR[k], display: 'inline-block' }} />{k}</span><b>{hv[k as keyof DailyPoint] as number}</b></div>))}
          <div className="r" style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 6 }}><span>Total</span><b>{hv.total}</b></div>
        </div>
      )}
    </div>
  );
}

function HBars({ rows, labW, empty }: { rows: { name: string; n: number }[]; labW: number; empty: string }) {
  if (!rows.length) return <div className="a-empty">{empty}</div>;
  const W = 460, rowH = 26, gap = 8, m = { t: 4, r: 52, l: labW };
  const H = m.t + rows.length * (rowH + gap) - gap + 4;
  const iw = W - m.l - m.r;
  const mx = Math.max(...rows.map((r) => r.n), 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Bar chart">
      {rows.map((r, i) => {
        const y = m.t + i * (rowH + gap); const w = Math.max(2, r.n / mx * iw);
        return (<g key={r.name}>
          <text className="a-barlab" x={m.l - 10} y={y + rowH / 2 + 4} textAnchor="end">{r.name}</text>
          <rect x={m.l} y={y} width={w} height={rowH} rx="4" fill="var(--c-blue)" />
          <text className="a-barval" x={m.l + w + 8} y={y + rowH / 2 + 4}>{r.n.toLocaleString()}</text>
        </g>);
      })}
    </svg>
  );
}

function Donut({ data, total }: { data: { name: string; n: number; pct: number }[]; total: number }) {
  if (!total) return <div className="a-empty">No leads in range</div>;
  const cx = 100, cy = 100, R = 82, r = 52; let a = -Math.PI / 2;
  const arcs = data.map((s) => {
    const frac = s.n / total; const a2 = a + frac * Math.PI * 2;
    const x1 = cx + R * Math.cos(a), y1 = cy + R * Math.sin(a), x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
    const xi1 = cx + r * Math.cos(a2), yi1 = cy + r * Math.sin(a2), xi2 = cx + r * Math.cos(a), yi2 = cy + r * Math.sin(a);
    const large = frac > 0.5 ? 1 : 0;
    const d = `M${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L${xi1.toFixed(2)} ${yi1.toFixed(2)} A${r} ${r} 0 ${large} 0 ${xi2.toFixed(2)} ${yi2.toFixed(2)} Z`;
    a = a2; return { d, c: CH_COLOR[s.name] ?? 'var(--c-slate)', name: s.name };
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <svg viewBox="0 0 200 200" style={{ width: 180, height: 180, flex: 'none' }} role="img" aria-label="Channel share">
        {arcs.map((s) => <path key={s.name} d={s.d} fill={s.c} stroke="var(--card)" strokeWidth="2" />)}
        <text x="100" y="94" textAnchor="middle" style={{ fontFamily: 'var(--font-head)', fontSize: 28, fill: 'var(--brand-blue)' }} className="num">{total.toLocaleString()}</text>
        <text x="100" y="114" textAnchor="middle" style={{ fontSize: 10.5, fill: 'var(--muted)', letterSpacing: '.05em' }}>TOTAL LEADS</text>
      </svg>
      <div className="a-legend" style={{ flexDirection: 'column', gap: 9, flex: 1, minWidth: 140 }}>
        {data.map((s) => (<span className="it" key={s.name}><span className="sw" style={{ background: CH_COLOR[s.name] ?? 'var(--c-slate)' }} />{s.name} <span className="v">{s.pct}%</span></span>))}
      </div>
    </div>
  );
}
