// Canonical Lead — the CRM-agnostic contract every source normalizes into and every consumer reads.
// All MarketSharp dialect (MSM_* keys, Na/na@na.com defaults, the MSM_interests cram, capture ids)
// lives in the adapter, never here. See the design doc §5.

export type LeadSource =
  | 'web-form'
  | 'phone'
  | 'vendor:leadbridge'
  | 'vendor:homequote'
  | 'vendor:renovatepros'
  | 'meta-lead-ad'
  | 'tiktok-lead-ad';

export type LeadStatus =
  | 'received' // durably captured, not yet processed
  | 'processing' // claimed by a worker/drain
  | 'written' // successfully written to the CRM (or shadow-logged)
  | 'failed' // a processing/write attempt failed; will retry
  | 'dead_letter'; // exhausted retries — held + alerting, never discarded

// The six-option product taxonomy the website form is constrained to. Used as the best-effort
// `productCategory` bucket for cross-source analytics; vendors pass their raw label through instead.
export const PRODUCT_CATEGORIES = [
  'Windows',
  'Doors',
  'Bath',
  'Patio Products',
  'Siding',
  'More Products',
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

// the company's service area — the only valid states. Out-of-area is flagged, never dropped.
export const SERVICE_STATES = ['Florida', 'Alabama'] as const;
export type ServiceState = (typeof SERVICE_STATES)[number];

// The website appointment-time dropdown (web form only).
export const APPOINTMENT_TIMES = ['09:00AM', '01:00PM', '05:00PM'] as const;

export interface ClickIds {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  oppref?: string;
  fbclid?: string;
  msclkid?: string;
  ttclid?: string;
}

export interface CanonicalLead {
  // ── identity / contact ──
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null; // E.164, normalized at canonical time
  email?: string | null;

  // ── address ──
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  county?: string | null; // opportunistic (web address-block quirk); never mapped to `state`
  country?: string | null;

  // ── lead content ──
  productInterest?: string | null; // the string written to MS Notes (web enum | vendor raw | campaign)
  productCategory?: ProductCategory | null; // best-effort bucket; null when unmapped (never blocks)
  message?: string | null;
  scheduleAppointment?: boolean | null;
  appointmentDate?: string | null;
  appointmentTime?: string | null;

  // ── consent (TCPA) ──
  consentGiven?: boolean | null;
  consentVersion?: string | null; // web: which checkbox wording (see consent_versions)
  consentCertUrl?: string | null; // vendor: TrustedForm/Jornaya cert (e.g. HomeQuote Network)
  consentAt?: string | null;

  // ── attribution / provenance ──
  source: LeadSource;
  channel?: string | null; // organic-web | Google | Bing | ... | organic-call | <vendor>
  campaign?: string | null;
  region?: string | null;
  clickIds?: ClickIds | null;
  dialedNumber?: string | null; // calls only — the tracked line (attribution key)
  rawAttribution?: Record<string, unknown> | null; // full param/code bag, nothing discarded
  provenance?: Record<string, unknown> | null; // ip, browser, device, source_url, sub-source codes...
}

// A row of the ledger/inbox/queue (`raw_leads`).
export interface RawLeadRow {
  id: string;
  source: LeadSource;
  source_message_id: string | null;
  raw_payload: Record<string, unknown>;
  canonical: CanonicalLead | null;
  would_write: Record<string, unknown> | null; // shadow mode: the MS payload we WOULD send
  status: LeadStatus;
  attempts: number;
  next_attempt_at: string;
  processing_started_at: string | null;
  crm_id: string | null;
  dead_letter_reason: string | null;
  instacall_fired: boolean;
  shadow: boolean;
  duplicate_of: string | null; // flagged likely-dup of an earlier lead (never merged/dropped)
  duplicate_reason: string | null; // 'phone' | 'email' | 'phone,email'
  received_at: string;
  updated_at: string;
}
