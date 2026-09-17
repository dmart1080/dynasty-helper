import React, { useMemo, useState } from 'react';
import { fmtValue } from '../lib/format.js';
import { PosTag } from './common.jsx';

/**
 * One side of a trade: pick a team, then tap assets to add or remove them.
 * Built for thumbs — a search box and a tappable list, no drag and drop.
 */
export default function AssetPicker({ label, teams, rosterId, onRosterChange, assets, selected, onToggle, loading }) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('players');

  const list = useMemo(() => {
    const source = tab === 'players' ? (assets?.players ?? []) : (assets?.picks ?? []);
    const needle = query.trim().toLowerCase();
    if (!needle) return source;
    return source.filter((a) => a.name.toLowerCase().includes(needle));
  }, [assets, tab, query]);

  const selectedAssets = useMemo(() => {
    const all = [...(assets?.players ?? []), ...(assets?.picks ?? [])];
    return selected.map((id) => all.find((a) => String(a.id) === String(id))).filter(Boolean);
  }, [assets, selected]);

  const total = selectedAssets.reduce((s, a) => s + a.value, 0);

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">{label} gives up</span>
        <span className="mono" style={{ fontWeight: 700 }}>{fmtValue(total)}</span>
      </div>

      <select value={rosterId ?? ''} onChange={(e) => onRosterChange(Number(e.target.value))}
        style={{ marginBottom: 9 }}>
        <option value="" disabled>Choose a team…</option>
        {[...(teams ?? [])].sort((a, b) => a.rosterId - b.rosterId).map((t) => (
          <option key={t.rosterId} value={t.rosterId}>{t.teamName}</option>
        ))}
      </select>

      {selectedAssets.length > 0 && (
        <div className="wrap" style={{ marginBottom: 9 }}>
          {selectedAssets.map((a) => (
            <button key={a.id} className="sm" onClick={() => onToggle(a.id)}
              style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
              {a.name} · {fmtValue(a.value)} ✕
            </button>
          ))}
        </div>
      )}

      {rosterId && (
        <>
          <div className="row auto" style={{ gap: 6, marginBottom: 8 }}>
            <div className="seg">
              <button className={tab === 'players' ? 'on' : ''} onClick={() => setTab('players')}>
                Players ({assets?.players?.length ?? 0})
              </button>
              <button className={tab === 'picks' ? 'on' : ''} onClick={() => setTab('picks')}>
                Picks ({assets?.picks?.length ?? 0})
              </button>
            </div>
          </div>

          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…" style={{ marginBottom: 8 }} />

          {loading && <div className="loading">Loading assets…</div>}
          <div style={{ maxHeight: 260, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>
            {list.length === 0 && !loading && <div className="empty-state">No matches.</div>}
            {list.map((a) => {
              const on = selected.some((id) => String(id) === String(a.id));
              return (
                <div key={a.id} className="prow" onClick={() => onToggle(a.id)}
                  style={{ cursor: 'pointer', opacity: on ? 0.45 : 1 }}>
                  <div className="slot"><PosTag position={a.position} /></div>
                  <div>
                    <div className="nm">{a.name}</div>
                    <div className="sub">
                      {a.position === 'PICK'
                        ? `${a.season} round ${a.round}${a.originalTeamName ? ` · via ${a.originalTeamName}` : ''}`
                        : `${a.team ?? 'FA'}${a.age ? ` · ${a.age}y` : ''}${a.positionRank ? ` · ${a.position}${a.positionRank}` : ''}`}
                    </div>
                  </div>
                  <div className="val">{on ? '✓' : fmtValue(a.value)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
