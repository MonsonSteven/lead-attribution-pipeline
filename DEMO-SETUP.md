# Demo setup — Neon + Vercel

Standing up the public demo on your own personal Neon + Vercel accounts. ~15 minutes.

## 1. Database (Neon)

1. Create a Neon project (free tier is fine). Copy the **pooled** connection string.
2. Locally:
   ```bash
   npm install
   cp .env.example .env
   # paste the Neon string into DATABASE_URL
   npm run migrate     # create tables (db/schema.sql)
   npm run seed        # attribution config (synthetic capture ids, DNI map, consent)
   ```

## 2. Run + populate locally

```bash
npm run dev                       # http://localhost:3000
# in a second terminal:
npm run demo-seed                 # sends ~60 synthetic leads through the live pipeline
```

Open `/` (dashboard), `/leads` (table + CSV export), `/analytics`. Re-run `demo-seed` (optionally
`COUNT=200 npm run demo-seed`) to add more.

## 3. Deploy (Vercel)

1. Push this repo to your personal GitHub, then **Import Project** in Vercel.
2. Project → **Settings → Environment Variables**:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | your Neon pooled string |
   | `PIPELINE_SHADOW_MODE` | `true` (keep the demo in shadow — no external CRM writes) |
   | `RECEIVER_WEBHOOK_SECRET` | optional; a random string if you want to lock the receivers |
   | `CRON_SECRET` | optional; a random string (Vercel Cron will send it) |
   | `DASHBOARD_PASSWORD` | leave **unset** for open access |

3. Deploy. `vercel.json` registers two daily crons (Hobby's max): the drain (reliability backstop;
   real-time processing is on the `after()` path at ingest, not the cron) and **demo-refresh** — a
   demo-only job that re-stamps the synthetic leads to the last 30 days so the analytics graphs stay
   populated no matter how long ago the data was seeded (`scripts/demo-seed.mjs` also calls it once).
4. Seed the deployed DB (run once, locally, pointed at the same Neon DB):
   ```bash
   npm run migrate && npm run seed
   BASE_URL=https://<your-deploy>.vercel.app \
     RECEIVER_WEBHOOK_SECRET=<if you set one> \
     COUNT=150 npm run demo-seed
   ```

## Notes

- **Shadow mode stays on.** The demo never makes real CRM calls; the "write" step is computed and
  logged (`would_write`) so the whole pipeline is visible without any external credentials.
- **Neon free tier** scales compute to zero after ~5 min idle; the daily cron won't hold the DB
  awake. First request after idle has a cold-start delay.
- All seeded data is synthetic — safe to wipe and re-seed anytime.
