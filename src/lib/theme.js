// Light / dark theme, persisted. Applied to <html data-theme> so the CSS token
// overrides in tokens.css take effect without a React re-render.
const KEY = 'caliper_theme';
const meta = () => document.querySelector('meta[name="theme-color"]');

const norm = (t) => (t === 'dark' ? 'dark' : 'light'); // any garbage/legacy value → light, never an invalid attr

export function applyTheme(t) {
  const v = norm(t);
  document.documentElement.setAttribute('data-theme', v);
  try { localStorage.setItem(KEY, v); } catch { /* ignore */ }
  const m = meta(); if (m) m.setAttribute('content', v === 'light' ? '#f4f5f2' : '#08080a');
}

export function initTheme() {
  let t = 'light'; // light is the default; a saved choice overrides it
  try { t = localStorage.getItem(KEY) || 'light'; } catch { /* ignore */ }
  const v = norm(t);
  document.documentElement.setAttribute('data-theme', v);
  const m = meta(); if (m) m.setAttribute('content', v === 'light' ? '#f4f5f2' : '#08080a');
}

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}
