import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { getToken, setUnauthorizedHandler } from './lib/api.js';

import Login from './screens/Login.jsx';
import Today from './screens/Today.jsx';
import LogScreen from './screens/LogScreen.jsx';
import Progress from './screens/Progress.jsx';
import Meals from './screens/Meals.jsx';
import Standards from './screens/Standards.jsx';
import Settings from './screens/Settings.jsx';
import Disclaimer from './screens/Disclaimer.jsx';

const NAV = [
  { to: '/', label: 'Today', glyph: '◎' },
  { to: '/log', label: 'Log', glyph: '✎' },
  { to: '/progress', label: 'Progress', glyph: '◪' },
  { to: '/meals', label: 'Meals', glyph: '☰' },
  { to: '/settings', label: 'Settings', glyph: '⚙' },
];

function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur border-t border-white/10 safe-bottom">
      <ul className="grid grid-cols-5">
        {NAV.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] min-h-[56px] ${
                  isActive ? 'text-series' : 'text-muted'
                }`
              }
            >
              <span aria-hidden="true" className="text-lg leading-none">
                {item.glyph}
              </span>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-full">
      <main className="mx-auto w-full max-w-md px-3 pt-3 pb-28 safe-top">{children}</main>
      <BottomNav />
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(() => Boolean(getToken()));
  const location = useLocation();

  const handleUnauthorized = useCallback(() => setAuthed(false), []);

  useEffect(() => {
    setUnauthorizedHandler(handleUnauthorized);
  }, [handleUnauthorized]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  if (!authed) {
    return <Login onSignedIn={() => setAuthed(true)} />;
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/log" element={<LogScreen />} />
        <Route path="/progress" element={<Progress />} />
        <Route path="/meals" element={<Meals />} />
        <Route path="/standards" element={<Standards />} />
        <Route path="/settings" element={<Settings onSignedOut={() => setAuthed(false)} />} />
        <Route path="/disclaimer" element={<Disclaimer />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
