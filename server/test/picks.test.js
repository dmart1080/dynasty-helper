import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slotMultiplier, genericRoundValue, valuePick, projectDraftSlots,
  expandOwnedPicks, PICK_DEFAULTS,
} from '../src/valuation/picks.js';

const NUM_TEAMS = 12;
// A descending value curve standing in for the league's player values.
const sortedValues = Array.from({ length: 400 }, (_, i) => Math.round(10000 * Math.exp(-0.011 * i)));
const baseCtx = { currentSeason: '2026', numTeams: NUM_TEAMS, sortedValues, mode: 'projected' };

test('slot multipliers average to 1 across a round, so generic and projected agree league-wide', () => {
  for (const round of [1, 2, 3, 4]) {
    const mults = Array.from({ length: NUM_TEAMS }, (_, i) => slotMultiplier(i + 1, NUM_TEAMS, round));
    const mean = mults.reduce((a, b) => a + b, 0) / NUM_TEAMS;
    assert.ok(Math.abs(mean - 1) < 0.005, `round ${round} mean ${mean} should be ~1`);
  }
});

test('an early pick is worth more than a late pick in the same round', () => {
  const first = slotMultiplier(1, NUM_TEAMS, 1);
  const last = slotMultiplier(12, NUM_TEAMS, 1);
  assert.ok(first > last);
  assert.ok(first > 1.5, `1.01 should carry a large premium, got ${first}`);
  assert.ok(last < 0.6, `1.12 should be well below a generic 1st, got ${last}`);
});

test('the slot curve is monotonically decreasing', () => {
  const mults = Array.from({ length: NUM_TEAMS }, (_, i) => slotMultiplier(i + 1, NUM_TEAMS, 1));
  for (let i = 1; i < mults.length; i++) assert.ok(mults[i] < mults[i - 1]);
});

test('later rounds are flatter than the first round', () => {
  const spread = (round) => slotMultiplier(1, NUM_TEAMS, round) - slotMultiplier(NUM_TEAMS, NUM_TEAMS, round);
  assert.ok(spread(1) > spread(2));
  assert.ok(spread(2) > spread(3));
});

test('the value source pick values are preferred over the rank-anchor fallback', () => {
  const withSource = genericRoundValue(1, { ...baseCtx, pickValuesByRound: new Map([[1, 4242]]) });
  assert.equal(withSource.value, 4242);
  assert.equal(withSource.basis, 'source');

  const fallback = genericRoundValue(1, { ...baseCtx, pickValuesByRound: new Map() });
  assert.equal(fallback.basis, 'rank-anchor');
  assert.equal(fallback.value, sortedValues[Math.round(PICK_DEFAULTS.rankAnchors[1] * NUM_TEAMS) - 1]);
});

test('rank anchors scale with league size', () => {
  const small = genericRoundValue(1, { ...baseCtx, numTeams: 8, pickValuesByRound: new Map() });
  const large = genericRoundValue(1, { ...baseCtx, numTeams: 14, pickValuesByRound: new Map() });
  assert.ok(small.value > large.value, 'a 1st in a shallower league maps to a better player');
});

test("a rebuilder's 1st is worth more than a contender's 1st", () => {
  // Roster 5 is the weakest, so it projects to pick 1.01; roster 1 is strongest → 1.12.
  const slots = projectDraftSlots([
    { rosterId: 1, strength: 2.0 }, { rosterId: 2, strength: 1.0 },
    { rosterId: 3, strength: 0.0 }, { rosterId: 4, strength: -1.0 },
    { rosterId: 5, strength: -2.0 },
  ]);
  assert.equal(slots.get(5), 1, 'weakest team drafts first');
  assert.equal(slots.get(1), 5, 'strongest team drafts last');

  const ctx = { ...baseCtx, numTeams: 5, projectedSlots: slots, pickValuesByRound: new Map([[1, 4000]]) };
  const rebuilderPick = valuePick({ season: '2026', round: 1, originalRosterId: 5 }, ctx);
  const contenderPick = valuePick({ season: '2026', round: 1, originalRosterId: 1 }, ctx);

  assert.ok(rebuilderPick.value > contenderPick.value);
  assert.ok(rebuilderPick.value > 4000, 'a projected 1.01 exceeds the generic 1st');
  assert.ok(contenderPick.value < 4000, 'a projected late 1st falls below the generic 1st');
});

test('generic mode ignores the original owner entirely', () => {
  const slots = projectDraftSlots([
    { rosterId: 1, strength: 2 }, { rosterId: 2, strength: -2 },
  ]);
  const ctx = { ...baseCtx, projectedSlots: slots, pickValuesByRound: new Map([[1, 4000]]), mode: 'generic' };
  const a = valuePick({ season: '2026', round: 1, originalRosterId: 1 }, ctx);
  const b = valuePick({ season: '2026', round: 1, originalRosterId: 2 }, ctx);
  assert.equal(a.value, b.value);
  assert.equal(a.value, 4000, 'current-season generic pick takes no time discount');
  assert.equal(a.mode, 'generic');
});

test('future picks are discounted and regress toward the generic value', () => {
  const slots = projectDraftSlots([{ rosterId: 1, strength: -5 }, { rosterId: 2, strength: 5 }]);
  const ctx = { ...baseCtx, numTeams: 2, projectedSlots: slots, pickValuesByRound: new Map([[1, 4000]]) };

  const y0 = valuePick({ season: '2026', round: 1, originalRosterId: 1 }, ctx);
  const y1 = valuePick({ season: '2027', round: 1, originalRosterId: 1 }, ctx);
  const y2 = valuePick({ season: '2028', round: 1, originalRosterId: 1 }, ctx);

  assert.ok(y0.value > y1.value && y1.value > y2.value, 'further out is worth less');
  assert.equal(y0.confidence, 1);
  assert.ok(Math.abs(y1.confidence - 0.6) < 1e-9);
  assert.ok(Math.abs(y2.confidence - 0.36) < 1e-9);
  assert.equal(y2.yearsOut, 2);
});

test('an unknown original owner falls back to the generic value rather than throwing', () => {
  const ctx = { ...baseCtx, projectedSlots: new Map(), pickValuesByRound: new Map([[1, 4000]]) };
  const pick = valuePick({ season: '2026', round: 1, originalRosterId: 99 }, ctx);
  assert.equal(pick.value, 4000);
  assert.match(pick.basis, /no-projection/);
});

test('total league pick value is the same in both modes for the current season', () => {
  const teams = Array.from({ length: NUM_TEAMS }, (_, i) => ({ rosterId: i + 1, strength: i - 6 }));
  const slots = projectDraftSlots(teams);
  const pickValues = new Map([[1, 4000], [2, 1800]]);

  const totalFor = (mode) => teams.reduce((sum, t) => sum + [1, 2].reduce((s, round) =>
    s + valuePick({ season: '2026', round, originalRosterId: t.rosterId },
      { ...baseCtx, projectedSlots: slots, pickValuesByRound: pickValues, mode }).value, 0), 0);

  const projected = totalFor('projected');
  const generic = totalFor('generic');
  // Normalised multipliers mean projection redistributes value, never creates it.
  assert.ok(Math.abs(projected - generic) / generic < 0.01,
    `projected ${projected} vs generic ${generic} should match within 1%`);
});

test('untraded picks stay with their original roster', () => {
  const picks = expandOwnedPicks({ rosterIds: [1, 2, 3], seasons: ['2026', '2027'], rounds: 2, tradedPicks: [] });
  assert.equal(picks.length, 3 * 2 * 2);
  assert.ok(picks.every((p) => p.ownerId === p.originalRosterId));
  assert.ok(picks.every((p) => p.traded === false));
});

test('traded picks move to the new owner and keep their original-owner provenance', () => {
  const picks = expandOwnedPicks({
    rosterIds: [1, 2, 3], seasons: ['2027'], rounds: 1,
    tradedPicks: [{ season: '2027', round: 1, original_roster_id: 1, current_owner_id: 3 }],
  });
  const moved = picks.find((p) => p.originalRosterId === 1);
  assert.equal(moved.ownerId, 3, 'roster 3 now holds it');
  assert.equal(moved.originalRosterId, 1, 'provenance drives the slot projection');
  assert.equal(moved.traded, true);
  assert.equal(picks.filter((p) => p.ownerId === 3).length, 2, 'roster 3 holds its own plus the acquired pick');
  assert.equal(picks.filter((p) => p.ownerId === 1).length, 0, 'roster 1 traded its only pick away');
});

test('every pick has exactly one owner', () => {
  const picks = expandOwnedPicks({
    rosterIds: [1, 2, 3, 4], seasons: ['2026', '2027', '2028'], rounds: 4,
    tradedPicks: [
      { season: '2027', round: 1, original_roster_id: 1, current_owner_id: 4 },
      { season: '2028', round: 2, original_roster_id: 2, current_owner_id: 1 },
    ],
  });
  assert.equal(picks.length, 4 * 3 * 4);
  const keys = picks.map((p) => `${p.season}|${p.round}|${p.originalRosterId}`);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate picks');
});
