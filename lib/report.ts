// Reporting helpers: parse filters from URL search params, and render lead rows to CSV.

import type { LeadExportRow, LeadFilters } from './repo';

type SP = Record<string, string | string[] | undefined>;

export function parseFilters(sp: SP): LeadFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const s = (v: string | string[] | undefined) => {
    const x = one(v);
    return x && x.trim() !== '' ? x.trim() : null;
  };
  return {
    source: s(sp.source),
    status: s(sp.status),
    channel: s(sp.channel),
    from: s(sp.from),
    to: s(sp.to),
  };
}

/** Build a URL query string from active filters (for the Export link / form state). */
export function filtersToQuery(f: LeadFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v != null && v !== '' && k !== 'limit') p.set(k, String(v));
  }
  const q = p.toString();
  return q ? `?${q}` : '';
}

export const CSV_COLUMNS: { key: keyof LeadExportRow; label: string }[] = [
  { key: 'received_at', label: 'Received' },
  { key: 'source', label: 'Source' },
  { key: 'channel', label: 'Channel' },
  { key: 'campaign', label: 'Campaign (utm_promo)' },
  { key: 'region', label: 'Region (utm_region)' },
  { key: 'gclid', label: 'gclid' },
  { key: 'fbclid', label: 'fbclid' },
  { key: 'msclkid', label: 'msclkid' },
  { key: 'oppref', label: 'oppref' },
  { key: 'ttclid', label: 'ttclid' },
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'county', label: 'County' },
  { key: 'zip', label: 'Zip' },
  { key: 'product', label: 'Product' },
  { key: 'schedule_appointment', label: 'Schedule Appt' },
  { key: 'appointment_date', label: 'Appt Date' },
  { key: 'appointment_time', label: 'Appt Time' },
  { key: 'status', label: 'Status' },
  { key: 'duplicate_of', label: 'Duplicate Of' },
  { key: 'duplicate_reason', label: 'Duplicate Reason' },
  { key: 'drift_reason', label: 'Drift Reason' },
  { key: 'capture_id', label: 'Capture ID' },
  { key: 'source_message_id', label: 'Source Msg ID' },
];

function esc(v: unknown): string {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: LeadExportRow[]): string {
  const header = CSV_COLUMNS.map((c) => c.label).join(',');
  const lines = rows.map((r) => CSV_COLUMNS.map((c) => esc(r[c.key])).join(','));
  return [header, ...lines].join('\r\n') + '\r\n';
}
