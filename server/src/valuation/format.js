/**
 * League format derivation.
 *
 * Everything here is read off the league's own roster_positions and
 * scoring_settings. Nothing about superflex or PPR is assumed.
 *
 * Pure module: no I/O, no imports from db/ or sources/.
 */

/** Slots that are not part of the starting lineup. */
export const BENCH_SLOTS = new Set(['BN', 'IR', 'TAXI', 'RES']);

/** Which positions may fill each slot code. */
export const SLOT_ELIGIBILITY = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  DL: ['DL', 'DE', 'DT'],
  LB: ['LB'],
  DB: ['DB', 'CB', 'S'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  WRRB_WRT: ['RB', 'WR', 'TE'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  IDP_FLEX: ['DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S'],
};

/** Offensive skill positions we report on. */
export const CORE_POSITIONS = ['QB', 'RB', 'WR', 'TE'];

export function eligibleFor(slot) {
  const code = String(slot ?? '').toUpperCase();
  return SLOT_ELIGIBILITY[code] ?? [code];
}

/**
 * Derive the format from a Sleeper league object.
 * @param {{roster_positions?: string[], scoring_settings?: object, total_rosters?: number}} league
 */
export function deriveFormat(league = {}) {
  const rosterPositions = Array.isArray(league.roster_positions) ? league.roster_positions : [];
  const scoring = league.scoring_settings ?? {};

  const startingSlots = rosterPositions.filter((s) => !BENCH_SLOTS.has(String(s).toUpperCase()));
  const benchSlots = rosterPositions.filter((s) => BENCH_SLOTS.has(String(s).toUpperCase()));

  const counts = {};
  for (const slot of rosterPositions) {
    const code = String(slot).toUpperCase();
    counts[code] = (counts[code] ?? 0) + 1;
  }

  const superflex = (counts.SUPER_FLEX ?? 0) > 0;
  const qbSlots = counts.QB ?? 0;
  // FantasyCalc models a superflex league as a 2-QB league.
  const numQbs = Math.min(2, Math.max(1, qbSlots + (superflex ? 1 : 0)));

  const ppr = Number(scoring.rec ?? 0) || 0;
  const tePremium = Number(scoring.bonus_rec_te ?? 0) || 0;
  const numTeams = Number(league.total_rosters) || 12;

  // How many players at a position can start at once: dedicated slots + any flex they qualify for.
  const maxStartable = {};
  for (const pos of [...CORE_POSITIONS, 'K', 'DEF']) {
    maxStartable[pos] = startingSlots.filter((slot) => eligibleFor(slot).includes(pos)).length;
  }

  return {
    numTeams,
    numQbs,
    ppr,
    superflex,
    tePremium,
    rosterPositions,
    startingSlots,
    benchSlots,
    slotCounts: counts,
    starterCount: startingSlots.length,
    rosterSize: rosterPositions.filter((s) => String(s).toUpperCase() !== 'IR' && String(s).toUpperCase() !== 'TAXI').length,
    taxiSlots: counts.TAXI ?? 0,
    irSlots: counts.IR ?? 0,
    maxStartable,
    formatKey: formatKey({ numTeams, numQbs, ppr, superflex }),
  };
}

/** Stable key partitioning value snapshots by league format. */
export function formatKey({ numTeams, numQbs, ppr, superflex }) {
  const qb = superflex ? 'sf' : `${numQbs}qb`;
  const pprPart = `${String(ppr).replace('.', '')}ppr`;
  return `dyn-${qb}-${numTeams}t-${pprPart}`;
}

/** Human-readable one-liner for the UI. */
export function describeFormat(format) {
  const parts = [`${format.numTeams}-team`];
  parts.push(format.superflex ? 'Superflex' : `${format.numQbs}QB`);
  if (format.ppr === 1) parts.push('PPR');
  else if (format.ppr === 0.5) parts.push('Half-PPR');
  else if (format.ppr === 0) parts.push('Standard');
  else parts.push(`${format.ppr}-PPR`);
  if (format.tePremium) parts.push(`TE+${format.tePremium}`);
  return parts.join(' · ');
}
