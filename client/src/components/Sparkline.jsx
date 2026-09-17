import React from 'react';

/**
 * Inline SVG value-history chart. No charting library — it is a polyline over a
 * normalised series, which keeps the bundle small and renders crisply on a phone.
 */
export default function Sparkline({ history = [], width = 300, height = 56, showAxis = true }) {
  const points = history.filter((h) => Number.isFinite(h.value));
  if (points.length < 2) {
    return <div className="tiny faint center" style={{ padding: '14px 0' }}>Not enough history yet — values are snapshotted once a day.</div>;
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;

  const x = (i) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;
  const rising = values.at(-1) >= values[0];
  const color = rising ? 'var(--good)' : 'var(--bad)';

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none"
        role="img" aria-label={`Value from ${points[0].captured_on} to ${points.at(-1).captured_on}`}>
        <defs>
          <linearGradient id={`g-${rising}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#g-${rising})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={x(points.length - 1)} cy={y(values.at(-1))} r="2.6" fill={color} />
      </svg>
      {showAxis && (
        <div className="spread tiny faint" style={{ marginTop: 2 }}>
          <span>{points[0].captured_on} · {Math.round(values[0]).toLocaleString()}</span>
          <span>{points.at(-1).captured_on} · {Math.round(values.at(-1)).toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
