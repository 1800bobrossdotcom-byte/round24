// ============================================================
// rollup engine — one spine, every view.
// mirrors the spec: every timer carries tech + property + unit
// + date + rate, so every aggregate is a reduce over the same set.
// ============================================================

export const fmtMoney = (n) =>
  '$' + Math.round(n).toLocaleString('en-US');
export const fmtMoneyC = (n) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtHrs = (n) => (Math.round(n * 10) / 10).toLocaleString('en-US');

export const cost = (t) => t.durationHrs * t.rate;

// ISO week key but honoring a configurable week start (Sat for Evolution24)
export function periodKey(dateStr, grain, weekStartDay = 6) {
  const d = new Date(dateStr + 'T00:00:00');
  if (grain === 'day') return dateStr;
  if (grain === 'month') return dateStr.slice(0, 7);
  if (grain === 'year') return dateStr.slice(0, 4);
  // week: roll back to configured start day
  const day = d.getDay();
  const diff = (day - weekStartDay + 7) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - diff);
  return start.toISOString().slice(0, 10);
}

export function periodLabel(key, grain) {
  if (grain === 'year') return key;
  if (grain === 'month') {
    const [y, m] = key.split('-');
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  if (grain === 'week') {
    const d = new Date(key + 'T00:00:00');
    const end = new Date(d); end.setDate(d.getDate() + 6);
    const f = (x) => x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${f(d)}–${f(end)}`;
  }
  return new Date(key + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// generic grouped rollup
export function rollup(timers, keyFn) {
  const m = new Map();
  for (const t of timers) {
    const k = keyFn(t);
    if (!m.has(k)) m.set(k, { key: k, hrs: 0, cost: 0, count: 0 });
    const e = m.get(k);
    e.hrs += t.durationHrs;
    e.cost += cost(t);
    e.count += 1;
  }
  return [...m.values()];
}

export function byPeriod(timers, grain, weekStartDay = 6) {
  return rollup(timers, (t) => periodKey(t.date, grain, weekStartDay))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((e) => ({ ...e, label: periodLabel(e.key, grain) }));
}

export const byTech = (timers) => rollup(timers, (t) => t.techId);
export const byProp = (timers) => rollup(timers, (t) => t.propId);
export const byUnit = (timers) => rollup(timers, (t) => `${t.propId}|${t.unit}`);
export const byCategory = (timers) => rollup(timers, (t) => t.category);

export function totals(timers) {
  return timers.reduce(
    (a, t) => ({ hrs: a.hrs + t.durationHrs, cost: a.cost + cost(t), count: a.count + 1 }),
    { hrs: 0, cost: 0, count: 0 }
  );
}

// category median duration — powers "this job vs normal"
export function categoryMedian(timers, category) {
  const ds = timers.filter((t) => t.category === category).map((t) => t.durationHrs).sort((a, b) => a - b);
  if (!ds.length) return 0;
  const mid = Math.floor(ds.length / 2);
  return ds.length % 2 ? ds[mid] : (ds[mid - 1] + ds[mid]) / 2;
}

export function filterRange(timers, from, to) {
  return timers.filter((t) => (!from || t.date >= from) && (!to || t.date <= to));
}
