import { useState, useEffect } from 'react';
import { isConfigured } from '../lib/backend/supabase.js';
import { getTheme, applyTheme } from '../lib/theme.js';
import { IcSun, IcMoon } from './ui.jsx';

// persistent slim strip pinned to the very top: live day + clock (military by
// default, tap to switch to 12-hour) and a glowing dot that shows field
// encryption is active. Clock format preference persists across sessions.
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n) => String(n).padStart(2, '0');

export default function TopStrip() {
  const [now, setNow] = useState(() => new Date());
  const [mil, setMil] = useState(() => localStorage.getItem('caliper_clock12') !== '1'); // military default
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  // TopStrip is mounted once and never remounts — pick up clock-format changes made
  // from Settings (same tab via custom event, other tabs via storage event)
  useEffect(() => {
    const sync = () => setMil(localStorage.getItem('caliper_clock12') !== '1');
    window.addEventListener('caliper-clock', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('caliper-clock', sync); window.removeEventListener('storage', sync); };
  }, []);

  const secure = isConfigured();
  const h = now.getHours();
  const time = mil
    ? `${pad(h)}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    : `${(h % 12) || 12}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ${h < 12 ? 'AM' : 'PM'}`;
  const date = `${DOW[now.getDay()]} ${MON[now.getMonth()]} ${now.getDate()}`;

  const toggle = () => setMil((v) => {
    const nv = !v;
    localStorage.setItem('caliper_clock12', nv ? '0' : '1');
    return nv;
  });

  const [theme, setTheme] = useState(() => getTheme());
  const flipTheme = () => { const t = theme === 'light' ? 'dark' : 'light'; applyTheme(t); setTheme(t); };

  return (
    <div className="topstrip">
      <div className={'aes' + (secure ? ' on' : '')}
        title={secure ? 'AES-256 field encryption active' : 'Demo mode — connect to enable encrypted storage'}>
        <span className="dot" />
        <span className="lbl">{secure ? 'AES-256 ENCRYPTED' : 'AES · DEMO'}</span>
      </div>
      <div className="strip-right">
        <button className="theme-btn" onClick={flipTheme} title={theme === 'light' ? 'Switch to dark' : 'Switch to light'} aria-label="Toggle light/dark theme">
          {theme === 'light' ? <IcMoon width={13} height={13} /> : <IcSun width={13} height={13} />}
        </button>
        <button className="clock" onClick={toggle} title="Tap to switch 12/24-hour" aria-label="Toggle clock format">
          <span className="d">{date}</span>
          <span className="t">{time}</span>
          <span className="fmt">{mil ? '24H' : '12H'}</span>
        </button>
      </div>
    </div>
  );
}
