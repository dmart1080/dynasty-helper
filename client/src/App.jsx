import React, { createContext, useContext, useMemo } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useStored } from './lib/useApi.js';
import Dashboard from './pages/Dashboard.jsx';
import Team from './pages/Team.jsx';
import Picks from './pages/Picks.jsx';
import Trade from './pages/Trade.jsx';
import Finder from './pages/Finder.jsx';
import Intel from './pages/Intel.jsx';
import Watchlist from './pages/Watchlist.jsx';
import Settings from './pages/Settings.jsx';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const TABS = [
  { to: '/', label: 'Teams', icon: '📊', end: true },
  { to: '/trade', label: 'Trade', icon: '⇄' },
  { to: '/finder', label: 'Finder', icon: '🔍' },
  { to: '/intel', label: 'Intel', icon: '📈' },
  { to: '/more', label: 'More', icon: '⋯' },
];

function More() {
  return (
    <>
      <div className="topbar"><h1>More</h1><div className="sub">Picks, watchlist and settings</div></div>
      <div style={{ marginTop: 12 }}>
        {[
          { to: '/picks', icon: '🎯', title: 'Draft picks', sub: 'Every team\u2019s owned picks and their values' },
          { to: '/watchlist', icon: '⭐', title: 'Watchlist & overrides', sub: 'Targets, value trends and manual adjustments' },
          { to: '/settings', icon: '⚙️', title: 'Settings', sub: 'League ID, your team, and data sync' },
        ].map((l) => (
          <NavLink key={l.to} to={l.to} className="team-row" style={{ gridTemplateColumns: '30px 1fr auto' }}>
            <div style={{ fontSize: 19, textAlign: 'center' }}>{l.icon}</div>
            <div>
              <div className="team-name">{l.title}</div>
              <div className="team-meta">{l.sub}</div>
            </div>
            <div className="faint">›</div>
          </NavLink>
        ))}
      </div>
    </>
  );
}

export default function App() {
  const [leagueId, setLeagueId] = useStored('dh.leagueId', '1312193587416436736');
  const [myRosterId, setMyRosterId] = useStored('dh.myRosterId', 1);
  const [pickMode, setPickMode] = useStored('dh.pickMode', 'projected');
  const location = useLocation();

  const ctx = useMemo(
    () => ({ leagueId, setLeagueId, myRosterId, setMyRosterId, pickMode, setPickMode }),
    [leagueId, myRosterId, pickMode],
  );

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/team/:rosterId" element={<Team />} />
          <Route path="/trade" element={<Trade />} />
          <Route path="/finder" element={<Finder />} />
          <Route path="/intel" element={<Intel />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/picks" element={<Picks />} />
          <Route path="/more" element={<More />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<div className="empty-state">Page not found. <NavLink to="/">Go to Teams</NavLink></div>} />
        </Routes>
      </div>
      <nav className="tabbar">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => (isActive
              || (t.to === '/' && location.pathname.startsWith('/team/'))
              || (t.to === '/more' && ['/picks', '/watchlist', '/settings'].includes(location.pathname))
              ? 'on' : '')}>
            <span className="ico">{t.icon}</span>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </AppCtx.Provider>
  );
}
