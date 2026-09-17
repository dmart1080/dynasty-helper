import config from '../config.js';
import { getJson, buildUrl, SourceError } from './http.js';

/**
 * FantasyCalc public dynasty values.
 *
 *   GET https://api.fantasycalc.com/values/current
 *       ?isDynasty=true&numQbs=2&numTeams=12&ppr=1
 *
 * Expected element shape (this is the contract `npm run verify:sources` checks):
 *   { player: { id, name, position, sleeperId, maybeAge, ... },
 *     value, overallRank, positionRank, trend30Day, redraftValue }
 *
 * This sandbox could not reach the host, so the reader below is deliberately
 * tolerant: every field is looked up through a list of candidate key spellings
 * and anything missing degrades to null rather than throwing. Only `value` and
 * a name are treated as required.
 */

const pick = (obj, keys, fallback = null) => {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return fallback;
};

const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const ROUND_WORDS = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };

/**
 * Recognises a draft-pick entry. FantasyCalc ships picks in the same feed with
 * position "PI" and names like "2027 Mid 1st". Falls back to name-sniffing so
 * picks are still detected if the position code differs.
 */
export function parsePickLabel(name, position) {
  const label = String(name ?? '').trim();
  const isPickPosition = ['PI', 'PICK', 'DP'].includes(String(position ?? '').toUpperCase());
  const m = label.match(/^(?:(\d{4})\s+)?(early|mid|late)?\s*(1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth)\b/i);
  if (!m) return isPickPosition ? { season: null, round: null, bucket: 'generic', label } : null;
  const round = ROUND_WORDS[m[3].toLowerCase()] ?? null;
  if (!isPickPosition && !m[1]) return null;   // avoid matching a player named e.g. "First"
  return {
    season: m[1] ?? null,
    round,
    bucket: m[2] ? m[2].toLowerCase() : 'generic',
    label,
  };
}

/** Normalise one feed element into our internal shape. Returns null if unusable. */
export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw.player && typeof raw.player === 'object' ? raw.player : raw;

  const name = pick(p, ['name', 'fullName', 'full_name', 'playerName']);
  const value = numOrNull(pick(raw, ['value', 'dynastyValue', 'currentValue']));
  if (!name || value === null) return null;

  const position = pick(p, ['position', 'pos', 'primaryPosition']);
  const sleeperIdRaw = pick(p, ['sleeperId', 'sleeper_id', 'sleeperPlayerId']);

  return {
    name: String(name),
    position: position ? String(position).toUpperCase() : null,
    team: pick(p, ['maybeTeam', 'team', 'nflTeam']),
    sleeperId: sleeperIdRaw === null ? null : String(sleeperIdRaw),
    sourceId: String(pick(p, ['id', 'playerId', 'fantasycalcId'], '')) || null,
    age: numOrNull(pick(p, ['maybeAge', 'age'])),
    birthDate: pick(p, ['maybeBirthday', 'birthday', 'birthDate']),
    value,
    overallRank: numOrNull(pick(raw, ['overallRank', 'rank', 'overall_rank'])),
    positionRank: numOrNull(pick(raw, ['positionRank', 'posRank', 'position_rank'])),
    trend30Day: numOrNull(pick(raw, ['trend30Day', 'trend30day', 'trend_30_day'])),
    redraftValue: numOrNull(pick(raw, ['redraftValue', 'redraft_value'])),
    pick: parsePickLabel(name, position),
  };
}

/**
 * Build the query for a league format. numQbs/numTeams/ppr come from the
 * league's own roster_positions and scoring_settings — never hardcoded.
 */
export function valuesQuery(format) {
  return {
    isDynasty: true,
    numQbs: format.numQbs,
    numTeams: format.numTeams,
    ppr: format.ppr,
  };
}

export function valuesUrl(format) {
  return buildUrl(config.values.baseUrl, config.values.valuesPath, valuesQuery(format));
}

/** Fetch and normalise the value feed for a league format. */
export async function getValues(format) {
  const url = valuesUrl(format);
  const data = await getJson(url, { source: 'fantasycalc', timeoutMs: config.values.timeoutMs });

  const list = Array.isArray(data) ? data : (Array.isArray(data?.values) ? data.values : null);
  if (!list) {
    throw new SourceError(
      `FantasyCalc response was not an array (got ${data === null ? 'null' : typeof data}). ` +
      `Run "npm run verify:sources" to inspect the live shape.`, { url },
    );
  }

  const entries = [];
  let skipped = 0;
  for (const raw of list) {
    const norm = normalizeEntry(raw);
    if (norm) entries.push(norm); else skipped++;
  }

  if (entries.length === 0) {
    throw new SourceError(`FantasyCalc returned ${list.length} rows but none matched the expected shape.`, { url });
  }

  return {
    url,
    entries: entries.filter((e) => !e.pick),
    picks: entries.filter((e) => e.pick),
    skipped,
    total: list.length,
  };
}
