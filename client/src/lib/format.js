/** Display helpers shared across pages. */

export const fmtValue = (v) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const n = Math.round(v);
  if (Math.abs(n) >= 100000) return `${(n / 1000).toFixed(0)}k`;
  if (Math.abs(n) >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
};

export const fmtPct = (v, dp = 0) =>
  (v === null || v === undefined || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(dp)}%`);

export const fmtAge = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}y`);

export const fmtSigned = (v) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const n = Math.round(v);
  return n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString();
};

export const timeAgo = (iso) => {
  if (!iso) return 'never';
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

export const MODE_LABEL = { contender: 'Contender', middle: 'Middle', rebuilder: 'Rebuilder' };
export const POSITIONS = ['QB', 'RB', 'WR', 'TE'];

/** Compact slot labels so long codes like SUPER_FLEX fit the 34px lineup gutter. */
export const SLOT_LABEL = {
  SUPER_FLEX: 'SFLX',
  WRRB_FLEX: 'W/R',
  WRRB_WRT: 'W/R/T',
  REC_FLEX: 'W/T',
  IDP_FLEX: 'IDP',
};
export const slotLabel = (slot) => SLOT_LABEL[slot] ?? slot;
