/**
 * League Intelligence: manager trade tendencies derived from transaction history.
 *
 * Sleeper's trade rows tell us who moved what. Joining that to current values
 * gives a rough sense of what each manager buys and sells — "rough" because the
 * value applied is TODAY's, not the value on the trade date. Historical values
 * only exist from the day this app first ran, so old trades are priced at
 * current values and that caveat is surfaced in the UI.
 */
import { all, unj } from '../db/index.js';
import { getCurrentValues } from './values.js';

export function buildManagerIntel(leagueId, format) {
  const values = getCurrentValues(format.formatKey);

  const rosterRows = all('SELECT roster_id, owner_id FROM rosters WHERE league_id = ?', leagueId);
  const users = new Map(all('SELECT user_id, display_name, team_name FROM users WHERE league_id = ?', leagueId)
    .map((u) => [String(u.user_id), u]));

  const nameFor = (rosterId) => {
    const r = rosterRows.find((x) => Number(x.roster_id) === Number(rosterId));
    const u = r ? users.get(String(r.owner_id)) : null;
    return u?.team_name || u?.display_name || `Roster ${rosterId}`;
  };

  const playerMeta = new Map(all('SELECT player_id, full_name, position FROM players')
    .map((p) => [String(p.player_id), p]));

  // Current-season league plus any prior-season leagues we walked back through.
  const leagueIds = all(
    `WITH RECURSIVE chain(id) AS (
       SELECT ?
       UNION
       SELECT l.previous_league_id FROM leagues l JOIN chain c ON l.league_id = c.id
        WHERE l.previous_league_id IS NOT NULL
     ) SELECT id FROM chain WHERE id IS NOT NULL`, leagueId).map((r) => r.id);

  const placeholders = leagueIds.map(() => '?').join(',');
  const trades = all(
    `SELECT * FROM transactions
      WHERE league_id IN (${placeholders}) AND type = 'trade' AND status = 'complete'
      ORDER BY created DESC`, ...leagueIds);

  const stats = new Map();
  const ensure = (rosterId) => {
    const id = Number(rosterId);
    if (!stats.has(id)) {
      stats.set(id, {
        rosterId: id, teamName: nameFor(id),
        trades: 0, partners: new Map(),
        playersAcquired: 0, playersSent: 0,
        picksAcquired: 0, picksSent: 0,
        valueAcquired: 0, valueSent: 0,
        boughtByPosition: {}, soldByPosition: {},
        pieces: 0, lastTradeAt: null, firstTradeAt: null,
      });
    }
    return stats.get(id);
  };

  const valueOf = (playerId) => values.bySleeperId.get(String(playerId))?.value ?? 0;

  const recent = [];
  for (const t of trades) {
    const rosterIds = unj(t.roster_ids, []) ?? [];
    const adds = unj(t.adds, {}) ?? {};
    const drops = unj(t.drops, {}) ?? {};
    const picks = unj(t.draft_picks, []) ?? [];

    for (const rid of rosterIds) {
      const s = ensure(rid);
      s.trades++;
      if (t.created) {
        s.lastTradeAt = s.lastTradeAt === null ? t.created : Math.max(s.lastTradeAt, t.created);
        s.firstTradeAt = s.firstTradeAt === null ? t.created : Math.min(s.firstTradeAt, t.created);
      }
      for (const other of rosterIds) {
        if (Number(other) === Number(rid)) continue;
        s.partners.set(Number(other), (s.partners.get(Number(other)) ?? 0) + 1);
      }
    }

    // adds maps player_id -> the roster that RECEIVED them.
    for (const [playerId, toRoster] of Object.entries(adds)) {
      const s = ensure(toRoster);
      const meta = playerMeta.get(String(playerId));
      const pos = meta?.position ?? '?';
      const v = valueOf(playerId);
      s.playersAcquired++; s.valueAcquired += v; s.pieces++;
      s.boughtByPosition[pos] = (s.boughtByPosition[pos] ?? 0) + 1;
    }
    for (const [playerId, fromRoster] of Object.entries(drops)) {
      const s = ensure(fromRoster);
      const meta = playerMeta.get(String(playerId));
      const pos = meta?.position ?? '?';
      const v = valueOf(playerId);
      s.playersSent++; s.valueSent += v; s.pieces++;
      s.soldByPosition[pos] = (s.soldByPosition[pos] ?? 0) + 1;
    }
    for (const p of picks) {
      const to = ensure(p.owner_id);
      to.picksAcquired++; to.pieces++;
      to.boughtByPosition.PICK = (to.boughtByPosition.PICK ?? 0) + 1;
      if (p.previous_owner_id !== undefined && p.previous_owner_id !== null) {
        const from = ensure(p.previous_owner_id);
        from.picksSent++; from.pieces++;
        from.soldByPosition.PICK = (from.soldByPosition.PICK ?? 0) + 1;
      }
    }

    if (recent.length < 25) {
      recent.push({
        transactionId: t.transaction_id,
        week: t.week, season: t.season, created: t.created,
        teams: rosterIds.map((r) => ({ rosterId: Number(r), teamName: nameFor(r) })),
        moves: rosterIds.map((rid) => ({
          rosterId: Number(rid),
          teamName: nameFor(rid),
          received: [
            ...Object.entries(adds).filter(([, to]) => Number(to) === Number(rid))
              .map(([pid]) => ({
                id: pid, name: playerMeta.get(String(pid))?.full_name ?? `Player ${pid}`,
                position: playerMeta.get(String(pid))?.position ?? '?', value: Math.round(valueOf(pid)),
              })),
            ...picks.filter((p) => Number(p.owner_id) === Number(rid))
              .map((p) => ({ id: `pick:${p.season}:${p.round}`, name: `${p.season} round ${p.round}`, position: 'PICK', value: null })),
          ],
        })),
      });
    }
  }

  const list = [...stats.values()].map((s) => {
    const span = s.firstTradeAt && s.lastTradeAt
      ? Math.max(1, (s.lastTradeAt - s.firstTradeAt) / (1000 * 86400 * 30))
      : null;
    return {
      ...s,
      partners: [...s.partners.entries()]
        .map(([rosterId, count]) => ({ rosterId, teamName: nameFor(rosterId), count }))
        .sort((a, b) => b.count - a.count),
      valueAcquired: Math.round(s.valueAcquired),
      valueSent: Math.round(s.valueSent),
      netValue: Math.round(s.valueAcquired - s.valueSent),
      avgPiecesPerTrade: s.trades ? Math.round((s.pieces / s.trades) * 10) / 10 : 0,
      tradesPerMonth: span ? Math.round((s.trades / span) * 10) / 10 : null,
      // A rough read on behaviour: do they accumulate picks or spend them?
      pickStance: s.picksAcquired === s.picksSent ? 'neutral'
        : s.picksAcquired > s.picksSent ? 'accumulates picks' : 'spends picks',
      lastTradeAt: s.lastTradeAt,
    };
  }).sort((a, b) => b.trades - a.trades);

  // Teams that have never traded still belong in the list.
  for (const r of rosterRows) {
    if (!list.some((s) => s.rosterId === Number(r.roster_id))) {
      list.push({
        rosterId: Number(r.roster_id), teamName: nameFor(r.roster_id),
        trades: 0, partners: [], playersAcquired: 0, playersSent: 0,
        picksAcquired: 0, picksSent: 0, valueAcquired: 0, valueSent: 0, netValue: 0,
        boughtByPosition: {}, soldByPosition: {}, avgPiecesPerTrade: 0,
        tradesPerMonth: null, pickStance: 'no trades on record', lastTradeAt: null,
      });
    }
  }

  return {
    managers: list,
    recentTrades: recent,
    totalTrades: trades.length,
    seasonsCovered: [...new Set(trades.map((t) => t.season).filter(Boolean))].sort(),
    valuedAt: values.date,
    caveat: 'Trade values are computed at today’s player values, not the values on the trade date.',
  };
}
