// ============================================================
// Building Handbook helpers — the section model and a starter template.
// A handbook is an ordered list of sections: { id, title, body, icon }.
// Pure and dependency-free.
// ============================================================

// Starter sections the office can fill in — covers what a tenant/resident
// actually asks: who to call, the rules, what to do in an emergency, what's
// available, and how the building runs. Bodies are prompts, not filler.
export const HANDBOOK_TEMPLATE = [
  { key: 'welcome', icon: '👋', title: 'Welcome', body: 'A short welcome and what this handbook covers.' },
  { key: 'contacts', icon: '📞', title: 'Key contacts', body: 'Management office, maintenance/after-hours line, and who to call for what.' },
  { key: 'emergency', icon: '🚨', title: 'Emergency & safety', body: 'Fire, medical, gas leak, and evacuation steps. Where the exits, extinguishers, and utility shut-offs are.' },
  { key: 'policies', icon: '📋', title: 'Building policies', body: 'Quiet hours, guests, pets, parking, smoking, and moving procedures.' },
  { key: 'amenities', icon: '🏢', title: 'Amenities', body: 'What’s available (laundry, gym, roof, conference room…), hours, and how to use or book them.' },
  { key: 'maintenance', icon: '🔧', title: 'Repairs & requests', body: 'How to report a repair, what’s an emergency, and expected response times.' },
  { key: 'trash', icon: '♻️', title: 'Trash & recycling', body: 'Where it goes, pickup days, and bulk-item rules.' },
];

let _seq = 0;
const genId = () => `hbs_${(_seq += 1)}_${(HANDBOOK_TEMPLATE.length)}`;

// A fresh handbook from the template (new ids so edits are independent).
export function templateSections() {
  return HANDBOOK_TEMPLATE.map((s) => ({ id: genId(), icon: s.icon, title: s.title, body: '' }));
}

// Normalize any stored/authored list into clean section objects, dropping the
// fully-empty ones and guaranteeing an id + string fields.
export function normalizeSections(sections = []) {
  return (Array.isArray(sections) ? sections : [])
    .map((s, i) => ({
      id: s.id || `hbs_${i}`,
      icon: (s.icon || '').toString().slice(0, 4),
      title: (s.title || '').toString(),
      body: (s.body || '').toString(),
    }))
    .filter((s) => s.title.trim() || s.body.trim());
}

// Is there anything worth showing a reader? (used to hide an empty handbook)
export function hasContent(sections = []) {
  return normalizeSections(sections).length > 0;
}
