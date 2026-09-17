import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketSharpPayload } from '../lib/adapters/marketsharp';
import type { CanonicalLead } from '../lib/types';

// Injected capture-id resolver — DB-free.
const resolveId = async () => 'test-capture-id';
const build = (lead: Partial<CanonicalLead>) => buildMarketSharpPayload({ source: 'web-form', ...lead } as CanonicalLead, resolveId);

test('web: real contact + MSM_interests pipe-cram (product | ApptDate | ApptTime)', async () => {
  const p = await build({
    source: 'web-form', firstName: 'Jane', lastName: 'Doe', phone: '+18505551212', email: 'j@d.com',
    address1: '1 Main', city: 'Riverton', state: 'Florida', zip: '32501',
    productInterest: 'Patio Products', appointmentDate: '2026-08-18', appointmentTime: '01:00PM',
  });
  assert.equal(p.id, 'test-capture-id');
  assert.equal(p.MSM_firstname, 'Jane');
  assert.equal(p.MSM_lastname, 'Doe');
  assert.equal(p.MSM_email, 'j@d.com');
  assert.equal(p.MSM_cellphone, '+18505551212');
  assert.equal(p.MSM_address2, ''); // MS-architected, always empty
  assert.equal(p.MSM_interests, 'Patio Products | ApptDate: 2026-08-18 | ApptTime: 01:00PM');
});

test('call: Na / na@na.com defaults, empty address, campaign-only interests', async () => {
  const p = await build({
    source: 'phone', phone: '+18505551234', campaign: 'GoogleBaths_Lakeside', city: 'Riverton', state: 'FL',
  });
  assert.equal(p.MSM_firstname, 'Na');
  assert.equal(p.MSM_lastname, 'Na');
  assert.equal(p.MSM_email, 'na@na.com');
  assert.equal(p.MSM_address1, '');
  assert.equal(p.MSM_cellphone, '+18505551234'); // the caller's number
  assert.equal(p.MSM_interests, 'GoogleBaths_Lakeside'); // campaign only, no pipe/appt
});

test('vendor: bare product interest (no pipe, no appt labels)', async () => {
  const p = await build({
    source: 'vendor:leadbridge', firstName: 'Perri', lastName: 'Santos', phone: '+15551230201', email: 'p@y.com', productInterest: 'Windows',
  });
  assert.equal(p.MSM_firstname, 'Perri'); // real name (no Na)
  assert.equal(p.MSM_interests, 'Windows');
});
