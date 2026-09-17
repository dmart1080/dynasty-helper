import React, { useEffect, useState } from 'react';
import { useApp } from '../App.jsx';
import { useApi } from '../lib/useApi.js';
import api from '../lib/api.js';
import { Loading, ErrorBox, MetaBanner, PosTag } from '../components/common.jsx';
import AssetPicker from '../components/AssetPicker.jsx';
import { fmtValue, fmtSigned, slotLabel } from '../lib/format.js';

export default function Trade() {
  const { leagueId, myRosterId, pickMode } = useApp();
  const teams = useApi(() => api.teams(leagueId, { pickMode }), [leagueId, pickMode]);

  const [rosterA, setRosterA] = useState(Number(myRosterId));
  const [rosterB, setRosterB] = useState(null);
  const [selA, setSelA] = useState([]);
  const [selB, setSelB] = useState([]);
  const [result, setResult] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState(null);

  const assetsA = useApi(() => fetchAssets(leagueId, rosterA, pickMode), [leagueId, rosterA, pickMode], { enabled: !!rosterA });
  const assetsB = useApi(() => fetchAssets(leagueId, rosterB, pickMode), [leagueId, rosterB, pickMode], { enabled: !!rosterB });

  useEffect(() => { setSelA([]); setResult(null); }, [rosterA]);
  useEffect(() => { setSelB([]); setResult(null); }, [rosterB]);

  const toggle = (setter) => (id) =>
    setter((cur) => (cur.some((x) => String(x) === String(id))
      ? cur.filter((x) => String(x) !== String(id))
      : [...cur, id]));

  const evaluate = async () => {
    setEvaluating(true); setError(null);
    try {
      const { data } = await api.evaluateTrade({
        leagueId, pickMode,
        sideA: { rosterId: rosterA, assetIds: selA },
        sideB: { rosterId: rosterB, assetIds: selB },
      });
      setResult(data);
    } catch (err) { setError(err); setResult(null); }
    finally { setEvaluating(false); }
  };

  const canEvaluate = rosterA && rosterB && rosterA !== rosterB && (selA.length || selB.length);

  if (teams.loading) return <Loading />;
  if (teams.error) return <ErrorBox error={teams.error} onRetry={teams.reload} />;

  return (
    <>
      <div className="topbar">
        <h1>Trade calculator</h1>
        <div className="sub">Raw totals, consolidation and roster-spot cost</div>
      </div>
      <MetaBanner meta={teams.meta} />

      <AssetPicker label="Side A" teams={teams.data?.teams} rosterId={rosterA}
        onRosterChange={setRosterA} assets={assetsA.data} selected={selA}
        onToggle={toggle(setSelA)} loading={assetsA.loading} />

      <div className="center" style={{ margin: '-2px 0 8px', color: 'var(--text-faint)', fontSize: 18 }}>⇅</div>

      <AssetPicker label="Side B" teams={teams.data?.teams} rosterId={rosterB}
        onRosterChange={setRosterB} assets={assetsB.data} selected={selB}
        onToggle={toggle(setSelB)} loading={assetsB.loading} />

      <button className="primary" style={{ width: '100%', marginBottom: 12 }}
        disabled={!canEvaluate || evaluating} onClick={evaluate}>
        {evaluating ? 'Evaluating…' : 'Evaluate trade'}
      </button>

      {error && <ErrorBox error={error} />}
      {result && <TradeResult result={result} onApplySuggestion={(assetId) => {
        (result.winner === 'A' ? toggle(setSelA) : toggle(setSelB))(assetId);
        setResult(null);
      }} />}
    </>
  );
}

async function fetchAssets(leagueId, rosterId, pickMode) {
  const res = await fetch(`/api/trades/assets/${leagueId}/${rosterId}?pickMode=${pickMode}`);
  const payload = await res.json();
  if (!res.ok || payload.ok === false) throw new Error(payload.error ?? 'Could not load assets');
  return { data: payload.data, meta: payload.meta };
}

function TradeResult({ result, onApplySuggestion }) {
  const pct = Math.abs(result.fairnessPct);
  const barPct = Math.min(50, (pct / 0.4) * 50);
  const leftWidth = result.winner === 'A' ? 50 + barPct : result.winner === 'B' ? 50 - barPct : 50;

  return (
    <>
      <div className="section-title">Verdict</div>
      <div className="card">
        <div className="spread" style={{ marginBottom: 8 }}>
          <span className={`pill ${verdictClass(result.verdictLabel)}`}>{result.verdictLabel}</span>
          <span className="mono small">
            {result.winner ? `${result.winnerName} +${Math.round(pct * 100)}%` : 'even'}
          </span>
        </div>

        {/* Fairness meter: centre is even, each side pushes the bar its way. */}
        <div style={{ position: 'relative', height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--surface-2)' }}>
          <div style={{ width: `${leftWidth}%`, height: '100%', background: 'var(--accent)' }} />
          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, background: 'var(--text)', opacity: 0.55 }} />
        </div>
        <div className="spread tiny faint" style={{ marginTop: 4 }}>
          <span>{result.sideA.teamName}</span><span>even</span><span>{result.sideB.teamName}</span>
        </div>

        <p style={{ fontSize: 13.5, margin: '11px 0 0', lineHeight: 1.5 }}>{result.verdict}</p>
      </div>

      {result.suggestions?.length > 0 && (
        <>
          <div className="section-title">What to add to balance it</div>
          <div className="card">
            <div className="tiny faint" style={{ marginBottom: 8 }}>
              {result.winnerName} adds one of these. Each is re-run through the full calculator,
              so the resulting fairness accounts for consolidation and roster spots too.
            </div>
            {result.suggestions.map((s) => (
              <div key={s.asset.id} className="prow">
                <div className="slot"><PosTag position={s.asset.position} /></div>
                <div>
                  <div className="nm">{s.asset.name}</div>
                  <div className="sub">
                    worth {fmtValue(s.asset.value)} → leaves it {Math.abs(Math.round(s.resultingFairnessPct * 100))}%
                    {' '}({s.resultingVerdict.toLowerCase()})
                  </div>
                </div>
                <button className="sm" onClick={() => onApplySuggestion(s.asset.id)}>Add</button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title">Value breakdown</div>
      <SideBreakdown side={result.sideA} />
      <SideBreakdown side={result.sideB} />
    </>
  );
}

function SideBreakdown({ side }) {
  return (
    <div className="card">
      <div className="card-head">
        <span style={{ fontWeight: 650 }}>{side.teamName}</span>
        <span className={`pill ${side.mode}`}>{side.mode}</span>
      </div>

      <div className="tiny faint" style={{ marginBottom: 6 }}>Receives</div>
      <div className="wrap" style={{ marginBottom: 10 }}>
        {side.incoming.length === 0 && <span className="faint small">nothing</span>}
        {side.incoming.map((a) => (
          <span key={a.id} className="pill muted">
            <span className={`pos ${a.position}`}>{a.position}</span> {a.name} {fmtValue(a.value)}
          </span>
        ))}
      </div>

      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <tbody>
          <Row label="Raw value in" value={fmtValue(side.rawIncoming)} />
          {side.consolidationPremium > 0 && (
            <Row label={`Consolidation premium (best asset: ${side.consolidationAsset?.name})`}
              value={`+${fmtValue(side.consolidationPremium)}`} good />
          )}
          {side.rosterSpotCost > 0 && (
            <Row label={`Roster-spot cost (${side.spotsNeeded} cut: ${side.cuts.map((c) => c.name).join(', ')})`}
              value={`−${fmtValue(side.rosterSpotCost)}`} bad />
          )}
          <Row label="Adjusted total" value={fmtValue(side.adjustedIncoming)} strong />
        </tbody>
      </table>

      <div className="spread" style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--border)' }}>
        <span className="small muted">Starting lineup</span>
        <span className="mono small">
          {fmtValue(side.lineup.beforeValue)} → {fmtValue(side.lineup.afterValue)}
          <strong className={side.lineup.delta >= 0 ? 'good' : 'bad'} style={{ marginLeft: 6 }}>
            {fmtSigned(side.lineup.delta)}
          </strong>
        </span>
      </div>

      {side.lineup.after.some((s) => s.changed) && (
        <div className="wrap" style={{ marginTop: 7 }}>
          {side.lineup.after.filter((s) => s.changed && s.player).map((s) => (
            <span key={s.slot + s.player.id} className="pill surplus">
              {slotLabel(s.slot)}: {s.player.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const Row = ({ label, value, good, bad, strong }) => (
  <tr style={{ borderTop: '1px solid var(--border)' }}>
    <td style={{ padding: '6px 0', color: strong ? 'var(--text)' : 'var(--text-dim)', fontWeight: strong ? 650 : 400, fontSize: 12.5 }}>
      {label}
    </td>
    <td className={`mono ${good ? 'good' : bad ? 'bad' : ''}`}
      style={{ textAlign: 'right', fontWeight: strong ? 700 : 600, padding: '6px 0' }}>
      {value}
    </td>
  </tr>
);

const verdictClass = (label) =>
  ({ 'Dead even': 'surplus', Fair: 'surplus', 'Clear edge': 'middle', Lopsided: 'need', 'Rejected instantly': 'need' }[label] ?? 'muted');
