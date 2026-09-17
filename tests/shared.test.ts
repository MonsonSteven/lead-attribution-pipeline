import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pick, splitName, toProductCategory } from '../lib/normalize/shared';

test('pick: first present value across candidate keys', () => {
  assert.equal(pick({ a: '', b: 'x' }, 'a', 'b'), 'x');
  assert.equal(pick({ First: 'Jane' }, 'first_name', 'First'), 'Jane');
  assert.equal(pick({}, 'a', 'b'), null);
});
test('pick: trims, and treats whitespace-only as absent', () => {
  assert.equal(pick({ a: '   ' }, 'a'), null);
  assert.equal(pick({ a: '  hi  ' }, 'a'), 'hi');
});

test('splitName: single token → first only', () => assert.deepEqual(splitName('Cher'), { firstName: 'Cher', lastName: null }));
test('splitName: first + last', () => assert.deepEqual(splitName('STEPHANIE MAYS'), { firstName: 'STEPHANIE', lastName: 'MAYS' }));
test('splitName: compound last name kept intact', () => assert.deepEqual(splitName('Mary Van Der Berg'), { firstName: 'Mary', lastName: 'Van Der Berg' }));
test('splitName: null/empty', () => {
  assert.deepEqual(splitName(null), { firstName: null, lastName: null });
  assert.deepEqual(splitName(''), { firstName: null, lastName: null });
});

test('toProductCategory: exact 6-enum value', () => assert.equal(toProductCategory('Windows'), 'Windows'));
test('toProductCategory: vendor-phrasing aliases', () => {
  assert.equal(toProductCategory('Bathroom Remodeling'), 'Bath');
  assert.equal(toProductCategory('Walk In Tubs'), 'Bath');
  assert.equal(toProductCategory('window'), 'Windows');
});
test('toProductCategory: unknown → null (never blocks; raw still passes through)', () => {
  assert.equal(toProductCategory('GoogleBaths_Lakeside'), null); // phone campaign, not a product
  assert.equal(toProductCategory(null), null);
});
