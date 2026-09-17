/**
 * Assembles the league picture: joins cached Sleeper rows to current values,
 * values every pick, and runs the valuation modules.
 *
 * Resolution order matters. Team strength determines projected draft slots, and
 * projected slots determine pick values — so strength is computed from PLAYERS
 * ONLY in a first pass. That is also the correct model: draft position is earned
 * on the field by the players, not by the picks a team happens to hold.
 */
import { all, get, kvGet, unj } from '../db/index.js';
import { deriveFormat, describeFormat, CORE_POSITIONS } from '../valuation/format.js';
import { evaluateLeague, evaluateTeam, replacementLevels } from '../valuation/team.js';
import { expandOwnedPicks, valuePick, projectDraftSlots } from '../valuation/picks.js';
import { optimalLineup } from '../valuation/lineup.js';
import { getCurrentValues, getPickValuesByRound, latestCaptureDate } from './values.js';

/** Exact age from a birth date; falls back to whatever the sources reported. */
export function computeAge(birthDate, fallbackAge, sourceAge) {
  if (birthDate) {
    const born = new Date(birthDate);
    if (!Number.isNaN(born.getTime())) {
      return Math.round(((Date.now() - born.getTime()) / (365.2425 * 86400000)) * 10) / 10;
    }
  }
  if (Number.isFinite(fallbackAge)) return Number(fallbackAge);
  if (Number.isFinite(sourceAge)) return Math.round(Number(sourceAge) * 10) / 10;
  return null;
}

export function getLeagueRow(leagueId) {
  const row = get('SELECT * FROM leagues WHERE league_id = ?', leagueId);
  if (!row) return null;
  return {
    ...row,
    roster_positions: unj(row.roster_positions, []),
    scoring_settings: unj(row.scoring_settings, {}),
    league_settings: unj(row.league_settings, {}),
  };
}

export function getFormat(leagueId) {
  const row = getLeagueRow(leagueId);
  if (!row) return null;
  return deriveFormat({
    roster_positions: row.roster_positions,
    scoring_settings: row.scoring_settings,
    total_rosters: row.total_rosters,
  });
}

/** Freshness of every cached source, for the stale-data banner. */
export function getMeta(leagueId, formatKey) {
  const lastSync = kvGet(`league:${leagueId}:last_sync`);
  const valuesRefresh = formatKey ? kvGet(`values:${formatKey}:last_refresh`) : null;
  const captureDate = formatKey ? latestCaptureDate(formatKey) : null;
  const failures = all(
    `SELECT source, url, status, error, fetched_at FROM fetch_log
      WHERE ok = 0 AND fetched_at > datetime('now', '-1 day')
      ORDER BY fetched_at DESC LIMIT 5`);

  const ageHours = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 3600000 : null);
  const leagueAge = ageHours(lastSync);
  const valueAge = ageHours(valuesRefresh);

  const warnings = [];
  if (leagueAge === null) warnings.push('League has never been synced.');
  else if (leagueAge > 24) warnings.push(`League data is ${Math.round(leagueAge)}h old.`);
  if (valueAge === null) warnings.push('Player values have never been fetched.');
  else if (valueAge > 48) warnings.push(`Player values are ${Math.round(valueAge / 24)} days old.`);
  if (failures.length) warnings.push(`${failures.length} fetch failure(s) in the last 24h.`);

  return {
    leagueSyncedAt: lastSync,
    valuesRefreshedAt: valuesRefresh,
    valuesCapturedOn: captureDate,
    isDemo: kvGet(`league:${leagueId}:source`) === 'fixture',
    stale: warnings.length > 0,
    warnings,
    recentFailures: failures,
  };
}

export function getUsersByRoster(leagueId) {
  const users = all('SELECT * FROM users WHERE league_id = ?', leagueId);
  return new Map(users.map((u) => [String(u.user_id), u]));
}

/**
 * The full league evaluation: every team valued, classified, with needs,
 * surpluses and picks.
 *
 * @param {string} leagueId
 * @param {{pickMode?: 'projected'|'generic'}} options
 */
export function buildLeague(leagueId, { pickMode = 'projected' } = {}) {
  const leagueRow = getLeagueRow(leagueId);
  if (!leagueRow) return null;

  const format = deriveFormat({
    roster_positions: leagueRow.roster_positions,
    scoring_settings: leagueRow.scoring_settings,
    total_rosters: leagueRow.total_rosters,
  });

  const values = getCurrentValues(format.formatKey);
  const usersById = getUsersByRoster(leagueId);
  const rosterRows = all('SELECT * FROM rosters WHERE league_id = ? ORDER BY roster_id', leagueId);
  const playerRows = all('SELECT * FROM players');
  const playersById = new Map(playerRows.map((p) => [String(p.player_id), p]));

  // ---- Join roster player ids to Sleeper metadata and current values ----
  const hydrate = (playerId) => {
    const meta = playersById.get(String(playerId));
    const val = values.bySleeperId.get(String(playerId));
    if (!meta && !val) return null;
    const position = meta?.position ?? val?.position ?? null;
    if (!position) return null;
    return {
      id: String(playerId),
      sleeperId: String(playerId),
      playerKey: val?.playerKey ?? `sleeper:${playerId}`,
      name: meta?.full_name ?? val?.name ?? `Player ${playerId}`,
      position,
      team: meta?.team ?? val?.team ?? null,
      age: computeAge(meta?.birth_date, meta?.age, val?.sourceAge),
      yearsExp: meta?.years_exp ?? null,
      injuryStatus: meta?.injury_status ?? null,
      value: val?.value ?? 0,
      baseValue: val?.baseValue ?? 0,
      overridePct: val?.overridePct ?? null,
      overallRank: val?.overallRank ?? null,
      positionRank: val?.positionRank ?? null,
      trend30d: val?.trend30d ?? null,
      unvalued: !val,
    };
  };

  const rosters = rosterRows.map((r) => {
    const ids = unj(r.players, []) ?? [];
    const players = ids.map(hydrate).filter(Boolean);
    const user = usersById.get(String(r.owner_id));
    return {
      rosterId: Number(r.roster_id),
      ownerId: r.owner_id,
      teamName: user?.team_name || user?.display_name || `Roster ${r.roster_id}`,
      managerName: user?.display_name || user?.username || `Roster ${r.roster_id}`,
      avatar: user?.avatar ?? null,
      players,
      record: { wins: r.wins, losses: r.losses, ties: r.ties, fpts: r.fpts, fptsAgainst: r.fpts_against },
      picks: [],
    };
  });

  // ---- Pass 1: strength from players only, to project draft order ----
  const allValuedPlayers = [...values.byKey.values()];
  const replacement = replacementLevels(allValuedPlayers, format);
  const pass1 = evaluateLeague(
    rosters.map((r) => ({ ...r, picks: [] })),
    { format, replacement },
  );
  const strengthByRoster = new Map(pass1.teams.map((t) => [t.rosterId, t.contendScore]));
  const projectedSlots = projectDraftSlots(
    rosters.map((r) => ({ rosterId: r.rosterId, strength: strengthByRoster.get(r.rosterId) ?? 0 })),
  );

  // ---- Value every owned pick ----
  const currentSeason = String(leagueRow.season ?? new Date().getFullYear());
  const draftRow = get('SELECT rounds FROM drafts WHERE league_id = ? ORDER BY season DESC LIMIT 1', leagueId);
  const rounds = Number(draftRow?.rounds) || Number(leagueRow.league_settings?.draft_rounds) || 4;

  // Current season's rookie draft plus the next two years, per the brief.
  const seasons = [];
  const startYear = Number(currentSeason);
  for (let i = 0; i <= 2; i++) seasons.push(String(startYear + i));

  const tradedPickRows = all('SELECT * FROM traded_picks WHERE league_id = ?', leagueId);
  const owned = expandOwnedPicks({
    rosterIds: rosters.map((r) => r.rosterId),
    seasons,
    rounds,
    tradedPicks: tradedPickRows,
  });

  const pickCtx = {
    currentSeason,
    numTeams: format.numTeams,
    projectedSlots,
    pickValuesByRound: getPickValuesByRound(format.formatKey, { currentSeason }),
    sortedValues: values.sortedValues,
    mode: pickMode,
  };

  const rosterById = new Map(rosters.map((r) => [r.rosterId, r]));
  const valuedPicks = [];
  for (const pick of owned) {
    const valued = valuePick(pick, pickCtx, {});
    const originalOwner = rosterById.get(pick.originalRosterId);
    valued.originalTeamName = originalOwner?.teamName ?? `Roster ${pick.originalRosterId}`;
    valued.label = `${pick.season} Round ${pick.round}`;
    valued.position = 'PICK';
    valued.name = valued.pickLabel
      ? `${pick.season} ${pick.round}.${String(Math.round(valued.projectedSlot)).padStart(2, '0')} (${valued.originalTeamName})`
      : `${pick.season} ${ordinal(pick.round)} (${valued.originalTeamName})`;
    valuedPicks.push(valued);
    rosterById.get(valued.ownerId)?.picks.push(valued);
  }

  // ---- Pass 2: full evaluation including picks ----
  const league = evaluateLeague(rosters, { format, replacement });

  return {
    leagueId,
    name: leagueRow.name,
    season: leagueRow.season,
    status: leagueRow.status,
    format,
    formatLabel: describeFormat(format),
    pickMode,
    rounds,
    pickSeasons: seasons,
    projectedSlots: Object.fromEntries(projectedSlots),
    replacement,
    medians: league.medians,
    teams: league.teams,
    picks: valuedPicks,
    valuesDate: values.date,
    valueIndex: values,
    playersById,
    meta: getMeta(leagueId, format.formatKey),
  };
}

export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

/** Compact team shape for list views — drops the heavy nested arrays. */
export function summarizeTeam(team) {
  return {
    rosterId: team.rosterId,
    teamName: team.teamName,
    managerName: team.managerName,
    rank: team.rank,
    starterRank: team.starterRank,
    mode: team.mode,
    contendScore: Math.round(team.contendScore * 1000) / 1000,
    totalValue: Math.round(team.totalValue),
    playerValue: Math.round(team.playerValue),
    pickValue: Math.round(team.pickValue),
    starterValue: Math.round(team.starterValue),
    benchValue: Math.round(team.benchValue),
    starterShare: Math.round(team.starterShare * 1000) / 1000,
    pickShare: Math.round(team.pickShare * 1000) / 1000,
    avgAge: team.avgAge === null ? null : Math.round(team.avgAge * 10) / 10,
    starterAge: team.starterAge === null ? null : Math.round(team.starterAge * 10) / 10,
    record: team.record,
    playerCount: team.playerCount,
    pickCount: team.pickCount,
    needs: team.needs,
    surpluses: team.surpluses,
    signals: team.signals,
    byPosition: Object.fromEntries(CORE_POSITIONS.map((pos) => {
      const p = team.byPosition[pos] ?? {};
      return [pos, {
        count: p.count ?? 0,
        totalValue: Math.round(p.totalValue ?? 0),
        starterValue: Math.round(p.starterValue ?? 0),
        surplusValue: Math.round(p.surplusValue ?? 0),
        avgAge: p.avgAge === null || p.avgAge === undefined ? null : Math.round(p.avgAge * 10) / 10,
        isNeed: !!p.isNeed,
        isSurplus: !!p.isSurplus,
        needSeverity: p.needSeverity ?? 0,
        leagueMedianStarterValue: Math.round(p.leagueMedianStarterValue ?? 0),
        maxStartable: p.maxStartable ?? 0,
      }];
    })),
  };
}
