import React from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { useApi } from '../lib/useApi.js';
import api from '../lib/api.js';
import { Loading, ErrorBox, MetaBanner, ModePill, PickModeToggle } from '../components/common.jsx';
import { fmtValue } from '../lib/format.js';

/** Every team's owned picks for the current year plus the next two. */
export default function Picks() {
  const { leagueId, myRosterId, pickMode, setPickMode } = useApp();
  const { data, meta, loading, error, reload } = useApi(
    () => api.picks(leagueId, { pickMode }), [leagueId, pickMode]);

  if (loading) return <Loading label="Valuing picks…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <>
      <div className="topbar">
        <div className="topbar-row">
          <div>
            <h1>Draft picks</h1>
            <div className="sub">{data.seasons.join(' · ')} · {data.rounds} rounds</div>
          </div>
          <PickModeToggle value={pickMode} onChange={setPickMode} />
        </div>
      </div>
      <MetaBanner meta={meta} />

      <div className="banner info" style={{ marginTop: 12 }}>
        <div>
          {pickMode === 'projected'
            ? 'Each pick is valued by its projected slot, derived from the original owner’s team strength. Slot confidence decays 60% per year out, so distant picks regress toward flat values.'
            : 'Flat mode: every 1st is worth the same, discounted 15% per year into the future.'}
        </div>
      </div>

      {data.owners.map((o) => (
        <div className="card" key={o.rosterId}>
          <div className="card-head">
            <div style={{ minWidth: 0 }}>
              <Link to={`/team/${o.rosterId}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                <div style={{ fontWeight: 650, fontSize: 14.5 }}>
                  {o.teamName}
                  {o.rosterId === Number(myRosterId) && <span className="pill muted" style={{ marginLeft: 6 }}>you</span>}
                </div>
              </Link>
              <div className="tiny faint" style={{ marginTop: 2 }}>{o.picks.length} picks</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="mono" style={{ fontWeight: 700 }}>{fmtValue(o.totalValue)}</div>
              <ModePill mode={o.mode} />
            </div>
          </div>
          <div className="wrap">
            {o.picks.map((p) => (
              <span key={p.id} className="pill muted" title={`${p.name} — ${p.basis}`}
                style={{ borderLeft: `2px solid ${roundColor(p.round)}`, fontSize: 11 }}>
                {p.season.slice(2)} R{p.round}
                {p.projectedSlot ? `.${String(p.projectedSlot).padStart(2, '0')}` : ''}
                {p.originalRosterId !== o.rosterId ? ' ↗' : ''}
                <span className="faint"> {fmtValue(p.value)}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
      <div className="tiny faint center" style={{ padding: '4px 0 10px' }}>↗ acquired from another team</div>
    </>
  );
}

const roundColor = (r) => ['var(--pick)', 'var(--wr)', 'var(--rebuilder)', 'var(--text-faint)'][r - 1] ?? 'var(--border)';
