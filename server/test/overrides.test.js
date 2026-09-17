import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOverride, isValidOverridePct, pctForTarget, MAX_OVERRIDE_PCT } from '../src/valuation/overrides.js';

test('a positive override raises the value by that percentage', () => {
  assert.equal(applyOverride(1000, 10), 1100);
  assert.equal(applyOverride(10077, -12), 8868);
});

test('a negative override lowers it', () => {
  assert.equal(applyOverride(1000, -25), 750);
});

test('no override returns the base value unchanged', () => {
  assert.equal(applyOverride(1234, null), 1234);
  assert.equal(applyOverride(1234, undefined), 1234);
  assert.equal(applyOverride(1234, 0), 1234);
});

test('overrides are percentages, so they keep applying as the source moves', () => {
  // The point of storing a percentage: the same override still means "+10%"
  // after the daily refresh changes the underlying value.
  assert.equal(applyOverride(1000, 10), 1100);
  assert.equal(applyOverride(2000, 10), 2200);
});

test('a value can never be pushed below zero', () => {
  assert.equal(applyOverride(100, -90), 10);
  assert.ok(applyOverride(1, -90) >= 0);
});

test('out-of-range percentages are ignored rather than applied', () => {
  assert.equal(applyOverride(1000, 500), 1000);
  assert.equal(applyOverride(1000, -500), 1000);
  assert.equal(isValidOverridePct(MAX_OVERRIDE_PCT), true);
  assert.equal(isValidOverridePct(MAX_OVERRIDE_PCT + 1), false);
  assert.equal(isValidOverridePct('not a number'), false);
  assert.equal(isValidOverridePct(NaN), false);
});

test('a non-numeric base value degrades to zero rather than NaN', () => {
  assert.equal(applyOverride(undefined, 10), 0);
  assert.equal(applyOverride(null, 10), 0);
  assert.equal(applyOverride('abc', 10), 0);
});

test('pctForTarget inverts applyOverride', () => {
  const pct = pctForTarget(1000, 1150);
  assert.equal(pct, 15);
  assert.equal(applyOverride(1000, pct), 1150);
});

test('pctForTarget is safe on a zero base', () => {
  assert.equal(pctForTarget(0, 500), 0);
});
