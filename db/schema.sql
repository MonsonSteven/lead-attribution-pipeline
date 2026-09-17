-- Summit Lead Pipeline — database schema (raw SQL, no ORM).
-- Idempotent: safe to re-run. Applied by `npm run migrate`.
-- See README.md for architecture notes.

create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────
-- raw_leads — the ledger + inbox + queue, all in one table.
-- Capture-before-process: a receiver writes a row here and ACKs before anything else runs, so once a
-- lead is on disk it cannot be lost. Everything downstream works off this durable record.
-- ─────────────────────────────────────────────────────────────
create table if not exists raw_leads (
  id                    uuid primary key default gen_random_uuid(),  -- internal id / idempotency key
  source                text        not null,                        -- web-form | phone | vendor:* | *-lead-ad
  source_message_id     text,                                        -- source-native dedupe key (FF submission id, TrustedForm URL, vendor Lead ID, Twilio CallSid)
  raw_payload           jsonb       not null,                        -- untouched inbound, kept forever
  canonical             jsonb,                                       -- normalized CanonicalLead (after processing)
  would_write           jsonb,                                       -- shadow mode: the MS payload we WOULD send
  status                text        not null default 'received',     -- received|processing|written|failed|dead_letter
  attempts              int         not null default 0,
  next_attempt_at       timestamptz not null default now(),          -- exponential backoff target
  processing_started_at timestamptz,                                 -- for the stuck-row sweeper (visibility timeout)
  crm_id                text,                                        -- set after a live CRM write
  dead_letter_reason    text,
  instacall_fired       boolean     not null default false,          -- idempotency for speed-to-lead
  shadow                boolean     not null default true,           -- during migration: normalize + log, don't write
  received_at           timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Dedupe / idempotency: at most one row per (source, source_message_id) when the source gives us an id.
create unique index if not exists raw_leads_source_msg_uniq
  on raw_leads (source, source_message_id)
  where source_message_id is not null;

-- Drain query: claim pending / retry-due rows, oldest first (used with FOR UPDATE SKIP LOCKED).
create index if not exists raw_leads_queue_idx
  on raw_leads (status, next_attempt_at);

-- Reconciliation / dashboard: per-source over time.
create index if not exists raw_leads_source_idx
  on raw_leads (source, received_at);

-- Cross-source dedupe (flag-don't-drop): a lead flagged as a likely dup of an earlier one keeps
-- flowing (never merged/dropped); these just record the match for review.
alter table raw_leads add column if not exists duplicate_of     uuid;
alter table raw_leads add column if not exists duplicate_reason  text;  -- 'phone' | 'email' | 'phone,email'

-- Drift alerting (flag-don't-drop): a lead that normalized to suspiciously-empty (no phone AND no
-- email, or a name-bearing source with no name) — the fingerprint of a renamed/mis-parsed source field
-- silently producing nulls (e.g. the malformed-JSON call that landed phone-less). Flagged for review;
-- still flows. null = clean.
alter table raw_leads add column if not exists drift_reason text;  -- 'no-contact' | 'no-name' | comma-joined

-- Functional indexes to make the phone/email match fast.
create index if not exists raw_leads_phone_idx on raw_leads ((canonical->>'phone'));
create index if not exists raw_leads_email_idx on raw_leads ((lower(canonical->>'email')));

-- Login brute-force throttle: one row per FAILED dashboard-login attempt, keyed by client IP. We
-- throttle the attacker (IP), never the shared password — a correct login clears the IP's rows, so
-- legitimate users (each on their own IP, entering the right password) are never locked out. Windowed
-- count per IP gates further attempts; rows self-prune after a day. See app/login/page.tsx.
create table if not exists login_failures (
  id bigserial primary key,
  ip text        not null,
  at timestamptz not null default now()
);
create index if not exists login_failures_ip_at_idx on login_failures (ip, at);

-- ─────────────────────────────────────────────────────────────
-- Attribution config (ports from the Zapier lookups). Small, editable.
-- ─────────────────────────────────────────────────────────────

-- Web: tracking param -> resolved channel. No param -> organic-web (handled in code).
create table if not exists param_channel_map (
  param   text primary key,   -- gclid, msclkid, oppref, fbclid, ttclid, gbraid, wbraid
  channel text not null        -- Google, Bing, OpenAI, Facebook, TikTok, ...
);

-- Phone: dialed (tracked) number -> {campaign, capture id}. Keyed by number (a campaign label can map
-- to different ids on different lines). Fallback (no match) = organic-call, handled in code.
create table if not exists dni_number_map (
  dialed_number text primary key,  -- national, no symbols
  campaign      text not null,
  capture_id    text not null
);

-- The CRM adapter's channel -> CRM capture id map (web + vendors + organic-call).
create table if not exists capture_map (
  channel    text primary key,  -- organic-web | Google | ... | vendor:leadbridge | organic-call
  capture_id text not null,     -- CRM capture id (uuid)
  label      text               -- human label from the MS dictionary
);

-- Versioned consent wording (web checkbox). Each web lead records which version it accepted.
create table if not exists consent_versions (
  version        text primary key,
  text           text not null,
  effective_from date not null
);
