import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTrade, consolidationPremium, rosterSpotCost, suggestBalancers } from '../src/valuation/trade.js';
import { deriveFormat } from '../src/valuation/format.js';

const FORMAT = deriveFormat({
  total_rosters: 12,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
  scoring_settings: { rec: 1 },
});   // rosterSize = 15

const p = (id, position, value, age = 25) => ({ id, name: id, position, value, age });
const pick = (id, value) => ({ id: `pick:${id}`, name: id, position: 'PICK', value });

/** A filler roster of n players so roster-limit maths are realistic. */
const roster = (n, base = 1000) =>
  Array.from({ length: n }, (_, i) => p(`filler${i}`, ['QB', 'RB', 'WR', 'TE'][i % 4], base - i * 50));

const team = (rosterId, players, picks = []) => ({
  rosterId, teamName: `Team ${rosterId}`, mode: 'middle', players, picks,
});

test('a star-for-star swap earns no consolidation premium', () => {
  const res = consolidationPremium([p('a', 'WR', 9000)], [p('b', 'WR', 9000)]);
  assert.equal(res.premium, 0);
  assert.equal(res.gap, 0);
});

test('the side receiving the best asset earns a premium proportional to the gap', () => {
  const res = consolidationPremium([p('star', 'WR', 9000)], [p('depth', 'RB', 4000)]);
  // gap = (9000-4000)/9000 = 0.5556; premium = 0.15 × 0.5556 × 9000 = 750
  assert.ok(Math.abs(res.gap - 0.5556) < 0.001);
  assert.ok(Math.abs(res.premium - 750) < 1);
  assert.equal(res.asset.id, 'star');
});

test('only one side can earn the consolidation premium', () => {
  const a = [p('star', 'WR', 9000)];
  const b = [p('d1', 'RB', 4000), p('d2', 'RB', 3500)];
  assert.ok(consolidationPremium(a, b).premium > 0);
  assert.equal(consolidationPremium(b, a).premium, 0);
});

test('the premium scales with the size of the gap', () => {
  const small = consolidationPremium([p('a', 'WR', 9000)], [p('b', 'WR', 8000)]).premium;
  const large = consolidationPremium([p('a', 'WR', 9000)], [p('b', 'WR', 1000)]).premium;
  assert.ok(large > small);
});

test('no roster-spot cost when the team has room', () => {
  const current = roster(10);
  const res = rosterSpotCost({
    incoming: [p('in1', 'WR', 3000), p('in2', 'RB', 2000)],
    outgoing: [current[0]],            // must actually be on the roster to free a spot
    roster: current,
    rosterLimit: 15,
  });
  // 10 − 1 + 2 = 11, under the 15-man limit.
  assert.equal(res.cost, 0);
  assert.equal(res.spotsNeeded, 0);
  assert.equal(res.openSpots, 4);
});

test('an outgoing player who is not on the roster does not free a spot', () => {
  const res = rosterSpotCost({
    incoming: [p('in1', 'WR', 3000)],
    outgoing: [p('strangerp', 'WR', 4000)],
    roster: roster(15, 1000),
    rosterLimit: 15,
  });
  assert.equal(res.spotsNeeded, 1, 'the roster is still full, so the incoming player forces a cut');
});

test('roster-spot cost equals the value of the players actually cut', () => {
  // A full 15-man roster taking in 3 for 1 must drop 2.
  const full = roster(15, 1000);   // values 1000 down to 300, step 50
  const res = rosterSpotCost({
    incoming: [p('in1', 'WR', 5000), p('in2', 'RB', 4000), p('in3', 'TE', 3000)],
    outgoing: [p('filler0', 'QB', 1000)],
    roster: full,
    rosterLimit: 15,
  });
  assert.equal(res.spotsNeeded, 2);
  // Survivors are filler1..filler14 (950..300); the two worst are 300 and 350.
  assert.equal(res.cost, 300 + 350);
  assert.deepEqual(res.cuts.map((c) => c.id).sort(), ['filler13', 'filler14']);
});

test('picks never cost a roster spot', () => {
  const res = rosterSpotCost({
    incoming: [pick('2027 1st', 4000), pick('2027 2nd', 1800), pick('2028 1st', 3000)],
    outgoing: [],
    roster: roster(15),
    rosterLimit: 15,
  });
  assert.equal(res.cost, 0);
  assert.equal(res.spotsNeeded, 0);
});

test('an even trade is reported as dead even with no winner', () => {
  const res = evaluateTrade({
    sideA: { team: team(1, roster(10)), assets: [p('a', 'WR', 5000)] },
    sideB: { team: team(2, roster(10)), assets: [p('b', 'RB', 5000)] },
    format: FORMAT,
  });
  assert.equal(res.winner, null);
  assert.equal(res.verdictLabel, 'Dead even');
  assert.equal(res.adjustedDiff, 0);
});

test('the calculator is symmetric: swapping the sides flips the sign only', () => {
  const t1 = team(1, roster(10)), t2 = team(2, roster(10));
  const x = [p('x', 'WR', 8000)], y = [p('y', 'RB', 5000)];

  const ab = evaluateTrade({ sideA: { team: t1, assets: x }, sideB: { team: t2, assets: y }, format: FORMAT });
  const ba = evaluateTrade({ sideA: { team: t2, assets: y }, sideB: { team: t1, assets: x }, format: FORMAT });

  assert.equal(ab.winnerName, ba.winnerName, 'the same team wins either way');
  assert.ok(Math.abs(ab.fairnessPct + ba.fairnessPct) < 1e-9, 'percentage flips sign');
  assert.equal(ab.gapToBalance, ba.gapToBalance);
});

test('consolidation makes 2-for-1 favour the side getting the best player', () => {
  // Raw values are equal: 9000 vs 4500 + 4500.
  const res = evaluateTrade({
    sideA: { team: team(1, roster(10)), assets: [p('d1', 'RB', 4500), p('d2', 'WR', 4500)] },
    sideB: { team: team(2, roster(10)), assets: [p('star', 'WR', 9000)] },
    format: FORMAT,
  });
  assert.equal(res.rawDiff, 0, 'raw totals are identical');
  assert.ok(res.adjustedDiff > 0, 'side A, receiving the star, is ahead after adjustment');
  assert.ok(res.sideA.consolidationPremium > 0);
  assert.equal(res.sideB.consolidationPremium, 0);
  assert.equal(res.winnerName, 'Team 1');
});

test('a full roster taking on depth is charged for the players it must cut', () => {
  const fullTeam = team(1, roster(15, 1000));
  const res = evaluateTrade({
    sideA: { team: fullTeam, assets: [p('mystar', 'WR', 9000)] },
    sideB: { team: team(2, roster(8)), assets: [p('d1', 'RB', 3200), p('d2', 'WR', 3100), p('d3', 'TE', 3000)] },
    format: FORMAT,
  });
  assert.ok(res.sideA.spotsNeeded > 0, 'side A must cut to fit three incoming players');
  assert.ok(res.sideA.rosterSpotCost > 0);
  assert.ok(res.sideA.cuts.length === res.sideA.spotsNeeded);
  assert.ok(res.sideA.adjustedIncoming < res.sideA.rawIncoming, 'adjusted total is reduced by the cuts');
});

test('before/after starting lineup value is reported for both sides', () => {
  const weakTeam = team(1, [
    p('qb', 'QB', 3000), p('rb1', 'RB', 2000), p('rb2', 'RB', 1500),
    p('wr1', 'WR', 2500), p('wr2', 'WR', 2000), p('wr3', 'WR', 1500),
    p('te', 'TE', 1200), p('f1', 'RB', 900), p('f2', 'WR', 800),
  ]);
  const res = evaluateTrade({
    sideA: { team: weakTeam, assets: [p('f2', 'WR', 800)] },
    sideB: { team: team(2, roster(10)), assets: [p('stud', 'WR', 9000)] },
    format: FORMAT,
  });
  assert.ok(res.sideA.lineup.afterValue > res.sideA.lineup.beforeValue);
  assert.ok(res.sideA.lineup.delta > 0);
  assert.ok(res.sideA.lineup.after.some((s) => s.changed), 'the new player shows as a lineup change');
});

test('picks trade correctly and appear in the incoming totals', () => {
  const res = evaluateTrade({
    sideA: { team: team(1, roster(10), [pick('2027 1st', 4000)]), assets: [pick('2027 1st', 4000)] },
    sideB: { team: team(2, roster(10)), assets: [p('wr', 'WR', 4000)] },
    format: FORMAT,
  });
  assert.equal(res.sideB.rawIncoming, 4000);
  assert.equal(res.sideA.rawIncoming, 4000);
  assert.ok(res.sideB.incoming[0].isPick);
});

test('a verdict is plain English and names the winning team', () => {
  const res = evaluateTrade({
    sideA: { team: team(1, roster(10)), assets: [p('junk', 'RB', 500)] },
    sideB: { team: team(2, roster(10)), assets: [p('elite', 'WR', 9000)] },
    format: FORMAT,
  });
  assert.match(res.verdict, /Team 1/);
  assert.ok(res.verdict.length > 30);
  assert.equal(res.verdictLabel, 'Rejected instantly');
});

test('balance suggestions close the gap and are ranked by how even they leave it', () => {
  const winnerRoster = [
    p('keep1', 'QB', 8000), p('keep2', 'WR', 7000),
    p('chip1', 'RB', 1000), p('chip2', 'RB', 2500), p('chip3', 'WR', 4200), p('chip4', 'TE', 6000),
  ];
  const sideA = { team: team(1, winnerRoster), assets: [p('small', 'RB', 1500)] };
  const sideB = { team: team(2, roster(10)), assets: [p('big', 'WR', 6000)] };

  const evaluation = evaluateTrade({ sideA, sideB, format: FORMAT });
  assert.equal(evaluation.winnerName, 'Team 1');

  const suggestions = suggestBalancers({ sideA, sideB, format: FORMAT, evaluation });
  assert.ok(suggestions.length > 0, 'at least one balancer is found');
  assert.ok(suggestions.every((s) => s.improved));
  assert.ok(suggestions[0].resultingAbsPct < evaluation.fairnessAbsPct, 'the top suggestion is the most balancing');
  for (let i = 1; i < suggestions.length; i++) {
    assert.ok(suggestions[i - 1].resultingAbsPct <= suggestions[i].resultingAbsPct, 'sorted by resulting fairness');
  }
  assert.ok(!suggestions.some((s) => s.asset.id === 'small'), 'assets already in the trade are excluded');
});

test('no balancers are suggested for an already-even trade', () => {
  const sideA = { team: team(1, roster(10)), assets: [p('a', 'WR', 5000)] };
  const sideB = { team: team(2, roster(10)), assets: [p('b', 'RB', 5000)] };
  assert.deepEqual(suggestBalancers({ sideA, sideB, format: FORMAT }), []);
});

test('an empty side does not throw', () => {
  const res = evaluateTrade({
    sideA: { team: team(1, roster(10)), assets: [] },
    sideB: { team: team(2, roster(10)), assets: [p('x', 'WR', 3000)] },
    format: FORMAT,
  });
  assert.equal(res.sideB.rawIncoming, 0);
  assert.equal(res.sideA.rawIncoming, 3000);
  assert.equal(res.winnerName, 'Team 1');
});
