/**
 * Ingestion orchestration.
 *
 * Design rule: a sync never throws because a source is down. It returns a
 * report listing what refreshed and what failed, and the app keeps serving the
 * last cached rows with their timestamp.
 */
import config from '../config.js';
import * as sleeper from '../sources/sleeper.js';
import { getValues } from '../sources/fantasycalc.js';
import { get, kvGet, kvSet } from '../db/index.js';
import { deriveFormat } from '../valuation/format.js';
import {
  saveLeague, saveUsers, saveRosters, savePlayers, saveTradedPicks,
  saveDrafts, saveTransactions, saveValueSnapshot, today,
} from './persist.js';

const ageMs = (iso) => (iso ? Date.now() - new Date(iso).getTime() : Infinity);

/** Refresh the ~5MB player file, but only if the cached copy is older than the TTL. */
export async function syncPlayers({ force = false } = {}) {
  const last = kvGet('players:last_refresh');
  const age = ageMs(last);
  if (!force && age < config.sleeper.playersTtlMs) {
    return { skipped: true, reason: `cached ${Math.round(age / 3600000)}h ago`, lastRefresh: last };
  }
  const map = await sleeper.getAllPlayers();
  const count = savePlayers(map);
  kvSet('players:last_refresh', new Date().toISOString());
  return { skipped: false, count, lastRefresh: kvGet('players:last_refresh') };
}

/** League, users, rosters, traded picks, drafts. */
export async function syncLeagueCore(leagueId) {
  const league = await sleeper.getLeague(leagueId);
  const format = saveLeague(league);

  const [users, rosters, picks, drafts] = await Promise.allSettled([
    sleeper.getUsers(leagueId),
    sleeper.getRosters(leagueId),
    sleeper.getTradedPicks(leagueId),
    sleeper.getDrafts(leagueId),
  ]);

  const out = { league: league.name, format, errors: [] };
  const take = (result, label, fn) => {
    if (result.status === 'fulfilled') out[label] = fn(result.value);
    else out.errors.push(`${label}: ${result.reason?.message ?? result.reason}`);
  };
  take(users, 'users', (v) => saveUsers(leagueId, v));
  take(rosters, 'rosters', (v) => saveRosters(leagueId, v));
  take(picks, 'tradedPicks', (v) => saveTradedPicks(leagueId, v));
  take(drafts, 'drafts', (v) => saveDrafts(leagueId, v));

  kvSet(`league:${leagueId}:last_sync`, new Date().toISOString());
  return out;
}

/**
 * Transactions week by week. Sleeper serves them per week, so we walk 1..week.
 * Weeks that fail individually are recorded and skipped rather than aborting.
 */
export async function syncTransactions(leagueId, { season, throughWeek } = {}) {
  let week = throughWeek;
  let seasonLabel = season;
  if (week === undefined || seasonLabel === undefined) {
    try {
      const state = await sleeper.getNflState();
      week = week ?? Math.max(1, Number(state?.week) || 1);
      seasonLabel = seasonLabel ?? state?.season;
    } catch {
      week = week ?? 18;
    }
  }
  if (!seasonLabel) {
    seasonLabel = get('SELECT season FROM leagues WHERE league_id = ?', leagueId)?.season ?? null;
  }

  let total = 0;
  const errors = [];
  for (let w = 1; w <= Math.min(week, 18); w++) {
    try {
      const list = await sleeper.getTransactions(leagueId, w);
      total += saveTransactions(leagueId, seasonLabel, list);
    } catch (err) {
      errors.push(`week ${w}: ${err.message}`);
    }
  }
  kvSet(`league:${leagueId}:last_tx_sync`, new Date().toISOString());
  return { transactions: total, throughWeek: Math.min(week, 18), season: seasonLabel, errors };
}

/**
 * Walk previous_league_id back through prior seasons and pull their trades too,
 * so manager tendencies are based on more than the current year.
 */
export async function syncHistory(leagueId, { maxSeasons = 3 } = {}) {
  const seasons = [];
  let cursor = get('SELECT previous_league_id FROM leagues WHERE league_id = ?', leagueId)?.previous_league_id;
  for (let i = 0; i < maxSeasons && cursor; i++) {
    try {
      const prev = await sleeper.getLeague(cursor);
      saveLeague(prev);
      const res = await syncTransactions(cursor, { season: prev.season, throughWeek: 18 });
      seasons.push({ leagueId: cursor, season: prev.season, transactions: res.transactions });
      cursor = prev.previous_league_id;
    } catch (err) {
      seasons.push({ leagueId: cursor, error: err.message });
      break;
    }
  }
  return { seasons };
}

/** Daily player-value snapshot for this league's format. */
export async function syncValues(format, { force = false } = {}) {
  const key = `values:${format.formatKey}:last_refresh`;
  const last = kvGet(key);
  const age = ageMs(last);
  const haveToday = get(
    'SELECT COUNT(*) AS n FROM value_snapshots WHERE format_key = ? AND captured_on = ?',
    format.formatKey, today(),
  )?.n ?? 0;

  if (!force && age < config.values.ttlMs && haveToday > 0) {
    return { skipped: true, reason: `snapshot for ${today()} already stored (${haveToday} players)`, lastRefresh: last };
  }

  const { entries, picks, url, skipped, total } = await getValues(format);
  const saved = saveValueSnapshot({ formatKey: format.formatKey, entries, picks });
  kvSet(key, new Date().toISOString());
  return { skipped: false, url, ...saved, unusableRows: skipped, totalRows: total };
}

/** Full refresh. Each stage is independent; failures are reported, not thrown. */
export async function syncAll(leagueId, { force = false, includeHistory = false } = {}) {
  const report = { leagueId, startedAt: new Date().toISOString(), stages: {}, errors: [] };

  const stage = async (name, fn) => {
    try { report.stages[name] = await fn(); }
    catch (err) { report.stages[name] = { failed: true, error: err.message }; report.errors.push(`${name}: ${err.message}`); }
  };

  await stage('players', () => syncPlayers({ force }));
  await stage('league', () => syncLeagueCore(leagueId));

  const row = get('SELECT roster_positions, scoring_settings, total_rosters FROM leagues WHERE league_id = ?', leagueId);
  let format = null;
  if (row) {
    format = deriveFormat({
      roster_positions: JSON.parse(row.roster_positions ?? '[]'),
      scoring_settings: JSON.parse(row.scoring_settings ?? '{}'),
      total_rosters: row.total_rosters,
    });
    await stage('values', () => syncValues(format, { force }));
  } else {
    report.errors.push('values: league format unknown (league fetch failed and nothing cached)');
  }

  await stage('transactions', () => syncTransactions(leagueId));
  if (includeHistory) await stage('history', () => syncHistory(leagueId));

  report.finishedAt = new Date().toISOString();
  report.ok = report.errors.length === 0;
  report.format = format;
  return report;
}
