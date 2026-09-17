'use client';

// Client-side leads table with show/hide column toggles. The server page fetches + filters the rows;
// this component is a *view* over them — pick which columns to show via a checkbox block, instantly, no
// reload. Selection persists in localStorage so a given user's layout sticks. Columns that are entirely
// empty in the current (already-filtered) result set are marked "(empty)" so it's obvious which are
// worth showing for phone-only vs web-only slices.

import { useEffect, useRef, useState } from 'react';
import type { LeadExportRow } from '@/lib/repo';

type ColKind = 'date' | 'dup' | 'drift' | 'text';
interface ColDef {
  key: keyof LeadExportRow;
  label: string;
  kind?: ColKind;
}

// Full column registry (order = table order). Keys map 1:1 to LeadExportRow.
const COLUMNS: ColDef[] = [
  { key: 'received_at', label: 'Received', kind: 'date' },
  { key: 'source', label: 'Source' },
  { key: 'channel', label: 'Channel' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'region', label: 'Region' },
  { key: 'gclid', label: 'gclid' },
  { key: 'fbclid', label: 'fbclid' },
  { key: 'msclkid', label: 'msclkid' },
  { key: 'oppref', label: 'oppref' },
  { key: 'ttclid', label: 'ttclid' },
  { key: 'first_name', label: 'First' },
  { key: 'last_name', label: 'Last' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'county', label: 'County' },
  { key: 'zip', label: 'Zip' },
  { key: 'product', label: 'Product' },
  { key: 'schedule_appointment', label: 'Sched Appt' },
  { key: 'appointment_date', label: 'Appt Date' },
  { key: 'appointment_time', label: 'Appt Time' },
  { key: 'capture_id', label: 'Capture ID' },
  { key: 'source_message_id', label: 'Source Msg ID' },
  { key: 'duplicate_reason', label: 'Dup', kind: 'dup' },
  { key: 'drift_reason', label: 'Drift', kind: 'drift' },
  { key: 'status', label: 'Status' },
];

// Sensible default: the fields you usually want, matching the previous fixed layout.
const DEFAULT_VISIBLE: (keyof LeadExportRow)[] = [
  'received_at', 'source', 'channel', 'first_name', 'last_name', 'phone', 'email',
  'city', 'state', 'product', 'status', 'duplicate_reason', 'drift_reason',
];

const STORAGE_KEY = 'summit-leads-visible-cols';

function fmt(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(String(ts).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
}

export default function LeadsTable({ rows }: { rows: LeadExportRow[] }) {
  const [visible, setVisible] = useState<Set<string>>(new Set(DEFAULT_VISIBLE as string[]));
  const [hydrated, setHydrated] = useState(false);

  // Load a saved layout after mount (avoids SSR/hydration mismatch).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const keys = JSON.parse(saved) as string[];
        const valid = keys.filter((k) => COLUMNS.some((c) => c.key === k));
        if (valid.length) setVisible(new Set(valid));
      }
    } catch {
      /* ignore malformed storage */
    }
    setHydrated(true);
  }, []);

  function persist(next: Set<string>) {
    setVisible(new Set(next));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      /* storage unavailable — selection still works for this session */
    }
  }

  function toggle(key: string) {
    const next = new Set(visible);
    next.has(key) ? next.delete(key) : next.add(key);
    persist(next);
  }

  // Which columns have any non-empty value in the current (filtered) result set.
  const nonEmpty = new Set(
    COLUMNS.filter((c) => rows.some((r) => r[c.key] != null && String(r[c.key]).trim() !== '')).map((c) => c.key as string),
  );

  const shownCols = COLUMNS.filter((c) => visible.has(c.key as string));

  // Synced top horizontal scrollbar: a matching scroller above the table so users can pan side-to-side
  // without scrolling down to the native bottom bar. Both scroll containers mirror each other's scrollLeft.
  const topRef = useRef<HTMLDivElement>(null);
  const botRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [tableW, setTableW] = useState(0);
  useEffect(() => {
    const t = tableRef.current;
    if (!t) return;
    const measure = () => setTableW(t.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(t);
    return () => ro.disconnect();
  }, []);
  // Column toggles change the table's width without resizing its box — re-measure on that change too.
  useEffect(() => {
    if (tableRef.current) setTableW(tableRef.current.getBoundingClientRect().width);
  }, [shownCols.length, rows.length]);
  const syncFromTop = () => { if (botRef.current && topRef.current) botRef.current.scrollLeft = topRef.current.scrollLeft; };
  const syncFromBottom = () => { if (botRef.current && topRef.current) topRef.current.scrollLeft = botRef.current.scrollLeft; };

  const cell = (c: ColDef, r: LeadExportRow) => {
    const v = r[c.key];
    if (c.kind === 'date') return fmt(v as string | null);
    if (c.kind === 'drift')
      return v ? <span style={{ color: '#b91c1c', fontWeight: 600 }}>⚠ {String(v)}</span> : '—';
    if (c.kind === 'dup')
      return v ? <span style={{ color: 'var(--warn)' }}>⚠ {String(v)}</span> : '—';
    return v != null && String(v).trim() !== '' ? String(v) : '—';
  };

  const chip: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px',
    border: '1px solid var(--line)', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer',
    background: 'var(--white)', userSelect: 'none',
  };

  return (
    <>
      {/* Column picker */}
      <details style={{ margin: '4px 0 16px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--card)' }}>
        <summary style={{ padding: '10px 14px', cursor: 'pointer', fontWeight: 600, color: 'var(--brand-blue)' }}>
          Columns ({shownCols.length}/{COLUMNS.length} shown)
        </summary>
        <div style={{ padding: '4px 14px 14px' }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <button type="button" onClick={() => persist(new Set(COLUMNS.map((c) => c.key as string)))} style={{ ...chip, fontWeight: 600 }}>
              Show all
            </button>
            <button type="button" onClick={() => persist(new Set(DEFAULT_VISIBLE as string[]))} style={{ ...chip, fontWeight: 600 }}>
              Reset to default
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {COLUMNS.map((c) => {
              const empty = !nonEmpty.has(c.key as string);
              const on = visible.has(c.key as string);
              return (
                <label key={c.key as string} style={{ ...chip, opacity: empty ? 0.55 : 1, borderColor: on ? 'var(--brand-blue)' : 'var(--line)' }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(c.key as string)} />
                  {c.label}
                  {empty && <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>(empty)</span>}
                </label>
              );
            })}
          </div>
        </div>
      </details>

      {/* Top scrollbar — mirrors the table's native bottom scrollbar */}
      <div ref={topRef} onScroll={syncFromTop} style={{ overflowX: 'auto', overflowY: 'hidden' }} aria-hidden="true">
        <div style={{ width: tableW, height: 1 }} />
      </div>

      <div ref={botRef} onScroll={syncFromBottom} style={{ overflowX: 'auto' }}>
        <table ref={tableRef} style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--muted)', borderBottom: '2px solid var(--line)' }}>
              {shownCols.map((c) => (
                <th key={c.key as string} style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
                {shownCols.map((c) => (
                  <td key={c.key as string} style={{ padding: '8px 10px', whiteSpace: c.kind === 'date' ? 'nowrap' : undefined }}>
                    {cell(c, r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Suppress the pre-hydration flash of default columns if a saved layout differs. */}
      {!hydrated && null}
    </>
  );
}
