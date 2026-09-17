import React, { useState } from 'react';
import { useApp } from '../App.jsx';
import { useApi } from '../lib/useApi.js';
import api from '../lib/api.js';
import { Loading, ErrorBox, MetaBanner, PosTag } from '../components/common.jsx';
import { fmtValue, fmtSigned, timeAgo } from '../lib/format.js';

/** League Intelligence: who trades, what they buy and sell, and value movers. */
export default function Intel() {
  const { leagueId } = useApp();
  const [tab, setTab] = useState('managers');

  const managers = useApi(() => api.managers(leagueId), [leagueId]);
  const movers = useApi(() => fetchJson(`/api/intel/${leagueId}/movers?days=30`), [leagueId]);

  return (
    <>
      <div className="topbar">
        <h1>League intelligence</h1>
        <div className="sub">Manager tendencies and value movement</div>
      </div>
      <MetaBanner meta={managers.meta} />

      <div className="seg" style={{ width: '100%', margin: '12px 0 4px' }}>
        <button style={{ flex: 1 }} className={tab === 'managers' ? 'on' : ''} onClick={() => setTab('managers')}>Managers</button>
        <button style={{ flex: 1 }} className={tab === 'trades' ? 'on' : ''} onClick={() => setTab('trades')}>Trade log</button>
        <button style={{ flex: 1 }} className={tab === 'movers' ? 'on' : ''} onClick={() => setTab('movers')}>Movers</button>
      </div>

      {tab === 'managers' && <Managers state={managers} />}
      {tab === 'trades' && <TradeLog state={managers} />}
      {tab === 'movers' && <Movers state={movers} />}
    </>
  );
}

function Managers({ state }) {
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />;
  const data = state.data;
  if (!data) return null;

  if (data.totalTrades === 0) {
    return <div className="card"><div className="empty-state">
      No completed trades found in the synced history. Run a sync with history enabled from Settings.
    </div></div>;
  }

  return (
    <>
      <div className="banner info">
        <div>{data.totalTrades} trades across {data.seasonsCovered.join(', ') || 'this season'}. {data.caveat}</div>
      </div>

      {data.managers.map((m) => (
        <div className="card" key={m.rosterId}>
          <div className="card-head">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 650, fontSize: 14.5 }}>{m.teamName}</div>
              <div className="tiny faint">
                {m.trades} trade{m.trades === 1 ? '' : 's'}
                {m.tradesPerMonth ? ` · ${m.tradesPerMonth}/month` : ''}
                {m.lastTradeAt ? ` · last ${timeAgo(new Date(m.lastTradeAt).toISOString())}` : ''}
              </div>
            </div>
            <span className={`pill ${m.picksAcquired > m.picksSent ? 'rebuilder' : m.picksSent > m.picksAcquired ? 'contender' : 'muted'}`}>
              {m.pickStance}
            </span>
          </div>

          {m.trades > 0 && (
            <>
              <div className="stats" style={{ marginBottom: 9 }}>
                <St l="Players in" v={m.playersAcquired} />
                <St l="Players out" v={m.playersSent} />
                <St l="Picks in" v={m.picksAcquired} />
                <St l="Picks out" v={m.picksSent} />
                <St l="Pieces/trade" v={m.avgPiecesPerTrade} />
              </div>

              <div className="tiny faint" style={{ marginBottom: 4 }}>BUYS</div>
              <div className="wrap" style={{ marginBottom: 8 }}>
                {Object.entries(m.boughtByPosition).sort((a, b) => b[1] - a[1]).map(([pos, n]) => (
                  <span key={pos} className="pill muted"><span className={`pos ${pos}`}>{pos}</span> ×{n}</span>
                ))}
                {Object.keys(m.boughtByPosition).length === 0 && <span className="tiny faint">nothing</span>}
              </div>

              <div className="tiny faint" style={{ marginBottom: 4 }}>SELLS</div>
              <div className="wrap" style={{ marginBottom: 8 }}>
                {Object.entries(m.soldByPosition).sort((a, b) => b[1] - a[1]).map(([pos, n]) => (
                  <span key={pos} className="pill muted"><span className={`pos ${pos}`}>{pos}</span> ×{n}</span>
                ))}
                {Object.keys(m.soldByPosition).length === 0 && <span className="tiny faint">nothing</span>}
              </div>

              {m.partners.length > 0 && (
                <div className="tiny faint">
                  Trades most with {m.partners.slice(0, 2).map((p) => `${p.teamName} (${p.count})`).join(', ')}
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </>
  );
}

function TradeLog({ state }) {
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />;
  const trades = state.data?.recentTrades ?? [];
  if (!trades.length) return <div className="card"><div className="empty-state">No trades on record.</div></div>;

  return trades.map((t) => (
    <div className="card" key={t.transactionId}>
      <div className="card-head">
        <span className="card-title">{t.season} · week {t.week}</span>
        <span className="tiny faint">{t.created ? new Date(t.created).toLocaleDateString() : ''}</span>
      </div>
      {t.moves.map((m) => (
        <div key={m.rosterId} style={{ marginBottom: 7 }}>
          <div className="small" style={{ fontWeight: 600, marginBottom: 2 }}>{m.teamName} received</div>
          {m.received.length === 0 && <div className="tiny faint">nothing</div>}
          <div className="wrap">
            {m.received.map((r) => (
              <span key={r.id} className="pill muted">
                <span className={`pos ${r.position}`}>{r.position}</span> {r.name}
                {r.value ? <span className="faint"> {fmtValue(r.value)}</span> : null}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  ));
}

function Movers({ state }) {
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />;
  const data = state.data;
  if (!data) return null;

  if (data.daysAvailable < 2) {
    return <div className="card"><div className="empty-state">
      Only {data.daysAvailable} day of value history stored so far. Trends appear once
      the app has captured snapshots on at least two separate days.
    </div></div>;
  }

  const Row = ({ p }) => (
    <div className="prow">
      <div className="slot"><PosTag position={p.position} /></div>
      <div>
        <div className="nm">{p.name}</div>
        <div className="sub">{p.ownerName} · {fmtValue(p.previousValue)} → {fmtValue(p.value)}</div>
      </div>
      <div className="val" style={{ color: p.pct >= 0 ? 'var(--good)' : 'var(--bad)' }}>
        {p.pct >= 0 ? '+' : ''}{p.pct}%
        <small>{fmtSigned(p.delta)}</small>
      </div>
    </div>
  );

  return (
    <>
      <div className="banner info">
        <div>Value change from {data.from} to {data.to} ({data.daysAvailable} daily snapshots stored).</div>
      </div>
      <div className="section-title">Risers</div>
      <div className="card tight">{data.risers.map((p) => <Row key={p.playerKey} p={p} />)}</div>
      <div className="section-title">Fallers</div>
      <div className="card tight">{data.fallers.map((p) => <Row key={p.playerKey} p={p} />)}</div>
    </>
  );
}

const St = ({ l, v }) => <div className="stat"><div className="l">{l}</div><div className="v">{v}</div></div>;

async function fetchJson(path) {
  const res = await fetch(path);
  const payload = await res.json();
  if (!res.ok || payload.ok === false) throw new Error(payload.error ?? 'Request failed');
  return { data: payload.data, meta: payload.meta };
}
