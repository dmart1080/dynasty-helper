import React, { useState } from 'react';
import { useApp } from '../App.jsx';
import { useApi } from '../lib/useApi.js';
import api from '../lib/api.js';
import { Loading, ErrorBox, MetaBanner, PosTag, ModePill } from '../components/common.jsx';
import { fmtValue, fmtSigned } from '../lib/format.js';

/** Trade Finder: constraints in, ranked packages out. */
export default function Finder() {
  const { leagueId, myRosterId, pickMode } = useApp();

  const [mode, setMode] = useState('contend');
  const [tolerance, setTolerance] = useState(0.05);
  const [maxPieces, setMaxPieces] = useState(2);
  const [untouchable, setUntouchable] = useState([]);
  const [targets, setTargets] = useState([]);
  const [showConstraints, setShowConstraints] = useState(false);

  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);

  const myAssets = useApi(() => fetchAssets(leagueId, myRosterId, pickMode), [leagueId, myRosterId, pickMode], { enabled: !!myRosterId });
  const teams = useApi(() => api.teams(leagueId, { pickMode }), [leagueId, pickMode]);

  const search = async () => {
    setSearching(true); setError(null);
    try {
      const { data } = await api.findTrades({
        leagueId, rosterId: myRosterId, mode, pickMode,
        untouchable, targets,
        maxPiecesPerSide: maxPieces, valueTolerance: tolerance,
      });
      setResults(data);
    } catch (err) { setError(err); setResults(null); }
    finally { setSearching(false); }
  };

  const toggle = (setter) => (id) =>
    setter((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <>
      <div className="topbar">
        <h1>Trade finder</h1>
        <div className="sub">Partners whose surplus fits your needs</div>
      </div>
      <MetaBanner meta={teams.meta} />

      <div className="card" style={{ marginTop: 12 }}>
        <div className="field">
          <label>Your mode</label>
          <div className="seg" style={{ width: '100%' }}>
            <button style={{ flex: 1 }} className={mode === 'contend' ? 'on' : ''} onClick={() => setMode('contend')}>
              Contend
            </button>
            <button style={{ flex: 1 }} className={mode === 'rebuild' ? 'on' : ''} onClick={() => setMode('rebuild')}>
              Rebuild
            </button>
          </div>
          <div className="tiny faint" style={{ marginTop: 5 }}>
            {mode === 'contend'
              ? 'Prefers proven players coming back and treats picks as currency to spend. Leans toward rebuilding partners.'
              : 'Prefers picks and young players coming back. Leans toward contending partners.'}
          </div>
        </div>

        <div className="row" style={{ marginBottom: 10 }}>
          <div>
            <label>Value tolerance</label>
            <select value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))}>
              <option value={0.02}>±2% — very tight</option>
              <option value={0.05}>±5%</option>
              <option value={0.10}>±10%</option>
              <option value={0.15}>±15% — loose</option>
            </select>
          </div>
          <div>
            <label>Max pieces / side</label>
            <select value={maxPieces} onChange={(e) => setMaxPieces(Number(e.target.value))}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </div>
        </div>

        <button className="ghost sm" style={{ width: '100%' }} onClick={() => setShowConstraints((v) => !v)}>
          {showConstraints ? 'Hide' : 'Set'} untouchables &amp; targets
          {(untouchable.length + targets.length) > 0 && ` (${untouchable.length + targets.length})`}
        </button>

        {showConstraints && (
          <div style={{ marginTop: 10 }}>
            <label>Untouchable — never offer these</label>
            <div className="wrap" style={{ marginBottom: 12, maxHeight: 150, overflowY: 'auto' }}>
              {[...(myAssets.data?.players ?? []), ...(myAssets.data?.picks ?? [])].map((a) => (
                <button key={a.id} className="sm" onClick={() => toggle(setUntouchable)(a.id)}
                  style={untouchable.includes(a.id)
                    ? { borderColor: 'var(--bad)', color: '#ff8a82' } : undefined}>
                  {untouchable.includes(a.id) ? '🔒 ' : ''}{a.name}
                </button>
              ))}
            </div>

            <label>Targets — a package must bring one of these back</label>
            <TargetPicker leagueId={leagueId} myRosterId={myRosterId}
              targets={targets} onToggle={toggle(setTargets)} />
          </div>
        )}

        <button className="primary" style={{ width: '100%', marginTop: 11 }}
          disabled={searching || !myRosterId} onClick={search}>
          {searching ? 'Searching…' : 'Find trades'}
        </button>
      </div>

      {error && <ErrorBox error={error} />}
      {searching && <Loading label="Evaluating every package…" />}

      {results && (
        <>
          <div className="card">
            <div className="card-head">
              <span className="card-title">Your position</span>
              <ModePill mode={results.me.mode} />
            </div>
            <div className="wrap">
              {results.me.needs.length === 0 && results.me.surpluses.length === 0 && (
                <span className="small faint">No flagged needs or surpluses — you are balanced.</span>
              )}
              {results.me.needs.map((n) => (
                <span key={n.position} className="pill need">need {n.position}</span>
              ))}
              {results.me.surpluses.map((s) => (
                <span key={s.position} className="pill surplus">surplus {s.position} · {fmtValue(s.value)}</span>
              ))}
            </div>
          </div>

          <div className="section-title">Best-fit partners</div>
          <div className="card">
            {results.partners.map((p) => (
              <div key={p.rosterId} className="prow">
                <div className="slot mono">{p.fit.toFixed(2)}</div>
                <div>
                  <div className="nm">{p.teamName}</div>
                  <div className="sub">
                    <ModePill mode={p.mode} />
                    {p.opposite && <span className="pill surplus" style={{ marginLeft: 4 }}>opposite timeline</span>}
                    {p.theirNeeds.length > 0 && <span style={{ marginLeft: 4 }}>needs {p.theirNeeds.join('/')}</span>}
                  </div>
                </div>
                <div />
              </div>
            ))}
            <div className="tiny faint" style={{ marginTop: 8 }}>
              Fit = how well your surplus meets their needs and their surplus meets yours,
              boosted when your timelines are opposite.
            </div>
          </div>

          <div className="section-title">
            {results.results.length} package{results.results.length === 1 ? '' : 's'} within ±{Math.round(results.searched.tolerance * 100)}%
          </div>

          {results.results.length === 0 && (
            <div className="card">
              <div className="empty-state">
                Nothing fit those constraints. Try a looser value tolerance, allow more pieces
                per side, or unlock an untouchable.
              </div>
            </div>
          )}

          {results.results.map((t, i) => <PackageCard key={i} pkg={t} />)}
        </>
      )}
    </>
  );
}

function PackageCard({ pkg }) {
  return (
    <div className="card">
      <div className="card-head">
        <span>
          <span className="pill muted">{pkg.shape}</span>
          <strong style={{ marginLeft: 7, fontSize: 14 }}>{pkg.partner.teamName}</strong>
        </span>
        <span className="mono small" style={{ color: Math.abs(pkg.fairnessPct) < 0.03 ? 'var(--good)' : 'var(--warn)' }}>
          {pkg.fairnessPct > 0 ? '+' : ''}{(pkg.fairnessPct * 100).toFixed(1)}%
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <div className="tiny faint" style={{ marginBottom: 4 }}>YOU SEND</div>
          {pkg.give.map((a) => <AssetChip key={a.id} asset={a} />)}
          <div className="tiny mono faint" style={{ marginTop: 4 }}>{fmtValue(pkg.giveValue)}</div>
        </div>
        <div>
          <div className="tiny faint" style={{ marginBottom: 4 }}>YOU GET</div>
          {pkg.get.map((a) => <AssetChip key={a.id} asset={a} />)}
          <div className="tiny mono faint" style={{ marginTop: 4 }}>{fmtValue(pkg.getValue)}</div>
        </div>
      </div>

      <div className="spread" style={{ marginTop: 9, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
        <span className="tiny faint">Your starting lineup</span>
        <span className={`mono tiny ${pkg.myStarterDelta >= 0 ? 'good' : 'bad'}`}>
          {fmtSigned(pkg.myStarterDelta)}
        </span>
      </div>
      <div className="spread">
        <span className="tiny faint">Their starting lineup</span>
        <span className={`mono tiny ${pkg.theirStarterDelta >= 0 ? 'good' : 'bad'}`}>
          {fmtSigned(pkg.theirStarterDelta)}
        </span>
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '9px 0 0', lineHeight: 1.5 }}>
        {pkg.rationale}
      </p>
    </div>
  );
}

const AssetChip = ({ asset }) => (
  <div style={{ marginBottom: 3 }}>
    <span className={`pos ${asset.position}`}>{asset.position}</span>{' '}
    <span style={{ fontSize: 12.5 }}>{asset.name}</span>{' '}
    <span className="tiny faint mono">{fmtValue(asset.value)}</span>
  </div>
);

function TargetPicker({ leagueId, myRosterId, targets, onToggle }) {
  const [query, setQuery] = useState('');
  const { data, loading } = useApi(
    () => api.search({ leagueId, q: query, limit: 12, includePicks: 'true' }),
    [leagueId, query], { enabled: query.length >= 2 });

  const options = [...(data?.players ?? []), ...(data?.picks ?? [])]
    .filter((p) => p.rosterId && p.rosterId !== Number(myRosterId));

  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a player on another team…" />
      {loading && <div className="tiny faint" style={{ marginTop: 5 }}>Searching…</div>}
      <div className="wrap" style={{ marginTop: 7 }}>
        {targets.length > 0 && targets.map((id) => (
          <button key={id} className="sm" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
            onClick={() => onToggle(id)}>🎯 {id} ✕</button>
        ))}
      </div>
      <div style={{ maxHeight: 170, overflowY: 'auto', marginTop: 5 }}>
        {options.map((p) => (
          <div key={p.id} className="prow" onClick={() => onToggle(p.id)} style={{ cursor: 'pointer' }}>
            <div className="slot"><PosTag position={p.position} /></div>
            <div>
              <div className="nm">{p.name}</div>
              <div className="sub">{p.ownerName}</div>
            </div>
            <div className="val">{targets.includes(p.id) ? '✓' : fmtValue(p.value)}</div>
          </div>
        ))}
      </div>
    </>
  );
}

async function fetchAssets(leagueId, rosterId, pickMode) {
  const res = await fetch(`/api/trades/assets/${leagueId}/${rosterId}?pickMode=${pickMode}`);
  const payload = await res.json();
  if (!res.ok || payload.ok === false) throw new Error(payload.error ?? 'Could not load assets');
  return { data: payload.data, meta: payload.meta };
}
