# Lead Data Pipeline — Demo

A production-style **lead ingestion and attribution pipeline** for a home-improvement contractor
(shown here as the fictional *Summit Home Improvement*). It replaces a brittle no-code automation
(Zapier) with a durable, testable service that ingests leads from many sources, normalizes them into
one canonical shape, flags duplicates and data drift, and writes to a CRM — running safely in
**shadow mode** alongside the incumbent until it's proven at parity.

> **Portfolio note.** This is a public demo built from a real system I designed and shipped. The
> client is anonymized and **all data is synthetic** — names, phone numbers (`555-01xx`), emails
> (`@example.com`), vendor names, CRM capture ids and pricing are invented. No real customer,
> employer, or vendor data is present.

---

## What it does

Many lead sources → one durable ledger → normalize → dedupe/drift checks → CRM write (or shadow-log).

```
web form ─┐
vendors  ─┤   POST /api/receivers/<source>      after() fast path ──┐
calls    ─┤ ─────────────────────────────►  raw_leads (ledger)  ───┤─►  normalize → build CRM payload
lead ads ─┘        capture-before-process      (idempotent)         │      → dedupe flag / drift flag
                                               cron drain (backstop)─┘      → shadow-log  OR  live write
```

## Engineering highlights

- **Source-agnostic adapter pattern.** Each source has a small normalizer that maps its raw payload
  into one `CanonicalLead` contract (`lib/normalize/*`). Adding a source is a normalizer + a registry
  entry (`lib/sources.ts`) — nothing else changes. The CRM write is a swappable adapter
  (`lib/adapters/*`), so the canonical model never leaks vendor dialect.
- **Capture-before-process.** The receiver durably stores the raw payload and ACKs *before* doing any
  work; processing happens on Next.js `after()` with a cron drain as a backstop. A killed function or
  a downstream outage never drops a lead.
- **Idempotency end to end.** Inserts dedupe on `(source, source_message_id)` (form submission id,
  vendor lead id, TrustedForm cert, Twilio `CallSid`), so re-delivered webhooks are no-ops; live
  writes never double-POST once a `crm_id` exists.
- **Shadow mode.** The pipeline computes exactly what it *would* write and logs it, without writing —
  so it can run in parallel with the incumbent and be diffed for **parity** before cutover
  (`lib/parity.ts`).
- **Flag, don't drop.** Cross-source duplicates and suspiciously-empty ("drift") leads are flagged
  for review and still flow through — the pipeline never silently discards a lead.
- **Reconciliation backstop.** After each drain, an integrity check surfaces any gap as a visible
  number rather than a silent miss (`lib/reconcile.ts`).
- **Attribution.** Click-ids (`gclid`, `fbclid`, …) and tracked phone lines (DNI) resolve to channels
  and campaigns via small editable lookup tables.

## Stack

Next.js (App Router) · TypeScript · Neon Postgres (raw parameterized SQL, no ORM) · Vercel
(functions + cron). Tests run on the Node built-in test runner via `tsx`.

## Run it locally

```bash
npm install
cp .env.example .env          # set DATABASE_URL to a Neon connection string
npm run migrate               # create tables
npm run seed                  # attribution config (synthetic)
npm run dev                   # http://localhost:3000
npm run demo-seed             # generate synthetic leads through the live pipeline
```

Then open the **dashboard** (`/`), **`/leads`** (with CSV export) and **`/analytics`**.

- `npm test` — unit tests (normalization, dedupe, phone, parity, validation).
- Full deploy steps (Neon + Vercel) are in [`DEMO-SETUP.md`](DEMO-SETUP.md).

## Notes on the CRM adapter

The example CRM adapter targets a **MarketSharp-style** REST "submit lead" API (a real, widely-used
home-improvement CRM). It demonstrates translating the canonical model into a vendor dialect; in this
demo it runs in shadow mode by default, so no external calls are made and no credentials are needed.
