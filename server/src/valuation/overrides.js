/**
 * Manual value overrides. Pure module.
 *
 * Overrides are stored as a PERCENTAGE delta rather than an absolute value, so
 * they keep applying as the source values move. An absolute override would be
 * silently wiped by the next daily refresh, or worse, would quietly go stale
 * while still looking authoritative.
 */

/** Overrides outside this range are almost certainly a typo. */
export const MAX_OVERRIDE_PCT = 90;

export function isValidOverridePct(pct) {
  const n = Number(pct);
  return Number.isFinite(n) && Math.abs(n) <= MAX_OVERRIDE_PCT;
}

/**
 * Apply a percentage override to a base value.
 * An invalid or absent percentage returns the base value untouched.
 */
export function applyOverride(baseValue, pct) {
  const base = Number(baseValue);
  if (!Number.isFinite(base)) return 0;
  if (pct === null || pct === undefined || pct === 0 || !isValidOverridePct(pct)) {
    return Math.round(base);
  }
  return Math.max(0, Math.round(base * (1 + Number(pct) / 100)));
}

/** Percentage that would turn `baseValue` into `targetValue` — for a "set to X" UI. */
export function pctForTarget(baseValue, targetValue) {
  const base = Number(baseValue);
  const target = Number(targetValue);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(target)) return 0;
  return Math.round(((target - base) / base) * 1000) / 10;
}
