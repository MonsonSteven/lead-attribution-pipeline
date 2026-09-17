import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toE164, toNationalDigits, isForeignPhone } from '../lib/phone';

test('toE164: 10 digits → +1', () => assert.equal(toE164('8505551212'), '+18505551212'));
test('toE164: formatted 10 digits', () => assert.equal(toE164('(850) 555-1212'), '+18505551212'));
test('toE164: 11 digits leading 1', () => assert.equal(toE164('18505551212'), '+18505551212'));
test('toE164: already E.164 passes through', () => assert.equal(toE164('+18505551212'), '+18505551212'));
test('toE164: unrecognizable → null (flag, do not fabricate)', () => {
  assert.equal(toE164('12345'), null);
  assert.equal(toE164(''), null);
  assert.equal(toE164(null), null);
  assert.equal(toE164(undefined), null);
});

test('toNationalDigits: strips symbols to 10 digits', () => {
  assert.equal(toNationalDigits('+18505551212'), '8505551212');
  assert.equal(toNationalDigits('(850) 555-1212'), '8505551212');
  assert.equal(toNationalDigits('8505551212'), '8505551212');
});
test('toNationalDigits: junk → null', () => {
  assert.equal(toNationalDigits('12345'), null);
  assert.equal(toNationalDigits(null), null);
});

test('isForeignPhone: real overseas E.164 numbers → true (the weekend spam callers)', () => {
  assert.equal(isForeignPhone('+33100000001'), true); // France
  assert.equal(isForeignPhone('+34600000001'), true); // Spain
  assert.equal(isForeignPhone('+48500000001'), true); // Poland
});
test('isForeignPhone: US/CA numbers → false (handled by toE164, not "foreign")', () => {
  assert.equal(isForeignPhone('8505551212'), false);
  assert.equal(isForeignPhone('+18505551212'), false);
  assert.equal(isForeignPhone('(850) 555-1212'), false);
});
test('isForeignPhone: empty/garbage → false (a genuine parse failure stays drift)', () => {
  assert.equal(isForeignPhone(''), false);
  assert.equal(isForeignPhone(null), false);
  assert.equal(isForeignPhone(undefined), false);
  assert.equal(isForeignPhone('12345'), false); // too short to be a real E.164 number
});
