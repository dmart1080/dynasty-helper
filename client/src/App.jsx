import React, { createContext, useContext, useMemo } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useStored } from './lib/useApi.js';
import Dashboard from './pages/Dashboard.jsx';
import Team from './pages/Team.jsx';
import Picks from './pages/Picks.jsx';
import Settings from './pages/Settings.jsx';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const TABS = [
  { to: '/', label: 'Teams', icon: '📊', end: true },
  { to: '/picks', label: 'Picks', icon: '🎯' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

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
          <Route path="/picks" element={<Picks />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<div className="empty-state">Page not found. <NavLink to="/">Go to Teams</NavLink></div>} />
        </Routes>
      </div>
      <nav className="tabbar">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => (isActive || (t.to === '/' && location.pathname.startsWith('/team/')) ? 'on' : '')}>
            <span className="ico">{t.icon}</span>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </AppCtx.Provider>
  );
}
