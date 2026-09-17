import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimalLineup, valueWeightedAge, starterValueByPosition } from '../src/valuation/lineup.js';

const p = (id, position, value, age = 25) => ({ id, position, value, age, name: id });
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'];

test('the superflex slot takes a QB when the QB is the best remaining player', () => {
  const roster = [
    p('qb1', 'QB', 9000), p('qb2', 'QB', 8000),
    p('rb1', 'RB', 5000), p('rb2', 'RB', 4000), p('rb3', 'RB', 1000),
    p('wr1', 'WR', 6000), p('wr2', 'WR', 5500), p('wr3', 'WR', 5000), p('wr4', 'WR', 2000),
    p('te1', 'TE', 3000),
  ];
  const lineup = optimalLineup(roster, SLOTS);
  const sf = lineup.assignments.find((a) => a.slot === 'SUPER_FLEX');
  assert.equal(sf.player.id, 'qb2', 'second QB beats the best flex option');
  assert.equal(lineup.starterValue, 9000 + 5000 + 4000 + 6000 + 5500 + 5000 + 3000 + 2000 + 8000);
});

test('the superflex slot takes a flex player when no second QB is rostered', () => {
  const roster = [
    p('qb1', 'QB', 9000),
    p('rb1', 'RB', 5000), p('rb2', 'RB', 4000), p('rb3', 'RB', 3500),
    p('wr1', 'WR', 6000), p('wr2', 'WR', 5500), p('wr3', 'WR', 5000), p('wr4', 'WR', 4800),
    p('te1', 'TE', 3000),
  ];
  const lineup = optimalLineup(roster, SLOTS);
  const sf = lineup.assignments.find((a) => a.slot === 'SUPER_FLEX');
  const flex = lineup.assignments.find((a) => a.slot === 'FLEX');

  assert.notEqual(sf.player.position, 'QB', 'the only QB is locked into the QB slot');
  // FLEX (3 eligible positions) is less restrictive than SUPER_FLEX (4), so it
  // fills first and takes the better of the two leftovers.
  assert.equal(flex.player.id, 'wr4');
  assert.equal(sf.player.id, 'rb3');
  // Either ordering of the leftovers yields the same total, which is what optimality means.
  assert.equal(lineup.starterValue, 9000 + 5000 + 4000 + 6000 + 5500 + 5000 + 3000 + 4800 + 3500);
});

test('greedy-by-restrictiveness beats naive best-first assignment', () => {
  // Naive: filling FLEX first with the best eligible player (rb1) would strand an RB slot.
  const roster = [
    p('qb1', 'QB', 5000),
    p('rb1', 'RB', 9000), p('rb2', 'RB', 100),
    p('wr1', 'WR', 8000), p('wr2', 'WR', 7000), p('wr3', 'WR', 6000), p('wr4', 'WR', 5500),
    p('te1', 'TE', 3000),
  ];
  const lineup = optimalLineup(roster, SLOTS);
  // Every dedicated slot is filled, and the two best leftovers take FLEX + SUPER_FLEX.
  assert.equal(lineup.starterValue, 5000 + 9000 + 100 + 8000 + 7000 + 6000 + 3000 + 5500 + 0);
  assert.equal(lineup.emptySlots.length, 1, 'no eligible player left for SUPER_FLEX');
});

test('a short roster leaves slots empty instead of throwing', () => {
  const lineup = optimalLineup([p('qb1', 'QB', 5000)], SLOTS);
  assert.equal(lineup.starters.length, 1);
  assert.equal(lineup.emptySlots.length, 8);
  assert.equal(lineup.starterValue, 5000);
});

test('no player is assigned to two slots', () => {
  const roster = Array.from({ length: 20 }, (_, i) => p(`p${i}`, ['QB', 'RB', 'WR', 'TE'][i % 4], 1000 - i * 10));
  const lineup = optimalLineup(roster, SLOTS);
  const ids = lineup.starters.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('bench value plus starter value equals total roster value', () => {
  const roster = Array.from({ length: 18 }, (_, i) => p(`p${i}`, ['QB', 'RB', 'WR', 'TE'][i % 4], 500 + i * 37));
  const lineup = optimalLineup(roster, SLOTS);
  const total = roster.reduce((s, x) => s + x.value, 0);
  assert.equal(lineup.starterValue + lineup.benchValue, total);
});

test('value-weighted age weights studs more heavily than scrubs', () => {
  // A 22-year-old worth 9000 and a 34-year-old worth 1000 → close to 23.2, not 28.
  const age = valueWeightedAge([p('a', 'WR', 9000, 22), p('b', 'WR', 1000, 34)]);
  assert.ok(Math.abs(age - 23.2) < 0.01, `expected ~23.2, got ${age}`);
});

test('players with unknown age are excluded from the age calculation', () => {
  const age = valueWeightedAge([p('a', 'WR', 1000, 25), { id: 'b', position: 'WR', value: 9000, age: null }]);
  assert.equal(age, 25);
});

test('value-weighted age is null when nothing has a usable age', () => {
  assert.equal(valueWeightedAge([]), null);
  assert.equal(valueWeightedAge([{ id: 'x', position: 'WR', value: 100, age: null }]), null);
});

test('starter value breaks down by position and sums to the lineup total', () => {
  const roster = [
    p('qb1', 'QB', 9000), p('qb2', 'QB', 8000),
    p('rb1', 'RB', 5000), p('rb2', 'RB', 4000),
    p('wr1', 'WR', 6000), p('wr2', 'WR', 5500), p('wr3', 'WR', 5000), p('wr4', 'WR', 2000),
    p('te1', 'TE', 3000),
  ];
  const lineup = optimalLineup(roster, SLOTS);
  const byPos = starterValueByPosition(lineup);
  assert.equal(Object.values(byPos).reduce((a, b) => a + b, 0), lineup.starterValue);
  assert.equal(byPos.QB, 17000);
});
