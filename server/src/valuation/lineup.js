/**
 * Optimal starting lineup solver.
 *
 * Pure module — plain objects in, plain objects out.
 *
 * Why greedy is correct here: slots are filled in order of restrictiveness
 * (fewest eligible positions first). In fantasy football the eligibility sets
 * are nested — {QB} ⊂ SUPER_FLEX, {RB} ⊂ FLEX ⊂ SUPER_FLEX — so a player taken
 * by a more restrictive slot could only ever have been used by a looser one,
 * and the looser slot always has at least as many candidates left. No search or
 * backtracking is needed to reach the maximum-value lineup.
 */
import { eligibleFor } from './format.js';

/**
 * @param {Array<{id: string, position: string, value: number}>} players
 * @param {string[]} startingSlots e.g. ['QB','RB','RB','WR','WR','WR','TE','FLEX','SUPER_FLEX']
 */
export function optimalLineup(players, startingSlots) {
  const pool = [...players]
    .filter((p) => p && Number.isFinite(p.value))
    .sort((a, b) => b.value - a.value);

  const slots = startingSlots.map((slot, index) => ({
    slot,
    index,
    eligible: new Set(eligibleFor(slot)),
  }));
  // Most restrictive first; ties keep the original lineup order for stable output.
  slots.sort((a, b) => (a.eligible.size - b.eligible.size) || (a.index - b.index));

  const used = new Set();
  const assignments = [];

  for (const s of slots) {
    const chosen = pool.find((p) => !used.has(p.id) && s.eligible.has(p.position));
    if (chosen) used.add(chosen.id);
    assignments.push({ slot: s.slot, index: s.index, player: chosen ?? null });
  }

  assignments.sort((a, b) => a.index - b.index);

  const starters = assignments.filter((a) => a.player).map((a) => a.player);
  const bench = pool.filter((p) => !used.has(p.id));

  return {
    assignments,
    starters,
    bench,
    starterValue: starters.reduce((sum, p) => sum + p.value, 0),
    benchValue: bench.reduce((sum, p) => sum + p.value, 0),
    emptySlots: assignments.filter((a) => !a.player).map((a) => a.slot),
  };
}

/** Value the starting lineup contributes, broken out by position. */
export function starterValueByPosition(lineup) {
  const out = {};
  for (const p of lineup.starters) {
    out[p.position] = (out[p.position] ?? 0) + p.value;
  }
  return out;
}

/**
 * Value-weighted average age: Σ(value·age) / Σ(value).
 * Players without a known age are excluded from both sums so they neither
 * inflate nor deflate the result.
 */
export function valueWeightedAge(players) {
  let weighted = 0;
  let weight = 0;
  for (const p of players) {
    if (!Number.isFinite(p.age) || !Number.isFinite(p.value) || p.value <= 0) continue;
    weighted += p.value * p.age;
    weight += p.value;
  }
  return weight > 0 ? weighted / weight : null;
}
