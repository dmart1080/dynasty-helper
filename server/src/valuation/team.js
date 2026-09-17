/**
 * Team valuation: totals, breakdowns, age profile, contention class,
 * positional needs and surpluses. Pure module.
 */
import { CORE_POSITIONS } from './format.js';
import { optimalLineup, starterValueByPosition, valueWeightedAge } from './lineup.js';
import { sum, median, zScores, clamp, round } from './stats.js';

export const TEAM_DEFAULTS = {
  // Contention score weights. Renormalised if a signal is unavailable.
  weights: { starterValue: 0.40, starterShare: 0.25, age: 0.20, record: 0.15 },
  // z-score cutoffs for the three classes.
  contenderThreshold: 0.5,
  rebuilderThreshold: -0.5,
  // A position is a "need" when starter value is this far below the league median.
  needSeverityThreshold: 0.25,
  // Surplus pieces below this fraction of replacement level are ignored as noise.
  surplusFloor: 0,
};

/**
 * Replacement level at a position: the value of the player ranked
 * numTeams × maxStartable(P) among all players at that position.
 *
 * That is the best player at P who would start for nobody if talent were spread
 * evenly — so value above it is what another roster would actually pay for.
 */
export function replacementLevels(allPlayers, format) {
  const levels = {};
  for (const pos of CORE_POSITIONS) {
    const startable = format.maxStartable?.[pos] ?? 0;
    const pool = allPlayers
      .filter((p) => p.position === pos && Number.isFinite(p.value))
      .sort((a, b) => b.value - a.value);
    if (!pool.length || startable === 0) { levels[pos] = 0; continue; }
    const index = clamp(Math.round(format.numTeams * startable) - 1, 0, pool.length - 1);
    levels[pos] = pool[index].value;
  }
  return levels;
}

/**
 * Value one team's roster and picks.
 *
 * @param {object} team  { rosterId, ownerId, teamName, managerName, players[], picks[], record }
 * @param {object} ctx   { format, replacement }
 */
export function evaluateTeam(team, ctx) {
  const { format } = ctx;
  const players = (team.players ?? []).filter((p) => Number.isFinite(p.value));
  const picks = team.picks ?? [];

  const lineup = optimalLineup(players, format.startingSlots);
  const starterByPos = starterValueByPosition(lineup);

  const playerValue = sum(players, (p) => p.value);
  const pickValue = sum(picks, (p) => p.value);
  const totalValue = playerValue + pickValue;

  // Breakdown by position, plus picks as their own bucket.
  //
  // Surplus is measured against the ACTUAL optimal lineup rather than against a
  // per-position slot count. Counting slots over-states capacity in superflex:
  // summing "TE can fill TE + FLEX + SUPER_FLEX" for every position at once
  // implies far more starting spots than the lineup really has. Asking the
  // solver who actually starts resolves flex contention correctly.
  const startingIds = new Set(lineup.starters.map((p) => String(p.id)));
  const byPosition = {};
  for (const pos of CORE_POSITIONS) {
    const atPos = players.filter((p) => p.position === pos).sort((a, b) => b.value - a.value);
    const startable = format.maxStartable?.[pos] ?? 0;
    const replacement = ctx.replacement?.[pos] ?? 0;
    const depth = atPos.filter((p) => !startingIds.has(String(p.id)));

    byPosition[pos] = {
      position: pos,
      count: atPos.length,
      startingCount: atPos.length - depth.length,
      totalValue: sum(atPos, (p) => p.value),
      starterValue: starterByPos[pos] ?? 0,
      // Only value the lineup cannot use, and only the part above replacement
      // level — that is what another roster would actually pay for.
      surplusValue: sum(depth, (p) => Math.max(0, p.value - replacement)),
      surplusPlayers: depth.filter((p) => p.value > replacement).map((p) => p.id),
      maxStartable: startable,
      replacementLevel: replacement,
      avgAge: valueWeightedAge(atPos),
      best: atPos[0] ?? null,
    };
  }

  const games = (team.record?.wins ?? 0) + (team.record?.losses ?? 0) + (team.record?.ties ?? 0);

  return {
    rosterId: team.rosterId,
    ownerId: team.ownerId,
    teamName: team.teamName,
    managerName: team.managerName,
    playerCount: players.length,
    pickCount: picks.length,
    playerValue,
    pickValue,
    totalValue,
    starterValue: lineup.starterValue,
    benchValue: lineup.benchValue,
    starterShare: totalValue > 0 ? lineup.starterValue / totalValue : 0,
    pickShare: totalValue > 0 ? pickValue / totalValue : 0,
    lineup,
    byPosition,
    avgAge: valueWeightedAge(players),
    starterAge: valueWeightedAge(lineup.starters),
    record: team.record ?? null,
    winPct: games > 0 ? ((team.record.wins ?? 0) + (team.record.ties ?? 0) * 0.5) / games : null,
    players,
    picks,
  };
}

/**
 * League-wide pass: classify teams and flag needs/surpluses.
 *
 * Classification (documented in the README):
 *   contendScore = 0.40·z(starterValue) + 0.25·z(starterShare)
 *                + 0.20·z(vwAge)        + 0.15·z(winPct)
 * Weights renormalise when a signal is missing (e.g. no games played yet).
 */
export function evaluateLeague(teams, ctx, opts = {}) {
  const cfg = { ...TEAM_DEFAULTS, ...opts, weights: { ...TEAM_DEFAULTS.weights, ...(opts.weights ?? {}) } };
  const evaluated = teams.map((t) => evaluateTeam(t, ctx));
  if (!evaluated.length) return { teams: [], medians: {}, replacement: ctx.replacement };

  const haveRecord = evaluated.some((t) => t.winPct !== null);
  const haveAge = evaluated.some((t) => Number.isFinite(t.avgAge));

  const zStarter = zScores(evaluated.map((t) => t.starterValue));
  const zShare = zScores(evaluated.map((t) => t.starterShare));
  const zAge = zScores(evaluated.map((t) => (Number.isFinite(t.avgAge) ? t.avgAge : 0)));
  const zRecord = zScores(evaluated.map((t) => t.winPct ?? 0));

  // Drop unavailable signals and renormalise the remaining weights to sum to 1.
  const active = { starterValue: cfg.weights.starterValue, starterShare: cfg.weights.starterShare };
  if (haveAge) active.age = cfg.weights.age;
  if (haveRecord) active.record = cfg.weights.record;
  const weightTotal = Object.values(active).reduce((a, b) => a + b, 0) || 1;

  evaluated.forEach((t, i) => {
    t.contendScore =
      ((active.starterValue ?? 0) * zStarter[i] +
       (active.starterShare ?? 0) * zShare[i] +
       (active.age ?? 0) * zAge[i] +
       (active.record ?? 0) * zRecord[i]) / weightTotal;

    t.mode = t.contendScore >= cfg.contenderThreshold ? 'contender'
      : t.contendScore <= cfg.rebuilderThreshold ? 'rebuilder'
        : 'middle';

    t.signals = {
      starterValueZ: round(zStarter[i], 2),
      starterShareZ: round(zShare[i], 2),
      ageZ: haveAge ? round(zAge[i], 2) : null,
      recordZ: haveRecord ? round(zRecord[i], 2) : null,
      weights: active,
    };
  });

  // League medians of starting value per position drive the "need" flags.
  const medians = {};
  for (const pos of CORE_POSITIONS) {
    medians[pos] = median(evaluated.map((t) => t.byPosition[pos]?.starterValue ?? 0));
  }

  for (const t of evaluated) {
    t.needs = [];
    t.surpluses = [];
    for (const pos of CORE_POSITIONS) {
      const slot = t.byPosition[pos];
      if (!slot || (format_maxStartable(ctx, pos) === 0)) continue;
      const med = medians[pos] || 0;
      const severity = med > 0 ? (med - slot.starterValue) / med : 0;
      slot.leagueMedianStarterValue = med;
      slot.needSeverity = round(severity, 3);
      slot.isNeed = severity >= cfg.needSeverityThreshold;
      slot.isSurplus = slot.surplusValue > cfg.surplusFloor;
      if (slot.isNeed) t.needs.push({ position: pos, severity: round(severity, 3), gap: round(med - slot.starterValue) });
      if (slot.isSurplus) t.surpluses.push({ position: pos, value: round(slot.surplusValue), players: slot.surplusPlayers });
    }
    t.needs.sort((a, b) => b.severity - a.severity);
    t.surpluses.sort((a, b) => b.value - a.value);
  }

  const ranked = [...evaluated].sort((a, b) => b.totalValue - a.totalValue);
  ranked.forEach((t, i) => { t.rank = i + 1; });
  const rankedByStarters = [...evaluated].sort((a, b) => b.starterValue - a.starterValue);
  rankedByStarters.forEach((t, i) => { t.starterRank = i + 1; });

  return { teams: ranked, medians, replacement: ctx.replacement };
}

const format_maxStartable = (ctx, pos) => ctx.format?.maxStartable?.[pos] ?? 0;
