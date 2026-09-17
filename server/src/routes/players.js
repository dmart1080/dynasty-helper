import { Router } from 'express';
import { all, get, run } from '../db/index.js';
import { getFormat, buildLeague } from '../services/league.js';
import { getCurrentValues, getValueHistory } from '../services/values.js';
import { isValidOverridePct, MAX_OVERRIDE_PCT } from '../valuation/overrides.js';
import { ok, fail, handler } from '../util/respond.js';

export const router = Router();

/** Player search for the trade calculator and watchlist. */
router.get('/search', handler((req, res) => {
  const { leagueId, q = '', limit = 25, includePicks = 'false' } = req.query;
  const format = getFormat(leagueId);
  if (!format) return fail(res, 404, 'League not cached.', { needsSync: true });

  const needle = String(q).toLowerCase().replace(/[^a-z0-9]/g, '');
  const values = getCurrentValues(format.formatKey);

  // Owner lookup so search results show who holds the player.
  const owners = new Map();
  for (const r of all('SELECT roster_id, players FROM rosters WHERE league_id = ?', leagueId)) {
    for (const pid of JSON.parse(r.players ?? '[]')) owners.set(String(pid), Number(r.roster_id));
  }
  const teamNames = new Map(all(
    `SELECT r.roster_id, COALESCE(u.team_name, u.display_name) AS name
       FROM rosters r LEFT JOIN users u ON u.user_id = r.owner_id AND u.league_id = r.league_id
      WHERE r.league_id = ?`, leagueId).map((r) => [Number(r.roster_id), r.name]));

  const rows = all(
    `SELECT player_id, full_name, position, team, age, birth_date, injury_status
       FROM players
      WHERE (? = '' OR search_name LIKE ?)
      ORDER BY full_name LIMIT 500`,
    needle, `%${needle}%`);

  const results = rows.map((r) => {
    const v = values.bySleeperId.get(String(r.player_id));
    const rosterId = owners.get(String(r.player_id)) ?? null;
    return {
      id: String(r.player_id), name: r.full_name, position: r.position, team: r.team,
      age: r.age, injuryStatus: r.injury_status,
      value: v?.value ?? 0, baseValue: v?.baseValue ?? 0, overridePct: v?.overridePct ?? null,
      overallRank: v?.overallRank ?? null, positionRank: v?.positionRank ?? null,
      trend30d: v?.trend30d ?? null,
      rosterId, ownerName: rosterId ? (teamNames.get(rosterId) ?? `Roster ${rosterId}`) : 'Free agent',
    };
  }).sort((a, b) => b.value - a.value).slice(0, Number(limit));

  // Picks are searchable assets too — the calculator needs them by name.
  let picks = [];
  if (includePicks === 'true') {
    const league = buildLeague(leagueId);
    picks = (league?.picks ?? [])
      .filter((p) => !needle || p.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(needle))
      .map((p) => ({
        id: p.id, name: p.name, position: 'PICK', value: Math.round(p.value),
        rosterId: p.ownerId, ownerName: teamNames.get(p.ownerId) ?? `Roster ${p.ownerId}`,
        season: p.season, round: p.round, originalTeamName: p.originalTeamName,
      }))
      .sort((a, b) => b.value - a.value).slice(0, 15);
  }

  ok(res, { players: results, picks }, { valuesDate: values.date });
}));

/** Daily value history for the trend chart. */
router.get('/:playerId/history', handler((req, res) => {
  const { leagueId, days = 90 } = req.query;
  const format = getFormat(leagueId);
  if (!format) return fail(res, 404, 'League not cached.', { needsSync: true });

  const playerKey = `sleeper:${req.params.playerId}`;
  const history = getValueHistory(format.formatKey, playerKey, { days: Number(days) });
  const meta = get('SELECT full_name, position, team, age FROM players WHERE player_id = ?', req.params.playerId);

  const first = history[0]?.value ?? null;
  const last = history.at(-1)?.value ?? null;
  ok(res, {
    playerId: req.params.playerId,
    name: meta?.full_name ?? null, position: meta?.position ?? null, team: meta?.team ?? null,
    history,
    change: first !== null && last !== null ? last - first : null,
    changePct: first ? Math.round(((last - first) / first) * 1000) / 10 : null,
  });
}));

/** Manual value overrides, as a +/- percentage that persists. */
router.get('/overrides/list', handler((req, res) => {
  ok(res, all('SELECT player_key, sleeper_id, name, pct, note, updated_at FROM value_overrides ORDER BY updated_at DESC'));
}));

router.put('/overrides/:playerId', handler((req, res) => {
  const pct = Number(req.body?.pct);
  if (!Number.isFinite(pct)) return fail(res, 400, 'pct must be a number, e.g. 10 for +10% or -15 for -15%.');
  if (!isValidOverridePct(pct)) return fail(res, 400, `pct must be between -${MAX_OVERRIDE_PCT} and ${MAX_OVERRIDE_PCT}.`);

  const meta = get('SELECT full_name FROM players WHERE player_id = ?', req.params.playerId);
  run(
    `INSERT INTO value_overrides (player_key, sleeper_id, name, pct, note, updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(player_key) DO UPDATE SET pct=excluded.pct, note=excluded.note, updated_at=excluded.updated_at`,
    `sleeper:${req.params.playerId}`, req.params.playerId, meta?.full_name ?? null,
    pct, req.body?.note ?? null, new Date().toISOString());

  ok(res, { playerKey: `sleeper:${req.params.playerId}`, pct, note: req.body?.note ?? null });
}));

router.delete('/overrides/:playerId', handler((req, res) => {
  run('DELETE FROM value_overrides WHERE player_key = ?', `sleeper:${req.params.playerId}`);
  ok(res, { removed: `sleeper:${req.params.playerId}` });
}));

export default router;
