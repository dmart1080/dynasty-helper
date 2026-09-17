/** Small numeric helpers shared across the valuation modules. Pure. */

export const sum = (arr, fn = (x) => x) => arr.reduce((a, b) => a + (Number(fn(b)) || 0), 0);

export function mean(arr) {
  const nums = arr.filter(Number.isFinite);
  return nums.length ? sum(nums) / nums.length : 0;
}

export function median(arr) {
  const nums = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

export function stdev(arr) {
  const nums = arr.filter(Number.isFinite);
  if (nums.length < 2) return 0;
  const m = mean(nums);
  return Math.sqrt(sum(nums, (x) => (x - m) ** 2) / nums.length);
}

/**
 * Z-scores for a list. When every value is identical the deviation is 0, so we
 * return zeros rather than dividing by zero.
 */
export function zScores(values) {
  const m = mean(values);
  const sd = stdev(values);
  if (sd === 0) return values.map(() => 0);
  return values.map((v) => (Number.isFinite(v) ? (v - m) / sd : 0));
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round = (v, dp = 0) => { const f = 10 ** dp; return Math.round(v * f) / f; };
export const pct = (v, dp = 1) => round(v * 100, dp);
