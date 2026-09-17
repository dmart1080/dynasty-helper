import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorePartner, rankPartners, findTrades } from '../src/valuation/finder.js';
import { evaluateLeague, replacementLevels } from '../src/valuation/team.js';
import { deriveFormat } from '../src/valuation/format.js';

const FORMAT = deriveFormat({
  total_rosters: 6,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
  scoring_settings: { rec: 1 },
});

const p = (id, position, value, age = 25) => ({ id, name: id, position, value, age });
const pk = (id, value, season = '2027', round = 1) =>
  ({ id: `pick:${id}`, name: id, position: 'PICK', value, season, round });

/**
 * A six-team league where team 1 is QB-rich / TE-poor and team 2 is the mirror,
 * so the finder has an unambiguous best partner to discover.
 */
function buildLeague() {
  const filler = (tag, n = 6) =>
    Array.from({ length: n }, (_, i) => p(`${tag}f${i}`, ['RB', 'WR'][i % 2], 3000 - i * 200, 26));

  const teams = [
    { rosterId: 1, teamName: 'QB Rich', managerName: 'A', record: { wins: 3, losses: 3, ties: 0 },
      players: [p('qbA', 'QB', 9000, 27), p('qbB', 'QB', 8000, 26), p('qbC', 'QB', 6500, 25),
        p('teA', 'TE', 400, 29), ...filler('a')],
      picks: [pk('a1', 3000)] },
    // Five TEs: even after the flex and superflex slots absorb two of them,
    // genuine depth is left over for the finder to move.
    { rosterId: 2, teamName: 'TE Rich', managerName: 'B', record: { wins: 3, losses: 3, ties: 0 },
      players: [p('teB', 'TE', 6200, 25), p('teC', 'TE', 5000, 24), p('teD', 'TE', 4000, 26),
        p('teE', 'TE', 3600, 25), p('teF', 'TE', 3200, 27),
        p('qbD', 'QB', 500, 30), ...filler('b')],
      picks: [pk('b1', 3000)] },
    ...Array.from({ length: 4 }, (_, i) => ({
      rosterId: i + 3, teamName: `Mid ${i + 3}`, managerName: `M${i}`, record: { wins: 3, losses: 3, ties: 0 },
      players: [p(`q${i}`, 'QB', 5200, 26), p(`q${i}b`, 'QB', 4800, 26),
        p(`t${i}`, 'TE', 3000, 26), ...filler(`m${i}`)],
      picks: [pk(`m${i}1`, 3000)],
    })),
  ];

  const allPlayers = teams.flatMap((t) => t.players);
  const replacement = replacementLevels(allPlayers, FORMAT);
  const { teams: evaluated } = evaluateLeague(teams, { format: FORMAT, replacement });
  return { teams: evaluated, byId: new Map(evaluated.map((t) => [t.rosterId, t])) };
}

test('the mirror-image team scores as the best partner', () => {
  const { teams, byId } = buildLeague();
  const me = byId.get(1);
  const ranked = rankPartners(me, teams);
  assert.equal(ranked[0].rosterId, 2, 'TE Rich complements QB Rich better than any mid team');
  assert.ok(ranked[0].fit > ranked[1].fit);
});

test('partner fit counts both directions of complementarity', () => {
  const { byId } = buildLeague();
  const score = scorePartner(byId.get(1), byId.get(2));
  assert.ok(score.iGive > 0, 'my QB surplus meets their QB need');
  assert.ok(score.iGet > 0, 'their TE surplus meets my TE need');
  assert.ok(score.reasons.length > 0);
});

test('opposite modes are preferred and matching modes penalised', () => {
  const me = { rosterId: 1, mode: 'contender', byPosition: { QB: { surplusValue: 100, needSeverity: 0 }, TE: { surplusValue: 0, needSeverity: 0.5 } }, needs: [], surpluses: [] };
  const base = { byPosition: { QB: { surplusValue: 0, needSeverity: 0.5 }, TE: { surplusValue: 100, needSeverity: 0 } }, needs: [], surpluses: [] };

  const rebuilder = scorePartner(me, { ...base, rosterId: 2, teamName: 'R', mode: 'rebuilder' });
  const middle = scorePartner(me, { ...base, rosterId: 3, teamName: 'M', mode: 'middle' });
  const contender = scorePartner(me, { ...base, rosterId: 4, teamName: 'C', mode: 'contender' });

  assert.ok(rebuilder.fit > middle.fit, 'opposite mode gets a bonus');
  assert.ok(middle.fit > contender.fit, 'same mode is penalised');
  assert.equal(rebuilder.opposite, true);
  assert.equal(contender.same, true);
});

test('the finder returns packages within the stated value tolerance', () => {
  const { teams, byId } = buildLeague();
  const me = byId.get(1);
  const results = findTrades({
    me, partners: rankPartners(me, teams), teamsById: byId, format: FORMAT,
    options: { mode: 'contend', valueTolerance: 0.05, maxPiecesPerSide: 2 },
  });
  assert.ok(results.length > 0, 'at least one package is found');
  assert.ok(results.every((r) => r.fairnessAbsPct <= 0.05), 'every result respects the tolerance');
});

test('a tighter tolerance never returns more packages than a looser one', () => {
  const { teams, byId } = buildLeague();
  const me = byId.get(1);
  const common = { me, partners: rankPartners(me, teams), teamsById: byId, format: FORMAT };
  const loose = findTrades({ ...common, options: { mode: 'contend', valueTolerance: 0.2, maxResults: 100 } });
  const tight = findTrades({ ...common, options: { mode: 'contend', valueTolerance: 0.02, maxResults: 100 } });
  assert.ok(tight.length <= loose.length);
  assert.ok(tight.every((r) => r.fairnessAbsPct <= 0.02));
});

test('untouchable players never appear in any package', () => {
  const { teams, byId } = buildLeague();
  const me = byId.get(1);
  const results = findTrades({
    me, partners: rankPartners(me, teams), teamsById: byId, format: FORMAT,
    options: { mode: 'contend', valueTolerance: 0.15, untouchable: ['qbA', 'qbB'], maxResults: 100 },
  });
  const offered = results.flatMap((r) => r.give.map((g) => g.id));
  assert.ok(!offered.includes('qbA'));
  assert.ok(!offered.includes('qbB'));
});

test('when targets are set, every package brings one back', () => {
  const { teams, byId } = buildLeague();
  const me = byId.get(1);
  const results = findTrades({
    me, partners: rankPartners(me, teams), teamsById: byId, format: FORMAT,
    options: { mode: 'contend', valueTolerance: 0.25, targets: ['teB'], maxResults: 100 },
  });
  assert.ok(results.length > 0, 'a package containing the target exists');
  assert.ok(results.every((r) => r.get.some((g) => g.id === 'teB')));
});

test('max pieces per side is respected', () => {
  const { teams, byId } = buildLeague();
  const me = byId.get(1);
  const results = findTrades({
    me, partners: rankPartners(me, teams), teamsById: byId, format: FORMAT,
    options: { mode: 'contend', valueTolerance: 0.2, maxPiecesPerSide: 1, maxResults: 100 },
  });
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => r.give.length === 1 && r.get.length === 1));
  assert.ok(results.every((r) => r.shape === '1-for-1'));
});

test('rebuild mode values incoming picks and youth over incoming veterans', () => {
  const { teams, byId } = buildLeague();
  const me = byId.get(1);
  const common = { me, partners: rankPartners(me, teams), teamsById: byId, format: FORMAT };
  const rebuild = findTrades({ ...common, options: { mode: 'rebuild', valueTolerance: 0.25, maxResults: 100 } });
  const contend = findTrades({ ...common, options: { mode: 'contend', valueTolerance: 0.25, maxResults: 100 } });

  const pickShare = (list) => {
    const withPicks = list.filter((r) => r.get.some((g) => g.isPick)).length;
    return list.length ? withPicks / list.length : 0;
  };
  // Rebuild mode should not rank pick-returning packages below contend mode does.
  assert.ok(pickShare(rebuild) >= pickShare(contend));
  assert.ok(rebuild.length > 0 && contend.length > 0);
});

test('every package carries a non-trivial plain-English rationale', () => {
  const { teams, byId } = buildLeague();
  const me = byId.get(1);
  const results = findTrades({
    me, partners: rankPartners(me, teams), teamsById: byId, format: FORMAT,
    options: { mode: 'contend', valueTolerance: 0.15 },
  });
  assert.ok(results.length > 0);
  for (const r of results) {
    assert.equal(typeof r.rationale, 'string');
    assert.ok(r.rationale.length > 25, `rationale too short: "${r.rationale}"`);
  }
});

test('results are sorted by score, best first', () => {
  const { teams, byId } = buildLeague();
  const me = byId.get(1);
  const results = findTrades({
    me, partners: rankPartners(me, teams), teamsById: byId, format: FORMAT,
    options: { mode: 'contend', valueTolerance: 0.2 },
  });
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i - 1].score >= results[i].score);
  }
});

test('no packages are produced when everything is untouchable', () => {
  const { teams, byId } = buildLeague();
  const me = byId.get(1);
  const allMine = [...me.players, ...me.picks].map((a) => String(a.id));
  const results = findTrades({
    me, partners: rankPartners(me, teams), teamsById: byId, format: FORMAT,
    options: { mode: 'contend', valueTolerance: 0.3, untouchable: allMine },
  });
  assert.deepEqual(results, []);
});
