// ============================================================
// Chart ink — the few colors an SVG chart needs, read from the live tokens.
// Recharts writes fill/stroke as SVG attributes, which cannot resolve
// var(--text), so charts read the computed values and re-read them when the
// theme flips (theme.js dispatches 'r24-theme'). Monochrome by design: one ink
// for a single series, ink + hatching for a second, never a hue.
// ============================================================
import { useEffect, useState } from 'react';

const read = (name, fallback) => {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

export function chartInk() {
  return {
    ink: read('--text', '#f2f2f2'),
    dim: read('--text-dim', '#a3a3a3'),
    faint: read('--text-faint', '#6b6b6b'),
    line: read('--line', '#2a2a2a'),
    surface: read('--surface-2', '#101010'),
    mono: read('--mono', 'ui-monospace, monospace'),
  };
}

export function useChartInk() {
  const [ink, setInk] = useState(chartInk);
  useEffect(() => {
    const sync = () => setInk(chartInk());
    window.addEventListener('r24-theme', sync);
    return () => window.removeEventListener('r24-theme', sync);
  }, []);
  return ink;
}

// tooltip box that follows the tokens (plain CSS properties resolve var() fine)
export const tooltipStyle = {
  background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 3,
  fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)',
};
