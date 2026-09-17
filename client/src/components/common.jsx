import React from 'react';
import { fmtValue, fmtPct, timeAgo, MODE_LABEL, slotLabel } from '../lib/format.js';

export const Loading = ({ label = 'Loading…' }) => (
  <div className="loading"><div className="spinner" />{label}</div>
);

export const ErrorBox = ({ error, onRetry }) => (
  <div className="banner error">
    <div style={{ flex: 1 }}>
      <strong>Something went wrong.</strong>
      <div style={{ marginTop: 3 }}>{error?.message ?? String(error)}</div>
      {error?.needsSync && <div style={{ marginTop: 5 }}>Sync this league from the Settings tab first.</div>}
      {onRetry && <button className="sm" style={{ marginTop: 8 }} onClick={onRetry}>Retry</button>}
    </div>
  </div>
);

/**
 * Freshness banner. The brief asks for last-cached data plus a timestamp when a
 * source is failing, so this is shown whenever meta.stale is set.
 */
export const MetaBanner = ({ meta }) => {
  if (!meta) return null;
  const bits = [];
  if (meta.leagueSyncedAt) bits.push(`league ${timeAgo(meta.leagueSyncedAt)}`);
  if (meta.valuesCapturedOn) bits.push(`values ${meta.valuesCapturedOn}`);

  return (
    <>
      {meta.isDemo && (
        <div className="banner info">
          <div>
            <strong>Demo data.</strong> This league is the built-in synthetic fixture, not your real
            Sleeper league. Run a sync from Settings to replace it.
          </div>
        </div>
      )}
      {meta.stale && (
        <div className="banner warn">
          <div style={{ flex: 1 }}>
            <strong>Showing cached data{bits.length ? ` — ${bits.join(', ')}` : ''}.</strong>
            <ul>{(meta.warnings ?? []).map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        </div>
      )}
    </>
  );
};

export const ModePill = ({ mode }) => <span className={`pill ${mode}`}>{MODE_LABEL[mode] ?? mode}</span>;

export const PosTag = ({ position }) => <span className={`pos ${position}`}>{position}</span>;

/** Stacked bar showing where a team's value sits by position. */
export const ValueBar = ({ byPosition, pickValue = 0, total }) => {
  const parts = [
    { key: 'QB', value: byPosition?.QB?.totalValue ?? 0, color: 'var(--qb)' },
    { key: 'RB', value: byPosition?.RB?.totalValue ?? 0, color: 'var(--rb)' },
    { key: 'WR', value: byPosition?.WR?.totalValue ?? 0, color: 'var(--wr)' },
    { key: 'TE', value: byPosition?.TE?.totalValue ?? 0, color: 'var(--te)' },
    { key: 'Picks', value: pickValue, color: 'var(--pick)' },
  ];
  const denom = total || parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <>
      <div className="vbar">
        {parts.map((p) => (
          <span key={p.key} style={{ width: `${(p.value / denom) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="vbar-legend">
        {parts.map((p) => (
          <span key={p.key}>
            <i style={{ background: p.color }} />{p.key} {fmtValue(p.value)}
            <span className="faint"> ({fmtPct(p.value / denom)})</span>
          </span>
        ))}
      </div>
    </>
  );
};

export const Stat = ({ label, value, sub, className = '' }) => (
  <div className="stat">
    <div className="l">{label}</div>
    <div className={`v ${className}`}>{value}</div>
    {sub && <div className="s">{sub}</div>}
  </div>
);

/** Toggle between projected-slot and flat generic pick values. */
export const PickModeToggle = ({ value, onChange }) => (
  <div className="seg">
    <button className={value === 'projected' ? 'on' : ''} onClick={() => onChange('projected')}>
      Projected
    </button>
    <button className={value === 'generic' ? 'on' : ''} onClick={() => onChange('generic')}>
      Generic
    </button>
  </div>
);

export const PlayerRow = ({ player, slot, right, onClick }) => {
  if (!player) {
    return (
      <div className="prow empty">
        <div className="slot">{slotLabel(slot)}</div>
        <div className="nm">empty</div>
        <div className="val faint">—</div>
      </div>
    );
  }
  return (
    <div className="prow" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="slot">{slot ? slotLabel(slot) : <PosTag position={player.position} />}</div>
      <div>
        <div className="nm">{player.name}</div>
        <div className="sub">
          {slot && <><PosTag position={player.position} />{' · '}</>}
          {player.team ?? 'FA'}
          {player.age ? ` · ${player.age}y` : ''}
          {player.positionRank ? ` · ${player.position}${player.positionRank}` : ''}
          {player.injuryStatus ? <span className="bad"> · {player.injuryStatus}</span> : null}
          {player.overridePct ? <span className="warn-c"> · override {player.overridePct > 0 ? '+' : ''}{player.overridePct}%</span> : null}
        </div>
      </div>
      <div className="val">
        {right ?? fmtValue(player.value)}
        {player.trend30d ? (
          <small className={player.trend30d > 0 ? 'good' : 'bad'}>
            {player.trend30d > 0 ? '▲' : '▼'} {fmtValue(Math.abs(player.trend30d))}
          </small>
        ) : null}
      </div>
    </div>
  );
};
