// Synthetic lead generator (portfolio demo).
//
// Posts believable, fully-synthetic leads to the REAL receiver endpoints
// (POST /api/receivers/<slug>) so the whole pipeline runs end to end — capture → normalize →
// dedupe → shadow-write — and the dashboard + analytics populate with plausible traffic.
//
// Nothing here is real: names, phones (555-01xx), emails (@example.com), addresses and vendor
// payloads are all invented. A slice of leads deliberately reuses an earlier person on a DIFFERENT
// source so the cross-source dedupe flagging has something to catch.
//
// Usage:
//   BASE_URL=http://localhost:3000 node scripts/demo-seed.mjs            # 60 leads (default)
//   BASE_URL=https://your-demo.vercel.app COUNT=200 \
//     RECEIVER_WEBHOOK_SECRET=... node scripts/demo-seed.mjs
//
// Env:
//   BASE_URL                 target origin (default http://localhost:3000)
//   COUNT                    number of leads to send (default 60)
//   RECEIVER_WEBHOOK_SECRET  sent as x-webhook-secret if the deployment requires it

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const COUNT = Number(process.env.COUNT ?? 240);
const SECRET = process.env.RECEIVER_WEBHOOK_SECRET ?? '';
const CRON_SECRET = process.env.CRON_SECRET ?? '';

const FIRST = ['Alex', 'Jordan', 'Taylor', 'Casey', 'Morgan', 'Riley', 'Jamie', 'Avery', 'Quinn', 'Sky', 'Drew', 'Reese', 'Sam', 'Devon', 'Harper', 'Rowan', 'Blake', 'Emerson', 'Parker', 'Hayden'];
const LAST = ['Rivera', 'Avery', 'Brooks', 'Morgan', 'Bennett', 'Coleman', 'Fisher', 'Grant', 'Hayes', 'Iverson', 'Jennings', 'Klein', 'Lowe', 'Mercer', 'Nolan', 'Osborn', 'Porter', 'Quill', 'Reyes', 'Sutton'];
const STREETS = ['Maple Grove Lane', 'Oak Ridge Road', 'Lakeshore Drive', 'Birch Hollow Way', 'Cedar Point Ct', 'Willow Bend Dr', 'Sunset Ridge Rd', 'Pinecrest Ave', 'Harbor View St', 'Meadowbrook Ln'];
const CITIES = ['Riverton', 'Fairview', 'Lakeside', 'Kendall', 'Brookfield', 'Ashford', 'Westbrook', 'Clearwater Springs', 'Fern Valley', 'Northgate'];
const STATES = ['Florida', 'Alabama', 'Georgia', 'Texas'];
const WEB_PRODUCTS = ['Windows', 'Doors', 'Bath', 'Patio Products', 'Siding', 'More Products'];
const VENDOR_PRODUCTS = ['Bathroom Remodeling', 'Window', 'Roofing', 'Siding', 'Walk-in Tub', 'Kitchen Remodel'];
const CLICK_PARAMS = ['gclid', 'fbclid', 'msclkid', 'ttclid', 'oppref', null, null, null]; // weighted toward organic
const DNI_NUMBERS = ['5551230101', '5551230102', '5551230103', '5551230104', '5551230105'];
const APPT_TIMES = ['09:00AM', '01:00PM', '05:00PM'];

// Source mix (weights): web is the biggest, then vendors, then calls.
const SOURCE_MIX = [
  ['website', 5],
  ['leadbridge', 2],
  ['homequote', 2],
  ['renovatepros', 2],
  ['twilio-call', 3],
];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const digits4 = () => String(1000 + Math.floor(Math.random() * 9000));
const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
// Synthetic caller/contact numbers stay in the 555-01xx fiction range.
// Valid 10-digit fiction number: 555 + 7 digits (the 555 area keeps it clearly fake).
const fakePhone = () => `555${String(1000000 + Math.floor(Math.random() * 8999999))}`;

function weightedSource() {
  const total = SOURCE_MIX.reduce((n, [, w]) => n + w, 0);
  let r = Math.random() * total;
  for (const [slug, w] of SOURCE_MIX) {
    if ((r -= w) <= 0) return slug;
  }
  return 'website';
}

function newPerson() {
  const first = rand(FIRST);
  const last = rand(LAST);
  return {
    first,
    last,
    phone: fakePhone(),
    email: `${first}.${last}${digits4()}@example.com`.toLowerCase(),
    street: `${100 + Math.floor(Math.random() * 900)} ${rand(STREETS)}`,
    city: rand(CITIES),
    state: rand(STATES),
    zip: String(30000 + Math.floor(Math.random() * 9999)),
  };
}

function buildPayload(slug, p) {
  switch (slug) {
    case 'website': {
      const param = rand(CLICK_PARAMS);
      const schedule = Math.random() < 0.5;
      return {
        names: { first_name: p.first, last_name: p.last },
        phone: p.phone,
        email: p.email,
        address_1: { address_line_1: p.street, city: p.city, state: 'Kendall', zip: p.zip, country: 'US' },
        state: p.state,
        dropdown: rand(WEB_PRODUCTS),
        schedule_appointment: schedule ? 'yes' : 'no',
        appointment_date: schedule ? '2026-02-14' : '',
        appointment_time: schedule ? rand(APPT_TIMES) : '',
        'terms-n-condition': Math.random() < 0.85 ? 'accepted' : '',
        ...(param ? { [param]: uid() } : {}),
        __submission: { id: uid(), form_id: '1', created_at: new Date().toISOString() },
      };
    }
    case 'leadbridge':
      return {
        First: p.first, Last: p.last, Phone: p.phone, Email: p.email,
        Address: p.street, City: p.city.toUpperCase(), State: 'FL', 'Zip Code': p.zip,
        'Product of Interest': rand(WEB_PRODUCTS), 'External Lead ID': digits4() + digits4(),
      };
    case 'homequote':
      return {
        Name: `${p.first.toUpperCase()} ${p.last.toUpperCase()}`, Phone: p.phone, Email: p.email,
        Address: p.street, City: p.city, State: 'FL', Zip: p.zip,
        Product: rand(VENDOR_PRODUCTS), 'Trusted Form': `https://cert.trustedform.com/${uid().replace(/-/g, '')}`,
      };
    case 'renovatepros':
      return {
        First: p.first, Last: p.last, Email: p.email, Phone: p.phone,
        Street: `${p.street}, ${p.city}`, City: p.city.toUpperCase(), State: 'FL', Zip: p.zip,
        Vertical: rand(VENDOR_PRODUCTS), 'Lead ID': digits4() + digits4(),
        Source: `DEMO-${digits4()}`, Campaign: digits4(),
      };
    case 'twilio-call': {
      const tracked = Math.random() < 0.6;
      return {
        From: `+1${p.phone}`,
        To: `+1${tracked ? rand(DNI_NUMBERS) : fakePhone()}`,
        City: p.city, State: 'FL', CallSid: `CA${uid().replace(/-/g, '')}`,
      };
    }
    default:
      throw new Error(`unknown slug ${slug}`);
  }
}

async function post(slug, payload) {
  const headers = { 'content-type': 'application/json' };
  if (SECRET) headers['x-webhook-secret'] = SECRET;
  const res = await fetch(`${BASE_URL}/api/receivers/${slug}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  console.log(`→ Sending ${COUNT} synthetic leads to ${BASE_URL} ${SECRET ? '(with webhook secret)' : ''}`);
  const recent = []; // pool of already-sent people, to reuse for cross-source dedupe demos
  const tally = {};
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < COUNT; i++) {
    const slug = weightedSource();
    // ~18% of the time reuse an earlier person on a DIFFERENT source → cross-source dedupe flag.
    let person;
    const reusable = recent.filter((r) => r.slug !== slug);
    if (reusable.length && Math.random() < 0.18) {
      person = rand(reusable).person;
    } else {
      person = newPerson();
    }
    recent.push({ slug, person });
    if (recent.length > 40) recent.shift();

    const payload = buildPayload(slug, person);
    try {
      const r = await post(slug, payload);
      if (r.ok) {
        sent++;
        tally[slug] = (tally[slug] ?? 0) + 1;
        process.stdout.write(r.body?.deduped ? 'd' : '.');
      } else {
        failed++;
        process.stdout.write('x');
        if (failed <= 3) console.error(`\n  ✖ ${slug} → ${r.status}`, r.body);
      }
    } catch (err) {
      failed++;
      process.stdout.write('x');
      if (failed <= 3) console.error(`\n  ✖ ${slug} → ${err.message} (is the server running at BASE_URL?)`);
    }
    await new Promise((r) => setTimeout(r, 40));
  }

  console.log(`\n\n✅ done — ${sent} accepted, ${failed} failed`);
  console.log('   by source:', tally);

  // Spread the just-captured leads across the last 30 days so the analytics graphs look alive
  // immediately (they'd otherwise all sit on today). The daily cron keeps them fresh thereafter.
  try {
    const url = `${BASE_URL}/api/cron/demo-refresh${CRON_SECRET ? `?secret=${encodeURIComponent(CRON_SECRET)}` : ''}`;
    const r = await fetch(url);
    const body = await r.json().catch(() => ({}));
    console.log(r.ok ? `   spread ${body.refreshed ?? '?'} leads across the last ${body.spreadDays ?? 30} days ✓` : `   ⚠ demo-refresh returned ${r.status}`);
  } catch (err) {
    console.log(`   ⚠ demo-refresh call failed: ${err.message} (run /api/cron/demo-refresh manually)`);
  }

  console.log('   view the dashboard, /leads and /analytics to see them flow.');
}

main();
