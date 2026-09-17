import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveFormat, describeFormat, eligibleFor, formatKey } from '../src/valuation/format.js';

const SUPERFLEX_PPR = {
  total_rosters: 12,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN', 'IR', 'TAXI'],
  scoring_settings: { rec: 1 },
};

test('superflex is detected from roster_positions, not assumed', () => {
  const f = deriveFormat(SUPERFLEX_PPR);
  assert.equal(f.superflex, true);
  assert.equal(f.numQbs, 2, 'FantasyCalc models superflex as 2QB');
});

test('a 1QB league is not treated as superflex', () => {
  const f = deriveFormat({
    total_rosters: 10,
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'],
    scoring_settings: { rec: 0.5 },
  });
  assert.equal(f.superflex, false);
  assert.equal(f.numQbs, 1);
  assert.equal(f.ppr, 0.5);
  assert.equal(f.numTeams, 10);
});

test('a true 2QB league reports numQbs 2 without a superflex slot', () => {
  const f = deriveFormat({
    total_rosters: 12,
    roster_positions: ['QB', 'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'BN'],
    scoring_settings: { rec: 1 },
  });
  assert.equal(f.superflex, false);
  assert.equal(f.numQbs, 2);
});

test('PPR is read from scoring_settings.rec and defaults to standard', () => {
  assert.equal(deriveFormat({ scoring_settings: { rec: 1 } }).ppr, 1);
  assert.equal(deriveFormat({ scoring_settings: { rec: 0.5 } }).ppr, 0.5);
  assert.equal(deriveFormat({ scoring_settings: {} }).ppr, 0);
  assert.equal(deriveFormat({}).ppr, 0);
});

test('bench, IR and taxi slots are excluded from the starting lineup', () => {
  const f = deriveFormat(SUPERFLEX_PPR);
  assert.equal(f.starterCount, 9);
  assert.ok(!f.startingSlots.includes('BN'));
  assert.ok(!f.startingSlots.includes('IR'));
  assert.ok(!f.startingSlots.includes('TAXI'));
  assert.equal(f.taxiSlots, 1);
  assert.equal(f.irSlots, 1);
});

test('maxStartable counts dedicated slots plus every flex a position qualifies for', () => {
  const f = deriveFormat(SUPERFLEX_PPR);
  assert.equal(f.maxStartable.QB, 2, 'QB slot + SUPER_FLEX');
  assert.equal(f.maxStartable.RB, 4, '2 RB + FLEX + SUPER_FLEX');
  assert.equal(f.maxStartable.WR, 5, '3 WR + FLEX + SUPER_FLEX');
  assert.equal(f.maxStartable.TE, 3, 'TE + FLEX + SUPER_FLEX');
});

test('flex eligibility maps are correct', () => {
  assert.deepEqual(eligibleFor('FLEX').sort(), ['RB', 'TE', 'WR']);
  assert.deepEqual(eligibleFor('SUPER_FLEX').sort(), ['QB', 'RB', 'TE', 'WR']);
  assert.deepEqual(eligibleFor('REC_FLEX').sort(), ['TE', 'WR']);
  assert.deepEqual(eligibleFor('WRRB_FLEX').sort(), ['RB', 'WR']);
  assert.deepEqual(eligibleFor('QB'), ['QB']);
});

test('format keys separate leagues that must not share value snapshots', () => {
  const sf = formatKey({ numTeams: 12, numQbs: 2, ppr: 1, superflex: true });
  const oneQb = formatKey({ numTeams: 12, numQbs: 1, ppr: 1, superflex: false });
  const tenTeam = formatKey({ numTeams: 10, numQbs: 2, ppr: 1, superflex: true });
  assert.notEqual(sf, oneQb);
  assert.notEqual(sf, tenTeam);
  assert.equal(sf, 'dyn-sf-12t-1ppr');
});

test('describeFormat renders a readable label', () => {
  assert.equal(describeFormat(deriveFormat(SUPERFLEX_PPR)), '12-team · Superflex · PPR');
});

test('an empty league object does not throw', () => {
  const f = deriveFormat({});
  assert.equal(f.starterCount, 0);
  assert.equal(f.numTeams, 12);
});
