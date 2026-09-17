/**
 * Persistence for ingested payloads.
 *
 * Every function here takes raw Sleeper/FantasyCalc-shaped objects and writes
 * them to SQLite. Live ingestion and fixture loading both go through these, so
 * offline mode exercises exactly the same code as the real thing.
 */
import { tx, run, j, bind } from '../db/index.js';
import { deriveFormat } from '../valuation/format.js';

const now = () => new Date().toISOString();
export const today = (d = new Date()) => d.toISOString().slice(0, 10);

export function saveLeague(league) {
  const format = deriveFormat(league);
  run(
    `INSERT INTO leagues (league_id, name, season, season_type, sport, status, total_rosters,
        roster_positions, scoring_settings, league_settings, previous_league_id, draft_id, avatar, format_key, fetched_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(league_id) DO UPDATE SET
       name=excluded.name, season=excluded.season, season_type=excluded.season_type, sport=excluded.sport,
       status=excluded.status, total_rosters=excluded.total_rosters, roster_positions=excluded.roster_positions,
       scoring_settings=excluded.scoring_settings, league_settings=excluded.league_settings,
       previous_league_id=excluded.previous_league_id, draft_id=excluded.draft_id, avatar=excluded.avatar,
       format_key=excluded.format_key, fetched_at=excluded.fetched_at`,
    league.league_id, bind(league.name), bind(league.season), bind(league.season_type), bind(league.sport),
    bind(league.status), bind(league.total_rosters), j(league.roster_positions), j(league.scoring_settings),
    j(league.settings), bind(league.previous_league_id), bind(league.draft_id), bind(league.avatar),
    format.formatKey, now(),
  );
  return format;
}

export function saveUsers(leagueId, users) {
  const stamp = now();
  tx((db) => {
    const stmt = db.prepare(
      `INSERT INTO users (league_id, user_id, username, display_name, team_name, avatar, fetched_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(league_id, user_id) DO UPDATE SET
         username=excluded.username, display_name=excluded.display_name,
         team_name=excluded.team_name, avatar=excluded.avatar, fetched_at=excluded.fetched_at`);
    for (const u of users) {
      stmt.run(leagueId, String(u.user_id), bind(u.username), bind(u.display_name),
        bind(u.metadata?.team_name), bind(u.avatar), stamp);
    }
  });
  return users.length;
}

export function saveRosters(leagueId, rosters) {
  const stamp = now();
  tx((db) => {
    const stmt = db.prepare(
      `INSERT INTO rosters (league_id, roster_id, owner_id, co_owners, players, starters, reserve, taxi,
          wins, losses, ties, fpts, fpts_against, settings, fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(league_id, roster_id) DO UPDATE SET
         owner_id=excluded.owner_id, co_owners=excluded.co_owners, players=excluded.players,
         starters=excluded.starters, reserve=excluded.reserve, taxi=excluded.taxi, wins=excluded.wins,
         losses=excluded.losses, ties=excluded.ties, fpts=excluded.fpts, fpts_against=excluded.fpts_against,
         settings=excluded.settings, fetched_at=excluded.fetched_at`);
    for (const r of rosters) {
      const s = r.settings ?? {};
      // Sleeper splits points into whole + hundredths (fpts / fpts_decimal).
      const pts = (whole, dec) => Number(whole ?? 0) + Number(dec ?? 0) / 100;
      stmt.run(leagueId, Number(r.roster_id), bind(r.owner_id), j(r.co_owners), j(r.players ?? []),
        j(r.starters ?? []), j(r.reserve ?? []), j(r.taxi ?? []),
        Number(s.wins ?? 0), Number(s.losses ?? 0), Number(s.ties ?? 0),
        pts(s.fpts, s.fpts_decimal), pts(s.fpts_against, s.fpts_against_decimal), j(s), stamp);
    }
  });
  return rosters.length;
}

export function savePlayers(playerMap) {
  const stamp = now();
  let count = 0;
  tx((db) => {
    const stmt = db.prepare(
      `INSERT INTO players (player_id, first_name, last_name, full_name, search_name, position,
          fantasy_positions, team, birth_date, age, years_exp, status, injury_status, number, college, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(player_id) DO UPDATE SET
         first_name=excluded.first_name, last_name=excluded.last_name, full_name=excluded.full_name,
         search_name=excluded.search_name, position=excluded.position, fantasy_positions=excluded.fantasy_positions,
         team=excluded.team, birth_date=excluded.birth_date, age=excluded.age, years_exp=excluded.years_exp,
         status=excluded.status, injury_status=excluded.injury_status, number=excluded.number,
         college=excluded.college, updated_at=excluded.updated_at`);
    for (const [id, p] of Object.entries(playerMap)) {
      if (!p || typeof p !== 'object') continue;
      const position = p.position ?? (Array.isArray(p.fantasy_positions) ? p.fantasy_positions[0] : null);
      // Skip the long tail of non-fantasy players; keeps the DB and searches small.
      if (!position || !['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(position)) continue;
      const fullName = p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(' ');
      stmt.run(String(id), bind(p.first_name), bind(p.last_name), bind(fullName),
        bind(p.search_full_name ?? fullName.toLowerCase().replace(/[^a-z]/g, '')),
        bind(position), j(p.fantasy_positions ?? [position]), bind(p.team), bind(p.birth_date),
        bind(p.age === undefined || p.age === null ? null : Number(p.age)),
        bind(p.years_exp === undefined || p.years_exp === null ? null : Number(p.years_exp)),
        bind(p.status), bind(p.injury_status),
        bind(p.number === undefined || p.number === null ? null : Number(p.number)),
        bind(p.college), stamp);
      count++;
    }
  });
  return count;
}

export function saveTradedPicks(leagueId, picks) {
  const stamp = now();
  tx((db) => {
    db.prepare('DELETE FROM traded_picks WHERE league_id = ?').run(leagueId);
    const stmt = db.prepare(
      `INSERT INTO traded_picks (league_id, season, round, original_roster_id, current_owner_id, previous_owner_id, fetched_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(league_id, season, round, original_roster_id) DO UPDATE SET
         current_owner_id=excluded.current_owner_id, previous_owner_id=excluded.previous_owner_id,
         fetched_at=excluded.fetched_at`);
    for (const p of picks) {
      stmt.run(leagueId, String(p.season), Number(p.round), Number(p.roster_id),
        bind(p.owner_id === undefined ? null : Number(p.owner_id)),
        bind(p.previous_owner_id === undefined || p.previous_owner_id === null ? null : Number(p.previous_owner_id)),
        stamp);
    }
  });
  return picks.length;
}

export function saveDrafts(leagueId, drafts) {
  const stamp = now();
  tx((db) => {
    const stmt = db.prepare(
      `INSERT INTO drafts (draft_id, league_id, season, rounds, type, status, slot_to_roster_id, draft_order, settings, start_time, fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(draft_id) DO UPDATE SET
         league_id=excluded.league_id, season=excluded.season, rounds=excluded.rounds, type=excluded.type,
         status=excluded.status, slot_to_roster_id=excluded.slot_to_roster_id, draft_order=excluded.draft_order,
         settings=excluded.settings, start_time=excluded.start_time, fetched_at=excluded.fetched_at`);
    for (const d of drafts) {
      stmt.run(String(d.draft_id), leagueId, bind(d.season), bind(Number(d.settings?.rounds ?? 0)),
        bind(d.type), bind(d.status), j(d.slot_to_roster_id), j(d.draft_order), j(d.settings),
        bind(d.start_time === undefined || d.start_time === null ? null : Number(d.start_time)), stamp);
    }
  });
  return drafts.length;
}

export function saveTransactions(leagueId, season, transactions) {
  const stamp = now();
  tx((db) => {
    const stmt = db.prepare(
      `INSERT INTO transactions (transaction_id, league_id, type, status, week, season, created,
          roster_ids, adds, drops, draft_picks, waiver_budget, creator, consenter_ids, fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(transaction_id) DO UPDATE SET
         type=excluded.type, status=excluded.status, week=excluded.week, season=excluded.season,
         created=excluded.created, roster_ids=excluded.roster_ids, adds=excluded.adds, drops=excluded.drops,
         draft_picks=excluded.draft_picks, waiver_budget=excluded.waiver_budget, creator=excluded.creator,
         consenter_ids=excluded.consenter_ids, fetched_at=excluded.fetched_at`);
    for (const t of transactions) {
      stmt.run(String(t.transaction_id), leagueId, bind(t.type), bind(t.status),
        bind(t.week === undefined || t.week === null ? null : Number(t.week)), bind(season),
        bind(t.created === undefined || t.created === null ? null : Number(t.created)),
        j(t.roster_ids ?? []), j(t.adds ?? {}), j(t.drops ?? {}), j(t.draft_picks ?? []),
        j(t.waiver_budget ?? []), bind(t.creator), j(t.consenter_ids ?? []), stamp);
    }
  });
  return transactions.length;
}

/** One row per player per day; re-running the same day overwrites rather than duplicating. */
export function saveValueSnapshot({ formatKey, entries, picks, source = 'fantasycalc', capturedOn = today() }) {
  tx((db) => {
    const stmt = db.prepare(
      `INSERT INTO value_snapshots (captured_on, source, format_key, player_key, sleeper_id, source_id,
          name, position, team, value, overall_rank, position_rank, trend_30d, redraft_value, age)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(captured_on, source, format_key, player_key) DO UPDATE SET
         value=excluded.value, overall_rank=excluded.overall_rank, position_rank=excluded.position_rank,
         trend_30d=excluded.trend_30d, redraft_value=excluded.redraft_value, age=excluded.age,
         name=excluded.name, position=excluded.position, team=excluded.team`);
    for (const e of entries) {
      const playerKey = e.sleeperId ? `sleeper:${e.sleeperId}` : `fc:${e.sourceId ?? e.name}`;
      stmt.run(capturedOn, source, formatKey, playerKey, bind(e.sleeperId), bind(e.sourceId),
        bind(e.name), bind(e.position), bind(e.team), Number(e.value),
        bind(e.overallRank), bind(e.positionRank), bind(e.trend30Day), bind(e.redraftValue), bind(e.age));
    }

    const pickStmt = db.prepare(
      `INSERT INTO pick_values (captured_on, source, format_key, label, season, round, slot_bucket, value)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(captured_on, source, format_key, label) DO UPDATE SET
         value=excluded.value, season=excluded.season, round=excluded.round, slot_bucket=excluded.slot_bucket`);
    for (const p of picks ?? []) {
      pickStmt.run(capturedOn, source, formatKey, p.name, bind(p.pick?.season),
        bind(p.pick?.round), bind(p.pick?.bucket ?? 'generic'), Number(p.value));
    }
  });
  return { players: entries.length, picks: picks?.length ?? 0, capturedOn };
}
