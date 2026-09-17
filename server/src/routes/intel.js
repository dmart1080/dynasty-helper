import { Router } from 'express';
import { all, get, run } from '../db/index.js';
import { getFormat, getMeta, buildLeague } from '../services/league.js';
import { buildManagerIntel } from '../services/intel.js';
import { getCurrentValues, getValueHistory } from '../services/values.js';
import { ok, fail, handler } from '../util/respond.js';

export const router = Router();

/** Manager trade tendencies: frequency, partners, what they buy and sell. */
router.get('/:leagueId/managers', handler((req, res) => {
  const { leagueId } = req.params;
  const format = getFormat(leagueId);
  if (!format) return fail(res, 404, `League ${leagueId} is not cached.`, { needsSync: true });
  ok(res, buildManagerIntel(leagueId, format), getMeta(leagueId, format.formatKey));
}));

/** Watchlist with current owner and value trend. */
router.get('/:leagueId/watchlist', handler((req, res) => {
  const { leagueId } = req.params;
  const format = getFormat(leagueId);
  if (!format) return fail(res, 404, `League ${leagueId} is not cached.`, { needsSync: true });

  const rows = all('SELECT sleeper_id, note, target_value, created_at FROM watchlist WHERE league_id = ? ORDER BY created_at DESC', leagueId);
  if (rows.length === 0) return ok(res, { players: [] }, getMeta(leagueId, format.formatKey));

  const values = getCurrentValues(format.formatKey);
  const owners = new Map();
  for (const r of all('SELECT roster_id, players FROM rosters WHERE league_id = ?', leagueId)) {
    for (const pid of JSON.parse(r.players ?? '[]')) owners.set(String(pid), Number(r.roster_id));
  }
  const teamNames = new Map(all(
    `SELECT r.roster_id, COALESCE(u.team_name, u.display_name) AS name
       FROM rosters r LEFT JOIN users u ON u.user_id = r.owner_id AND u.league_id = r.league_id
      WHERE r.league_id = ?`, leagueId).map((r) => [Number(r.roster_id), r.name]));

  const players = rows.map((w) => {
    const meta = get('SELECT full_name, position, team, age, injury_status FROM players WHERE player_id = ?', w.sleeper_id);
    const v = values.bySleeperId.get(String(w.sleeper_id));
    const history = getValueHistory(format.formatKey, `sleeper:${w.sleeper_id}`, { days: 60 });
    const first = history[0]?.value ?? null;
    const last = history.at(-1)?.value ?? v?.value ?? null;
    const rosterId = owners.get(String(w.sleeper_id)) ?? null;

    return {
      id: String(w.sleeper_id),
      name: meta?.full_name ?? v?.name ?? `Player ${w.sleeper_id}`,
      position: meta?.position ?? v?.position ?? '?',
      team: meta?.team ?? null,
      age: meta?.age ?? null,
      injuryStatus: meta?.injury_status ?? null,
      value: v?.value ?? 0,
      trend30d: v?.trend30d ?? null,
      ownerRosterId: rosterId,
      ownerName: rosterId ? (teamNames.get(rosterId) ?? `Roster ${rosterId}`) : 'Free agent',
      note: w.note,
      targetValue: w.target_value,
      addedAt: w.created_at,
      history,
      change: first !== null && last !== null ? Math.round(last - first) : null,
      changePct: first ? Math.round(((last - first) / first) * 1000) / 10 : null,
      atTarget: w.target_value ? (v?.value ?? 0) <= w.target_value : null,
    };
  });

  ok(res, { players }, getMeta(leagueId, format.formatKey));
}));

router.post('/:leagueId/watchlist', handler((req, res) => {
  const { playerId, note, targetValue } = req.body ?? {};
  if (!playerId) return fail(res, 400, 'playerId is required.');
  const exists = get('SELECT player_id FROM players WHERE player_id = ?', String(playerId));
  if (!exists) return fail(res, 404, `No cached player with id ${playerId}.`);

  run(`INSERT INTO watchlist (league_id, sleeper_id, note, target_value, created_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(league_id, sleeper_id) DO UPDATE SET note=excluded.note, target_value=excluded.target_value`,
    req.params.leagueId, String(playerId), note ?? null,
    targetValue === undefined || targetValue === null || targetValue === '' ? null : Number(targetValue),
    new Date().toISOString());

  ok(res, { playerId: String(playerId), added: true });
}));

router.delete('/:leagueId/watchlist/:playerId', handler((req, res) => {
  run('DELETE FROM watchlist WHERE league_id = ? AND sleeper_id = ?', req.params.leagueId, String(req.params.playerId));
  ok(res, { removed: String(req.params.playerId) });
}));

/** Biggest movers over the stored history, for the trends view. */
router.get('/:leagueId/movers', handler((req, res) => {
  const { leagueId } = req.params;
  const days = Number(req.query.days) || 30;
  const format = getFormat(leagueId);
  if (!format) return fail(res, 404, `League ${leagueId} is not cached.`, { needsSync: true });

  const dates = all(
    'SELECT DISTINCT captured_on FROM value_snapshots WHERE format_key = ? ORDER BY captured_on DESC LIMIT ?',
    format.formatKey, days);
  if (dates.length < 2) {
    return ok(res, { risers: [], fallers: [], from: null, to: null, daysAvailable: dates.length },
      getMeta(leagueId, format.formatKey));
  }

  const to = dates[0].captured_on;
  const from = dates.at(-1).captured_on;

  const rows = all(
    `SELECT n.player_key, n.sleeper_id, n.name, n.position, n.value AS now_value,
            o.value AS then_value, (n.value - o.value) AS delta,
            CASE WHEN o.value > 0 THEN (n.value - o.value) * 100.0 / o.value ELSE 0 END AS pct
       FROM value_snapshots n
       JOIN value_snapshots o
         ON o.player_key = n.player_key AND o.format_key = n.format_key AND o.captured_on = ?
      WHERE n.format_key = ? AND n.captured_on = ? AND o.value > 200
      ORDER BY pct DESC`,
    from, format.formatKey, to);

  const owners = new Map();
  for (const r of all('SELECT roster_id, players FROM rosters WHERE league_id = ?', leagueId)) {
    for (const pid of JSON.parse(r.players ?? '[]')) owners.set(String(pid), Number(r.roster_id));
  }
  const teamNames = new Map(all(
    `SELECT r.roster_id, COALESCE(u.team_name, u.display_name) AS name
       FROM rosters r LEFT JOIN users u ON u.user_id = r.owner_id AND u.league_id = r.league_id
      WHERE r.league_id = ?`, leagueId).map((r) => [Number(r.roster_id), r.name]));

  const shape = (r) => ({
    id: r.sleeper_id, playerKey: r.player_key, name: r.name, position: r.position,
    value: Math.round(r.now_value), previousValue: Math.round(r.then_value),
    delta: Math.round(r.delta), pct: Math.round(r.pct * 10) / 10,
    ownerName: owners.has(String(r.sleeper_id))
      ? (teamNames.get(owners.get(String(r.sleeper_id))) ?? 'Rostered') : 'Free agent',
  });

  ok(res, {
    from, to, daysAvailable: dates.length,
    risers: rows.slice(0, 10).map(shape),
    fallers: rows.slice(-10).reverse().map(shape),
  }, getMeta(leagueId, format.formatKey));
}));

export default router;
