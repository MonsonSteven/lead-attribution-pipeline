import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDuplicateSignal, selectPriorMatch } from '../lib/repo';
import type { LeadSource } from '../lib/types';

// ── isDuplicateSignal: the source-pair rule (2026-09-04 dedupe-window review) ──
// phone↔phone repeat callers are legitimately separate leads → NOT a duplicate signal.
// Everything else (cross-source, or a repeat same-contact web submission) stays flagged.

test('phone↔phone is NOT a duplicate signal (repeat caller = separate lead)', () => {
  assert.equal(isDuplicateSignal('phone', 'phone'), false);
});

test('cross-source phone↔web IS a duplicate signal (both directions)', () => {
  assert.equal(isDuplicateSignal('phone', 'web-form'), true);
  assert.equal(isDuplicateSignal('web-form', 'phone'), true);
});

test('same-source web↔web IS a duplicate signal (accidental resubmit)', () => {
  assert.equal(isDuplicateSignal('web-form', 'web-form'), true);
});

test('vendor pairings ARE duplicate signals (only phone↔phone is exempt)', () => {
  const others: LeadSource[] = ['web-form', 'vendor:leadbridge', 'vendor:homequote', 'vendor:renovatepros'];
  for (const a of others) {
    for (const b of others) {
      assert.equal(isDuplicateSignal(a, b), true, `${a}↔${b} should flag`);
    }
  }
  // a vendor lead matching an earlier phone lead (cross-source) still flags
  assert.equal(isDuplicateSignal('vendor:leadbridge', 'phone'), true);
});

// ── selectPriorMatch: temporal window + strictly-earlier + earliest genuine match wins ──
// The current lead is anchored at ANCHOR; candidates carry their own received_at.

const ANCHOR = '2026-09-04T12:00:00.000Z';
const at = (isoOffsetDays: number) =>
  new Date(Date.parse(ANCHOR) + isoOffsetDays * 86_400_000).toISOString();

type Cand = Parameters<typeof selectPriorMatch>[1][number];
const cand = (o: Partial<Cand>): Cand =>
  ({ id: 'x', source: 'web-form', received_at: at(-1), phone_match: false, email_match: false, ...o }) as Cand;
const cur = (source: Cand['source'], windowDays = 30) => ({ source, receivedAt: ANCHOR, windowDays });

test('no candidates → null', () => {
  assert.equal(selectPriorMatch(cur('web-form'), []), null);
});

test('phone lead skips a phone↔phone repeat, finds no other match → null', () => {
  const prior = [cand({ id: 'earlier-call', source: 'phone', received_at: at(-1), phone_match: true })];
  assert.equal(selectPriorMatch(cur('phone'), prior), null);
});

test('phone lead skips the phone repeat but flags an earlier cross-source web match', () => {
  const prior = [
    cand({ id: 'web-lead', source: 'web-form', received_at: at(-2), phone_match: true }),
    cand({ id: 'earlier-call', source: 'phone', received_at: at(-1), phone_match: true }),
  ];
  assert.deepEqual(selectPriorMatch(cur('phone'), prior), { id: 'web-lead', reason: 'phone' });
});

test('reason composes phone,email when both match', () => {
  const prior = [cand({ id: 'w1', source: 'web-form', phone_match: true, email_match: true })];
  assert.deepEqual(selectPriorMatch(cur('web-form'), prior), { id: 'w1', reason: 'phone,email' });
});

test('email-only cross-source match flags with reason=email', () => {
  const prior = [cand({ id: 'w1', source: 'web-form', phone_match: false, email_match: true })];
  assert.deepEqual(selectPriorMatch(cur('phone'), prior), { id: 'w1', reason: 'email' });
});

test('earliest genuine match wins regardless of candidate order', () => {
  const prior = [
    cand({ id: 'second', source: 'web-form', received_at: at(-1), phone_match: true }),
    cand({ id: 'first', source: 'web-form', received_at: at(-3), phone_match: true }),
  ];
  assert.deepEqual(selectPriorMatch(cur('web-form'), prior), { id: 'first', reason: 'phone' });
});

// ── the hardening: temporal bounds (prevents forward-flags + honors the window) ──

test('a LATER candidate is ignored (no forward-flag) — the reprocess hazard', () => {
  // A same-contact lead that arrived AFTER the current one must never be flagged as its "prior".
  const prior = [cand({ id: 'future-lead', source: 'web-form', received_at: at(+1), phone_match: true })];
  assert.equal(selectPriorMatch(cur('web-form'), prior), null);
});

test('a candidate at the exact anchor instant is ignored (strictly-earlier)', () => {
  const prior = [cand({ id: 'same-instant', source: 'web-form', received_at: ANCHOR, phone_match: true })];
  assert.equal(selectPriorMatch(cur('web-form'), prior), null);
});

test('a candidate older than the window floor is ignored', () => {
  const prior = [cand({ id: 'ancient', source: 'web-form', received_at: at(-31), phone_match: true })];
  assert.equal(selectPriorMatch(cur('web-form', 30), prior), null);
});

test('a candidate just inside the window floor is flagged', () => {
  const prior = [cand({ id: 'edge', source: 'web-form', received_at: at(-29), phone_match: true })];
  assert.deepEqual(selectPriorMatch(cur('web-form', 30), prior), { id: 'edge', reason: 'phone' });
});
