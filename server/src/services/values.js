/**
 * Current player values: latest snapshot for a format, with manual overrides applied.
 */
import { all, get } from '../db/index.js';

/** The most recent capture date we hold for a format. */
export function latestCaptureDate(formatKey) {
  return get('SELECT MAX(captured_on) AS d FROM value_snapshots WHERE format_key = ?', formatKey)?.d ?? null;
}

export function getOverrides() {
  const rows = all('SELECT player_key, sleeper_id, name, pct, note, updated_at FROM value_overrides');
  return new Map(rows.map((r) => [r.player_key, r]));
}

/**
 * Values for a format keyed by sleeper player id.
 * `value` is post-override; `baseValue` is what the source published.
 */
export function getCurrentValues(formatKey, { capturedOn } = {}) {
  const date = capturedOn ?? latestCaptureDate(formatKey);
  if (!date) return { date: null, bySleeperId: new Map(), byKey: new Map(), sortedValues: [], rows: [] };

  const rows = all(
    `SELECT player_key, sleeper_id, name, position, team, value, overall_rank, position_rank,
            trend_30d, redraft_value, age
       FROM value_snapshots
      WHERE format_key = ? AND captured_on = ?
      ORDER BY value DESC`,
    formatKey, date);

  const overrides = getOverrides();
  const bySleeperId = new Map();
  const byKey = new Map();

  for (const r of rows) {
    const ov = overrides.get(r.player_key);
    const pct = ov ? Number(ov.pct) : 0;
    const value = pct ? Math.max(0, Math.round(r.value * (1 + pct / 100))) : r.value;
    const entry = {
      playerKey: r.player_key,
      sleeperId: r.sleeper_id,
      name: r.name,
      position: r.position,
      team: r.team,
      baseValue: r.value,
      value,
      overridePct: pct || null,
      overrideNote: ov?.note ?? null,
      overallRank: r.overall_rank,
      positionRank: r.position_rank,
      trend30d: r.trend_30d,
      redraftValue: r.redraft_value,
      sourceAge: r.age,
    };
    byKey.set(r.player_key, entry);
    if (r.sleeper_id) bySleeperId.set(String(r.sleeper_id), entry);
  }

  const sortedValues = [...byKey.values()].map((e) => e.value).sort((a, b) => b - a);
  return { date, bySleeperId, byKey, sortedValues, rows };
}

/** Round -> generic value, averaged across the source's early/mid/late buckets. */
export function getPickValuesByRound(formatKey, { capturedOn, currentSeason } = {}) {
  const date = capturedOn ?? get('SELECT MAX(captured_on) AS d FROM pick_values WHERE format_key = ?', formatKey)?.d;
  if (!date) return new Map();

  const rows = all(
    'SELECT label, season, round, slot_bucket, value FROM pick_values WHERE format_key = ? AND captured_on = ?',
    formatKey, date);

  // Use the nearest draft year as the baseline; future years are discounted by
  // the pick model itself, so mixing years here would double-count.
  const seasons = [...new Set(rows.map((r) => r.season).filter(Boolean))].sort();
  const baseSeason = currentSeason && seasons.includes(String(currentSeason)) ? String(currentSeason) : seasons[0];

  const byRound = new Map();
  for (const r of rows) {
    if (!r.round) continue;
    if (baseSeason && r.season && r.season !== baseSeason) continue;
    const list = byRound.get(r.round) ?? [];
    list.push(r.value);
    byRound.set(r.round, list);
  }
  // Average the buckets: mean(early, mid, late) ≈ the average pick in the round.
  return new Map([...byRound].map(([round, vals]) => [round, vals.reduce((a, b) => a + b, 0) / vals.length]));
}

/** Daily value history for one player, for the trend charts. */
export function getValueHistory(formatKey, playerKey, { days = 90 } = {}) {
  return all(
    `SELECT captured_on, value, overall_rank, position_rank
       FROM value_snapshots
      WHERE format_key = ? AND player_key = ?
      ORDER BY captured_on DESC
      LIMIT ?`,
    formatKey, playerKey, days).reverse();
}
