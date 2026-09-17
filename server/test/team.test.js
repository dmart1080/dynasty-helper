import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTeam, evaluateLeague, replacementLevels } from '../src/valuation/team.js';
import { deriveFormat } from '../src/valuation/format.js';

const FORMAT = deriveFormat({
  total_rosters: 12,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN', 'BN', 'BN'],
  scoring_settings: { rec: 1 },
});

const p = (id, position, value, age = 25) => ({ id, position, value, age });

/** A league-wide player pool with a clean descending curve per position. */
function pool() {
  const out = [];
  for (const [pos, top, decay, n] of [['QB', 9000, 0.05, 40], ['RB', 7000, 0.07, 70], ['WR', 9000, 0.04, 100], ['TE', 6000, 0.1, 40]]) {
    for (let i = 0; i < n; i++) out.push(p(`${pos}${i + 1}`, pos, Math.round(top * Math.exp(-decay * i)), 24));
  }
  return out;
}

function team(rosterId, players, { picks = [], wins = 7, losses = 6 } = {}) {
  return { rosterId, ownerId: `u${rosterId}`, teamName: `Team ${rosterId}`, managerName: `Mgr ${rosterId}`, players, picks, record: { wins, losses, ties: 0 } };
}

test('replacement level sits at numTeams × maxStartable for each position', () => {
  const levels = replacementLevels(pool(), FORMAT);
  // QB: 12 teams × 2 startable = the 24th-best QB.
  const qbs = pool().filter((x) => x.position === 'QB').sort((a, b) => b.value - a.value);
  assert.equal(levels.QB, qbs[23].value);
  // WR: 12 × 5 = the 60th-best WR.
  const wrs = pool().filter((x) => x.position === 'WR').sort((a, b) => b.value - a.value);
  assert.equal(levels.WR, wrs[59].value);
  assert.ok(levels.QB > levels.TE, 'QBs are scarcer in superflex');
});

test('team totals split cleanly into players and picks', () => {
  const players = [p('a', 'QB', 5000), p('b', 'RB', 3000)];
  const picks = [{ id: 'pick:2027:1:1', value: 2000, season: '2027', round: 1 }];
  const t = evaluateTeam(team(1, players, { picks }), { format: FORMAT, replacement: {} });
  assert.equal(t.playerValue, 8000);
  assert.equal(t.pickValue, 2000);
  assert.equal(t.totalValue, 10000);
  assert.equal(t.pickShare, 0.2);
});

test('starter share is starter value over total value including picks', () => {
  const players = [p('qb', 'QB', 6000), p('rb', 'RB', 2000), p('bench', 'WR', 500)];
  const picks = [{ id: 'k', value: 1500 }];
  const t = evaluateTeam(team(1, players, { picks }), { format: FORMAT, replacement: {} });
  assert.equal(t.starterValue, 8500, 'all three players fit into the 9 starting slots');
  assert.equal(t.totalValue, 10000);
  assert.equal(t.starterShare, 0.85);
});

test('surplus counts only bench value above replacement level', () => {
  const replacement = { QB: 1000, RB: 1000, WR: 1000, TE: 1000 };
  // 6 RBs; maxStartable(RB) is 4, so RB5 and RB6 are depth.
  const players = [
    p('rb1', 'RB', 5000), p('rb2', 'RB', 4000), p('rb3', 'RB', 3000), p('rb4', 'RB', 2500),
    p('rb5', 'RB', 2000), p('rb6', 'RB', 900),
  ];
  const t = evaluateTeam(team(1, players), { format: FORMAT, replacement });
  // rb5 is 1000 above replacement; rb6 is below it and contributes nothing.
  assert.equal(t.byPosition.RB.surplusValue, 1000);
  assert.deepEqual(t.byPosition.RB.surplusPlayers, ['rb5']);
});

test('a team with no depth beyond its lineup shows zero surplus', () => {
  const replacement = { QB: 1000, RB: 1000, WR: 1000, TE: 1000 };
  const t = evaluateTeam(team(1, [p('rb1', 'RB', 5000), p('rb2', 'RB', 4000)]), { format: FORMAT, replacement });
  assert.equal(t.byPosition.RB.surplusValue, 0);
});

test('an old, top-heavy, winning roster classifies as a contender and a young pick-rich one as a rebuilder', () => {
  const strongOld = [p('q1', 'QB', 9000, 31), p('q2', 'QB', 8000, 32), p('r1', 'RB', 7000, 30),
    p('r2', 'RB', 6500, 29), p('w1', 'WR', 8500, 31), p('w2', 'WR', 8000, 30),
    p('w3', 'WR', 7500, 33), p('t1', 'TE', 6000, 30), p('f1', 'RB', 5000, 29)];
  const weakYoung = [p('q3', 'QB', 2000, 22), p('r3', 'RB', 1500, 22), p('w4', 'WR', 1800, 21),
    p('w5', 'WR', 1200, 23), p('t2', 'TE', 900, 22)];

  const teams = [
    team(1, strongOld, { wins: 11, losses: 2 }),
    team(2, weakYoung, { picks: [{ id: 'p1', value: 4000 }, { id: 'p2', value: 3500 }, { id: 'p3', value: 3000 }], wins: 2, losses: 11 }),
    ...Array.from({ length: 6 }, (_, i) => team(i + 3, [
      p(`m${i}a`, 'QB', 5000, 26), p(`m${i}b`, 'RB', 4000, 26),
      p(`m${i}c`, 'WR', 4500, 26), p(`m${i}d`, 'TE', 3000, 26),
    ], { picks: [{ id: `mp${i}`, value: 2000 }], wins: 6, losses: 7 })),
  ];

  const { teams: evaluated } = evaluateLeague(teams, { format: FORMAT, replacement: { QB: 1000, RB: 800, WR: 800, TE: 600 } });
  const byId = new Map(evaluated.map((t) => [t.rosterId, t]));
  assert.equal(byId.get(1).mode, 'contender');
  assert.equal(byId.get(2).mode, 'rebuilder');
  assert.ok(byId.get(1).contendScore > byId.get(2).contendScore);
});

test('classification weights renormalise when no games have been played', () => {
  const teams = Array.from({ length: 4 }, (_, i) => team(i + 1, [
    p(`a${i}`, 'QB', 5000 + i * 1000, 25), p(`b${i}`, 'RB', 3000, 25),
  ], { wins: 0, losses: 0 }));
  const { teams: evaluated } = evaluateLeague(teams, { format: FORMAT, replacement: {} });
  assert.ok(evaluated.every((t) => t.signals.recordZ === null), 'record signal is dropped');
  const weightSum = Object.values(evaluated[0].signals.weights).reduce((a, b) => a + b, 0);
  assert.ok(weightSum < 1, 'remaining weights are renormalised by their own sum');
  assert.ok(evaluated.every((t) => Number.isFinite(t.contendScore)));
});

test('an identical league produces zero z-scores and no extreme classifications', () => {
  const teams = Array.from({ length: 6 }, (_, i) => team(i + 1, [p(`a${i}`, 'QB', 5000, 26), p(`b${i}`, 'RB', 3000, 26)], { wins: 5, losses: 5 }));
  const { teams: evaluated } = evaluateLeague(teams, { format: FORMAT, replacement: {} });
  assert.ok(evaluated.every((t) => Math.abs(t.contendScore) < 1e-9));
  assert.ok(evaluated.every((t) => t.mode === 'middle'));
});

test('a position below the league median starter value is flagged as a need', () => {
  // Five teams with strong QBs, one with a weak QB.
  const teams = [
    ...Array.from({ length: 5 }, (_, i) => team(i + 1, [p(`q${i}`, 'QB', 8000, 26), p(`q${i}b`, 'QB', 7000, 26), p(`r${i}`, 'RB', 4000, 26)])),
    team(6, [p('weakqb', 'QB', 1000, 26), p('r6', 'RB', 4000, 26)]),
  ];
  const { teams: evaluated, medians } = evaluateLeague(teams, { format: FORMAT, replacement: { QB: 500, RB: 500, WR: 500, TE: 500 } });
  const weak = evaluated.find((t) => t.rosterId === 6);
  assert.ok(medians.QB > 0);
  assert.ok(weak.needs.some((n) => n.position === 'QB'), 'QB should be flagged');
  assert.ok(weak.byPosition.QB.needSeverity > 0.25);

  const strong = evaluated.find((t) => t.rosterId === 1);
  assert.ok(!strong.needs.some((n) => n.position === 'QB'));
});

test('teams are ranked by total value and separately by starter value', () => {
  const teams = [
    team(1, [p('a', 'QB', 5000, 25)], { picks: [{ id: 'x', value: 9000 }] }),   // pick-heavy
    team(2, [p('b', 'QB', 9000, 25)], { picks: [] }),                            // starter-heavy
  ];
  const { teams: evaluated } = evaluateLeague(teams, { format: FORMAT, replacement: {} });
  const byId = new Map(evaluated.map((t) => [t.rosterId, t]));
  assert.equal(byId.get(1).rank, 1, 'roster 1 has more total value (14000 vs 9000)');
  assert.equal(byId.get(2).starterRank, 1, 'roster 2 has more starting value');
});

test('an empty league returns empty results rather than throwing', () => {
  const res = evaluateLeague([], { format: FORMAT, replacement: {} });
  assert.deepEqual(res.teams, []);
});

test('a roster with no players does not produce NaN', () => {
  const t = evaluateTeam(team(1, []), { format: FORMAT, replacement: {} });
  assert.equal(t.totalValue, 0);
  assert.equal(t.starterShare, 0);
  assert.equal(t.avgAge, null);
});
