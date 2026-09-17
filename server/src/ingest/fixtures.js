/**
 * Loads the synthetic fixture league into SQLite through the same persistence
 * functions the live path uses.
 *
 * Purpose: let the app boot and be exercised with no network. Rows loaded this
 * way are stamped so the UI can label the league as demo data rather than
 * passing it off as real.
 */
import { generateFixtures } from '../../../fixtures/generate.js';
import { normalizeEntry } from '../sources/fantasycalc.js';
import { kvSet } from '../db/index.js';
import {
  saveLeague, saveUsers, saveRosters, savePlayers, saveTradedPicks,
  saveDrafts, saveTransactions, saveValueSnapshot, today,
} from './persist.js';

/** @param {{leagueId?: string, seed?: number, days?: number}} opts */
export function loadFixtures({ leagueId = '1312193587416436736', seed = 20260917, days = 30 } = {}) {
  const f = generateFixtures({ seed, leagueId });

  const format = saveLeague(f.league);
  saveUsers(leagueId, f.users);
  saveRosters(leagueId, f.rosters);
  savePlayers(f.players);
  saveTradedPicks(leagueId, f.tradedPicks);
  saveDrafts(leagueId, f.drafts);
  saveTransactions(leagueId, f.league.season, f.transactions);

  const normalized = f.valuesFeed.map(normalizeEntry).filter(Boolean);
  const entries = normalized.filter((e) => !e.pick);
  const picks = normalized.filter((e) => e.pick);

  // Backfill a value history so the trend charts have something to draw.
  // Random-walk backwards from today's values with a per-player drift.
  let totalRows = 0;
  for (let back = days - 1; back >= 0; back--) {
    const date = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    const drift = (i) => {
      const phase = Math.sin((i * 0.7) + (back * 0.22));
      return 1 + phase * 0.05 - (back / days) * 0.015;
    };
    const dayEntries = entries.map((e, i) => ({ ...e, value: Math.max(5, Math.round(e.value * drift(i))) }));
    const dayPicks = picks.map((p, i) => ({ ...p, value: Math.max(5, Math.round(p.value * drift(i + 500))) }));
    const res = saveValueSnapshot({ formatKey: format.formatKey, entries: dayEntries, picks: dayPicks, capturedOn: date });
    totalRows += res.players + res.picks;
  }

  const stamp = new Date().toISOString();
  kvSet('players:last_refresh', stamp);
  kvSet(`league:${leagueId}:last_sync`, stamp);
  kvSet(`league:${leagueId}:last_tx_sync`, stamp);
  kvSet(`values:${format.formatKey}:last_refresh`, stamp);
  kvSet(`league:${leagueId}:source`, 'fixture');

  return {
    leagueId,
    format,
    league: f.league.name,
    users: f.users.length,
    rosters: f.rosters.length,
    players: Object.keys(f.players).length,
    tradedPicks: f.tradedPicks.length,
    transactions: f.transactions.length,
    valueRows: totalRows,
    historyDays: days,
    capturedOn: today(),
  };
}

export default loadFixtures;
