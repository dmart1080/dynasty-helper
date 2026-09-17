import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { useApi } from '../lib/useApi.js';
import api from '../lib/api.js';
import { Loading, ErrorBox, MetaBanner, ModePill, ValueBar, PlayerRow } from '../components/common.jsx';
import { fmtValue, fmtAge, fmtPct, POSITIONS } from '../lib/format.js';

export default function Team() {
  const { rosterId } = useParams();
  const { leagueId, pickMode } = useApp();
  const { data: team, meta, loading, error, reload } = useApi(
    () => api.team(leagueId, rosterId, { pickMode }), [leagueId, rosterId, pickMode]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!team) return null;

  return (
    <>
      <div className="topbar">
        <div className="topbar-row">
          <div style={{ minWidth: 0 }}>
            <h1 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.teamName}</h1>
            <div className="sub">
              {team.managerName} · #{team.rank} overall · {team.record?.wins ?? 0}-{team.record?.losses ?? 0}
            </div>
          </div>
          <ModePill mode={team.mode} />
        </div>
      </div>
      <MetaBanner meta={meta} />

      <div className="card" style={{ marginTop: 12 }}>
        <div className="stats">
          <S l="Total" v={fmtValue(team.totalValue)} s={`#${team.rank}`} />
          <S l="Starters" v={fmtValue(team.starterValue)} s={`#${team.starterRank}`} />
          <S l="Bench" v={fmtValue(team.benchValue)} />
          <S l="Picks" v={fmtValue(team.pickValue)} s={`${team.pickCount} owned`} />
          <S l="Age" v={fmtAge(team.avgAge)} s={`starters ${fmtAge(team.starterAge)}`} />
          <S l="Starter share" v={fmtPct(team.starterShare)} />
        </div>
        <div style={{ marginTop: 10 }}>
          <ValueBar byPosition={team.byPosition} pickValue={team.pickValue} total={team.totalValue} />
        </div>
        <div className="tiny faint" style={{ marginTop: 10, lineHeight: 1.5 }}>
          Classified <strong>{team.mode}</strong> from a contention score of {team.contendScore?.toFixed(2)}:
          starter value {sig(team.signals?.starterValueZ)}, starter share {sig(team.signals?.starterShareZ)},
          age {sig(team.signals?.ageZ)}{team.signals?.recordZ !== null && team.signals?.recordZ !== undefined ? `, record ${sig(team.signals.recordZ)}` : ''} (all as standard
          deviations from the league mean).
        </div>
      </div>

      <div className="section-title">Optimal starting lineup</div>
      <div className="card tight">
        <div className="plist">
          {team.lineup.map((a, i) => (
            <PlayerRow key={`${a.slot}-${i}`} slot={a.slot} player={a.player} />
          ))}
        </div>
        <div className="spread" style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--border)' }}>
          <span className="small muted">Starting value</span>
          <strong className="mono">{fmtValue(team.starterValue)}</strong>
        </div>
        <div className="tiny faint" style={{ marginTop: 6 }}>
          Best legal lineup, not the one currently set in Sleeper.
        </div>
      </div>

      <div className="section-title">Positional strength vs. league</div>
      <div className="card">
        {POSITIONS.map((p) => {
          const b = team.byPosition[p] ?? {};
          const med = b.leagueMedianStarterValue || 0;
          const ratio = med > 0 ? Math.min(2, b.starterValue / med) : 0;
          return (
            <div key={p} style={{ marginBottom: 11 }}>
              <div className="spread" style={{ marginBottom: 3 }}>
                <span>
                  <span className={`pos ${p}`}>{p}</span>
                  <span className="tiny faint" style={{ marginLeft: 6 }}>
                    {b.count} rostered · can start {b.maxStartable} · {fmtAge(b.avgAge)}
                  </span>
                </span>
                <span className="small mono">
                  {fmtValue(b.starterValue)}
                  <span className="faint"> / {fmtValue(med)}</span>
                </span>
              </div>
              <div className="vbar" style={{ height: 6 }}>
                <span style={{ width: `${(ratio / 2) * 100}%`, background: barColor(p, b) }} />
              </div>
              <div className="tiny" style={{ marginTop: 3 }}>
                {b.isNeed && <span className="pill need">need · {fmtPct(b.needSeverity)} below median</span>}
                {b.isSurplus && <span className="pill surplus" style={{ marginLeft: 4 }}>surplus · {fmtValue(b.surplusValue)} above replacement</span>}
                {!b.isNeed && !b.isSurplus && <span className="faint">balanced</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="section-title">Draft picks ({team.picks.length})</div>
      <div className="card tight">
        {team.picks.length === 0 && <div className="empty-state">No picks owned.</div>}
        <div className="plist">
          {team.picks.map((p) => (
            <div className="prow" key={p.id}>
              <div className="slot"><span className="pos PICK">{p.round}</span></div>
              <div>
                <div className="nm">{p.season} Round {p.round}</div>
                <div className="sub">
                  {p.originalRosterId === team.rosterId ? 'own pick' : `via ${p.originalTeamName}`}
                  {p.projectedSlot ? ` · projected ${p.round}.${String(p.projectedSlot).padStart(2, '0')}` : ''}
                  {p.confidence ? ` · ${Math.round(p.confidence * 100)}% slot confidence` : ''}
                </div>
              </div>
              <div className="val">
                {fmtValue(p.value)}
                {p.genericValue ? <small>flat {fmtValue(p.genericValue)}</small> : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="section-title">Bench ({team.bench.length})</div>
      <div className="card tight">
        {team.bench.length === 0 && <div className="empty-state">No bench players.</div>}
        <div className="plist">
          {team.bench.map((p) => <PlayerRow key={p.id} player={p} />)}
        </div>
      </div>

      <Link to="/"><button className="ghost" style={{ width: '100%', marginTop: 4 }}>← All teams</button></Link>
    </>
  );
}

const sig = (z) => (z === null || z === undefined ? 'n/a' : `${z > 0 ? '+' : ''}${z.toFixed(2)}`);
const barColor = (p, b) => (b.isNeed ? 'var(--bad)' : b.isSurplus ? 'var(--good)' : `var(--${p.toLowerCase()})`);
const S = ({ l, v, s }) => (
  <div className="stat"><div className="l">{l}</div><div className="v">{v}</div>{s && <div className="s">{s}</div>}</div>
);
