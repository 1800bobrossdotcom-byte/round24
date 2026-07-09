// Light / dark theme, persisted. Applied to <html data-theme> so the CSS token
// overrides in tokens.css take effect without a React re-render.
const KEY = 'caliper_theme';
const meta = () => document.querySelector('meta[name="theme-color"]');

export function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  const m = meta(); if (m) m.setAttribute('content', t === 'light' ? '#f4f5f2' : '#08080a');
}

export function initTheme() {
  let t = 'light'; // light is the default; a saved choice overrides it
  try { t = localStorage.getItem(KEY) || 'light'; } catch { /* ignore */ }
  document.documentElement.setAttribute('data-theme', t);
  const m = meta(); if (m) m.setAttribute('content', t === 'light' ? '#f4f5f2' : '#08080a');
}

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}
