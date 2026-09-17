import { Router } from 'express';
import { buildLeague } from '../services/league.js';
import { rankPartners, findTrades } from '../valuation/finder.js';
import { ok, fail, handler } from '../util/respond.js';

export const router = Router();

/**
 * POST /api/finder/search
 * {
 *   leagueId, rosterId, mode: 'contend'|'rebuild', pickMode?,
 *   untouchable: [assetId], targets: [assetId],
 *   maxPiecesPerSide: 2, valueTolerance: 0.05
 * }
 */
router.post('/search', handler((req, res) => {
  const {
    leagueId, rosterId, mode = 'contend', pickMode,
    untouchable = [], targets = [],
    maxPiecesPerSide = 2, valueTolerance = 0.05, maxResults = 12,
  } = req.body ?? {};

  if (!leagueId) return fail(res, 400, 'leagueId is required.');
  if (!rosterId) return fail(res, 400, 'rosterId is required — which team is yours?');

  const tolerance = Number(valueTolerance);
  if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 0.5) {
    return fail(res, 400, 'valueTolerance must be between 0 and 0.5 (e.g. 0.05 for ±5%).');
  }

  const league = buildLeague(leagueId, { pickMode: pickMode === 'generic' ? 'generic' : 'projected' });
  if (!league) return fail(res, 404, `League ${leagueId} is not cached.`, { needsSync: true });

  const byId = new Map(league.teams.map((t) => [t.rosterId, t]));
  const me = byId.get(Number(rosterId));
  if (!me) return fail(res, 404, `Roster ${rosterId} is not in this league.`);

  const partners = rankPartners(me, league.teams);
  const results = findTrades({
    me, partners, teamsById: byId, format: league.format,
    options: {
      mode: mode === 'rebuild' ? 'rebuild' : 'contend',
      untouchable, targets,
      maxPiecesPerSide: Number(maxPiecesPerSide) || 2,
      valueTolerance: tolerance,
      maxResults: Number(maxResults) || 12,
    },
  });

  ok(res, {
    me: {
      rosterId: me.rosterId, teamName: me.teamName, mode: me.mode,
      needs: me.needs, surpluses: me.surpluses,
    },
    mode,
    partners,
    results,
    searched: {
      tolerance, maxPiecesPerSide: Number(maxPiecesPerSide) || 2,
      untouchableCount: untouchable.length, targetCount: targets.length,
      partnersConsidered: partners.length,
    },
  }, league.meta);
}));

export default router;
