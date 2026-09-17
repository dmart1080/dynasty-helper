import React, { useState } from 'react';
import { useApp } from '../App.jsx';
import { useApi } from '../lib/useApi.js';
import api from '../lib/api.js';
import { Loading, ErrorBox, MetaBanner, PosTag } from '../components/common.jsx';
import Sparkline from '../components/Sparkline.jsx';
import { fmtValue, fmtSigned } from '../lib/format.js';

/** Watchlist plus manual value overrides — both persist in SQLite. */
export default function Watchlist() {
  const { leagueId } = useApp();
  const [tab, setTab] = useState('watch');
  const watch = useApi(() => api.watchlist(leagueId), [leagueId]);
  const overrides = useApi(() => api.overrides(), []);

  return (
    <>
      <div className="topbar">
        <h1>Watchlist</h1>
        <div className="sub">Targets, trends and manual value overrides</div>
      </div>
      <MetaBanner meta={watch.meta} />

      <div className="seg" style={{ width: '100%', margin: '12px 0 4px' }}>
        <button style={{ flex: 1 }} className={tab === 'watch' ? 'on' : ''} onClick={() => setTab('watch')}>
          Watching ({watch.data?.players?.length ?? 0})
        </button>
        <button style={{ flex: 1 }} className={tab === 'overrides' ? 'on' : ''} onClick={() => setTab('overrides')}>
          Overrides ({overrides.data?.length ?? 0})
        </button>
      </div>

      {tab === 'watch'
        ? <WatchTab leagueId={leagueId} state={watch} onChange={() => { watch.reload(); overrides.reload(); }} />
        : <OverridesTab state={overrides} onChange={() => { overrides.reload(); watch.reload(); }} leagueId={leagueId} />}
    </>
  );
}

function WatchTab({ leagueId, state, onChange }) {
  const [adding, setAdding] = useState(false);

  return (
    <>
      <button className="primary" style={{ width: '100%', margin: '8px 0 12px' }}
        onClick={() => setAdding((v) => !v)}>
        {adding ? 'Close search' : '+ Add a player to watch'}
      </button>

      {adding && <PlayerSearch leagueId={leagueId} onAdded={() => { setAdding(false); onChange(); }} />}

      {state.loading && <Loading />}
      {state.error && <ErrorBox error={state.error} onRetry={state.reload} />}

      {state.data?.players?.length === 0 && (
        <div className="card"><div className="empty-state">
          Nothing on the watchlist yet. Add players you are targeting and you will see
          their current owner and value trend here.
        </div></div>
      )}

      {(state.data?.players ?? []).map((p) => (
        <div className="card" key={p.id}>
          <div className="card-head">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 650, fontSize: 14.5 }}>
                <PosTag position={p.position} /> {p.name}
              </div>
              <div className="tiny faint">
                {p.team ?? 'FA'}{p.age ? ` · ${p.age}y` : ''} · owned by <strong>{p.ownerName}</strong>
                {p.injuryStatus ? <span className="bad"> · {p.injuryStatus}</span> : null}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="mono" style={{ fontWeight: 700 }}>{fmtValue(p.value)}</div>
              {p.changePct !== null && (
                <div className={`tiny mono ${p.changePct >= 0 ? 'good' : 'bad'}`}>
                  {p.changePct >= 0 ? '+' : ''}{p.changePct}% · {fmtSigned(p.change)}
                </div>
              )}
            </div>
          </div>

          <Sparkline history={p.history} />

          {p.targetValue && (
            <div className={`banner ${p.atTarget ? 'info' : 'warn'}`} style={{ margin: '8px 0 0' }}>
              <div>
                Target buy price {fmtValue(p.targetValue)} —{' '}
                {p.atTarget ? 'in range now.' : `still ${fmtValue(p.value - p.targetValue)} above.`}
              </div>
            </div>
          )}
          {p.note && <div className="small muted" style={{ marginTop: 7 }}>{p.note}</div>}

          <button className="danger sm" style={{ width: '100%', marginTop: 9 }}
            onClick={async () => { await api.removeWatch(leagueId, p.id); onChange(); }}>
            Remove
          </button>
        </div>
      ))}
    </>
  );
}

function PlayerSearch({ leagueId, onAdded }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState('');
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);

  const { data, loading } = useApi(
    () => api.search({ leagueId, q: query, limit: 15 }), [leagueId, query], { enabled: query.length >= 2 });

  const add = async () => {
    setSaving(true);
    try {
      await api.addWatch(leagueId, { playerId: selected.id, note: note || null, targetValue: target || null });
      onAdded();
    } finally { setSaving(false); }
  };

  return (
    <div className="card">
      <input value={query} onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
        placeholder="Search a player by name…" autoFocus />
      {loading && <div className="tiny faint" style={{ marginTop: 6 }}>Searching…</div>}

      {!selected && (
        <div style={{ maxHeight: 240, overflowY: 'auto', marginTop: 8 }}>
          {(data?.players ?? []).map((p) => (
            <div key={p.id} className="prow" onClick={() => setSelected(p)} style={{ cursor: 'pointer' }}>
              <div className="slot"><PosTag position={p.position} /></div>
              <div>
                <div className="nm">{p.name}</div>
                <div className="sub">{p.ownerName}{p.age ? ` · ${p.age}y` : ''}</div>
              </div>
              <div className="val">{fmtValue(p.value)}</div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div style={{ marginTop: 10 }}>
          <div className="banner info"><div><strong>{selected.name}</strong> — owned by {selected.ownerName}, worth {fmtValue(selected.value)}</div></div>
          <div className="field">
            <label>Target buy price (optional)</label>
            <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="numeric"
              placeholder={`e.g. ${Math.round(selected.value * 0.85)}`} />
          </div>
          <div className="field">
            <label>Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why you want him" />
          </div>
          <div className="row">
            <button onClick={() => setSelected(null)}>Back</button>
            <button className="primary" disabled={saving} onClick={add}>
              {saving ? 'Adding…' : 'Add to watchlist'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Manual value overrides, expressed as a +/- percentage so they survive the
 * daily value refresh — an absolute override would be wiped by the next sync.
 */
function OverridesTab({ state, onChange, leagueId }) {
  const [adding, setAdding] = useState(false);

  return (
    <>
      <div className="banner info" style={{ marginTop: 8 }}>
        <div>
          Overrides are a percentage adjustment, not a fixed number, so they keep applying
          as the source values move. They feed every calculation in the app — dashboard,
          calculator and finder.
        </div>
      </div>

      <button className="primary" style={{ width: '100%', marginBottom: 12 }}
        onClick={() => setAdding((v) => !v)}>
        {adding ? 'Close' : '+ Add an override'}
      </button>

      {adding && <OverrideSearch leagueId={leagueId} onSaved={() => { setAdding(false); onChange(); }} />}

      {state.loading && <Loading />}
      {state.error && <ErrorBox error={state.error} onRetry={state.reload} />}
      {state.data?.length === 0 && (
        <div className="card"><div className="empty-state">No overrides set. Source values are used as-is.</div></div>
      )}

      {(state.data ?? []).map((o) => (
        <div className="card tight" key={o.player_key}>
          <div className="spread">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{o.name ?? o.player_key}</div>
              {o.note && <div className="tiny faint">{o.note}</div>}
            </div>
            <div className="row auto" style={{ gap: 6 }}>
              <span className={`pill ${o.pct > 0 ? 'surplus' : 'need'}`}>
                {o.pct > 0 ? '+' : ''}{o.pct}%
              </span>
              <button className="danger sm"
                onClick={async () => { await api.clearOverride(o.sleeper_id); onChange(); }}>
                Clear
              </button>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function OverrideSearch({ leagueId, onSaved }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [pct, setPct] = useState('10');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);

  const { data, loading } = useApi(
    () => api.search({ leagueId, q: query, limit: 15 }), [leagueId, query], { enabled: query.length >= 2 });

  const save = async () => {
    setError(null);
    try {
      await api.setOverride(selected.id, { pct: Number(pct), note: note || null });
      onSaved();
    } catch (err) { setError(err); }
  };

  return (
    <div className="card">
      <input value={query} onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
        placeholder="Search a player…" autoFocus />
      {loading && <div className="tiny faint" style={{ marginTop: 6 }}>Searching…</div>}

      {!selected && (
        <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 8 }}>
          {(data?.players ?? []).map((p) => (
            <div key={p.id} className="prow" onClick={() => setSelected(p)} style={{ cursor: 'pointer' }}>
              <div className="slot"><PosTag position={p.position} /></div>
              <div><div className="nm">{p.name}</div><div className="sub">{p.ownerName}</div></div>
              <div className="val">{fmtValue(p.value)}</div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div style={{ marginTop: 10 }}>
          <div className="field">
            <label>{selected.name} — adjust by percent</label>
            <input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="numeric"
              placeholder="10 for +10%, -15 for -15%" />
            <div className="tiny faint" style={{ marginTop: 4 }}>
              {Number.isFinite(Number(pct))
                ? `${fmtValue(selected.baseValue || selected.value)} → ${fmtValue((selected.baseValue || selected.value) * (1 + Number(pct) / 100))}`
                : 'Enter a number between -90 and 90.'}
            </div>
          </div>
          <div className="field">
            <label>Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why you disagree with the source" />
          </div>
          {error && <ErrorBox error={error} />}
          <div className="row">
            <button onClick={() => setSelected(null)}>Back</button>
            <button className="primary" onClick={save}>Save override</button>
          </div>
        </div>
      )}
    </div>
  );
}
