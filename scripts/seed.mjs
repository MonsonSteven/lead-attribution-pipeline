// Seed the attribution config tables with the demo's (fictional) reference data.
// Idempotent (upserts). Run after migrate:  DATABASE_URL=... npm run seed
//
//   param_channel_map   — web tracking param -> channel
//   capture_map         — channel -> CRM "capture id" (web + vendors + organic-call)
//   dni_number_map      — dialed tracking number -> {campaign, capture id}
//   consent_versions    — the web SMS-consent wording, v1
//
// NOTE (portfolio demo): all capture ids, vendor names, phone numbers and consent copy below are
// synthetic. This file is fully self-contained — it does not read any external CSV/docs.

import pg from 'pg';

// Load .env (Node doesn't do this automatically for plain scripts, unlike Next for the app).
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env present — fall back to ambient environment */
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✖ DATABASE_URL is not set — see .env.example');
  process.exit(1);
}

// ── param -> channel (web) ──
const PARAM_CHANNEL = [
  ['gclid', 'Google'],
  ['gbraid', 'Google'],
  ['wbraid', 'Google'],
  ['msclkid', 'Bing'],
  ['oppref', 'OpenAI'],
  ['fbclid', 'Facebook'],
  ['ttclid', 'TikTok'],
];

// ── channel -> CRM capture id (web + vendors + organic-call). Synthetic ids for the demo. ──
const CAPTURE_MAP = [
  ['organic-web', 'ac915eb8-2a89-489c-9ede-eb5409938087', 'Web Form'],
  ['Google', 'b58d7a11-13c9-4b2d-9680-32977b554c52', 'PPC Google'],
  ['Bing', '4f47e9f7-40ed-4884-9f91-ad09d569260f', 'PPC Bing'],
  ['OpenAI', 'df585dec-534f-4771-a43b-363e4c2c0354', 'OpenAI Ads'],
  ['Facebook', 'f6c09d17-b941-4264-ad7b-0aa92f90c07f', 'PPC Facebook'],
  ['TikTok', 'f0a5ea38-b709-4b75-8ca7-5280055b42e8', 'PPC TikTok'],
  ['YouTube', '0054ee27-a434-4f81-b1a5-c62bd80c3363', 'PPC YouTube'],
  ['vendor:leadbridge', 'b9ece286-5ebe-460c-8830-a6b6a2b5fff1', 'LeadBridge'],
  ['vendor:homequote', 'b68be2ee-6101-45c7-a323-762d0c331a24', 'HomeQuote Network'],
  ['vendor:renovatepros', '84a93044-4e2a-4a74-b02c-95481898766b', 'RenovatePros'],
  ['organic-call', '5d0fd93c-62d6-4ce0-b55b-4e48dda291a6', 'Website/Internet - Phone Calls'],
];

// ── consent v1 (web SMS checkbox) — synthetic generic TCPA-style wording ──
const CONSENT_V1 =
  'By checking this box, I agree to receive marketing and appointment text messages from ' +
  'Summit Home Improvement at the number provided. Consent is not a condition of purchase. ' +
  'Message and data rates may apply. Reply STOP to opt out.';

// ── dni_number_map — synthetic tracked lines -> {campaign, capture id}. ──
// Dialed numbers are the attribution key for inbound calls (a tracked line -> a campaign).
const DNI = [
  // dialed number (national digits), campaign, capture-id (matches a CAPTURE_MAP entry)
  ['5551230101', 'GoogleDisplay_North', 'b58d7a11-13c9-4b2d-9680-32977b554c52'],
  ['5551230102', 'LocalServices_North', 'b58d7a11-13c9-4b2d-9680-32977b554c52'],
  ['5551230103', 'FacebookBaths_Metro', 'f6c09d17-b941-4264-ad7b-0aa92f90c07f'],
  ['5551230104', 'BingWindows_Metro', '4f47e9f7-40ed-4884-9f91-ad09d569260f'],
  ['5551230105', 'YouTubeBrand', '0054ee27-a434-4f81-b1a5-c62bd80c3363'],
];

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();

  for (const [param, channel] of PARAM_CHANNEL) {
    await client.query(
      `insert into param_channel_map (param, channel) values ($1,$2)
       on conflict (param) do update set channel = excluded.channel`,
      [param, channel],
    );
  }

  for (const [channel, id, label] of CAPTURE_MAP) {
    await client.query(
      `insert into capture_map (channel, capture_id, label) values ($1,$2,$3)
       on conflict (channel) do update set capture_id = excluded.capture_id, label = excluded.label`,
      [channel, id, label],
    );
  }

  for (const [num, campaign, id] of DNI) {
    await client.query(
      `insert into dni_number_map (dialed_number, campaign, capture_id) values ($1,$2,$3)
       on conflict (dialed_number) do update set campaign = excluded.campaign, capture_id = excluded.capture_id`,
      [num, campaign, id],
    );
  }

  await client.query(
    `insert into consent_versions (version, text, effective_from) values ('v1', $1, '2026-01-01')
     on conflict (version) do update set text = excluded.text`,
    [CONSENT_V1],
  );

  console.log(
    `✅ seeded: ${PARAM_CHANNEL.length} params, ${CAPTURE_MAP.length} capture ids, ${DNI.length} DNI lines, consent v1`,
  );
} catch (err) {
  console.error('✖ seed failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
