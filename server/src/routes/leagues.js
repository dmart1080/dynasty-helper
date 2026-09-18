import { Router } from 'express';
import { all, get, kvGet } from '../db/index.js';
import config from '../config.js';
import { buildLeague, getFormat, getMeta, summarizeTeam } from '../services/league.js';
import { syncAll } from '../ingest/index.js';
import { describeFormat } from '../valuation/format.js';
import { ok, fail, handler } from '../util/respond.js';

export const router = Router();

/** Leagues already cached locally, for the league switcher. */
router.get('/', handler((req, res) => {
  const rows = all('SELECT league_id, name, season, total_rosters, format_key, fetched_at FROM leagues ORDER BY fetched_at DESC');
  ok(res, rows.map((r) => ({
    leagueId: r.league_id, name: r.name, season: r.season,
    totalRosters: r.total_rosters, formatKey: r.format_key, fetchedAt: r.fetched_at,
    isDemo: kvGet(`league:${r.league_id}:source`) === 'fixture',
  })), { defaultLeagueId: config.defaultLeagueId, defaultRosterId: config.defaultRosterId });
}));

/** League header: format, settings, freshness. */
router.get('/:leagueId', handler((req, res) => {
  const { leagueId } = req.params;
  const row = get('SELECT * FROM leagues WHERE league_id = ?', leagueId);
  if (!row) return fail(res, 404, `League ${leagueId} is not cached. Sync it first.`, { needsSync: true });
  const format = getFormat(leagueId);
  ok(res, {
    leagueId, name: row.name, season: row.season, status: row.status,
    totalRosters: row.total_rosters, format, formatLabel: describeFormat(format),
  }, getMeta(leagueId, format.formatKey));
}));

/**
 * Team Value Dashboard: every team ranked, with breakdowns, age profile,
 * classification, needs and surpluses.
 */
router.get('/:leagueId/teams', handler((req, res) => {
  const { leagueId } = req.params;
  const pickMode = req.query.pickMode === 'generic' ? 'generic' : 'projected';
  const league = buildLeague(leagueId, { pickMode });
  if (!league) return fail(res, 404, `League ${leagueId} is not cached. Sync it first.`, { needsSync: true });

  ok(res, {
    leagueId, name: league.name, season: league.season,
    formatLabel: league.formatLabel, format: league.format,
    pickMode, medians: league.medians, replacement: league.replacement,
    projectedSlots: league.projectedSlots,
    valuesDate: league.valuesDate,
    teams: league.teams.map(summarizeTeam),
  }, league.meta);
}));

/** One team in full: roster, optimal lineup, picks, needs. */
router.get('/:leagueId/teams/:rosterId', handler((req, res) => {
  const { leagueId, rosterId } = req.params;
  const pickMode = req.query.pickMode === 'generic' ? 'generic' : 'projected';
  const league = buildLeague(leagueId, { pickMode });
  if (!league) return fail(res, 404, `League ${leagueId} is not cached.`, { needsSync: true });

  const team = league.teams.find((t) => t.rosterId === Number(rosterId));
  if (!team) return fail(res, 404, `Roster ${rosterId} not found in league ${leagueId}.`);

  const starterIds = new Set(team.lineup.starters.map((s) => s.id));
  ok(res, {
    ...summarizeTeam(team),
    formatLabel: league.formatLabel,
    startingSlots: league.format.startingSlots,
    lineup: team.lineup.assignments.map((a) => ({
      slot: a.slot,
      player: a.player ? shapePlayer(a.player) : null,
    })),
    bench: team.lineup.bench.map(shapePlayer),
    roster: team.players.map((p) => ({ ...shapePlayer(p), starting: starterIds.has(p.id) })),
    picks: team.picks.map(shapePick).sort((a, b) => a.season.localeCompare(b.season) || a.round - b.round),
    medians: league.medians,
  }, league.meta);
}));

/** Every pick in the league, grouped by owner. */
router.get('/:leagueId/picks', handler((req, res) => {
  const { leagueId } = req.params;
  const pickMode = req.query.pickMode === 'generic' ? 'generic' : 'projected';
  const league = buildLeague(leagueId, { pickMode });
  if (!league) return fail(res, 404, `League ${leagueId} is not cached.`, { needsSync: true });

  const byOwner = new Map();
  for (const team of league.teams) byOwner.set(team.rosterId, { rosterId: team.rosterId, teamName: team.teamName, mode: team.mode, picks: [], totalValue: 0 });
  for (const pick of league.picks) {
    const bucket = byOwner.get(pick.ownerId);
    if (!bucket) continue;
    bucket.picks.push(shapePick(pick));
    bucket.totalValue += pick.value;
  }

  ok(res, {
    pickMode, seasons: league.pickSeasons, rounds: league.rounds,
    draftedSeasons: league.draftedSeasons,
    projectedSlots: league.projectedSlots,
    owners: [...byOwner.values()]
      .map((o) => ({ ...o, totalValue: Math.round(o.totalValue), picks: o.picks.sort((a, b) => a.season.localeCompare(b.season) || a.round - b.round) }))
      .sort((a, b) => b.totalValue - a.totalValue),
  }, league.meta);
}));

/** Trigger a refresh from the live APIs. */
router.post('/:leagueId/sync', handler(async (req, res) => {
  const report = await syncAll(req.params.leagueId, {
    force: req.query.force === 'true',
    includeHistory: req.query.history === 'true',
  });
  ok(res, report, getMeta(req.params.leagueId, report.format?.formatKey));
}));

export const shapePlayer = (p) => ({
  id: p.id, name: p.name, position: p.position, team: p.team, age: p.age,
  value: Math.round(p.value), baseValue: Math.round(p.baseValue ?? p.value),
  overridePct: p.overridePct ?? null, overallRank: p.overallRank,
  positionRank: p.positionRank, trend30d: p.trend30d,
  injuryStatus: p.injuryStatus ?? null, unvalued: !!p.unvalued,
});

export const shapePick = (p) => ({
  id: p.id, name: p.name, label: p.label, season: p.season, round: p.round,
  value: Math.round(p.value), genericValue: Math.round(p.genericValue ?? 0),
  originalRosterId: p.originalRosterId, originalTeamName: p.originalTeamName,
  ownerId: p.ownerId, traded: p.traded, projectedSlot: p.projectedSlot,
  slotMultiplier: p.slotMultiplier === undefined ? null : Math.round(p.slotMultiplier * 1000) / 1000,
  confidence: p.confidence, yearsOut: p.yearsOut, basis: p.basis, position: 'PICK',
});

export default router;
