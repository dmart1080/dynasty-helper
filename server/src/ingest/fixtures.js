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

  // Backfill a value history so the trend charts and the movers list have
  // something real to show. Each asset gets its OWN seeded random walk with its
  // own drift — a single shared wave would move every player in lockstep and
  // make "biggest risers" meaningless.
  const seeded = (n) => {
    let t = (n * 2654435761) >>> 0;
    return () => {
      t = (t + 0x6D2B79F5) >>> 0;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  };

  // Walk each asset backwards from today so today's value is exactly the
  // published one and history diverges from it, not the other way round.
  const buildSeries = (assets, offset) => assets.map((asset, i) => {
    const rnd = seeded(i + offset);
    // Per-asset daily trend, kept small because it compounds across the window:
    // most assets drift a few percent over a month, a minority move ~20-30%,
    // which is the realistic shape of dynasty value movement.
    const trend = (rnd() - 0.5) * 0.003 + (rnd() < 0.12 ? (rnd() - 0.5) * 0.014 : 0);
    const series = new Array(days);
    let v = asset.value;
    series[days - 1] = Math.max(5, Math.round(v));
    for (let back = 1; back < days; back++) {
      // Undo one day of trend plus noise to get the previous day's value.
      v = v / (1 + trend + (rnd() - 0.5) * 0.008);
      series[days - 1 - back] = Math.max(5, Math.round(v));
    }
    return series;
  });

  const entrySeries = buildSeries(entries, 0);
  const pickSeries = buildSeries(picks, 100000);

  let totalRows = 0;
  for (let idx = 0; idx < days; idx++) {
    const back = days - 1 - idx;
    const date = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    const dayEntries = entries.map((e, i) => ({ ...e, value: entrySeries[i][idx] }));
    const dayPicks = picks.map((p, i) => ({ ...p, value: pickSeries[i][idx] }));
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
