import { Router } from 'express';
import { buildLeague } from '../services/league.js';
import { evaluateTrade, suggestBalancers } from '../valuation/trade.js';
import { ok, fail, handler } from '../util/respond.js';

export const router = Router();

/**
 * POST /api/trades/evaluate
 * {
 *   leagueId, pickMode?,
 *   sideA: { rosterId, assetIds: [] },   // assetIds are what THAT side gives up
 *   sideB: { rosterId, assetIds: [] }
 * }
 * Player asset ids are Sleeper player ids; pick ids look like "pick:2027:1:4".
 */
router.post('/evaluate', handler((req, res) => {
  const { leagueId, sideA, sideB, pickMode } = req.body ?? {};
  if (!leagueId) return fail(res, 400, 'leagueId is required.');
  if (!sideA?.rosterId || !sideB?.rosterId) return fail(res, 400, 'Both sides need a rosterId.');
  if (Number(sideA.rosterId) === Number(sideB.rosterId)) return fail(res, 400, 'A team cannot trade with itself.');

  const league = buildLeague(leagueId, { pickMode: pickMode === 'generic' ? 'generic' : 'projected' });
  if (!league) return fail(res, 404, `League ${leagueId} is not cached.`, { needsSync: true });

  const teamA = league.teams.find((t) => t.rosterId === Number(sideA.rosterId));
  const teamB = league.teams.find((t) => t.rosterId === Number(sideB.rosterId));
  if (!teamA || !teamB) return fail(res, 404, 'One of those rosters is not in this league.');

  const resolve = (team, ids) => {
    const pool = new Map([...team.players, ...team.picks].map((x) => [String(x.id), x]));
    const found = [], missing = [];
    for (const id of ids ?? []) {
      const asset = pool.get(String(id));
      if (asset) found.push(asset); else missing.push(id);
    }
    return { found, missing };
  };

  const a = resolve(teamA, sideA.assetIds);
  const b = resolve(teamB, sideB.assetIds);
  if (a.missing.length || b.missing.length) {
    return fail(res, 400,
      `Some assets are not owned by the side offering them: ${[...a.missing, ...b.missing].join(', ')}`);
  }
  if (!a.found.length && !b.found.length) return fail(res, 400, 'Add at least one asset to a side.');

  const inputA = { team: teamA, assets: a.found };
  const inputB = { team: teamB, assets: b.found };
  const evaluation = evaluateTrade({ sideA: inputA, sideB: inputB, format: league.format });
  const suggestions = suggestBalancers({ sideA: inputA, sideB: inputB, format: league.format, evaluation });

  // Needs before/after, so you can see whether the trade actually fixes a hole.
  const needsSnapshot = (team, side) => ({
    before: team.needs.map((n) => n.position),
    surplusBefore: team.surpluses.map((s) => s.position),
    starterDelta: side.lineup.delta,
  });

  ok(res, {
    ...evaluation,
    suggestions,
    context: {
      formatLabel: league.formatLabel,
      rosterSize: league.format.rosterSize,
      medians: league.medians,
      sideANeeds: needsSnapshot(teamA, evaluation.sideA),
      sideBNeeds: needsSnapshot(teamB, evaluation.sideB),
    },
  }, league.meta);
}));

/** Every tradeable asset a roster owns, for the picker UI. */
router.get('/assets/:leagueId/:rosterId', handler((req, res) => {
  const { leagueId, rosterId } = req.params;
  const league = buildLeague(leagueId, { pickMode: req.query.pickMode === 'generic' ? 'generic' : 'projected' });
  if (!league) return fail(res, 404, `League ${leagueId} is not cached.`, { needsSync: true });

  const team = league.teams.find((t) => t.rosterId === Number(rosterId));
  if (!team) return fail(res, 404, `Roster ${rosterId} not found.`);

  ok(res, {
    rosterId: team.rosterId,
    teamName: team.teamName,
    mode: team.mode,
    players: [...team.players].sort((x, y) => y.value - x.value).map((x) => ({
      id: x.id, name: x.name, position: x.position, team: x.team,
      age: x.age, value: Math.round(x.value), positionRank: x.positionRank,
    })),
    picks: [...team.picks].sort((x, y) => y.value - x.value).map((x) => ({
      id: x.id, name: x.name, position: 'PICK', season: x.season, round: x.round,
      value: Math.round(x.value), originalTeamName: x.originalTeamName,
    })),
  }, league.meta);
}));

export default router;
