import React, { useState } from 'react';
import { useApp } from '../App.jsx';
import { useApi } from '../lib/useApi.js';
import api from '../lib/api.js';
import { Loading, ErrorBox } from '../components/common.jsx';
import { timeAgo } from '../lib/format.js';

export default function Settings() {
  const { leagueId, setLeagueId, myRosterId, setMyRosterId } = useApp();
  const [input, setInput] = useState(leagueId);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const leagues = useApi(() => api.leagues(), []);
  const teams = useApi(() => api.teams(leagueId), [leagueId], { enabled: !!leagueId });

  const runSync = async (force) => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const { data } = await api.sync(leagueId, { force: force ? 'true' : undefined, history: 'true' });
      setSyncResult(data);
      leagues.reload();
      teams.reload();
    } catch (err) {
      setSyncResult({ ok: false, errors: [err.message] });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <div className="topbar"><h1>Settings</h1><div className="sub">League, identity and data freshness</div></div>

      <div className="section-title">League</div>
      <div className="card">
        <div className="field">
          <label>Sleeper league ID</label>
          <div className="row">
            <input value={input} onChange={(e) => setInput(e.target.value.trim())} inputMode="numeric"
              placeholder="e.g. 1312193587416436736" />
            <button className="primary" style={{ flex: '0 0 auto' }}
              disabled={!input || input === leagueId}
              onClick={() => setLeagueId(input)}>Use</button>
          </div>
          <div className="tiny faint" style={{ marginTop: 5 }}>
            Found in your Sleeper league URL. Scoring and roster settings are read from the API —
            nothing about superflex or PPR is assumed.
          </div>
        </div>

        {leagues.data?.length > 0 && (
          <div className="field">
            <label>Cached leagues</label>
            <div className="wrap">
              {leagues.data.map((l) => (
                <button key={l.leagueId} className="sm"
                  style={l.leagueId === leagueId ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                  onClick={() => { setLeagueId(l.leagueId); setInput(l.leagueId); }}>
                  {l.name ?? l.leagueId}{l.isDemo ? ' (demo)' : ''}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field" style={{ marginBottom: 0 }}>
          <label>Which team is yours?</label>
          {teams.loading && <Loading label="Loading teams…" />}
          {teams.error && <ErrorBox error={teams.error} onRetry={teams.reload} />}
          {teams.data && (
            <select value={myRosterId} onChange={(e) => setMyRosterId(Number(e.target.value))}>
              {[...teams.data.teams].sort((a, b) => a.rosterId - b.rosterId).map((t) => (
                <option key={t.rosterId} value={t.rosterId}>
                  Roster {t.rosterId} — {t.teamName} ({t.managerName})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="section-title">Data</div>
      <div className="card">
        <div className="spread" style={{ marginBottom: 9 }}>
          <div>
            <div className="small">League synced</div>
            <div className="tiny faint">{timeAgo(teams.meta?.leagueSyncedAt)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="small">Values captured</div>
            <div className="tiny faint">{teams.meta?.valuesCapturedOn ?? 'never'}</div>
          </div>
        </div>

        <div className="row auto" style={{ gap: 8 }}>
          <button style={{ flex: 1 }} disabled={syncing} onClick={() => runSync(false)}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button style={{ flex: 1 }} disabled={syncing} onClick={() => runSync(true)}>
            Force refresh
          </button>
        </div>
        <div className="tiny faint" style={{ marginTop: 6 }}>
          The 5MB player file refreshes at most once a day. Values are snapshotted once a day so
          trends build up over time. Force ignores both.
        </div>

        {syncResult && (
          <div className={`banner ${syncResult.ok ? 'info' : 'warn'}`} style={{ marginTop: 10 }}>
            <div style={{ flex: 1 }}>
              {syncResult.ok ? <strong>Sync complete.</strong> : <strong>Sync finished with problems.</strong>}
              {syncResult.errors?.length > 0 && (
                <ul>{syncResult.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              )}
              {syncResult.stages && (
                <div className="tiny" style={{ marginTop: 5 }}>
                  {Object.entries(syncResult.stages).map(([k, v]) => (
                    <div key={k}>{k}: {v.failed ? `failed — ${v.error}` : v.skipped ? `skipped (${v.reason})` : 'ok'}</div>
                  ))}
                </div>
              )}
              {!syncResult.ok && (
                <div className="tiny" style={{ marginTop: 6 }}>
                  Run <code>npm run verify:sources</code> in a terminal to see which endpoints are reachable.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
