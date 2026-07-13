// ============================================================
// #hashtag task tagging → category buckets.
//
// Crew describe what they're on in plain words with #tags — "#rounds",
// "#mopping the halls", "spot check #spotcheck", "working on #caliper #dev".
// Each recognized tag maps to one of the fixed job categories, so a note
// self-classifies instead of making the operator hunt for the right chip.
// Unknown tags are kept as labels (they still show, they just don't set a
// category), so the vocabulary can grow without code changes.
// ============================================================

// tag (singular, lowercased) → category bucket. Add freely; plurals/’-ing’ are
// normalized before lookup, so "#floors" and "#mopping" resolve on their own.
const TAG_CATEGORY = {
  // plumbing
  plumbing: 'plumbing', plumb: 'plumbing', leak: 'plumbing', drain: 'plumbing', faucet: 'plumbing',
  toilet: 'plumbing', pipe: 'plumbing', clog: 'plumbing', sink: 'plumbing', valve: 'plumbing', sewer: 'plumbing',
  // electrical
  electrical: 'electrical', electric: 'electrical', wiring: 'electrical', wire: 'electrical', outlet: 'electrical',
  breaker: 'electrical', light: 'electrical', lighting: 'electrical', fixture: 'electrical', gfci: 'electrical',
  // hvac
  hvac: 'hvac', heat: 'hvac', heating: 'hvac', ac: 'hvac', furnace: 'hvac', boiler: 'hvac',
  thermostat: 'hvac', vent: 'hvac', ventilation: 'hvac', cooling: 'hvac', ductwork: 'hvac',
  // appliance
  appliance: 'appliance', application: 'appliance', fridge: 'appliance', refrigerator: 'appliance',
  stove: 'appliance', oven: 'appliance', washer: 'appliance', dryer: 'appliance', dishwasher: 'appliance', microwave: 'appliance',
  // doors (work-order-only category)
  door: 'doors', doors: 'doors', garage: 'doors', lock: 'doors', hinge: 'doors', deadbolt: 'doors',
  // painting
  paint: 'painting', painting: 'painting', touchup: 'painting', primer: 'painting', caulk: 'painting',
  // turn / cleaning / haul-out
  turn: 'turn', turnover: 'turn', cleanout: 'turn', cleaning: 'turn', clean: 'turn', mop: 'turn', mopping: 'turn',
  trash: 'turn', trashout: 'turn', floor: 'turn', floors: 'turn', sweep: 'turn', haul: 'turn', junk: 'turn', vacuum: 'turn',
  // inspection / spot checks / rounds-with-a-checklist
  inspection: 'inspection', inspect: 'inspection', spotcheck: 'inspection', check: 'inspection',
  walkthrough: 'inspection', walk: 'inspection', punchlist: 'inspection', punch: 'inspection',
  // general / routine / admin / office / dev
  general: 'general', round: 'general', rounds: 'general', misc: 'general', admin: 'general', office: 'general',
  errand: 'general', supplies: 'general', pickup: 'general', meeting: 'general', paperwork: 'general',
  caliper: 'general', development: 'general', dev: 'general', training: 'general', setup: 'general',
  web: 'general', website: 'general', app: 'general', software: 'general', code: 'general',
};

// normalize a raw tag → a lookup key: lowercase, strip a trailing "-ing"/"s"
const normTag = (raw) => {
  let t = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (TAG_CATEGORY[t]) return t;
  if (t.endsWith('ing') && TAG_CATEGORY[t.slice(0, -3)]) return t.slice(0, -3);
  if (t.endsWith('s') && TAG_CATEGORY[t.slice(0, -1)]) return t.slice(0, -1);
  return t;
};

// every #tag in a note, in order, de-duplicated (raw labels, without the #)
export function parseTags(text) {
  const out = []; const seen = new Set();
  const re = /#([a-z0-9][\w-]*)/gi; let m;
  while ((m = re.exec(String(text || '')))) {
    const raw = m[1]; const k = raw.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(raw); }
  }
  return out;
}

// a tag → its category, or null if unrecognized
export const categoryForTag = (tag) => TAG_CATEGORY[normTag(tag)] || null;

// the category a note implies from its #tags — the first recognized tag wins
// (operators lead with the primary tag). null when no tag maps to a bucket.
export function categoryForText(text) {
  for (const t of parseTags(text)) { const c = categoryForTag(t); if (c) return c; }
  return null;
}

// split a note into display segments for chip rendering: [{tag, category}|{text}]
export function tagSegments(text) {
  const s = String(text || ''); const out = []; let last = 0; let m;
  const re = /#([a-z0-9][\w-]*)/gi;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ tag: m[1], category: categoryForTag(m[1]) });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}
