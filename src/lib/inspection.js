// ============================================================
// Inspections — checklist templates + scoring. Pure, dependency-free.
// An item is { label, status: 'pass'|'fail'|'na'|'', note }.
// ============================================================

// Ready-to-run checklists. Starting an inspection copies the chosen template's
// items (each status blank) onto the inspection.
export const TEMPLATES = [
  { key: 'move_in', name: 'Move-in', items: [
    'Walls & ceilings', 'Floors & carpet', 'Windows & screens', 'Doors & locks',
    'Kitchen appliances', 'Plumbing — no leaks', 'Electrical & outlets', 'Heat / HVAC',
    'Smoke & CO detectors', 'Keys issued'] },
  { key: 'move_out', name: 'Move-out', items: [
    'Walls & ceilings', 'Floors & carpet', 'Windows & screens', 'Doors & locks',
    'Kitchen — clean & working', 'Bathroom — clean & working', 'Plumbing — no leaks',
    'Trash removed', 'Keys returned', 'Damage beyond normal wear'] },
  { key: 'quarterly', name: 'Quarterly safety', items: [
    'Smoke & CO detectors', 'Fire extinguishers charged', 'Exit routes clear',
    'Handrails & stairs', 'Exterior lighting', 'Common-area cleanliness',
    'Roof / gutters', 'Heating system', 'Water heater', 'No visible leaks'] },
  { key: 'turn', name: 'Unit turn', items: [
    'Cleaned top to bottom', 'Paint / touch-ups', 'Flooring', 'Appliances working',
    'Plumbing fixtures', 'Electrical & outlets', 'Locks re-keyed', 'Smoke & CO detectors',
    'Blinds / windows', 'Ready to show'] },
];

export const templateByKey = (key) => TEMPLATES.find((t) => t.key === key) || null;

// Build a fresh inspection's item list from a template key.
export function itemsFromTemplate(key) {
  const t = templateByKey(key);
  return (t ? t.items : []).map((label) => ({ label, status: '', note: '' }));
}

// Score an inspection's items.
export function scoreItems(items = []) {
  const total = items.length;
  let pass = 0, fail = 0, na = 0, done = 0;
  for (const it of items) {
    if (it.status === 'pass') { pass += 1; done += 1; }
    else if (it.status === 'fail') { fail += 1; done += 1; }
    else if (it.status === 'na') { na += 1; done += 1; }
  }
  return {
    total, pass, fail, na, done,
    pct: total ? Math.round((done / total) * 100) : 0,
    hasFails: fail > 0,
    complete: total > 0 && done === total,
  };
}

// Org-level rollup for the dashboard row.
export function inspectionSummary(inspections = []) {
  let open = 0, failsOpen = 0, completed = 0;
  for (const insp of inspections) {
    const s = scoreItems(insp.items);
    if (insp.status === 'complete') completed += 1;
    else open += 1;
    failsOpen += s.fail; // failed line items still on the books
  }
  return { open, completed, failsOpen, total: inspections.length };
}
