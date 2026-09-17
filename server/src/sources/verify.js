#!/usr/bin/env node
/**
 * Source doctor.  `npm run verify:sources [leagueId]`
 *
 * Calls every endpoint this app depends on and reports, per endpoint:
 * reachability, HTTP status, and whether the response satisfies the contract
 * the code expects. Run it before trusting the app, and again any time data
 * looks wrong — it tells you whether the problem is upstream or in here.
 */
import config from '../config.js';
import { buildUrl } from './http.js';
import { deriveFormat, describeFormat } from '../valuation/format.js';
import { normalizeEntry, valuesUrl } from './fantasycalc.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', RESET = '\x1b[0m';
const ok = (s) => `${GREEN}PASS${RESET} ${s}`;
const bad = (s) => `${RED}FAIL${RESET} ${s}`;
const warn = (s) => `${YELLOW}WARN${RESET} ${s}`;

const results = [];
function record(name, status, detail) {
  results.push({ name, status, detail });
  const line = status === 'pass' ? ok(name) : status === 'warn' ? warn(name) : bad(name);
  console.log(line);
  if (detail) console.log(`${DIM}     ${detail}${RESET}`);
}

async function probe(label, url, check) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'dynasty-helper/1.0' }, signal: AbortSignal.timeout(45000) });
    const ms = Date.now() - started;
    if (!res.ok) {
      record(label, 'fail', `HTTP ${res.status} ${res.statusText} in ${ms}ms — ${url}`);
      return null;
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) {
      record(label, 'fail', `Response was not JSON (${e.message}) — ${url}`);
      return null;
    }
    const detail = check ? check(data, { ms, bytes: text.length, url }) : `HTTP 200 in ${ms}ms, ${text.length} bytes`;
    record(label, detail?.status ?? 'pass', detail?.detail ?? detail);
    return data;
  } catch (err) {
    record(label, 'fail', `${err.name}: ${err.message} — ${url}`);
    return null;
  }
}

const has = (obj, keys) => keys.filter((k) => obj?.[k] === undefined);

async function main() {
  const leagueId = process.argv[2] || config.defaultLeagueId;
  console.log(`\n${DIM}Dynasty Helper — source verification${RESET}`);
  console.log(`${DIM}league ${leagueId} | sleeper ${config.sleeper.baseUrl} | values ${config.values.baseUrl}${config.values.valuesPath}${RESET}\n`);

  console.log('── Sleeper ─────────────────────────────────────────');

  const league = await probe('GET /league/{id}', buildUrl(config.sleeper.baseUrl, `league/${leagueId}`), (d, m) => {
    const missing = has(d, ['league_id', 'roster_positions', 'scoring_settings', 'total_rosters']);
    if (missing.length) return { status: 'fail', detail: `Missing required fields: ${missing.join(', ')}` };
    return { status: 'pass', detail: `"${d.name}" · ${d.season} · ${d.total_rosters} teams · ${m.ms}ms\n     roster_positions: ${JSON.stringify(d.roster_positions)}\n     scoring rec=${d.scoring_settings?.rec}, bonus_rec_te=${d.scoring_settings?.bonus_rec_te ?? 0}` };
  });

  let format = null;
  if (league) {
    format = deriveFormat(league);
    record('Format derivation', 'pass',
      `${describeFormat(format)} → FantasyCalc numQbs=${format.numQbs}, numTeams=${format.numTeams}, ppr=${format.ppr}\n     format_key=${format.formatKey} · ${format.starterCount} starters · maxStartable=${JSON.stringify(format.maxStartable)}`);
  }

  await probe('GET /league/{id}/rosters', buildUrl(config.sleeper.baseUrl, `league/${leagueId}/rosters`), (d) => {
    if (!Array.isArray(d)) return { status: 'fail', detail: 'Not an array' };
    const r = d[0] ?? {};
    const missing = has(r, ['roster_id', 'players']);
    return missing.length
      ? { status: 'warn', detail: `${d.length} rosters but first is missing: ${missing.join(', ')}` }
      : { status: 'pass', detail: `${d.length} rosters · first has ${r.players?.length ?? 0} players, ${r.starters?.length ?? 0} starters, record ${r.settings?.wins ?? 0}-${r.settings?.losses ?? 0}` };
  });

  await probe('GET /league/{id}/users', buildUrl(config.sleeper.baseUrl, `league/${leagueId}/users`), (d) =>
    Array.isArray(d)
      ? { status: 'pass', detail: `${d.length} users · e.g. "${d[0]?.display_name}" (team: ${d[0]?.metadata?.team_name ?? '—'})` }
      : { status: 'fail', detail: 'Not an array' });

  await probe('GET /league/{id}/traded_picks', buildUrl(config.sleeper.baseUrl, `league/${leagueId}/traded_picks`), (d) => {
    if (!Array.isArray(d)) return { status: 'fail', detail: 'Not an array' };
    if (d.length === 0) return { status: 'warn', detail: 'Empty — no picks have been traded in this league yet (not an error)' };
    const missing = has(d[0], ['season', 'round', 'roster_id', 'owner_id']);
    return missing.length
      ? { status: 'fail', detail: `First pick missing: ${missing.join(', ')}` }
      : { status: 'pass', detail: `${d.length} traded picks · e.g. ${JSON.stringify(d[0])}` };
  });

  await probe('GET /league/{id}/drafts', buildUrl(config.sleeper.baseUrl, `league/${leagueId}/drafts`), (d) =>
    Array.isArray(d)
      ? { status: 'pass', detail: `${d.length} drafts · e.g. ${d[0]?.season} ${d[0]?.type}, ${d[0]?.settings?.rounds} rounds, status=${d[0]?.status}` }
      : { status: 'fail', detail: 'Not an array' });

  const state = await probe('GET /state/nfl', buildUrl(config.sleeper.baseUrl, 'state/nfl'), (d) =>
    d?.week !== undefined
      ? { status: 'pass', detail: `season ${d.season} ${d.season_type}, week ${d.week} (display ${d.display_week})` }
      : { status: 'fail', detail: `Unexpected: ${JSON.stringify(d).slice(0, 200)}` });

  const week = state?.week ?? 1;
  await probe(`GET /league/{id}/transactions/${week}`, buildUrl(config.sleeper.baseUrl, `league/${leagueId}/transactions/${week}`), (d) => {
    if (!Array.isArray(d)) return { status: 'fail', detail: 'Not an array' };
    const trade = d.find((t) => t.type === 'trade');
    return { status: 'pass', detail: `${d.length} transactions in week ${week} (${d.filter((t) => t.type === 'trade').length} trades)${trade ? `\n     trade keys: ${Object.keys(trade).join(', ')}` : ''}` };
  });

  await probe('GET /players/nfl (5MB, once per day)', buildUrl(config.sleeper.baseUrl, 'players/nfl'), (d, m) => {
    const ids = Object.keys(d ?? {});
    if (ids.length === 0) return { status: 'fail', detail: 'Empty player map' };
    const sample = d[ids.find((id) => d[id]?.position === 'WR' && d[id]?.birth_date) ?? ids[0]];
    return { status: 'pass', detail: `${ids.length} players, ${(m.bytes / 1048576).toFixed(1)}MB in ${m.ms}ms\n     sample: ${sample?.full_name} ${sample?.position} ${sample?.team} birth_date=${sample?.birth_date} age=${sample?.age}` };
  });

  console.log('\n── Value source (FantasyCalc) ──────────────────────');

  const fmt = format ?? { numQbs: 2, numTeams: 12, ppr: 1 };
  if (!format) console.log(`${YELLOW}     League unavailable — probing with numQbs=2, numTeams=12, ppr=1${RESET}`);

  await probe('GET /values/current', valuesUrl(fmt), (d, m) => {
    const list = Array.isArray(d) ? d : d?.values;
    if (!Array.isArray(list)) {
      return { status: 'fail', detail: `Expected an array, got ${d === null ? 'null' : typeof d}. Top-level keys: ${Object.keys(d ?? {}).join(', ') || '(none)'}` };
    }
    const normalized = list.map(normalizeEntry).filter(Boolean);
    const picks = normalized.filter((e) => e.pick);
    const withSleeper = normalized.filter((e) => e.sleeperId);
    const first = list[0];

    const lines = [
      `${list.length} rows in ${m.ms}ms, ${(m.bytes / 1024).toFixed(0)}KB`,
      `normalized ${normalized.length} (${list.length - normalized.length} unusable)`,
      `${withSleeper.length} carry a sleeperId — needed to match Sleeper rosters`,
      `${picks.length} draft-pick entries${picks.length ? ` e.g. ${picks.slice(0, 4).map((p) => `"${p.name}"=${p.value}`).join(', ')}` : ' — pick values will fall back to the rank-anchor model'}`,
      `top asset: ${normalized[0]?.name} (${normalized[0]?.position}) = ${normalized[0]?.value}`,
      `element keys: ${Object.keys(first ?? {}).join(', ')}`,
      `player keys: ${Object.keys(first?.player ?? {}).join(', ')}`,
    ];

    let status = 'pass';
    if (normalized.length === 0) status = 'fail';
    else if (withSleeper.length < normalized.length * 0.5) status = 'warn';
    return { status, detail: lines.join('\n     ') };
  });

  console.log('\n── Summary ─────────────────────────────────────────');
  const fails = results.filter((r) => r.status === 'fail');
  const warns = results.filter((r) => r.status === 'warn');
  console.log(`${results.filter((r) => r.status === 'pass').length} passed, ${warns.length} warnings, ${fails.length} failed\n`);
  if (fails.length) {
    console.log(`${RED}Failing contracts must be fixed before the data is trustworthy:${RESET}`);
    for (const f of fails) console.log(`  · ${f.name}`);
    console.log(`\nIf FantasyCalc failed, set FANTASYCALC_BASE_URL / FANTASYCALC_VALUES_PATH in .env\nand re-run. The adapter in server/src/sources/fantasycalc.js maps fields in one\nplace (normalizeEntry) if key names have changed.\n`);
  }
  process.exit(fails.length ? 1 : 0);
}

main().catch((err) => { console.error(`${RED}Verifier crashed:${RESET}`, err); process.exit(2); });
