import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDrift } from '../lib/validate';
import type { CanonicalLead } from '../lib/types';

const lead = (o: Partial<CanonicalLead>): CanonicalLead => ({ source: 'web-form', ...o }) as CanonicalLead;

test('healthy web lead → no drift', () => {
  assert.equal(detectDrift(lead({ source: 'web-form', phone: '+18505551212', firstName: 'A', lastName: 'B' })), null);
});
test('web with no contact AND no name → no-contact,no-name', () => {
  assert.equal(detectDrift(lead({ source: 'web-form' })), 'no-contact,no-name');
});
test('web with email + name → healthy (email counts as contact)', () => {
  assert.equal(detectDrift(lead({ source: 'web-form', email: 'x@y.com', firstName: 'A' })), null);
});
test('phone with a number but no name → healthy (calls have no name by design)', () => {
  assert.equal(detectDrift(lead({ source: 'phone', phone: '+18505551212' })), null);
});
test('phone with NO phone/email → no-contact (the malformed-JSON-call failure)', () => {
  assert.equal(detectDrift(lead({ source: 'phone' })), 'no-contact');
});
test('phone with an out-of-region caller → NO drift (foreign number dropped, not a parse failure)', () => {
  assert.equal(detectDrift(lead({ source: 'phone', provenance: { foreignCaller: true } })), null);
});
test('foreignCaller exemption is phone-only (a web-form would still flag no-contact)', () => {
  assert.equal(detectDrift(lead({ source: 'web-form', firstName: 'A', provenance: { foreignCaller: true } })), 'no-contact');
});
test('vendor with contact but no name → no-name', () => {
  assert.equal(detectDrift(lead({ source: 'vendor:leadbridge', phone: '+18505551212' })), 'no-name');
});
test('whitespace-only fields count as empty', () => {
  assert.equal(detectDrift(lead({ source: 'web-form', phone: '  ', email: '', firstName: ' ' })), 'no-contact,no-name');
});
