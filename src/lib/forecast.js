// ============================================================
// Predictive expenses — turns the receipt history into what's coming next.
// Four signals, all derived from data the crew already captures:
//   run-rate   — trailing spend by category/building → next 30/90 days
//   recurring  — same vendor+item on a cadence → the next likely buy + when
//   turnovers  — vacant units + leases ending → projected make-ready spend
//   warranties — appliance/HVAC buys carry coverage → when it lapses (= risk)
// Pure + dependency-free.
// ============================================================

const DAY = 86400000;
const money = (n) => Math.round(n);
const tOf = (p) => (p.createdAt ? new Date(p.createdAt).getTime() : null);
const isApproved = (p) => !p.status || p.status === 'approved';

// infer a work category from the vendor + note + line items
const CAT_HINTS = [
  [/paint|sherwin|eggshell|primer|roller/i, 'painting'],
  [/furnace|hvac|igniter|thermostat|condenser|blower|flame sensor|filter/i, 'hvac'],
  [/faucet|plumb|cartridge|supply line|p-?trap|wax ring|water heater|sharkbite|drain/i, 'plumbing'],
  [/dishwasher|refrigerator|fridge|range|oven|microwave|washer|dryer|disposal|appliance/i, 'appliance'],
  [/smoke|detector|breaker|outlet|gfci|wire|electrical|fixture|ballast/i, 'electrical'],
  [/lock|door|hinge|closer|hardware|key/i, 'general'],
];
export function guessCategory(p) {
  if (p.category && p.category !== 'imported') return p.category;
  const hay = `${p.vendor || ''} ${p.note || ''} ${(p.lineItems || []).map((li) => li.description).join(' ')}`;
  for (const [re, cat] of CAT_HINTS) if (re.test(hay)) return cat;
  return 'other';
}

// typical manufacturer warranty by item, in months — used to project when a
// covered item lapses (an unbudgeted repair becomes likely after)
const WARRANTY_MONTHS = [
  [/water heater/i, 72], [/furnace|condenser|hvac|heat pump/i, 120], [/\bac\b|air condition/i, 60],
  [/refrigerator|fridge/i, 12], [/dishwasher/i, 12], [/washer|dryer/i, 12],
  [/range|oven|microwave|disposal/i, 12], [/roof/i, 240], [/appliance/i, 12],
];
// consumables ride under HVAC/appliance keywords but carry no warranty
const CONSUMABLE = /filter|tape|caulk|glue|fitting|coupling|supplies|supply line|cartridge|element|wax ring|pack|case|towel|drop cloth|roller|brush|primer|screws?|bulb/i;
function warrantyMonthsFor(p) {
  if (p.warrantyMonths) return p.warrantyMonths;
  const items = (p.lineItems || []).map((li) => li.description);
  const hay = `${p.note || ''} ${items.join(' ')}`;
  if (CONSUMABLE.test(hay) && !p.warrantyMonths) return null;   // filters, tape, fittings, …
  for (const [re, m] of WARRANTY_MONTHS) if (re.test(hay)) return m;
  return null;
}

function groupSum(list, keyFn) {
  const m = new Map();
  for (const p of list) { const k = keyFn(p) || 'Unassigned'; m.set(k, (m.get(k) || 0) + (p.amount || 0)); }
  return [...m.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
}
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const addMonths = (t, m) => { const d = new Date(t); d.setMonth(d.getMonth() + m); return d.getTime(); };
// LOCAL calendar day of an instant — toISOString() would shift evening dates a day forward in US time zones
const isoDay = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// recurring buys: same vendor + category showing up on a cadence
function detectRecurring(dated, asOf) {
  const groups = new Map();
  for (const p of dated) {
    const key = `${(p.vendor || '?').toLowerCase()}|${guessCategory(p)}`;
    (groups.get(key) || groups.set(key, []).get(key)).push(p);
  }
  const out = [];
  for (const [, items] of groups) {
    if (items.length < 2) continue;
    items.sort((a, b) => a.t - b.t);
    const gaps = items.slice(1).map((p, i) => (p.t - items[i].t) / DAY);
    const cadence = Math.round(median(gaps));
    if (cadence < 10 || cadence > 400) continue;      // not a real cadence
    const last = items[items.length - 1];
    const avg = items.reduce((a, p) => a + (p.amount || 0), 0) / items.length;
    const nextT = last.t + cadence * DAY;
    // regularity: tighter gap spread → higher confidence
    const spread = gaps.length > 1 ? Math.max(...gaps) - Math.min(...gaps) : 0;
    const confidence = Math.min(1, items.length / 5) * (spread > cadence ? 0.6 : 1);
    out.push({
      vendor: last.vendor || '—', category: guessCategory(last), count: items.length,
      avgAmount: money(avg), cadenceDays: cadence, lastDate: isoDay(last.t),
      nextDate: isoDay(nextT), overdue: nextT < asOf, confidence: Math.round(confidence * 100),
    });
  }
  return out.sort((a, b) => new Date(a.nextDate) - new Date(b.nextDate));
}

// projected make-ready spend from the rent roll: vacant/turning units cost now,
// leases ending soon likely turn next.
function detectTurnovers(leasing, asOf, perTurn) {
  const out = [];
  const soon = asOf + 75 * DAY;
  for (const u of leasing) {
    if (u.type === 'land' || u.status === 'held') continue;
    const endT = u.leaseEnd ? new Date(u.leaseEnd).getTime() : null;
    if (u.status === 'vacant' || u.status === 'turning') {
      out.push({ building: u.building, unit: u.number, reason: u.status === 'turning' ? 'turning now' : 'vacant', dueDate: null, estCost: perTurn });
    } else if (endT && endT <= soon && endT >= asOf - 5 * DAY) {
      out.push({ building: u.building, unit: u.number, reason: 'lease ending', dueDate: u.leaseEnd, estCost: Math.round(perTurn * 0.5) });
    }
  }
  return out.sort((a, b) => (a.dueDate ? new Date(a.dueDate) : 0) - (b.dueDate ? new Date(b.dueDate) : 0));
}

function detectWarranties(dated, asOf) {
  const out = [];
  for (const p of dated) {
    const m = warrantyMonthsFor(p); if (!m) continue;
    const expiry = addMonths(p.t, m);
    out.push({
      item: (p.lineItems || []).map((li) => li.description).find((d) => WARRANTY_MONTHS.some(([re]) => re.test(d))) || p.note || p.vendor || 'item',
      building: p.propLabel || 'Unassigned', vendor: p.vendor || '—',
      purchaseDate: isoDay(p.t), expiry: isoDay(expiry),
      daysLeft: Math.round((expiry - asOf) / DAY), active: expiry >= asOf,
    });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

export function forecastExpenses({ purchases = [], leasing = [], asOf = null, turnDefault = 650, windowDays = 90 } = {}) {
  const now = asOf || new Date(purchases.reduce((a, p) => Math.max(a, tOf(p) || 0), 0) || Date.now()).getTime();
  const approved = purchases.filter(isApproved).map((p) => ({ ...p, t: tOf(p) })).filter((p) => p.t);
  const since = now - windowDays * DAY;
  const recent = approved.filter((p) => p.t >= since);
  const total = recent.reduce((a, p) => a + (p.amount || 0), 0);
  const monthly = total / (windowDays / 30);

  const byCat = groupSum(recent, guessCategory);
  const byBld = groupSum(recent, (p) => p.propLabel);
  const recurring = detectRecurring(approved, now);
  const turnCosts = approved.filter((p) => ['painting', 'appliance'].includes(guessCategory(p))).map((p) => p.amount || 0);
  const perTurn = turnCosts.length ? Math.round(turnCosts.reduce((a, b) => a + b, 0) / turnCosts.length) : turnDefault;
  const turnovers = detectTurnovers(leasing, now, perTurn);
  const warranties = detectWarranties(approved, now);

  return {
    asOf: isoDay(now), windowDays, sampleCount: recent.length,
    monthly: money(monthly), projected30: money(monthly), projected90: money(monthly * 3),
    byCat, byBld, recurring, turnovers,
    turnTotal: turnovers.reduce((a, t) => a + t.estCost, 0),
    warranties, warrantyActive: warranties.filter((w) => w.active).length,
  };
}
