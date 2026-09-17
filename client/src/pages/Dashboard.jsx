import React from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { useApi } from '../lib/useApi.js';
import api from '../lib/api.js';
import { Loading, ErrorBox, MetaBanner, ModePill, ValueBar, PickModeToggle } from '../components/common.jsx';
import { fmtValue, fmtAge, fmtPct, POSITIONS } from '../lib/format.js';

/** Team Value Dashboard: every team ranked, with breakdown, age and class. */
export default function Dashboard() {
  const { leagueId, myRosterId, pickMode, setPickMode } = useApp();
  const { data, meta, loading, error, reload } = useApi(
    () => api.teams(leagueId, { pickMode }), [leagueId, pickMode], { enabled: !!leagueId });

  if (loading) return <Loading label="Valuing every roster…" />;
  if (error) return <><Header /><ErrorBox error={error} onRetry={reload} /></>;
  if (!data) return null;

  const teams = data.teams;
  const me = teams.find((t) => t.rosterId === Number(myRosterId));

  return (
    <>
      <Header name={data.name} formatLabel={data.formatLabel} season={data.season} />
      <MetaBanner meta={meta} />

      <div className="spread" style={{ margin: '12px 0 10px' }}>
        <div className="section-title" style={{ margin: 0 }}>Pick values</div>
        <PickModeToggle value={pickMode} onChange={setPickMode} />
      </div>
      <div className="tiny faint" style={{ marginBottom: 12 }}>
        {pickMode === 'projected'
          ? 'Picks valued by projected slot — a rebuilder’s 1st is worth more than a contender’s.'
          : 'Flat values — every 1st is worth the same regardless of who it came from.'}
      </div>

      {me && <MyTeamCard team={me} medians={data.medians} />}

      <div className="section-title">League — ranked by total value</div>
      {teams.map((t) => (
        <Link key={t.rosterId} to={`/team/${t.rosterId}`}
          className={`team-row${t.rosterId === Number(myRosterId) ? ' me' : ''}`}>
          <div className="team-rank">{t.rank}</div>
          <div>
            <div className="team-name">{t.teamName}</div>
            <div className="team-meta">
              <ModePill mode={t.mode} />
              <span>{fmtAge(t.avgAge)}</span>
              <span>{t.record?.wins ?? 0}-{t.record?.losses ?? 0}</span>
              {t.needs.length > 0 && (
                <span className="pill need">need {t.needs.map((n) => n.position).join('/')}</span>
              )}
              {t.surpluses.length > 0 && (
                <span className="pill surplus">+{t.surpluses.map((s) => s.position).join('/')}</span>
              )}
            </div>
          </div>
          <div className="team-total">
            <div className="v">{fmtValue(t.totalValue)}</div>
            <div className="l">{fmtValue(t.pickValue)} picks</div>
          </div>
        </Link>
      ))}

      <div className="section-title">Age profile — value-weighted, by position</div>
      <div className="card">
        <div className="tiny faint" style={{ marginBottom: 9 }}>
          Weighted by value, so a 34-year-old WR5 barely moves the number while a 34-year-old WR1 does.
        </div>
        <div style={{ overflowX: 'auto', margin: '0 -12px', padding: '0 12px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 320 }}>
            <thead>
              <tr style={{ color: 'var(--text-faint)', textAlign: 'right' }}>
                <th style={{ textAlign: 'left', paddingBottom: 6 }}>Team</th>
                {POSITIONS.map((p) => <th key={p} style={{ paddingBottom: 6 }}>{p}</th>)}
                <th style={{ paddingBottom: 6 }}>All</th>
              </tr>
            </thead>
            <tbody>
              {[...teams].sort((a, b) => (a.avgAge ?? 99) - (b.avgAge ?? 99)).map((t) => (
                <tr key={t.rosterId} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 0', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.teamName}
                  </td>
                  {POSITIONS.map((p) => (
                    <td key={p} className="mono" style={{ textAlign: 'right', color: ageColor(t.byPosition[p]?.avgAge) }}>
                      {t.byPosition[p]?.avgAge ? t.byPosition[p].avgAge.toFixed(1) : '—'}
                    </td>
                  ))}
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 650 }}>
                    {t.avgAge ? t.avgAge.toFixed(1) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section-title">League median starter value</div>
      <div className="card">
        <div className="stats">
          {POSITIONS.map((p) => (
            <div className="stat" key={p}>
              <div className="l">{p}</div>
              <div className="v">{fmtValue(data.medians?.[p])}</div>
              <div className="s">repl {fmtValue(data.replacement?.[p])}</div>
            </div>
          ))}
        </div>
        <div className="tiny faint" style={{ marginTop: 9 }}>
          A position below its league median is flagged as a need. Replacement level is the
          best player at that position who would start for nobody — surplus is measured above it.
        </div>
      </div>
    </>
  );
}

const ageColor = (age) => {
  if (!age) return 'var(--text-faint)';
  if (age < 24.5) return 'var(--rebuilder)';
  if (age > 27.5) return 'var(--contender)';
  return 'var(--text)';
};

const Header = ({ name, formatLabel, season }) => (
  <div className="topbar">
    <div className="topbar-row">
      <div>
        <h1>{name ?? 'Dynasty Helper'}</h1>
        <div className="sub">{formatLabel}{season ? ` · ${season}` : ''}</div>
      </div>
    </div>
  </div>
);

function MyTeamCard({ team, medians }) {
  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div className="card-head">
        <div>
          <div className="card-title" style={{ color: 'var(--accent)' }}>Your team</div>
          <div style={{ fontSize: 16, fontWeight: 650 }}>{team.teamName}</div>
        </div>
        <ModePill mode={team.mode} />
      </div>

      <div className="stats" style={{ marginBottom: 10 }}>
        <Stat l="Total" v={fmtValue(team.totalValue)} s={`#${team.rank} of league`} />
        <Stat l="Starters" v={fmtValue(team.starterValue)} s={`#${team.starterRank}`} />
        <Stat l="Picks" v={fmtValue(team.pickValue)} s={`${team.pickCount} owned`} />
        <Stat l="Age" v={fmtAge(team.avgAge)} s={`starters ${fmtAge(team.starterAge)}`} />
        <Stat l="Starter share" v={fmtPct(team.starterShare)} s="of total value" />
      </div>

      <ValueBar byPosition={team.byPosition} pickValue={team.pickValue} total={team.totalValue} />

      {(team.needs.length > 0 || team.surpluses.length > 0) && (
        <div className="wrap" style={{ marginTop: 10 }}>
          {team.needs.map((n) => (
            <span key={n.position} className="pill need">
              {n.position} need · {fmtValue(n.gap)} below median
            </span>
          ))}
          {team.surpluses.map((s) => (
            <span key={s.position} className="pill surplus">
              {s.position} surplus · {fmtValue(s.value)} tradeable
            </span>
          ))}
        </div>
      )}

      <Link to={`/team/${team.rosterId}`}>
        <button className="primary" style={{ width: '100%', marginTop: 11 }}>View full roster</button>
      </Link>
    </div>
  );
}

const Stat = ({ l, v, s }) => (
  <div className="stat"><div className="l">{l}</div><div className="v">{v}</div>{s && <div className="s">{s}</div>}</div>
);
