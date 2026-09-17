import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWebsite } from '../lib/normalize/website';

// Injected config stubs — keep the test DB-free and deterministic.
const paramMap = async () => ({ gclid: 'Google', msclkid: 'Bing', oppref: 'OpenAI', fbclid: 'Facebook', ttclid: 'TikTok' });
const consentVer = async () => 'v1';
const norm = (raw: unknown) => normalizeWebsite(raw, paramMap, consentVer);

test('website: state from the standalone field; county from the address-block quirk', async () => {
  const c = await norm({
    names: { first_name: 'Alex', last_name: 'Rivera' },
    phone: '8665551212', email: 'alex@example.com',
    address_1: { address_line_1: '123 Main St', city: 'Riverton', state: 'Kendall', zip: '32501', country: 'US' },
    state: 'Florida', dropdown: 'Windows',
    schedule_appointment: 'yes', appointment_date: '2026-09-01', appointment_time: '01:00PM',
    'terms-n-condition': 'accepted', gclid: 'TESTGCLID',
    __submission: { id: '830', form_id: '14', created_at: '2026-08-28T12:00:00Z' },
  });
  assert.equal(c.firstName, 'Alex');
  assert.equal(c.lastName, 'Rivera');
  assert.equal(c.phone, '+18665551212');
  assert.equal(c.state, 'Florida'); // standalone State field is authoritative
  assert.equal(c.county, 'Kendall'); // ⚠ the address block's "state" is really the county
  assert.equal(c.city, 'Riverton');
  assert.equal(c.productInterest, 'Windows');
  assert.equal(c.channel, 'Google'); // gclid → Google via injected param map
  assert.equal(c.consentGiven, true);
  assert.equal(c.consentVersion, 'v1');
  assert.equal(c.scheduleAppointment, true);
  assert.equal(c.appointmentTime, '01:00PM');
  assert.equal(c.source, 'web-form');
});

test('website: no click-ids → organic-web', async () => {
  const c = await norm({ names: { first_name: 'A' }, state: 'Alabama', __submission: { id: '1' } });
  assert.equal(c.channel, 'organic-web');
});

test('website: click-id precedence (paid gclid beats fbclid) + collision flagged', async () => {
  const c = await norm({ gclid: 'g', fbclid: 'f', __submission: { id: '2' } });
  assert.equal(c.channel, 'Google');
  assert.equal((c.rawAttribution as { collision?: boolean })?.collision, true);
});

test('website: no consent checkbox → not consented, no version', async () => {
  const c = await norm({ names: { first_name: 'A' }, __submission: { id: '3' } });
  assert.equal(c.consentGiven, false);
  assert.equal(c.consentVersion, null);
});
