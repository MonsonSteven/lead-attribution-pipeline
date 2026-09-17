// Shared normalizer helpers (used by the vendor normalizers).
// ⚠ Vendor payload keys will be finalized against real captured webhooks; the `pick` fallbacks make
// that a localized change. Product labels pass through raw to MS Notes; category is best-effort.

import { PRODUCT_CATEGORIES, type ProductCategory } from '../types';
import { toE164 } from '../phone';

export type AnyObj = Record<string, unknown>;

export function asObj(v: unknown): AnyObj {
  return v && typeof v === 'object' ? (v as AnyObj) : {};
}

export function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** First present value across candidate keys. */
export function pick(obj: AnyObj, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = str(obj[k]);
    if (v != null) return v;
  }
  return null;
}

/** Conservative split of a combined name string: first token / remainder (compound last names intact). */
export function splitName(combined: string | null): { firstName: string | null; lastName: string | null } {
  if (!combined) return { firstName: null, lastName: null };
  const parts = combined.trim().split(/\s+/);
  return { firstName: parts[0] ?? null, lastName: parts.slice(1).join(' ') || null };
}

// Best-effort map of any product phrasing to the canonical 6-enum. Null when unknown (never blocks —
// the raw label always passes through to MS Notes regardless).
const CATEGORY_ALIASES: Record<string, ProductCategory> = {
  window: 'Windows',
  windows: 'Windows',
  door: 'Doors',
  doors: 'Doors',
  bath: 'Bath',
  bathroom: 'Bath',
  'bathroom remodel': 'Bath',
  'bathroom remodeling': 'Bath',
  tub: 'Bath',
  'walk in tub': 'Bath',
  'walk in tubs': 'Bath',
  'walk-in tub': 'Bath',
  'walk in shower': 'Bath',
  'walk-in shower': 'Bath',
  shower: 'Bath',
  patio: 'Patio Products',
  'patio products': 'Patio Products',
  siding: 'Siding',
  'more products': 'More Products',
};

export function toProductCategory(raw: string | null): ProductCategory | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  const exact = PRODUCT_CATEGORIES.find((c) => c.toLowerCase() === key);
  if (exact) return exact;
  return CATEGORY_ALIASES[key] ?? null;
}

export { toE164 };
