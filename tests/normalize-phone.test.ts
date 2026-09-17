import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, phoneSourceMessageId } from '../lib/normalize/phone';

// Injected DNI lookup stub — DB-free, deterministic.
const dni = async (n: string) =>
  n === '5551230101' ? { campaign: 'GoogleDisplay_AL', captureId: 'cap-google' } : null;

test('phone: tracked line → campaign + Google channel; the CALLER (From) is the lead', async () => {
  const c = await normalizePhone({ From: '+18505551234', To: '+15551230101', City: 'Riverton', State: 'FL', CallSid: 'CAabc' }, dni);
  assert.equal(c.phone, '+18505551234'); // From = caller = the lead's number
  assert.equal(c.dialedNumber, '+15551230101');
  assert.equal(c.campaign, 'GoogleDisplay_AL');
  assert.equal(c.channel, 'Google');
  assert.equal(c.source, 'phone');
  assert.equal((c.provenance as { callSid?: string })?.callSid, 'CAabc');
});

test('phone: untracked line → Organic Incoming Call fallback', async () => {
  const c = await normalizePhone({ From: '+18509990000', To: '+19995550000', CallSid: 'CAx' }, dni);
  assert.equal(c.campaign, 'Organic Incoming Call');
  assert.equal(c.channel, 'organic-call');
});

test('phone: LocalServices_* campaign → LSA channel (the prod-spelling fix)', async () => {
  const dniLsa = async () => ({ campaign: 'LocalServices_Alabama', captureId: 'cap-lsa' });
  const c = await normalizePhone({ From: '+18505551234', To: '+15551230102' }, dniLsa);
  assert.equal(c.channel, 'LSA');
});

test('phone: overseas caller → phone null but flagged foreignCaller in provenance', async () => {
  const c = await normalizePhone({ From: '+33100000001', To: '+15551230103', CallSid: 'CAfr' }, dni);
  assert.equal(c.phone, null); // US/CA-only: not written to the CRM
  assert.equal((c.provenance as { foreignCaller?: boolean })?.foreignCaller, true);
});
test('phone: US caller → no foreignCaller flag (only set when a real number is dropped)', async () => {
  const c = await normalizePhone({ From: '+18509990000', To: '+15551230103', CallSid: 'CAus' }, dni);
  assert.equal(c.phone, '+18509990000');
  assert.equal((c.provenance as { foreignCaller?: boolean })?.foreignCaller, undefined);
});
test('phone: missing caller → no foreignCaller flag (a genuine parse failure stays drift)', async () => {
  const c = await normalizePhone({ To: '+15551230103', CallSid: 'CAempty' }, dni);
  assert.equal(c.phone, null);
  assert.equal((c.provenance as { foreignCaller?: boolean })?.foreignCaller, undefined);
});

test('phoneSourceMessageId extracts CallSid (the idempotency key)', () => {
  assert.equal(phoneSourceMessageId({ CallSid: 'CAxyz' }), 'CAxyz');
  assert.equal(phoneSourceMessageId({}), null);
});
