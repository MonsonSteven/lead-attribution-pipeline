// Analytics aggregations for the /analytics dashboard. One filtered pull of the minimal per-lead fields
// + all shaping in JS — auditable (IT review), dependency-light, and trivial at our volumes (a busy
// month is a few thousand rows; the 20k cap is generous headroom). Everything here reads fields the
// pipeline already captures — no new collection. See the design doc §5.

import { getSql } from './db';

export interface AnalyticsFilters {
  days: number | null; // range window; null = all-time
  source: string | null; // 'phone' | 'web-form' | 'vendor' | 'social' | null
  channel: string | null; // exact canonical channel
  state: string | null; // 'Florida' | 'Alabama' | null
}

export interface DailyPoint { date: string; Phone: number; Website: number; Vendors: number; Social: number; total: number; }
export interface Named { name: string; n: number; pct: number; }

/** Rich per-campaign row for the performance table. */
export interface CampaignRow { name: string; n: number; pct: number; channel: string; source: string; lastAt: string | null; }

/** A flagged likely-duplicate lead (never merged — surfaced for human review). */
export interface DuplicateRow { id: string; source: string; phone: string | null; email: string | null; reason: string; duplicateOf: string; receivedAt: string; }

/** Same-length immediately-preceding window, for period-over-period comparison. Null when range = all-time. */
export interface PeriodComparison {
  previousTotal: number;
  previousDaily: number[]; // aligned by day-index to the current window (for the chart overlay)
  totalDeltaPct: number | null; // current vs previous
  avgDeltaPct: number | null;
  phoneShareDeltaPts: number | null; // percentage-point change
}

export interface AnalyticsData {
  filters: AnalyticsFilters;
  channelOptions: string[];
  count: number;
  windowDays: number;
  kpis: { total: number; avgPerDay: number; phoneSharePct: number; topChannel: string; topChannelPct: number; wowPct: number | null };
  daily: DailyPoint[];
  sourceKeys: (keyof Pick<DailyPoint, 'Phone' | 'Website' | 'Vendors' | 'Social'>)[];
  channelMix: Named[];
  campaigns: Named[];
  campaignTable: CampaignRow[];
  duplicates: { rows: DuplicateRow[]; total: number };
  comparison: PeriodComparison | null;
  cities: Named[];
  stateSplit: Named[];
  products: Named[];
}

interface Row {
  id: string;
  received_at: string; source: string;
  channel: string | null; campaign: string | null; city: string | null; state: string | null; product: string | null;
  phone: string | null; email: string | null; duplicate_of: string | null; duplicate_reason: string | null;
}

const SOURCE_KEYS = ['Phone', 'Website', 'Vendors', 'Social'] as const;

function sourceGroup(s: string): (typeof SOURCE_KEYS)[number] {
  if (s === 'phone') return 'Phone';
  if (s === 'web-form') return 'Website';
  if (s.startsWith('vendor:')) return 'Vendors';
  if (s.endsWith('-lead-ad')) return 'Social';
  return 'Website';
}

function channelBucket(ch: string | null): string {
  if (!ch) return 'Unknown';
  if (ch === 'organic-web' || ch === 'organic-call') return 'Organic';
  if (ch === 'LeadBridge' || ch === 'HomeQuote Network' || ch === 'RenovatePros') return 'Vendors';
  if (ch === 'Phone') return 'Phone (other)';
  return ch; // Google | Bing | Facebook | TikTok | OpenAI | LSA | TV
}

function normState(s: string | null): string | null {
  if (!s) return null;
  const u = s.trim().toLowerCase();
  if (u === 'fl' || u === 'florida') return 'Florida';
  if (u === 'al' || u === 'alabama') return 'Alabama';
  return s.trim();
}

function titleCase(s: string): string {
  return s.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function isoDate(ts: string): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Top-N by count with the remainder folded into "Other" (categorical cap). */
function topN(map: Map<string, number>, n: number, total: number, otherLabel = 'Other'): Named[] {
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, n);
  const tail = sorted.slice(n);
  const rows = head.map(([name, c]) => ({ name, n: c, pct: total ? Math.round((c / total) * 100) : 0 }));
  const rest = tail.reduce((a, [, c]) => a + c, 0);
  if (rest > 0) rows.push({ name: otherLabel, n: rest, pct: total ? Math.round((rest / total) * 100) : 0 });
  return rows;
}

export async function getAnalytics(f: AnalyticsFilters): Promise<AnalyticsData> {
  const sql = getSql();

  const rows = (await sql`
    select id, received_at, source,
           canonical->>'channel'          as channel,
           canonical->>'campaign'         as campaign,
           canonical->>'city'             as city,
           canonical->>'state'            as state,
           canonical->>'productCategory'  as product,
           canonical->>'phone'            as phone,
           canonical->>'email'            as email,
           duplicate_of, duplicate_reason
    from raw_leads
    where (${f.days}::int is null or received_at >= now() - (${f.days} * interval '1 day'))
      and (${f.source}::text is null
           or (${f.source} = 'phone'    and source = 'phone')
           or (${f.source} = 'web-form' and source = 'web-form')
           or (${f.source} = 'vendor'   and source like 'vendor:%')
           or (${f.source} = 'social'   and source like '%-lead-ad'))
      and (${f.channel}::text is null or canonical->>'channel' = ${f.channel})
      and (${f.state}::text is null
           or (${f.state} = 'Florida' and lower(canonical->>'state') in ('fl','florida'))
           or (${f.state} = 'Alabama' and lower(canonical->>'state') in ('al','alabama')))
    order by received_at
    limit 20000
  `) as Row[];

  const channelOpts = (await sql`
    select distinct canonical->>'channel' as c
    from raw_leads
    where coalesce(canonical->>'channel','') <> ''
    order by 1
  `) as { c: string }[];

  const total = rows.length;

  // ── daily series by source group (gap-filled across the window) ──
  const byDate = new Map<string, DailyPoint>();
  for (const r of rows) {
    const d = isoDate(r.received_at);
    let p = byDate.get(d);
    if (!p) { p = { date: d, Phone: 0, Website: 0, Vendors: 0, Social: 0, total: 0 }; byDate.set(d, p); }
    p[sourceGroup(r.source)]++; p.total++;
  }
  // window bounds
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  let start: Date;
  if (f.days) { start = new Date(today); start.setUTCDate(today.getUTCDate() - (f.days - 1)); }
  else {
    const first = rows.length ? isoDate(rows[0].received_at) : today.toISOString().slice(0, 10);
    start = new Date(first + 'T00:00:00Z');
  }
  const daily: DailyPoint[] = [];
  for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    daily.push(byDate.get(key) ?? { date: key, Phone: 0, Website: 0, Vendors: 0, Social: 0, total: 0 });
  }
  const windowDays = daily.length;

  // ── which source layers actually have data (keep the stack clean) ──
  const sourceKeys = SOURCE_KEYS.filter((k) => daily.some((d) => d[k] > 0));

  // ── channel mix (bucketed, top 6 + Other) ──
  const chMap = new Map<string, number>();
  for (const r of rows) { const b = channelBucket(r.channel); chMap.set(b, (chMap.get(b) ?? 0) + 1); }
  const channelMix = topN(chMap, 6, total);

  // ── top campaigns ──
  const campMap = new Map<string, number>();
  for (const r of rows) if (r.campaign && r.campaign.trim()) campMap.set(r.campaign, (campMap.get(r.campaign) ?? 0) + 1);
  const campaigns = [...campMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, n]) => ({ name, n, pct: total ? Math.round((n / total) * 100) : 0 }));

  // ── per-campaign performance table (rich: modal channel/source + last-seen; top 30) ──
  const campAgg = new Map<string, { n: number; lastAt: string; channels: Map<string, number>; sources: Map<string, number> }>();
  for (const r of rows) {
    if (!r.campaign || !r.campaign.trim()) continue;
    let a = campAgg.get(r.campaign);
    if (!a) { a = { n: 0, lastAt: r.received_at, channels: new Map(), sources: new Map() }; campAgg.set(r.campaign, a); }
    a.n++;
    if (r.received_at > a.lastAt) a.lastAt = r.received_at;
    const ch = r.channel ?? 'Unknown';
    a.channels.set(ch, (a.channels.get(ch) ?? 0) + 1);
    const src = sourceGroup(r.source);
    a.sources.set(src, (a.sources.get(src) ?? 0) + 1);
  }
  const modeOf = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '—';
  const campaignTable: CampaignRow[] = [...campAgg.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 30)
    .map(([name, a]) => ({ name, n: a.n, pct: total ? Math.round((a.n / total) * 100) : 0, channel: modeOf(a.channels), source: modeOf(a.sources), lastAt: a.lastAt }));

  // ── flagged duplicates (flag-don't-drop; surfaced for human review) ──
  const dupAll = rows.filter((r) => r.duplicate_of);
  const duplicates = {
    total: dupAll.length,
    rows: dupAll
      .sort((a, b) => (a.received_at < b.received_at ? 1 : -1))
      .slice(0, 25)
      .map((r) => ({
        id: r.id, source: r.source, phone: r.phone, email: r.email,
        reason: r.duplicate_reason ?? '', duplicateOf: r.duplicate_of ?? '', receivedAt: r.received_at,
      })),
  };

  // ── cities (case-normalized) ──
  const cityMap = new Map<string, number>();
  for (const r of rows) if (r.city && r.city.trim()) { const c = titleCase(r.city); cityMap.set(c, (cityMap.get(c) ?? 0) + 1); }
  const cities = [...cityMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, n]) => ({ name, n, pct: total ? Math.round((n / total) * 100) : 0 }));

  // ── state split (FL/AL normalized) ──
  const stMap = new Map<string, number>();
  for (const r of rows) { const s = normState(r.state); if (s) stMap.set(s, (stMap.get(s) ?? 0) + 1); }
  const stateSplit = [...stMap.entries()].sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({ name, n, pct: total ? Math.round((n / total) * 100) : 0 }));

  // ── product interest (productCategory only — phone "product" is a campaign, correctly excluded) ──
  const prodMap = new Map<string, number>();
  for (const r of rows) if (r.product && r.product.trim()) prodMap.set(r.product, (prodMap.get(r.product) ?? 0) + 1);
  const products = [...prodMap.entries()].sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({ name, n, pct: total ? Math.round((n / total) * 100) : 0 }));

  // ── KPIs ──
  const phoneTotal = daily.reduce((a, d) => a + d.Phone, 0);
  const topCh = channelMix.find((c) => c.name !== 'Unknown') ?? channelMix[0];
  const half = Math.floor(daily.length / 2);
  const prior = daily.slice(0, half).reduce((a, d) => a + d.total, 0);
  const recent = daily.slice(half).reduce((a, d) => a + d.total, 0);
  const wowPct = prior > 0 ? Math.round(((recent - prior) / prior) * 100) : null;

  // ── period-over-period comparison (same-length immediately-preceding window) ──
  let comparison: PeriodComparison | null = null;
  if (f.days) {
    const prev = (await sql`
      select received_at, source from raw_leads
      where received_at >= now() - (${2 * f.days} * interval '1 day')
        and received_at <  now() - (${f.days} * interval '1 day')
        and (${f.source}::text is null
             or (${f.source} = 'phone'    and source = 'phone')
             or (${f.source} = 'web-form' and source = 'web-form')
             or (${f.source} = 'vendor'   and source like 'vendor:%')
             or (${f.source} = 'social'   and source like '%-lead-ad'))
        and (${f.channel}::text is null or canonical->>'channel' = ${f.channel})
        and (${f.state}::text is null
             or (${f.state} = 'Florida' and lower(canonical->>'state') in ('fl','florida'))
             or (${f.state} = 'Alabama' and lower(canonical->>'state') in ('al','alabama')))
      order by received_at
    `) as { received_at: string; source: string }[];
    const prevTotal = prev.length;
    const prevPhone = prev.filter((r) => r.source === 'phone').length;
    const prevStart = new Date(start);
    prevStart.setUTCDate(start.getUTCDate() - windowDays);
    const prevByDate = new Map<string, number>();
    for (const r of prev) { const d = isoDate(r.received_at); prevByDate.set(d, (prevByDate.get(d) ?? 0) + 1); }
    const previousDaily: number[] = [];
    for (let i = 0; i < windowDays; i++) {
      const d = new Date(prevStart);
      d.setUTCDate(prevStart.getUTCDate() + i);
      previousDaily.push(prevByDate.get(d.toISOString().slice(0, 10)) ?? 0);
    }
    const curAvg = windowDays ? total / windowDays : 0;
    const prevAvg = windowDays ? prevTotal / windowDays : 0;
    const curPhoneShare = total ? Math.round((phoneTotal / total) * 100) : 0;
    const prevPhoneShare = prevTotal ? Math.round((prevPhone / prevTotal) * 100) : 0;
    comparison = {
      previousTotal: prevTotal,
      previousDaily,
      totalDeltaPct: prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null,
      avgDeltaPct: prevAvg > 0 ? Math.round(((curAvg - prevAvg) / prevAvg) * 100) : null,
      phoneShareDeltaPts: prevTotal > 0 ? curPhoneShare - prevPhoneShare : null,
    };
  }

  return {
    filters: f,
    channelOptions: channelOpts.map((r) => r.c),
    count: total,
    windowDays,
    kpis: {
      total,
      avgPerDay: windowDays ? Math.round((total / windowDays) * 10) / 10 : 0,
      phoneSharePct: total ? Math.round((phoneTotal / total) * 100) : 0,
      topChannel: topCh?.name ?? '—',
      topChannelPct: topCh?.pct ?? 0,
      wowPct,
    },
    daily,
    sourceKeys,
    channelMix,
    campaigns,
    campaignTable,
    duplicates,
    comparison,
    cities,
    stateSplit,
    products,
  };
}
