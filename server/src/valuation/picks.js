/**
 * Draft pick valuation. Pure module.
 *
 * Two modes, switched by `mode`:
 *   'projected' — value a pick by where it is likely to land, using the
 *                 ORIGINAL owner's team strength. A rebuilder's 1st is worth
 *                 more than a contender's 1st.
 *   'generic'   — flat "a 1st is a 1st" values, ignoring who it came from.
 *
 * Both modes discount future years.
 */
import { clamp } from './stats.js';

export const PICK_DEFAULTS = {
  // Within-round decay. Higher k = steeper drop from pick 1.01 to 1.12.
  // Later rounds are flatter because the talent gap narrows.
  roundDecay: { 1: 1.25, 2: 0.9, 3: 0.7, 4: 0.6 },
  // How much we trust a slot projection N years out. 0.6^1 = 60%, 0.6^2 = 36%.
  slotConfidenceBase: 0.6,
  // Ordinary time-value discount for picks in future drafts.
  futureYearDiscount: 0.85,
  // Fallback generic values are read off the value curve at these rank anchors,
  // scaled by league size: round 1 ≈ the player ranked 2.8 × numTeams.
  rankAnchors: { 1: 2.8, 2: 5.5, 3: 9, 4: 13, 5: 18 },
};

/**
 * Within-round multiplier, normalised so the mean across the round is exactly 1.
 * That keeps a "generic Nth" equal to the average pick in that round, so
 * switching modes never changes total league pick value by construction.
 *
 *   pos  = (slot − 0.5) / numTeams               ∈ (0,1)
 *   mult = exp(−k(pos − 0.5)) · k / (2·sinh(k/2))
 */
export function slotMultiplier(slot, numTeams, round, opts = {}) {
  const cfg = { ...PICK_DEFAULTS, ...opts };
  const k = cfg.roundDecay[round] ?? cfg.roundDecay[4] ?? 0.6;
  if (!Number.isFinite(slot) || !Number.isFinite(numTeams) || numTeams <= 0) return 1;
  if (k === 0) return 1;
  const pos = clamp((slot - 0.5) / numTeams, 0, 1);
  const normalizer = (2 * Math.sinh(k / 2)) / k;
  return Math.exp(-k * (pos - 0.5)) / normalizer;
}

/**
 * Generic value for one round, preferring the value source's own pick entries.
 *
 * @param {number} round
 * @param {object} ctx
 * @param {Map<string, number>} ctx.pickValuesByRound  round -> value, from pick_values rows
 * @param {number[]} ctx.sortedValues  all player values in the league format, descending
 * @param {number} ctx.numTeams
 */
export function genericRoundValue(round, ctx, opts = {}) {
  const cfg = { ...PICK_DEFAULTS, ...opts };

  const fromSource = ctx.pickValuesByRound?.get?.(round);
  if (Number.isFinite(fromSource) && fromSource > 0) {
    return { value: fromSource, basis: 'source' };
  }

  // Fallback: read the value curve at a rank anchor that scales with league size.
  const anchor = cfg.rankAnchors[round] ?? cfg.rankAnchors[5] ?? 18;
  const values = ctx.sortedValues ?? [];
  if (!values.length) return { value: 0, basis: 'none' };
  const index = clamp(Math.round(anchor * (ctx.numTeams ?? 12)) - 1, 0, values.length - 1);
  return { value: values[index], basis: 'rank-anchor' };
}

/**
 * Value a single draft pick.
 *
 * @param {object} pick   { season, round, originalRosterId, ownerId }
 * @param {object} ctx
 *   currentSeason   e.g. '2026'
 *   numTeams
 *   projectedSlots  Map rosterId -> projected draft slot (1 = first pick)
 *   pickValuesByRound
 *   sortedValues
 *   mode            'projected' | 'generic'
 */
export function valuePick(pick, ctx, opts = {}) {
  const cfg = { ...PICK_DEFAULTS, ...opts };
  const round = Number(pick.round);
  const numTeams = ctx.numTeams ?? 12;

  const generic = genericRoundValue(round, ctx, cfg);
  const yearsOut = Math.max(0, Number(pick.season) - Number(ctx.currentSeason ?? pick.season));
  const timeDiscount = cfg.futureYearDiscount ** yearsOut;

  if (ctx.mode === 'generic') {
    return {
      ...pick,
      value: Math.round(generic.value * timeDiscount),
      genericValue: generic.value,
      basis: generic.basis,
      mode: 'generic',
      yearsOut,
      projectedSlot: null,
      slotMultiplier: 1,
      confidence: 0,
    };
  }

  const slot = ctx.projectedSlots?.get?.(Number(pick.originalRosterId));
  if (!Number.isFinite(slot)) {
    // No projection available for the original owner — fall back to generic.
    return {
      ...pick,
      value: Math.round(generic.value * timeDiscount),
      genericValue: generic.value,
      basis: `${generic.basis}+no-projection`,
      mode: 'projected',
      yearsOut,
      projectedSlot: null,
      slotMultiplier: 1,
      confidence: 0,
    };
  }

  const mult = slotMultiplier(slot, numTeams, round, cfg);
  // A slot two years out is close to a guess, so regress toward the generic value.
  const confidence = cfg.slotConfidenceBase ** yearsOut;
  const blended = confidence * mult + (1 - confidence);

  return {
    ...pick,
    value: Math.round(generic.value * blended * timeDiscount),
    genericValue: generic.value,
    basis: generic.basis,
    mode: 'projected',
    yearsOut,
    projectedSlot: slot,
    slotMultiplier: mult,
    confidence,
    pickLabel: `${pick.season} ${round}.${String(Math.round(slot)).padStart(2, '0')}`,
  };
}

/**
 * Projected draft order from team strength. Rookie drafts run in reverse
 * standings order, so the weakest team projects to pick first.
 *
 * @param {Array<{rosterId: number, strength: number}>} teams
 * @returns {Map<number, number>} rosterId -> projected slot (1-based)
 */
export function projectDraftSlots(teams) {
  const ordered = [...teams].sort((a, b) => a.strength - b.strength);   // weakest first
  const map = new Map();
  ordered.forEach((t, i) => map.set(Number(t.rosterId), i + 1));
  return map;
}

/**
 * Expand every team's owned picks for the given seasons.
 *
 * Sleeper's traded_picks only lists picks that have moved. Every other pick is
 * implicitly still owned by its original roster, so we start from the full grid
 * and apply the traded rows over the top.
 *
 * @param {object} args
 *   rosterIds   number[]
 *   seasons     string[]  e.g. ['2026','2027','2028']
 *   rounds      number    rookie draft rounds
 *   tradedPicks [{season, round, original_roster_id, current_owner_id}]
 */
export function expandOwnedPicks({ rosterIds, seasons, rounds, tradedPicks = [] }) {
  const traded = new Map();
  for (const t of tradedPicks) {
    traded.set(`${t.season}|${t.round}|${t.original_roster_id ?? t.originalRosterId}`,
      Number(t.current_owner_id ?? t.ownerId));
  }

  const picks = [];
  for (const season of seasons) {
    for (let round = 1; round <= rounds; round++) {
      for (const originalRosterId of rosterIds) {
        const key = `${season}|${round}|${originalRosterId}`;
        const ownerId = traded.has(key) ? traded.get(key) : Number(originalRosterId);
        picks.push({
          season: String(season),
          round,
          originalRosterId: Number(originalRosterId),
          ownerId,
          traded: traded.has(key),
          id: `pick:${season}:${round}:${originalRosterId}`,
        });
      }
    }
  }
  return picks;
}
