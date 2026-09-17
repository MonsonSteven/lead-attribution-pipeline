import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffPayloads, summarizeParity } from '../lib/parity';

test('identical payloads match', () => {
  const r = diffPayloads({ a: '1', b: '2' }, { a: '1', b: '2' });
  assert.equal(r.match, true);
  assert.equal(r.diffs.length, 0);
});
test('detects a value mismatch and names the field', () => {
  const r = diffPayloads({ MSM_cellphone: '+1850' }, { MSM_cellphone: '+1999' });
  assert.equal(r.match, false);
  assert.equal(r.diffs[0].field, 'MSM_cellphone');
});
test('byte-exact: trailing whitespace IS a mismatch (not trimmed)', () => {
  // exactly the MSM_interests empty-appt case the design flags for convergence
  const r = diffPayloads({ MSM_interests: 'Siding | ApptDate: | ApptTime: ' }, { MSM_interests: 'Siding | ApptDate: | ApptTime:' });
  assert.equal(r.match, false);
});
test('null vs empty-string are treated as equal', () => {
  assert.equal(diffPayloads({ x: null }, { x: '' }).match, true);
});
test('ignore list skips fields (e.g. crmId)', () => {
  assert.equal(diffPayloads({ id: 'a', x: '1' }, { id: 'b', x: '1' }, { ignore: ['id'] }).match, true);
});
test('summarizeParity rolls up the go/no-go number + worst field', () => {
  const s = summarizeParity([
    { key: '1', ours: { a: '1' }, theirs: { a: '1' } },
    { key: '2', ours: { a: '1' }, theirs: { a: '2' } },
    { key: '3', ours: { a: '1' }, theirs: { a: '9' } },
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.matched, 1);
  assert.equal(s.mismatched, 2);
  assert.equal(s.diffsByField[0].field, 'a');
  assert.equal(s.diffsByField[0].count, 2);
});
