// Parity harness — the "do we match Zapier, field-for-field?" proof that unlocks cutover. During the
// parallel run, every lead is written by BOTH Zapier (real) and us (shadow `would_write`). This compares
// the two so we can show a hard "N/N leads match" number per source before flipping a source live.
//
// The comparison engine is here + tested now. The remaining piece is the SOURCE of "theirs": either the
// MarketSharp record for the lead (via the REST read API — needs provisioned creds, see marketsharp-api
// memory) or an export of Zapier's writes. Feed matched pairs into summarizeParity() once that lands.

export interface FieldDiff { field: string; ours: string; theirs: string; }
export interface ParityResult { key: string; match: boolean; diffs: FieldDiff[]; }

// Exact string compare (null → ""). Deliberately does NOT trim — parity must catch byte-level diffs like
// the MSM_interests trailing-whitespace case the design flags for convergence before cutover.
const norm = (v: unknown): string => (v == null ? '' : String(v));

/** Field-by-field diff of two CRM payloads. `ignore` skips fields not expected to match (e.g. crmId). */
export function diffPayloads(
  ours: Record<string, unknown>,
  theirs: Record<string, unknown>,
  opts: { ignore?: string[]; key?: string } = {},
): ParityResult {
  const ignore = new Set(opts.ignore ?? []);
  const fields = [...new Set([...Object.keys(ours), ...Object.keys(theirs)])].filter((f) => !ignore.has(f));
  const diffs: FieldDiff[] = [];
  for (const f of fields.sort()) {
    const a = norm(ours[f]);
    const b = norm(theirs[f]);
    if (a !== b) diffs.push({ field: f, ours: a, theirs: b });
  }
  return { key: opts.key ?? '', match: diffs.length === 0, diffs };
}

export interface ParitySummary {
  total: number;
  matched: number;
  mismatched: number;
  matchRate: number; // 0..1
  /** How often each field diverged, worst first — tells us exactly what to fix before cutover. */
  diffsByField: { field: string; count: number }[];
  mismatches: ParityResult[]; // the offending pairs, for review
}

/** Roll a batch of pairs into the go/no-go number + the field-level breakdown. */
export function summarizeParity(
  pairs: { key: string; ours: Record<string, unknown>; theirs: Record<string, unknown> }[],
  opts: { ignore?: string[] } = {},
): ParitySummary {
  const results = pairs.map((p) => diffPayloads(p.ours, p.theirs, { ignore: opts.ignore, key: p.key }));
  const mismatches = results.filter((r) => !r.match);
  const fieldCounts = new Map<string, number>();
  for (const r of mismatches) for (const d of r.diffs) fieldCounts.set(d.field, (fieldCounts.get(d.field) ?? 0) + 1);
  const total = results.length;
  const matched = total - mismatches.length;
  return {
    total,
    matched,
    mismatched: mismatches.length,
    matchRate: total ? matched / total : 1,
    diffsByField: [...fieldCounts.entries()].sort((a, b) => b[1] - a[1]).map(([field, count]) => ({ field, count })),
    mismatches,
  };
}
